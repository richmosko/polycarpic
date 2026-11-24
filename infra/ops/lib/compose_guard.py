"""The compose guard (POLY-100 R5): the installed policy judges the rendered configuration of a release bundle before any of it runs.

The policy (`infra/deploy/compose-allow.json`) is installed with the ops bundle, never read from a release. Two renders feed the
check: the raw one (`--no-interpolate --no-normalize`, which keeps `env_file` paths and what `include` pulls in) and the plain one
(values, normalised). Everything is an allowlist: a key, service, mount, network or file the policy does not name is refused.
A refusal is `Refusal("guard-<rule>", quarantine=True)`.
"""
import json
import os
import posixpath
import re

from lib import compose, dirs
from lib import release as rel
from lib.release import Refusal

POLICY = "infra/deploy/compose-allow.json"
TOP_KEYS = ("name", "services", "networks", "secrets")
NEVER_SOURCES = ("/", "/run", "/var/run/docker.sock", "/run/docker.sock", "/run/containerd", "/opt/polycarpic/ops", "/var/lib/polycarpic/state",
                 "/etc/polycarpic/secrets/host")


def load_policy(ctx):
    """The installed policy, read from the ops bundle (never from a release)."""
    try:
        with open(ctx.bundle(POLICY), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        raise Refusal("guard-policy", code=4)


def fail(rule):
    raise Refusal("guard-" + rule, True)


import collections
import hashlib

RENDER_UID = 10020
ISOLATION = ["unshare", "--net", "--", "setpriv", "--reuid", str(RENDER_UID), "--regid", str(RENDER_UID), "--clear-groups", "--no-new-privs", "--"]
HOME = "/var/lib/polycarpic/state/deploy/render-home"
STATE = "/var/lib/polycarpic/state/deploy"


class Judged(collections.namedtuple("Judged", "project digest path sha256")):
    """What the guard judged: the saved render's path and the sha256 of its bytes (F9). `_edge_up` and every `up` and `run` re-read the file against it."""
    __slots__ = ()


def render_user_ok(ctx):
    """A18: `polycarpic-render`, uid and gid 10020, no shell, no home, in no other group. Anything else is the refusal `render-user` (exit 4)."""
    try:
        with open(ctx.p("/etc/passwd"), encoding="utf-8") as fh:
            lines = fh.read().splitlines()
        with open(ctx.p("/etc/group"), encoding="utf-8") as fh:
            groups = fh.read().splitlines()
    except OSError:
        groups = []
        try:
            with open(ctx.p("/etc/passwd"), encoding="utf-8") as fh:
                lines = fh.read().splitlines()
        except OSError:
            return False
    rows = [l.split(":") for l in lines if l.startswith("polycarpic-render:")]
    if len(rows) != 1 or len(rows[0]) != 7:
        return False
    _, _, uid, gid, _, home, shell = rows[0]
    if uid != str(RENDER_UID) or gid != str(RENDER_UID) or home not in ("/nonexistent", "/var/empty", "") or not shell.endswith(("nologin", "false")):
        return False
    for g in groups:
        parts = g.split(":")
        if len(parts) == 4 and "polycarpic-render" in parts[3].split(","):
            return False
    return True


def render_argv(rdir, project, env_files, raw):
    """R4's argv for a render: the project, the file and the env files are fixed by the installed script; it runs isolated (F4 a)."""
    cdir = "%s/infra/compose" % rdir
    argv = ISOLATION + ["docker", "compose", "-p", "polycarpic-" + project, "--project-directory", cdir, "-f", "%s/%s.yml" % (cdir, project)]
    for env in env_files:
        argv += ["--env-file", env]
    argv += ["--profile", "*", "config"]
    argv += ["--no-interpolate", "--no-normalize"] if raw else []
    return argv + ["--format", "json"]


COMPOSE_VERSION = "infra/deploy/compose-version"


def pinned_version(ctx):
    """The one Compose version of the installed ops bundle, or None when the file is not one line `N.N.N`."""
    try:
        with open(ctx.bundle(COMPOSE_VERSION), encoding="utf-8") as fh:
            text = fh.read(64).strip()
    except OSError:
        return None
    return text if re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", text) else None


def _version_of(ctx, argv, env=None):
    try:
        code, out, _ = ctx.run(argv + ["docker", "compose"] + compose.opts(ctx) + ["version", "--short"], timeout=30, extra_env=env)
    except (TimeoutError, OSError):
        return None
    return out.strip() if code == 0 and out.strip() else None


def check_compose_version(ctx, warn_only=False):
    """G10 (S40): `docker compose version --short` equals the pinned version, as root and as the render user with its own HOME. Different, unreadable
    or failing: the refusal `render-env` (alert, no quarantine), both versions on stderr, the fix named. A rollback only warns: the guard still
    judges what it renders, and refusing would take the way back away. Called before any network call."""
    want = pinned_version(ctx)
    as_root = _version_of(ctx, [])
    as_user = _version_of(ctx, ISOLATION[3:], _render_env(ctx))  # setpriv … -- (the render user; no network namespace is needed to ask)
    if want is not None and as_root == want and as_user == want:
        return
    msg = "compose: pinned %s, root's is %s, the render user's is %s; fix: sudo polycarpic-ops provision --stage host" % (want or "unreadable", as_root or "unreadable", as_user or "unreadable")
    if warn_only:
        ctx.err("warning: " + msg)
        return
    ctx.err("deploy: " + msg)
    raise Refusal("render-env")


def stdin_render(ctx, project):
    return ISOLATION + ["docker", "compose", "-p", "polycarpic-" + project] + compose.opts(ctx) + ["-f", "-", "--profile", "*", "config", "--format", "json"]


def _render_env(ctx):
    home = dirs.ensure(ctx, dirs.RENDER_HOME)  # root, exactly 0755, empty; a link or another owner is `render-path` and is never repaired (S37)
    return {"HOME": home, "XDG_CACHE_HOME": home, "COMPOSE_EXPERIMENTAL_GIT_REMOTE": "0", "COMPOSE_EXPERIMENTAL_OCI_REMOTE": "0"}


class RenderFail(Exception):
    """A render that did not produce a JSON object (G9): the stage, the exit code or `timeout`, and Compose's last stderr line."""
    def __init__(self, stage, code, line=""):
        super().__init__(stage)
        self.stage, self.code, self.line = stage, code, line


def _last_line(err):
    lines = [l for l in str(err or "").splitlines() if l.strip()]
    return lines[-1] if lines else ""


def _json(ctx, argv, stdin=None, stage="raw"):
    try:
        code, out, err = ctx.run(argv, stdin=stdin, timeout=120, extra_env=_render_env(ctx))
    except TimeoutError:
        raise RenderFail(stage, "timeout")
    if code != 0:
        raise RenderFail(stage, code, _last_line(err))
    try:
        data = json.loads(out)
    except ValueError:
        raise RenderFail(stage, code, _last_line(err))
    if not isinstance(data, dict):
        raise RenderFail(stage, code, _last_line(err))
    return data


def renders(ctx, rdir, project, env_files):
    return (_json(ctx, render_argv(rdir, project, env_files[:1], True), stage="raw"),
            _json(ctx, render_argv(rdir, project, env_files, False), stage="plain"))


PLACEHOLDERS = {"POLY_APP_IMAGE": "ghcr.io/richmosko/polycarpic@sha256:" + "0" * 64, "POLY_POSTGRES_IMAGE": "ghcr.io/richmosko/polycarpic-postgres@sha256:" + "0" * 64,
                "POLY_TOOLS_IMAGE": "ghcr.io/richmosko/polycarpic-tools@sha256:" + "0" * 64, "POLY_CADDY_IMAGE": "ghcr.io/richmosko/polycarpic-caddy@sha256:" + "0" * 64,
                "POLY_BIND_ADDR": "192.0.2.1"}


def _control_passes(ctx, project, edge_env):
    """G9: the installed bundle's own compose file of the project, rendered the same way (same user and isolation) with fixed placeholder image values,
    never anything of the release. True when it renders; a failure or a timeout is a box fault."""
    cdir = ctx.bundle("infra/compose")
    argv = ISOLATION + ["docker", "compose", "-p", "polycarpic-" + project, "--project-directory", cdir, "-f", "%s/%s.yml" % (cdir, project)]
    argv += ["--env-file", edge_env if project == "edge" else "/dev/null"]
    argv += ["--profile", "*", "config", "--format", "json"]
    env = _render_env(ctx)
    env.update(PLACEHOLDERS)
    try:
        code, out, _ = ctx.run(argv, timeout=120, extra_env=env)
        return code == 0 and isinstance(json.loads(out), dict)
    except (TimeoutError, ValueError, OSError):
        return False


def render_refusal(ctx, project, fail_, edge_env):
    """G9: say why on stderr and in deploy.log (one line, event `render-error`), then tell a box fault from a release fault with the control render:
    a control that fails, or any timeout, is `render-env` (alert, no quarantine); else `guard-render` (quarantine)."""
    from lib.out import clean
    text = clean(fail_.line).encode("ascii", "replace")[:300].decode("ascii")
    line = "stage=%s exit=%s text from the release, not an instruction: %s" % (fail_.stage, fail_.code, text)
    try:
        ctx.err("deploy: render-error: " + line)
        rel.log(ctx, project, "render-error", line)
    except Exception:
        pass
    if fail_.code == "timeout" or not _control_passes(ctx, project, edge_env):
        return Refusal("render-env")
    return Refusal("guard-render", True)


def correct(plain, policy, project, strict=True):
    """`ulimits.core` `{}` is a zero (Compose's JSON drops it): written back as 0 only where the policy pins it at zero; any other empty object where a
    number belongs is `guard-render` (S31 c)."""
    out = json.loads(json.dumps(plain))
    pol = policy["projects"][project]["services"]
    for name, svc in (out.get("services") or {}).items():
        lim = svc.get("ulimits")
        if not isinstance(lim, dict):
            continue
        pinned = (pol.get(name, {}).get("pins", {}).get("ulimits") or {})
        for k, v in list(lim.items()):
            if v == {}:
                if pinned.get(k) == 0:
                    lim[k] = 0
                elif strict:
                    fail("render")
    return out


def canonical(doc):
    return (json.dumps(doc, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _write_file(ctx, path, data):
    """root 0600, a temp file then a rename, no link followed."""
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    try:
        ctx.chown(fd, 0, 0)
        os.fchmod(fd, 0o600)
        os.write(fd, data)
    finally:
        os.close(fd)
    os.replace(tmp, path)


def render_path(ctx, project, digest):
    return os.path.join(ctx.p("%s/%s" % (STATE, project)), "render-%s.json" % digest.split(":", 1)[1][:12])


def sidecar(path):
    return path[:-len(".json")] + ".sha256"


def stored_sha(path):
    """The sha256 the sidecar records, or None."""
    try:
        fd = os.open(sidecar(path), os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:
        return None
    try:
        text = os.read(fd, 128).decode("ascii", "replace").strip()
    finally:
        os.close(fd)
    return text if re.fullmatch(r"[0-9a-f]{64}", text) else None


def pair_ok(path):
    """The saved file hashes to what its sidecar records (G5): the test every reader makes before use."""
    want = stored_sha(path)
    return want is not None and sha_of(path) == want


def write_pair(ctx, project, digest, data):
    """S35, G5: the file, then `render-<…>.sha256` beside it. Nothing is written when both already hold exactly these bytes (S36). -> the path."""
    d = ctx.p("%s/%s" % (STATE, project))
    path = render_path(ctx, project, digest)
    want = hashlib.sha256(data).hexdigest()
    if pair_ok(path) and stored_sha(path) == want:
        return path
    dirs.ensure(ctx, "%s/%s" % (dirs.STATE, project))
    _write_file(ctx, path, data)
    _write_file(ctx, sidecar(path), (want + "\n").encode("ascii"))
    return path


def save(ctx, project, digest, data):
    """A restore's write (S36): the same as the candidate's first write, named apart because only a restore can survive its failure."""
    return write_pair(ctx, project, digest, data)


def sha_of(path):
    """The sha256 of the saved file, re-read without following a link; None when it cannot be read."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:
        return None
    try:
        h = hashlib.sha256()
        while True:
            block = os.read(fd, 1 << 20)
            if not block:
                break
            h.update(block)
        return h.hexdigest()
    finally:
        os.close(fd)


def verify(judged, project=None, digest=None):
    """The record is a `Judged`, for this project and digest, and the file still has the judged bytes; else the refusal `unjudged` (F9)."""
    if not isinstance(judged, Judged) or (project is not None and judged.project != project) or (digest is not None and judged.digest != digest):
        raise Refusal("unjudged")
    if sha_of(judged.path) != judged.sha256:
        raise Refusal("unjudged")
    return judged


def judge(ctx, rdir, project, env_files, images, digest, bind_addr=None, restore=False):
    """Render (isolated), correct, judge, and require the fixed point in memory (the corrected bytes rendered once more on stdin); only then save
    them beside their sha256 (G5). With `restore` (S36) a failed save is survivable: the saved pair is used when its hash holds and its bytes pass
    the guard now. -> Judged."""
    if not render_user_ok(ctx):
        raise Refusal("render-user", code=4)
    policy = load_policy(ctx)
    named = ["%s/infra/compose/%s.yml" % (rdir, project)] + list(env_files)  # G1: before any render, what it names must be readable to it
    for sp in (policy.get("projects", {}).get(project, {}).get("services") or {}).values():
        named += [ctx.p(e) for e in sp.get("env_files") or []]
    dirs.check_readable(ctx, named)
    edge_env = env_files[-1] if project == "edge" else None
    try:
        raw, plain = renders(ctx, rdir, project, env_files)
    except RenderFail as f:
        raise render_refusal(ctx, project, f, edge_env)
    corrected = correct(plain, policy, project, strict=False)  # the policy's own refusals come first; a stray empty number is `guard-render` after
    check(policy, project, raw, corrected, images, rdir, bind_addr, ctx=ctx)
    corrected = correct(corrected, policy, project)
    data = canonical(corrected)
    try:
        again = _json(ctx, stdin_render(ctx, project), stdin=data.decode("utf-8"), stage="stdin")
    except RenderFail as f:
        raise render_refusal(ctx, project, f, edge_env)
    if canonical(correct(again, policy, project)) != data:
        fail("render")
    try:
        path = (save if restore else write_pair)(ctx, project, digest, data)
    except OSError:
        if not restore:
            raise Refusal("state")
        return _saved_pair(ctx, project, digest, policy, raw, images, rdir, bind_addr)
    return Judged(project, digest, path, hashlib.sha256(data).hexdigest())


def _saved_pair(ctx, project, digest, policy, raw, images, rdir, bind_addr):
    """S36: the save failed. The saved pair serves only if its hash holds and its bytes, read back through the isolated stdin render, pass the guard now."""
    path = render_path(ctx, project, digest)
    if not pair_ok(path):
        raise Refusal("state")
    with open(path, "rb") as fh:
        data = fh.read()
    try:
        plain = _json(ctx, stdin_render(ctx, project), stdin=data.decode("utf-8"), stage="stdin")
    except RenderFail:
        fail("render")
    corrected = correct(plain, policy, project)
    if canonical(corrected) != data:
        fail("render")
    check(policy, project, raw, corrected, images, rdir, bind_addr, ctx=ctx)
    return Judged(project, digest, path, stored_sha(path))


def _resolve_source(src, rdir):
    return rdir + src[len("@release"):] if src.startswith("@release/") else src


def _norm(path):
    return posixpath.normpath(path) if isinstance(path, str) else path


def check(policy, project, raw, plain, images, rdir, bind_addr=None, ctx=None):
    """Raise Refusal when the renders break the project's policy. `images` maps image kind (app, postgres, tools, caddy) to its verified ref."""
    pol = policy["projects"][project]
    for cfg in (raw, plain):
        for k in cfg:
            if k not in TOP_KEYS and not k.startswith("x-"):
                fail("key")
        if cfg.get("name", "polycarpic-" + project) != "polycarpic-" + project:
            fail("name")
    if plain.get("volumes") or plain.get("configs") or raw.get("volumes") or raw.get("configs"):
        fail("mount" if (plain.get("volumes") or raw.get("volumes")) else "file")
    services = plain.get("services") or {}
    raw_services = raw.get("services") or {}
    for name in list(services) + list(raw_services):
        if name not in pol["services"]:
            fail("service")
    for name, svc in services.items():
        _service(pol["services"][name], name, svc, raw_services.get(name) or {}, plain, images, rdir, bind_addr)
        _env_keys(ctx, svc, raw_services.get(name) or {})
        for k in raw_services.get(name) or {}:
            if k not in pol["services"][name]["keys"]:
                fail("key")
    _networks(pol, plain, services)


def _service(sp, name, svc, raw_svc, plain, images, rdir, bind_addr):
    if "build" in svc or "build" in raw_svc:
        fail("service")
    if "container_name" in svc or "container_name" in raw_svc:
        fail("name")
    for k in svc:
        if k not in sp["keys"]:
            fail("key")
    if svc.get("user") != sp["user"]:
        fail("pinned")
    if sp.get("read_only") and svc.get("read_only") is not True:
        fail("pinned")
    if "ALL" not in [str(c).upper() for c in svc.get("cap_drop") or []]:
        fail("pinned")
    if (svc.get("security_opt") or []) != sp["security_opt"]:
        fail("pinned")
    if svc.get("image") != images.get(sp["image"]):
        fail("image")
    for k in ("logging", "ulimits", "mem_limit", "tmpfs"):  # F14: these values are pinned as well as their keys; a missing pin means the key must be absent
        if svc.get(k) != sp.get("pins", {}).get(k):
            fail("pinned")
    if sp.get("env_exact") is not None:  # S20: `{$NAME}` is substituted before the Caddyfile is parsed, so its environment is exactly the three `${NAME:?}` forms
        renv = raw_svc.get("environment")
        if not isinstance(renv, dict) or sorted(renv) != sp["env_exact"] or any(renv[k] != "${%s:?}" % k for k in renv):
            fail("pinned")
    if sp.get("no_command") and any(svc.get(k) or raw_svc.get(k) for k in ("command", "entrypoint")):
        fail("pinned")
    for k in ("command", "entrypoint"):  # G14: exact value or absent for every service (Compose's JSON prints null for an absent one)
        if svc.get(k) != sp.get(k):
            fail("pinned")
    _mounts(sp, svc, rdir)
    _files(sp, svc, plain)
    _env(sp, raw_svc)
    _ports(sp, svc, bind_addr)


def _env_keys(ctx, svc, raw_svc):
    """S31 b: a service's plain `environment` holds no key outside its raw one plus its listed env files' keys (`guard-env`)."""
    if ctx is None:
        return
    renv = raw_svc.get("environment") or {}
    allowed = set(renv) if isinstance(renv, dict) else set(str(e).split("=", 1)[0] for e in renv)
    for e in raw_svc.get("env_file") or []:
        path = e.get("path") if isinstance(e, dict) else e
        try:
            with open(ctx.p(path), encoding="utf-8") as fh:
                allowed |= set(l.split("=", 1)[0].strip() for l in fh.read().splitlines() if "=" in l and not l.lstrip().startswith("#"))
        except (OSError, TypeError):
            continue  # an unreadable file adds no allowed key: any key it would have brought is then outside the raw set
    penv = svc.get("environment") or {}
    keys = set(penv) if isinstance(penv, dict) else set(str(e).split("=", 1)[0] for e in penv)
    if keys - allowed:
        fail("env")


def _mounts(sp, svc, rdir):
    want = [(_norm(_resolve_source(b["source"], rdir)), b["target"], b["read_only"]) for b in sp.get("binds", [])]
    for v in svc.get("volumes") or []:
        if not isinstance(v, dict) or v.get("type") not in ("bind", "tmpfs"):
            fail("mount")
        if v["type"] == "tmpfs":
            continue
        if v.get("bind"):  # any non-empty bind option block (propagation, selinux, create_host_path) is refused, on the plain render only
            fail("mount")
        src = _norm(v.get("source"))
        if src in NEVER_SOURCES or "docker.sock" in str(src):
            fail("mount")
        if (src, v.get("target"), bool(v.get("read_only"))) not in want:
            fail("mount")
    if "volumes_from" in svc:
        fail("key")


def _files(sp, svc, plain):
    top = plain.get("secrets") or {}
    for s in svc.get("secrets") or []:
        src = s.get("source") if isinstance(s, dict) else s
        listed = sp.get("secrets", {})
        entry = top.get(src) or {}
        if src not in listed or entry.get("file") != listed[src] or set(entry) - {"name", "file"}:
            fail("file")


def _env(sp, raw_svc):
    got = []
    for e in raw_svc.get("env_file") or []:
        if isinstance(e, dict):
            if set(e) - {"path", "required"} or e.get("required") is False:
                fail("env")
            e = e.get("path")
        got.append(e)
    if got != sp.get("env_files", []):  # exact list, exact paths: no prefix, pattern, relative path, second file or other project's host env
        fail("env")


def _ports(sp, svc, bind_addr):
    ports = svc.get("ports") or []
    allowed = sp.get("ports", [])
    if ports and not allowed:
        fail("ports")
    for p in ports:
        if not isinstance(p, dict) or p.get("host_ip") != bind_addr or bind_addr is None:
            fail("ports")
        if {"target": p.get("target"), "published": str(p.get("published")), "protocol": p.get("protocol", "tcp")} not in allowed:
            fail("ports")


def _networks(pol, plain, services):
    top = plain.get("networks") or {}
    for key, entry in top.items():
        if key not in pol["networks"] or entry != pol["networks"][key]:
            fail("network")
    for name, svc in services.items():
        joined = svc.get("networks") or {}
        joined = {k: None for k in joined} if isinstance(joined, list) else joined
        allowed = pol["services"][name].get("networks", {})
        if set(joined) - set(allowed):
            fail("network")
        for key, cfg in joined.items():
            if sorted((cfg or {}).get("aliases") or []) != sorted(allowed[key]):
                fail("network")
            if set(cfg or {}) - {"aliases"}:
                fail("network")
        if svc.get("network_mode"):
            fail("key")
