"""rollback <prod|staging>: put `previous` back (POLY-100 R8). Makes no GitHub call, never migrates.

Quarantines `current`, re-checks `previous`'s tree hash, runs the installed guard on its render, brings it up and waits for health.
"""
import os

from lib import deployer as deploy, edge, release as rel

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
        rel.quarantine(ctx, project, cur["digest"], "rollback")
        if not deploy.restore(project, ctx, prev):
            rel.log(ctx, project, "rollback-unhealthy", cur["digest"])
            rel.alert(ctx, project, "rollback-unhealthy")
            ctx.err("rollback: previous release is not healthy")
            return 1
        rel.save_pointer(ctx, project, "current", prev)
        rel.save_pointer(ctx, project, "previous", cur)
        link = ctx.p("%s/%s-current" % (rel.RELEASES, project))
        tmp = link + ".new"
        if os.path.lexists(tmp):
            os.unlink(tmp)
        os.symlink("sha256-" + prev["digest"].split(":", 1)[1], tmp)
        os.replace(tmp, link)
        rel.log(ctx, project, "rolled-back", cur["digest"])
        rel.clear_alert(ctx, project)
        return 0
    finally:
        os.close(fd)
