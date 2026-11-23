"""The pull-based deploy (POLY-100): finds the candidate, verifies all of it, and only then runs anything of it.

Exit codes: 0 done, nothing to do, busy or a transient outage; 1 refused or failed; 4 precondition.
"""
import fcntl
import os
import tempfile

from lib import compose, compose_guard, guardhelp, release as rel, sauth, spool, stack, tokenexp
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
        tokenexp.refresh(ctx, tok, work)
        cur = rel.load_pointer(ctx, project, "current")
        rel.load_pointer(ctx, project, "previous")  # a present but unparsable pointer stops the run with `state` (S17)
        if cur:  # a leftover first-attempt file beside `current` has no effect and is removed (S19)
            try:
                os.unlink(os.path.join(rel.sdir(ctx, project), "first-attempt"))
            except FileNotFoundError:
                pass
        if first and cur:
            raise Refusal("already-deployed", code=4)
        if not first and not cur:
            raise Refusal("not-first-deployed", code=4)
        fresh = _first_preconditions(project, ctx, existing_data) if first else False
        try:
            digest, commit, tag = _candidate(project, ctx, tok, work, cur, seen)
        except _Skip:
            return 0
        rel.log(ctx, project, "candidate", digest, commit)
        if project == "prod":
            check_staging_auth(ctx)  # before V1: the file is Caddyfile text, and a prod run ups Caddy (S30)
        rdir, images = _verify(project, ctx, tok, work, digest, commit)
        keep = False
        try:
            owner = _gate(project, ctx, rdir, images, cur, commit, tag)
            rel.log(ctx, project, "verified", digest)
            keep = True
            return _roll_out(project, ctx, rdir, digest, tag, commit, cur, first, existing_data, owner, fresh)
        finally:
            if not keep:
                rel.remove_tree(rdir)
    except rel.Transient as err:
        rel.log(ctx, project, "transient", str(err))
        return 0
    except Refusal as err:
        return refuse(project, ctx, err, seen["digest"])


def check_staging_auth(ctx):
    reason = sauth.check(ctx)
    if reason:
        ctx.err("deploy: staging-auth: %s; run polycarpic-ops staging-auth" % reason)
        raise Refusal("staging-auth")


def refuse(project, ctx, err, digest="-"):
    rel.log(ctx, project, "refused", err.name, digest)
    if err.quarantine and digest != "-":
        rel.quarantine(ctx, project, digest, err.name)
    text = err.help_lines or ()
    for line in text:
        rel.log(ctx, project, "help", line)
    rel.alert(ctx, project, err.name, text)
    for line in text:
        ctx.err(line)
    ctx.err("deploy: refused " + err.name)
    return err.code


def _first_preconditions(project, ctx, existing_data):
    """A8: a non-empty data directory needs --existing-data or this project's own `first-attempt` file. -> True when the directory is empty (fresh)."""
    data = ctx.p("/srv/polycarpic/pg-" + project)
    empty = not (os.path.isdir(data) and os.listdir(data))
    if not empty and not existing_data and rel.read(ctx, project, "first-attempt") is None:
        raise Refusal("existing-data", code=4)
    return empty and not existing_data


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


def _gate(project, ctx, rdir, images, cur, commit, tag):
    """V6 (the Postgres major is unchanged) and V7 (the installed guard on the rendered config). A refusal of the CANDIDATE by the guard
    carries the operator text (R10); a refusal of `current` or `previous` elsewhere does not."""
    try:
        return _gate_checks(project, ctx, rdir, images, cur, commit)
    except Refusal as err:
        err.help_lines = guardhelp.lines(ctx, err.name, commit, tag)
        raise


def _gate_checks(project, ctx, rdir, images, cur, commit):
    if project == "prod" and not cur:  # prod takes over from edge once (S23): C equals or descends from edge's commit, else `edge-older` (no Q)
        edge_cur = rel.load_pointer(ctx, "edge", "current")
        if edge_cur and edge_cur["commit"] != commit and not rel.descends(ctx, edge_cur["commit"], commit):
            raise Refusal("edge-older")
    if cur:
        old = rel.ts.read_text(os.path.join(rel.release_dir(ctx, cur["digest"]), "infra/postgres-major"))
        new = rel.ts.read_text(os.path.join(rdir, "infra/postgres-major"))
        if old is None or old.strip() != (new or "").strip():
            raise Refusal("postgres-major", True)
    owner = project == "prod"  # R9 strict: edge is prod's alone; a staging run never renders or ups it
    guard(project, ctx, rdir, images)
    if owner:
        guard("edge", ctx, rdir, images)
    return owner


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



