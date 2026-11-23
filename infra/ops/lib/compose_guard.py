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


def render_argv(rdir, release_root, project, env_files, raw):
    """R4's exact argv for a render: the project, the file and the env files are fixed by the installed script."""
    cdir = "%s/infra/compose" % rdir
    argv = ["docker", "compose", "-p", "polycarpic-" + project, "--project-directory", cdir, "-f", "%s/%s.yml" % (cdir, project)]
    for env in env_files:
        argv += ["--env-file", env]
    argv += ["--profile", "*", "config"]
    argv += ["--no-interpolate", "--no-normalize"] if raw else []
    return argv + ["--format", "json"]


def _json(ctx, argv):
    try:
        code, out, _ = ctx.run(argv, timeout=120)
        data = json.loads(out)
    except (ValueError, TimeoutError):
        fail("render")
    if code != 0 or not isinstance(data, dict):
        fail("render")
    return data


def renders(ctx, rdir, release_root, project, env_files):
    return (_json(ctx, render_argv(rdir, release_root, project, env_files[:1], True)),
            _json(ctx, render_argv(rdir, release_root, project, env_files, False)))


def _resolve_source(src, rdir):
    return rdir + src[len("@release"):] if src.startswith("@release/") else src


def _norm(path):
    return posixpath.normpath(path) if isinstance(path, str) else path


def check(policy, project, raw, plain, images, rdir, bind_addr=None):
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
    _mounts(sp, svc, rdir)
    _files(sp, svc, plain)
    _env(sp, raw_svc)
    _ports(sp, svc, bind_addr)


def _mounts(sp, svc, rdir):
    want = [(_norm(_resolve_source(b["source"], rdir)), b["target"], b["read_only"]) for b in sp.get("binds", [])]
    for v in svc.get("volumes") or []:
        if not isinstance(v, dict) or v.get("type") not in ("bind", "tmpfs"):
            fail("mount")
        if v["type"] == "tmpfs":
            continue
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
