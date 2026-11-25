"""Edge alone (POLY-100 R9): Caddy before any prod release exists. `edge-deploy <tag>` and `rollback edge`; the pieces prod's takeover shares.

State is state/deploy/edge/ with R10's files and grammar. Nothing but Caddy of the release is ever started, and no other project is touched.
"""
import os
import re
import tempfile

from lib import compose, compose_guard, deployer, dirs, release as rel, sauth, stack
from lib.release import Refusal

EDGE_TAG = re.compile(r"edge-(0|[1-9][0-9]*)")
WAIT = 10 * 60
EDGE_ENV = "/etc/polycarpic/edge.env"
BODY = rel.BODY


def number(tag):
    m = EDGE_TAG.fullmatch(tag or "")
    return int(m.group(1)) if m else None


def owned_by_prod(ctx):
    """R9 step 2, read after the lock is held (S28): prod has a `current` (a damaged one counts as present, S17/S23) or any `polycarpic-prod`
    container is listed by `compose ps -a` (a failed or unparsable listing counts as one, because a lost state directory reads as "no prod").
    -> None, or the Refusal to raise: `edge-owned-by-prod` (exit 4) or `state` (exit 1)."""
    try:
        if rel.load_pointer(ctx, "prod", "current"):
            return Refusal("edge-owned-by-prod", code=4)
    except Refusal:
        return Refusal("state", code=1)
    try:
        rows = compose.ps(ctx, "polycarpic-prod")
    except (TimeoutError, OSError, ValueError):
        rows = None
    if rows is None or rows:
        return Refusal("edge-owned-by-prod", code=4)
    return None


def _release(ctx, tok, work, tag):
    """Step 4: the Release for exactly this tag: non-draft, tag_name equal, a body of exactly one digest line. -> digest."""
    data = rel.gh_json(ctx, tok, work, "repos/%s/releases/tags/%s" % (rel.SLUG, tag))
    if not isinstance(data, dict) or data.get("tag_name") != tag or data.get("draft") or data.get("prerelease"):
        raise Refusal("malformed")
    m = BODY.fullmatch(data.get("body") if isinstance(data.get("body"), str) else "")
    if not m:
        raise Refusal("malformed")
    return m.group(1)


def deploy(tag, ctx):
    """-> exit code. The tag form is checked before anything else, including any network call."""
    if number(tag) is None:
        ctx.err("edge-deploy: the tag must match edge-<n> (n without leading zeros)")
        return 2
    fd = deployer.take_lock(ctx, WAIT)
    if fd is None:
        ctx.err("edge-deploy: the deploy lock was not got in 10 minutes")
        return 4
    seen = {"digest": "-"}
    run = deployer.new_run()
    try:
        try:
            dirs.ensure_shared(ctx, "edge")
        except Refusal as err:
            return deployer.refuse("edge", ctx, err)
        rel.clear_incoming(ctx)
        with deployer._Signals():
            try:
                code = _handled(tag, ctx, seen, run)
            except BaseException as exc:
                if not isinstance(exc, Exception):
                    deployer.on_interrupt("edge", ctx, run)
                raise
            finally:
                if run["work"]:
                    rel.remove_tree(run["work"])
        if run["stuck"] and not run["healthy"]:
            return deployer.stuck_end("edge", ctx, run)
        return code
    finally:
        os.close(fd)