# ---- R6 steps 2-9 ----
def _compose(ctx, argv, timeout=600):
    try:
        return ctx.run(argv, timeout=timeout)
    except TimeoutError:
        return 124, "", "timeout"


def _roll_out(project, ctx, rdir, digest, tag, commit, cur, first, existing_data, owner, fresh):
    cdir = rel.release_dir(ctx, cur["digest"]) if cur else rdir  # only a first deploy, with no `current`, starts the candidate's Postgres
    if cur:  # current's bundle is judged by the installed guard before any container of it is started (S3, S12)
        guard(project, ctx, cdir, stack.kinds(stack.refs(cdir)))
    rerun = first and not cur and not existing_data and rel.read(ctx, project, "first-attempt") is not None  # an earlier attempt of this project
    if fresh:  # an empty data directory and no `current`: a rerun after `roles-missing` may proceed without --existing-data
        rel.put(ctx, project, "first-attempt", rel.now_utc(ctx) + "\n")
    _start_postgres(project, ctx, cdir)
    # S19: a rerun skips the backup only when its own earlier attempt left an empty database; a table, or a failed or unparsable read, requires it
    backup_needed = bool(cur or existing_data or (rerun and not _database_empty(project, ctx, cdir)))
    if project == "prod" and backup_needed:
        try:
            _premigration(project, ctx)
        except Refusal:
            if rerun:
                ctx.err("run: sudo polycarpic-ops provision --stage database --project " + project)
            raise
    backup_fd = None
    if project == "prod":
        backup_fd = spool.lock(ctx, "backup.lock", wait=30 * 60)
        if backup_fd is None:
            raise Refusal("backup-lock")
    try:
        return _apply(project, ctx, rdir, digest, tag, commit, cur, first, owner)
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


SQL_TABLES = ("SET default_transaction_read_only = on;\n"
              "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
              "WHERE c.relkind IN ('r','p','f','m') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast';\n")


