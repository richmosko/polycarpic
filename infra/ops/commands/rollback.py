"""rollback <prod|staging>: put `previous` back (POLY-100 R8). Makes no GitHub call, never migrates.

Quarantines `current`, re-checks `previous`'s tree hash, runs the installed guard on its render, brings it up and waits for health.
"""
import os

from lib import compose_guard, deployer as deploy, dirs, edge, release as rel

HELP = "rollback prod|staging|edge (bring back the previous release; no network)"
WAIT = 10 * 60


def add_arguments(parser):
    parser.add_argument("project", choices=["prod", "staging", "edge"])


def run(args, ctx):
    project = args.project
    if project == "edge":
        return edge.rollback(ctx)
    fd = deploy.take_lock(ctx, WAIT)
    if fd is None:
        ctx.err("rollback: the deploy lock was not got in 10 minutes")
        return 4
    try:
        try:
            deploy.require_data_mount(ctx)  # F13
            dirs.ensure_shared(ctx, project)  # G1
            compose_guard.check_compose_version(ctx, warn_only=True)  # G10: a rollback warns and goes on
        except rel.Refusal as err:
            ctx.err("rollback: refused %s" % err.name)
            return err.code
        try:
            cur, prev = rel.load_pointer(ctx, project, "current"), rel.load_pointer(ctx, project, "previous")
        except rel.Refusal:
            ctx.err("rollback: a state pointer is present but unparsable: stopped (state)")
            return 1
        if not cur or not prev:
            ctx.err("rollback: there is no previous release")
            return 4
        try:  # G2: restore first, then the records
            ok = deploy.restore(project, ctx, prev)
        except Exception:  # F2: an exception inside the rollback is `rollback-unhealthy`, always with an alert
            ok = False
        code = 0
        try:
            rel.quarantine(ctx, project, cur["digest"], "rollback")
        except Exception:
            ctx.err("rollback: the quarantine line could not be written")
            code = 1
        if not ok:
            deploy._note(ctx, project, "rollback-unhealthy", cur["digest"])
            try:
                rel.alert(ctx, project, "rollback-unhealthy")
            except Exception:
                pass
            ctx.err("rollback: previous release is not healthy")
            return 1
        try:  # the pointers after the restore: a failed write is reported, exit 1, with the old release up
            rel.save_pointer(ctx, project, "current", prev)
            rel.save_pointer(ctx, project, "previous", cur)
            link = ctx.p("%s/%s-current" % (rel.RELEASES, project))
            tmp = link + ".new"
            if os.path.lexists(tmp):
                os.unlink(tmp)
            os.symlink("sha256-" + prev["digest"].split(":", 1)[1], tmp)
            os.replace(tmp, link)
        except Exception:
            ctx.err("rollback: the previous release is up but the pointers could not be written")
            return 1
        deploy._note(ctx, project, "rolled-back", cur["digest"])
        try:
            rel.clear_alert(ctx, project)
        except Exception:
            pass
        return code
    finally:
        os.close(fd)