def _handled(tag, ctx, seen, run):
    try:
        try:
            return _run(tag, ctx, seen, run)
        except (rel.Transient, Refusal, deployer._Stop):
            raise
        except Exception as err:  # F2: one handler: before the first `up` a refusal, after it the unwind to edge's previous
            ctx.err("deploy: internal error: %s" % err.__class__.__name__)
            if run["committed"]:
                return deployer.after_commit("edge", ctx)
            if not run["up"]:
                try:
                    rel.alert(ctx, "edge", "internal")
                except Exception:
                    pass
                deployer._note(ctx, "edge", "refused", "internal", seen["digest"])
                ctx.err("deploy: refused internal")
                return 1
            return _unhealthy(ctx, seen["digest"], run["cur"], run, why="internal")
    except rel.Transient as err:
        deployer._note(ctx, "edge", "transient", str(err))
        deployer.mark_transient(ctx, "edge")
        ctx.err("edge-deploy: transient: %s" % err)  # F7: a foreground command says why it did nothing
        return 1
    except Refusal as err:
        if run["committed"]:
            return deployer.after_commit("edge", ctx)
        if run["up"]:  # G2: a refusal after the first `up` restores first
            return _unhealthy(ctx, seen["digest"], run["cur"], run, reason=err.name if err.quarantine else "held-" + err.name, why=err.name)
        return deployer.refuse("edge", ctx, err, seen["digest"])
    except deployer._Stop as stop:
        return stop.code


def _run(tag, ctx, seen, run):
    why = owned_by_prod(ctx)
    if why:
        raise why
    deployer.require_data_mount(ctx)
    cur = rel.load_pointer(ctx, "edge", "current")
    run["cur"], run["loaded"] = cur, True
    deployer.recover("edge", ctx, cur, run)  # R1: before edge.env, Compose, the tag rules or any network call
    deployer.end_if_unreadable_stuck(run)
    work = tempfile.mkdtemp(prefix="work-", dir=rel.sdir(ctx, "edge"))
    run["work"] = work
    os.chmod(work, 0o700)
    deployer.check_edge_env(ctx)  # F10, before any network call and so before V1
    compose_guard.check_compose_version(ctx)  # G10, before any network call
    rel.load_pointer(ctx, "edge", "previous")
    if cur:
        n_cur, n = number(cur["tag"]), number(tag)
        if n_cur is not None and n < n_cur:
            raise Refusal("not-newer")
    tok = rel.token(ctx)
    digest = _release(ctx, tok, work, tag)
    seen["digest"] = digest
    if run["stuck"] and digest == run["stuck_digest"]:  # R1.4: the stuck candidate is not tried again; a different digest may deploy
        return 0
    if cur and cur["tag"] == tag:
        if cur["digest"] == digest:
            return 0
        raise Refusal("not-newer")
    if digest in rel.quarantined(ctx, "edge"):
        rel.log(ctx, "edge", "quarantined", digest)
        raise Refusal("quarantined")
    commit = rel.tag_commit(ctx, tag)
    rel.log(ctx, "edge", "candidate", digest, commit)
    deployer.check_staging_auth(ctx)
    rdir, images, created = deployer._verify("edge", ctx, tok, work, digest, commit)
    deployer.clear_transient(ctx, "edge")
    keep = False
    try:
        try:
            judged = deployer.guard("edge", ctx, rdir, images)
        except Refusal as err:
            err.help_lines = deployer.guardhelp.lines(ctx, err.name, commit, tag, again="sudo polycarpic-ops edge-deploy " + tag)
            raise
        rel.log(ctx, "edge", "verified", digest)
        keep = True
        return _up(ctx, rdir, digest, tag, commit, cur, judged, run)
    finally:
        if not keep and created:
            rel.remove_created(ctx, rdir, digest)


def _up(ctx, rdir, digest, tag, commit, cur, judged, run):
    compose_guard.verify(judged, "edge", digest)  # F9, before anything is marked or started
    rel.put(ctx, "edge", "in-progress", digest + "\n")
    run["up"] = True
    code = deployer._edge_up(ctx, judged, digest)  # only Caddy of this release is started
    deployer._note(ctx, "edge", "up", digest)
    ok = code == 0 and stack.wait_healthy(ctx, "edge", rdir, ["caddy"], check_http=False, judged=judged)
    if ok:
        return _promote(ctx, rdir, digest, tag, commit, cur, run)
    return _unhealthy(ctx, digest, cur, run)


def _unhealthy(ctx, digest, cur, run=None, reason="unhealthy", why=None):
    """G2: edge's unwind: edge's previous release first, then the records, none able to stop the next."""
    return deployer.unwind("edge", ctx, digest, lambda: bool(cur) and deployer._restore_cur("edge", ctx, cur), reason, why, run)