def _database_empty(project, ctx, cdir):
    """True only when the project's database holds no table outside the system schemas, read over the container's local socket."""
    argv = stack.base(cdir, project) + ["exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "polycarpic", "-XAtq", "-v", "ON_ERROR_STOP=1"]
    try:
        code, out, _ = ctx.run(argv, stdin=SQL_TABLES, timeout=30)
    except TimeoutError:
        return False
    lines = [l.strip() for l in out.splitlines() if l.strip()]
    return code == 0 and bool(lines) and lines[-1] == "0"


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


def _apply(project, ctx, rdir, digest, tag, commit, cur, first, owner):
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
    owns = bool(owner)  # edge is prod's alone (R9 strict)
    probe, baseline_ok = _probe_baseline(project, ctx, first)
    if owns:
        code = _edge_up(project, ctx, rdir, judged=True)
        if code != 0:
            return _rollback_auto(project, ctx, digest, cur, owns, probe)
    code, _, _ = _compose(ctx, stack.up_argv(rdir, project))
    rel.log(ctx, project, "up", digest)
    extra = probe if baseline_ok else None
    up_ok = code == 0 and stack.wait_healthy(ctx, project, rdir, stack.services_for(project), extra=extra)
    if up_ok and owns:
        up_ok = stack.wait_healthy(ctx, "edge", rdir, ["caddy"], check_http=False, extra=extra)
    if up_ok:
        code = _healthy(project, ctx, rdir, digest, tag, commit, cur)
        if probe and not baseline_ok:  # A13: the probe was not required, and the alert says so even when healthy
            rel.alert(ctx, project, "edge-probe-baseline")
        return code
    return _rollback_auto(project, ctx, digest, cur, owns, probe if baseline_ok else None)


def _probe_baseline(project, ctx, first):
    """A13: prod, real-domain mode, not the first deploy. -> (probe callable or None, baseline was 200). The baseline is asked once before step 8."""
    if project != "prod" or first:
        return None, False
    host_env = rel.ts.read_text(ctx.p("/etc/polycarpic/host.env")) or ""
    if "TLS_MODE=real-domain" not in host_env.splitlines():
        return None, False
    dom = edge_domain(ctx)
    addr = bind_addr(ctx)
    if not dom or not addr:
        return None, False
    host = "app." + dom
    addr = "127.0.0.1" if addr == "0.0.0.0" else addr

    def probe():
        try:
            return ctx.https_status(host, addr, "/api/v1/health") == 200
        except OSError:
            return False

    ok = probe()
    if not ok:
        rel.log(ctx, project, "edge-probe-baseline", host)
    return probe, ok


def _edge_up(project, ctx, rdir, judged=False):
    """R9: bring the shared Caddy up from this prod release. Refuses an edge render this run has not judged."""
    if not judged or project != "prod":
        raise Refusal("guard-edge", True)
    argv = stack.up_argv(rdir, "edge", ["caddy"], [], ctx.p("/etc/polycarpic/edge.env"))
    code, _, _ = _compose(ctx, argv)
    return code


def _healthy(project, ctx, rdir, digest, tag, commit, cur):
    if cur:
        rel.save_pointer(ctx, project, "previous", cur)
    rel.save_pointer(ctx, project, "current", dict(digest=digest, tag=tag, commit=commit, tree=stack.tree(rdir), at=rel.now_utc(ctx)))
    link_current(ctx, project, rdir)
    if project == "prod":
        rel.write(ctx, ctx.p("/opt/polycarpic/images.env"), open(os.path.join(rdir, "images.env"), encoding="utf-8").read())
    _prune(ctx)
    rel.clear_alert(ctx, project)
    try:
        os.unlink(os.path.join(rel.sdir(ctx, project), "first-attempt"))
    except FileNotFoundError:
        pass
    rel.log(ctx, project, "healthy", digest)
    return 0


def link_current(ctx, project, rdir):
    link = ctx.p("%s/%s-current" % (rel.RELEASES, project))
    tmp = link + ".new"
    if os.path.lexists(tmp):
        os.unlink(tmp)
    os.symlink(os.path.basename(rdir), tmp)
    os.replace(tmp, link)


def _prune(ctx):
    keep = set()
    try:
        prod_has_current = bool(rel.load_pointer(ctx, "prod", "current"))
    except Refusal:
        prod_has_current = True
    # edge's current and previous are kept only until prod has a `current` (R4, R9): after that Caddy comes from prod's releases
    for project in ("prod", "staging") + (() if prod_has_current else ("edge",)):
        for name in ("current", "previous"):
            p = rel.load_pointer(ctx, project, name)
            if p:
                keep.add("sha256-" + p["digest"].split(":", 1)[1])
    root = ctx.p(rel.RELEASES)
    for name in os.listdir(root):
        if name.startswith("sha256-") and name not in keep:
            rel.remove_tree(os.path.join(root, name))


def _rollback_auto(project, ctx, digest, cur, owns=False, probe=None):
    """R8: the candidate did not become healthy; put `current` back from its own release, never migrating."""
    rel.quarantine(ctx, project, digest, "unhealthy")
    if cur is None:
        if project == "prod" and owns:  # a first prod deploy that ups Caddy and fails puts Caddy back on edge's `current` (S23); the outcome stays unhealthy
            from lib import edge
            try:
                ptr = rel.load_pointer(ctx, "edge", "current")
            except Refusal:
                ptr = None
            if ptr:
                edge.restore(ctx, ptr, wait_healthy=False)
        rel.log(ctx, project, "rollback-unhealthy", digest)
        rel.alert(ctx, project, "rollback-unhealthy")
        ctx.err("deploy: rollback-unhealthy")
        return 1
    ok = restore(project, ctx, cur, owns, probe)
    name = "rolled-back" if ok else "rollback-unhealthy"
    rel.log(ctx, project, name, digest)
    rel.alert(ctx, project, name)
    ctx.err("deploy: " + name)
    return 1


def restore(project, ctx, ptr, owns=None, probe=None):
    """Bring a recorded release back up: tree-hash re-check, the guard on its render, `up`, health. -> True when healthy.
    Edge is prod's alone (R9 strict): a prod rollback restores Caddy too, a staging one never names it."""
    rdir = rel.release_dir(ctx, ptr["digest"])
    if not os.path.isdir(rdir) or stack.tree(rdir) != ptr["tree"]:
        return False
    owner = project == "prod"
    if owner and sauth.check(ctx):  # nothing is upped when the staging-auth file is wrong (S30)
        return False
    try:
        images = stack.kinds(stack.refs(rdir))
        guard(project, ctx, rdir, images)
        if owner:
            guard("edge", ctx, rdir, images)  # both renders are judged before either `up`
    except Refusal:
        return False
    code, _, _ = _compose(ctx, stack.up_argv(rdir, project))
    ok = code == 0 and stack.wait_healthy(ctx, project, rdir, stack.services_for(project), extra=probe)
    if owner:
        code, _, _ = _compose(ctx, stack.up_argv(rdir, "edge", ["caddy"], [], ctx.p("/etc/polycarpic/edge.env")))
        ok = ok and code == 0 and stack.wait_healthy(ctx, "edge", rdir, ["caddy"], check_http=False, extra=probe)
    return ok
