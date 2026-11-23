"""The pull-based deploy (POLY-100): finds the candidate, verifies all of it, and only then runs anything of it.

Exit codes: 0 done, nothing to do, busy or a transient outage; 1 refused or failed; 4 precondition.
"""
import fcntl
import os
import tempfile

from lib import compose, compose_guard, release as rel, spool, stack
from lib.release import Refusal

LOCK = "/run/polycarpic/deploy.lock"
BACKUP_TIMEOUT = 65 * 60


def take_lock(ctx, wait=0):
    run_dir = ctx.p("/run/polycarpic")
    os.makedirs(run_dir, mode=0o755, exist_ok=True)
    fd = os.open(ctx.p(LOCK), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    start = ctx.epoch()
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fd
        except OSError:
            if ctx.epoch() - start >= wait:
                os.close(fd)
                return None
            ctx.sleep(30)


def locked(project, ctx, first, wait=0, existing_data=False):
    if first:
        early = early_precheck(project, ctx)
        if early:
            return early
    fd = take_lock(ctx, wait)
    if fd is None:
        if first:
            ctx.err("deploy: the deploy lock was not got in %d minutes" % (wait // 60))
            return 4
        rel.log(ctx, project, "busy")
        return 0
    work = None
    try:
        work = tempfile.mkdtemp(prefix="work-", dir=rel.sdir(ctx, project))
        os.chmod(work, 0o700)
        return _deploy(project, ctx, work, first, existing_data)
    finally:
        if work:
            rel.remove_tree(work)
        os.close(fd)


class _Skip(Exception):
    pass


def _deploy(project, ctx, work, first, existing_data):
    seen = {"digest": "-"}
    try:
        tok = rel.token(ctx)
        cur = rel.load_pointer(ctx, project, "current")
        if first and cur:
            raise Refusal("already-deployed", code=4)
        if not first and not cur:
            raise Refusal("not-first-deployed", code=4)
        if first:
            _first_preconditions(project, ctx, existing_data)
        try:
            digest, commit, tag = _candidate(project, ctx, tok, work, cur, seen)
        except _Skip:
            return 0
        rel.log(ctx, project, "candidate", digest, commit)
        rdir, images = _verify(project, ctx, tok, work, digest, commit)
        keep = False
        try:
            _gate(project, ctx, rdir, images, cur)
            rel.log(ctx, project, "verified", digest)
            keep = True
            return _roll_out(project, ctx, rdir, digest, tag, commit, cur, first, existing_data)
        finally:
            if not keep:
                rel.remove_tree(rdir)
    except rel.Transient as err:
        rel.log(ctx, project, "transient", str(err))
        return 0
    except Refusal as err:
        return refuse(project, ctx, err, seen["digest"])


def refuse(project, ctx, err, digest="-"):
    rel.log(ctx, project, "refused", err.name, digest)
    if err.quarantine and digest != "-":
        rel.quarantine(ctx, project, digest, err.name)
    rel.alert(ctx, project, err.name)
    ctx.err("deploy: refused " + err.name)
    return err.code


def _first_preconditions(project, ctx, existing_data):
    data = ctx.p("/srv/polycarpic/pg-" + project)
    if os.path.isdir(data) and os.listdir(data) and not existing_data:
        raise Refusal("existing-data", code=4)


def _candidate(project, ctx, tok, work, cur, seen):
    """R2: -> (digest, commit, tag). Raises _Skip when there is nothing new, or the candidate is quarantined."""
    if project == "staging":
        digest, commit, _ = rel.staging_candidate(ctx, tok, work)
        tag = "-"
    else:
        digest, tag = rel.prod_candidate(ctx, tok, work)
        commit = None
    seen["digest"] = digest
    rel.put(ctx, project, "last-poll", rel.now_utc(ctx) + "\n")
    if cur and cur["digest"] == digest:
        raise _Skip()
    if digest in rel.quarantined(ctx, project):
        rel.log(ctx, project, "quarantined", digest)
        raise _Skip()
    if project == "prod":
        commit = rel.tag_commit(ctx, tag)
        if cur and cur["tag"] != "-" and rel.semver(tag) <= rel.semver(cur["tag"]):
            _not_newer(project, ctx, digest)
    elif cur and not rel.descends(ctx, cur["commit"], commit):
        _not_newer(project, ctx, digest)
    return digest, commit, tag


def _not_newer(project, ctx, digest):
    rel.log(ctx, project, "not-newer", digest)
    raise Refusal("not-newer")


def _verify(project, ctx, tok, work, digest, commit):
    """R3 V1-V5: the app image, then the bundle and each sibling. Nothing of the digest is run. -> (release dir, the four image refs)."""
    ref = rel.verify_image(ctx, tok, work, "polycarpic", digest, commit)
    rdir = rel.extract(ctx, ref, digest)
    try:
        text = open(os.path.join(rdir, "infra/release/images.env"), encoding="utf-8").read()
        siblings = rel.parse_images_env(text)
        for key in rel.IMAGE_KEYS:
            repo, dig = siblings[key]
            rel.verify_image(ctx, tok, work, "polycarpic-" + repo, dig, commit, sibling=repo)
        rel.write_images_env(ctx, rdir, ref, text)
    except BaseException:
        rel.remove_tree(rdir)
        raise
    return rdir, stack.kinds(stack.refs(rdir))


def _gate(project, ctx, rdir, images, cur):
    """V6 (the Postgres major is unchanged) and V7 (the installed guard on the rendered config)."""
    if cur:
        old = rel.ts.read_text(os.path.join(rel.release_dir(ctx, cur["digest"]), "infra/postgres-major"))
        new = rel.ts.read_text(os.path.join(rdir, "infra/postgres-major"))
        if old is None or old.strip() != (new or "").strip():
            raise Refusal("postgres-major", True)
    guard(project, ctx, rdir, images)
    if edge_owner_peek(project, ctx):
        guard("edge", ctx, rdir, images)


def edge_owner_peek(project, ctx):
    """Whether this run will own edge, decided without side effects (the alert for a resolving name is raised in _apply)."""
    if project == "prod":
        return True
    return not (rel.load_pointer(ctx, "prod", "current") or compose.ps(ctx, "polycarpic-prod") or name_resolves(ctx))


def bind_addr(ctx):
    text = rel.ts.read_text(ctx.p("/etc/polycarpic/edge.env")) or ""
    for line in text.splitlines():
        if line.startswith("POLY_BIND_ADDR="):
            return line.split("=", 1)[1]
    return None


def guard(project, ctx, rdir, images):
    policy = compose_guard.load_policy(ctx)
    env_files = ["%s/images.env" % rdir] + ([ctx.p("/etc/polycarpic/edge.env")] if project == "edge" else [])
    raw, plain = compose_guard.renders(ctx, rdir, rel.RELEASES, project, env_files)
    compose_guard.check(policy, project, raw, plain, images, rdir, bind_addr(ctx))


def edge_domain(ctx):
    text = rel.ts.read_text(ctx.p("/etc/polycarpic/edge.env")) or ""
    for line in text.splitlines():
        if line.startswith("POLY_DOMAIN="):
            return line.split("=", 1)[1].strip().strip('"')
    return None


def name_resolves(ctx):
    dom = edge_domain(ctx)
    if not dom:
        return False
    try:
        return bool(ctx.resolve("app." + dom))
    except OSError:
        return False


def edge_exists(ctx):
    """A caddy container exists in the shared edge project (a staging-era or prod one)."""
    return bool(compose.running(compose.ps(ctx, "polycarpic-edge") or [], "caddy")) or any(
        r.get("Service") == "caddy" for r in compose.ps(ctx, "polycarpic-edge") or [])


def edge_owner(project, ctx):
    """R9: who may touch edge in this run. -> "prod" | "staging" | None. A staging-only host's staging run owns it unless app.<domain> resolves."""
    if project == "prod":
        return "prod"
    if rel.load_pointer(ctx, "prod", "current") or compose.ps(ctx, "polycarpic-prod"):
        return None
    if name_resolves(ctx):
        return "name"
    return "staging"


def early_precheck(project, ctx):
    """S15, before anything is touched: the first prod deploy refuses while app.<domain> resolves and a staging-era caddy exists."""
    if project == "prod" and not rel.load_pointer(ctx, "prod", "current") and edge_exists(ctx) and name_resolves(ctx):
        ctx.err("deploy: refused edge-prod-name-early")
        return 4
    return None


# ---- R6 steps 2-9 ----
def _compose(ctx, argv, timeout=600):
    try:
        return ctx.run(argv, timeout=timeout)
    except TimeoutError:
        return 124, "", "timeout"


def _roll_out(project, ctx, rdir, digest, tag, commit, cur, first, existing_data):
    cdir = rel.release_dir(ctx, cur["digest"]) if cur else rdir  # only a first deploy, with no `current`, starts the candidate's Postgres
    _start_postgres(project, ctx, cdir)
    if project == "prod" and (cur or existing_data):
        if cur:
            guard(project, ctx, cdir, stack.kinds(stack.refs(cdir)))
        _premigration(project, ctx)
    backup_fd = None
    if project == "prod":
        backup_fd = spool.lock(ctx, "backup.lock", wait=30 * 60)
        if backup_fd is None:
            raise Refusal("backup-lock")
    try:
        return _apply(project, ctx, rdir, digest, tag, commit, cur, first)
    finally:
        if backup_fd is not None:
            os.close(backup_fd)


def _start_postgres(project, ctx, cdir):
    rows = compose.ps(ctx, "polycarpic-" + project)
    if compose.running(rows, "postgres"):
        return
    code, _, _ = _compose(ctx, stack.up_argv(cdir, project, ["postgres"], ["--no-deps"]))
    if code != 0 or not stack.wait_healthy(ctx, project, cdir, ["postgres"], check_http=False):
        raise Refusal("postgres-start")


def _premigration(project, ctx):
    try:
        code, out, _ = ctx.run(["/usr/local/sbin/polycarpic-ops", "backup", "premigration"], timeout=BACKUP_TIMEOUT)
    except TimeoutError:
        raise Refusal("premigration-timeout")
    last = (out.strip().splitlines() or [""])[-1]
    if code != 0:
        raise Refusal("premigration-%d" % code)
    if not stack.PREMIGRATION.fullmatch(last):
        raise Refusal("premigration-malformed")
    rel.log(ctx, project, "premigration-set", last.split(" ", 1)[1])


def _apply(project, ctx, rdir, digest, tag, commit, cur, first):
    for svc in stack.APP_SERVICES:
        code, _, _ = _compose(ctx, stack.run_argv(rdir, project, svc, [svc, "check-config"]))
        if code != 0:
            raise Refusal("check-config", True)
    code, out, err = _compose(ctx, stack.run_argv(rdir, project, "migrate", ["migrate", "--plan"]))
    if code == 2 and first and "roles-missing" in out + err:
        ctx.err("run: sudo polycarpic-ops provision --stage database --project " + project)
        raise Refusal("roles-missing", code=4)
    if code == 3:
        code, _, _ = _compose(ctx, stack.run_argv(rdir, project, "migrate", ["migrate"]))
        if code == 4:
            raise Refusal("migrate-4")
        if code != 0:
            raise Refusal("migrate-%d" % code, True)
        rel.log(ctx, project, "migrated", digest)
    elif code == 2:
        raise Refusal("plan-diverged", True)
    elif code != 0:
        raise Refusal("plan-error")
    owner = edge_owner(project, ctx)
    skipped = owner == "name"
    owner = None if skipped else owner
    if owner:
        code = _edge_up(project, ctx, rdir, first and project == "prod")
        if code != 0:
            return _rollback_auto(project, ctx, digest, cur)
    code, _, _ = _compose(ctx, stack.up_argv(rdir, project))
    rel.log(ctx, project, "up", digest)
    up_ok = code == 0 and stack.wait_healthy(ctx, project, rdir, stack.services_for(project))
    if up_ok and owner:
        up_ok = stack.wait_healthy(ctx, "edge", rdir, ["caddy"], check_http=False)
    if up_ok:
        code = _healthy(project, ctx, rdir, digest, tag, commit, cur)
        if skipped:  # the alert stays while the name resolves: this run left caddy as it was
            rel.log(ctx, project, "refused", "edge-prod-name", "-")
            rel.alert(ctx, project, "edge-prod-name")
        return code
    return _rollback_auto(project, ctx, digest, cur)


def _caddy_current(ctx, rdir):
    row = compose.running(compose.ps(ctx, "polycarpic-edge"), "caddy")
    want = stack.refs(rdir).get("POLY_CADDY_IMAGE")
    return bool(row) and compose.image_ref(compose.inspect(ctx, row.get("Name", ""))) == want


def _wipe(path):
    for name in os.listdir(path):
        full = os.path.join(path, name)
        if os.path.isdir(full) and not os.path.islink(full):
            rel.remove_tree(full)
        else:
            os.unlink(full)


def _edge_up(project, ctx, rdir, first_prod):
    """R9: bring the shared Caddy up from this release. The first prod deploy stops a staging-era Caddy, empties its state and recreates it."""
    if first_prod:
        old = rel.load_pointer(ctx, "staging", "current")
        if old and edge_exists(ctx):
            odir = rel.release_dir(ctx, old["digest"])
            _compose(ctx, stack.base(odir, "edge", ctx.p("/etc/polycarpic/edge.env")) + ["stop", "caddy"])
            _compose(ctx, stack.base(odir, "edge", ctx.p("/etc/polycarpic/edge.env")) + ["rm", "-f", "caddy"])
        for d in ("/srv/polycarpic/caddy", "/srv/polycarpic/caddy-config"):
            if os.path.isdir(ctx.p(d)):
                _wipe(ctx.p(d))
    if not first_prod and _caddy_current(ctx, rdir):
        return 0  # already running this release's Caddy image: `up` would change nothing
    argv = stack.up_argv(rdir, "edge", ["caddy"], ["--force-recreate"] if first_prod else [], ctx.p("/etc/polycarpic/edge.env"))
    code, _, _ = _compose(ctx, argv)
    return code


def _healthy(project, ctx, rdir, digest, tag, commit, cur):
    if cur:
        rel.save_pointer(ctx, project, "previous", cur)
    rel.save_pointer(ctx, project, "current", dict(digest=digest, tag=tag, commit=commit, tree=stack.tree(rdir), at=rel.now_utc(ctx)))
    link = ctx.p("%s/%s-current" % (rel.RELEASES, project))
    tmp = link + ".new"
    if os.path.lexists(tmp):
        os.unlink(tmp)
    os.symlink(os.path.basename(rdir), tmp)
    os.replace(tmp, link)
    if project == "prod":
        rel.write(ctx, ctx.p("/opt/polycarpic/images.env"), open(os.path.join(rdir, "images.env"), encoding="utf-8").read())
    _prune(ctx)
    rel.clear_alert(ctx, project)
    rel.log(ctx, project, "healthy", digest)
    return 0


def _prune(ctx):
    keep = set()
    for project in ("prod", "staging"):
        for name in ("current", "previous"):
            p = rel.load_pointer(ctx, project, name)
            if p:
                keep.add("sha256-" + p["digest"].split(":", 1)[1])
    root = ctx.p(rel.RELEASES)
    for name in os.listdir(root):
        if name.startswith("sha256-") and name not in keep:
            rel.remove_tree(os.path.join(root, name))


def _rollback_auto(project, ctx, digest, cur):
    """R8: the candidate did not become healthy; put `current` back from its own release, never migrating."""
    rel.quarantine(ctx, project, digest, "unhealthy")
    if cur is None:
        rel.log(ctx, project, "rollback-unhealthy", digest)
        rel.alert(ctx, project, "rollback-unhealthy")
        ctx.err("deploy: rollback-unhealthy")
        return 1
    ok = restore(project, ctx, cur)
    name = "rolled-back" if ok else "rollback-unhealthy"
    rel.log(ctx, project, name, digest)
    rel.alert(ctx, project, name)
    ctx.err("deploy: " + name)
    return 1


def restore(project, ctx, ptr):
    """Bring a recorded release back up: tree-hash re-check, the guard on its render, `up`, health. -> True when healthy."""
    rdir = rel.release_dir(ctx, ptr["digest"])
    if not os.path.isdir(rdir) or stack.tree(rdir) != ptr["tree"]:
        return False
    try:
        guard(project, ctx, rdir, stack.kinds(stack.refs(rdir)))
    except Refusal:
        return False
    code, _, _ = _compose(ctx, stack.up_argv(rdir, project))
    return code == 0 and stack.wait_healthy(ctx, project, rdir, stack.services_for(project))