def _promote(ctx, rdir, digest, tag, commit, cur, run):
    deployer.commit("edge", ctx, cur, dict(digest=digest, tag=tag, commit=commit), run)
    if run.get("rescued"):
        return deployer.after_commit("edge", ctx)
    return 0 if deployer.settle("edge", ctx, rdir, digest) else 1


def restore(ctx, ptr, wait_healthy=True, keep=False):
    """Caddy back on a recorded edge release: its directory safely owned (F8), tree hash, the staging-auth file, the guard on its edge render,
    `up`. -> True when it is up (and healthy)."""
    rdir = rel.release_dir(ctx, ptr["digest"])
    if not os.path.isdir(rdir) or not rel.owned_safely(ctx, rdir):
        return False
    try:
        if stack.tree(rdir) != ptr["tree"]:
            return False
    except Refusal:
        return False
    if sauth.check(ctx):
        return False
    try:
        judged = deployer.guard("edge", ctx, rdir, stack.kinds(stack.refs(rdir)), restore=True, keep=keep)  # in memory; written only when the bytes differ (S36)
        code = deployer._edge_up(ctx, judged, ptr["digest"])
    except Refusal:
        return False
    if code != 0:
        return False
    return stack.wait_healthy(ctx, "edge", rdir, ["caddy"], check_http=False, judged=judged) if wait_healthy else True


def rollback(ctx):
    """`rollback edge`: R8's manual rule, refusing on step 2's conditions read after the lock."""
    fd = deployer.take_lock(ctx, WAIT)
    if fd is None:
        ctx.err("rollback: the deploy lock was not got in 10 minutes")
        return 4
    try:
        why = owned_by_prod(ctx)
        if why:
            ctx.err("rollback: refused %s" % why.name)
            return why.code
        try:
            deployer.require_data_mount(ctx)
            dirs.ensure_shared(ctx, "edge")  # G1
            compose_guard.check_compose_version(ctx, warn_only=True)  # G10: a rollback warns and goes on
        except Refusal as err:
            ctx.err("rollback: refused %s" % err.name)
            return err.code
        try:
            cur, prev = rel.load_pointer(ctx, "edge", "current"), rel.load_pointer(ctx, "edge", "previous")
        except Refusal:
            ctx.err("rollback: a state pointer is present but unparsable: stopped (state)")
            return 1
        code = deployer.recovered_first("edge", ctx, cur)
        if code is not None:
            return code
        if not cur or not prev or prev["digest"] == cur["digest"]:
            ctx.err("rollback: there is no previous edge release")
            return 4
        try:  # G2: restore first, then the records
            ok = restore(ctx, prev)
        except Exception:
            ok = False
        code = 0
        try:
            rel.quarantine(ctx, "edge", cur["digest"], "rollback")
        except Exception:
            ctx.err("rollback: the quarantine line could not be written")
            code = 1
        if not ok:
            deployer._note(ctx, "edge", "rollback-unhealthy", cur["digest"])
            try:
                rel.alert(ctx, "edge", "rollback-unhealthy")
            except Exception:
                pass
            ctx.err("rollback: previous edge release is not healthy")
            return 1
        try:
            rel.save_pointer(ctx, "edge", "current", prev)
            rel.save_pointer(ctx, "edge", "previous", cur)
            deployer.link_current(ctx, "edge", rel.release_dir(ctx, prev["digest"]))
        except Exception:
            try:
                rel.alert(ctx, "edge", "rollback-pointers")
            except Exception:
                pass
            ctx.err("rollback: the previous release is up but the pointers could not be written; free space and run rollback again")
            return 1
        deployer._note(ctx, "edge", "rolled-back", cur["digest"])
        try:
            rel.clear_alert(ctx, "edge")
            deployer._unlink(ctx, "edge", "in-progress")  # a healthy end clears the mark
        except Exception:
            pass
        return code
    finally:
        os.close(fd)
