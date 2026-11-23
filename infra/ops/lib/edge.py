"""Edge alone (POLY-100 R9): Caddy before any prod release exists. `edge-deploy <tag>` and `rollback edge`; the pieces prod's takeover shares.

State is state/deploy/edge/ with R10's files and grammar. Nothing but Caddy of the release is ever started, and no other project is touched.
"""
import os
import re
import tempfile

from lib import compose, deployer, release as rel, sauth, stack
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
    work = None
    seen = {"digest": "-"}
    run = {"up": False, "cur": None}
    try:
        rel.clear_incoming(ctx)
        work = tempfile.mkdtemp(prefix="work-", dir=rel.sdir(ctx, "edge"))
        os.chmod(work, 0o700)
        try:
            return _run(tag, ctx, work, seen, run)
        except (rel.Transient, Refusal):
            raise
        except Exception as err:  # F2: one handler: before the first `up` a refusal, after it a rollback to edge's previous
            rel.log(ctx, "edge", "refused", "internal", seen["digest"])
            ctx.err("deploy: internal error: %s" % err.__class__.__name__)
            if not run["up"]:
                rel.alert(ctx, "edge", "internal")
                return 1
            return _unhealthy(ctx, seen["digest"], run["cur"], guarded=True)
    except rel.Transient as err:
        rel.log(ctx, "edge", "transient", str(err))
        deployer.mark_transient(ctx, "edge")
        ctx.err("edge-deploy: transient: %s" % err)  # F7: a foreground command says why it did nothing
        return 1
    except Refusal as err:
        return deployer.refuse("edge", ctx, err, seen["digest"])
    finally:
        if work:
            rel.remove_tree(work)
        if run["up"]:
            try:
                os.unlink(os.path.join(rel.sdir(ctx, "edge"), "in-progress"))
            except OSError:
                pass
        os.close(fd)


def _run(tag, ctx, work, seen, run):
    why = owned_by_prod(ctx)
    if why:
        raise why
    deployer.require_data_mount(ctx)
    cur = rel.load_pointer(ctx, "edge", "current")
    rel.load_pointer(ctx, "edge", "previous")
    run["cur"] = cur
    deployer._handle_interrupted("edge", ctx, cur)
    if cur:
        n_cur, n = number(cur["tag"]), number(tag)
        if n_cur is not None and n < n_cur:
            raise Refusal("not-newer")
    tok = rel.token(ctx)
    digest = _release(ctx, tok, work, tag)
    seen["digest"] = digest
    if cur and cur["tag"] == tag:
        if cur["digest"] == digest:
            return 0
        raise Refusal("not-newer")
    if digest in rel.quarantined(ctx, "edge"):
        rel.log(ctx, "edge", "quarantined", digest)
        raise Refusal("quarantined")
    commit = rel.tag_commit(ctx, tag)
    rel.log(ctx, "edge", "candidate", digest, commit)
    deployer.check_edge_env(ctx)  # F10, before V1
    deployer.check_staging_auth(ctx)
    rdir, images, created = deployer._verify("edge", ctx, tok, work, digest, commit)
    deployer.clear_transient(ctx, "edge")
    keep = False
    try:
        try:
            deployer.guard("edge", ctx, rdir, images)
        except Refusal as err:
            err.help_lines = deployer.guardhelp.lines(ctx, err.name, commit, tag, again="sudo polycarpic-ops edge-deploy " + tag)
            raise
        rel.log(ctx, "edge", "verified", digest)
        keep = True
        return _up(ctx, rdir, digest, tag, commit, cur, rdir, run)
    finally:
        if not keep and created:
            rel.remove_created(ctx, rdir, digest)


def _up(ctx, rdir, digest, tag, commit, cur, judged_dir, run):
    if os.path.normpath(judged_dir) != os.path.normpath(rdir):  # F9: only the directory whose edge render was judged is upped
        raise Refusal("guard-edge", True)
    rel.put(ctx, "edge", "in-progress", digest + "\n")
    run["up"] = True
    head = stack.up_argv(rdir, "edge", ["caddy"], [], ctx.p(EDGE_ENV))  # only Caddy of this release is started
    code, _, _ = deployer._compose(ctx, head)
    rel.log(ctx, "edge", "up", digest)
    ok = code == 0 and stack.wait_healthy(ctx, "edge", rdir, ["caddy"], check_http=False)
    if ok:
        _promote(ctx, rdir, digest, tag, commit, cur)
        return 0
    rel.quarantine(ctx, "edge", digest, "unhealthy")
    return _unhealthy(ctx, digest, cur)


def _unhealthy(ctx, digest, cur, guarded=False):
    try:
        restored = bool(cur) and restore(ctx, cur)
    except Exception:
        restored = False
    name = "rolled-back" if restored else "rollback-unhealthy"
    rel.log(ctx, "edge", name, digest)
    rel.alert(ctx, "edge", name)
    ctx.err("deploy: " + name)
    return 1


def _promote(ctx, rdir, digest, tag, commit, cur):
    if cur:
        rel.save_pointer(ctx, "edge", "previous", cur)
    rel.save_pointer(ctx, "edge", "current", dict(digest=digest, tag=tag, commit=commit, tree=stack.tree(rdir), at=rel.now_utc(ctx)))
    deployer.link_current(ctx, "edge", rdir)
    deployer._prune(ctx)
    rel.clear_alert(ctx, "edge")
    rel.log(ctx, "edge", "healthy", digest)


def restore(ctx, ptr, wait_healthy=True):
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
        deployer.guard("edge", ctx, rdir, stack.kinds(stack.refs(rdir)))
    except Refusal:
        return False
    code, _, _ = deployer._compose(ctx, stack.up_argv(rdir, "edge", ["caddy"], [], ctx.p(EDGE_ENV)))
    if code != 0:
        return False
    return stack.wait_healthy(ctx, "edge", rdir, ["caddy"], check_http=False) if wait_healthy else True


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
        except Refusal as err:
            ctx.err("rollback: refused %s" % err.name)
            return err.code
        try:
            cur, prev = rel.load_pointer(ctx, "edge", "current"), rel.load_pointer(ctx, "edge", "previous")
        except Refusal:
            ctx.err("rollback: a state pointer is present but unparsable: stopped (state)")
            return 1
        if not cur or not prev:
            ctx.err("rollback: there is no previous edge release")
            return 4
        rel.quarantine(ctx, "edge", cur["digest"], "rollback")
        try:
            ok = restore(ctx, prev)
        except Exception:
            ok = False
        if not ok:
            rel.log(ctx, "edge", "rollback-unhealthy", cur["digest"])
            rel.alert(ctx, "edge", "rollback-unhealthy")
            ctx.err("rollback: previous edge release is not healthy")
            return 1
        rel.save_pointer(ctx, "edge", "current", prev)
        rel.save_pointer(ctx, "edge", "previous", cur)
        deployer.link_current(ctx, "edge", rel.release_dir(ctx, prev["digest"]))
        rel.log(ctx, "edge", "rolled-back", cur["digest"])
        rel.clear_alert(ctx, "edge")
        return 0
    finally:
        os.close(fd)
