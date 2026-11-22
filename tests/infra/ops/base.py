"""POLY-98 R11 harness for polycarpic-ops. Stdlib only. Contract pins: process/cairn/reviews/POLY-98/test-plan.md.

The tool is driven in-process: `main(argv, ctx)` of infra/ops/polycarpic-ops, with a Ctx (infra/ops/lib/ctx.py) whose root is a temp tree
and whose every outside-world call (run, run_inherit, getpass, isatty, confirm, now, sleep, chown, geteuid, tls_probe, statvfs) is a fake
built here. subprocess, os.system, os.popen, socket and urlopen raise, so a missed injection fails loudly.
"""
import contextlib
import datetime as dt
import getpass as _getpass
import importlib.machinery
import importlib.util
import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True  # never leave infra/ops/__pycache__ in the checkout the container tests copy
REPO = Path(__file__).resolve().parents[3]
OPS = REPO / "infra" / "ops"
DISPATCH = OPS / "polycarpic-ops"
NOW = dt.datetime(2026, 11, 22, 18, 40, 0, tzinfo=dt.timezone.utc)
FIXED_ENV = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C.UTF-8", "HOME": "/root"}
ID = "git-aaaaaaaaaaaa"
BUNDLE = "/opt/polycarpic/ops/current"
DIGEST = "1a2b3c4d5e6f" + "0" * 52
APP_REF = "ghcr.io/richmosko/polycarpic@sha256:" + DIGEST
PG_REF = "postgres@sha256:" + "ab" * 32
SECRET_LINE = re.compile(r"^  ([a-z0-9_]+)__([a-z0-9-]+): \{file: (/\S+)\}$")
REFUSED_PROVISION = {"db_superuser_password", "db_password_app", "db_password_auth", "db_password_worker", "db_password_migrator", "db_password_operator", "db_password_backup", "auth_secret"}


def need(path):
    if not Path(path).exists():
        raise AssertionError("%s does not exist (POLY-98 98d builds it)" % Path(path).relative_to(REPO))


def declared(compose_text):
    """The test's own parse of a compose secrets block: [(service, name, path)] (ruling R4's strict line pattern)."""
    out, inside = [], False
    for line in compose_text.splitlines():
        if line.startswith("secrets:"):
            inside = True
            continue
        if inside:
            if line and not line.startswith(" "):
                break
            m = SECRET_LINE.match(line)
            if m:
                out.append((m.group(2), m.group(1), m.group(3)))
    return out


def mounts(project="prod"):
    """(service, name, path) for the project, from the real compose files (edge.yml joins prod only)."""
    files = ["prod.yml", "edge.yml"] if project == "prod" else ["staging.yml"]
    rows = []
    for f in files:
        rows += declared((REPO / "infra" / "compose" / f).read_text())
    seen = {}
    for svc, name, path in rows:
        if "/etc/polycarpic/%s/" % ("secrets" if project == "prod" else "staging-secrets") in path:
            seen[(svc, name)] = path
    return sorted((s, n, p) for (s, n), p in seen.items())


def load_dispatcher(path=DISPATCH):
    need(path)
    loader = importlib.machinery.SourceFileLoader("polycarpic_ops_under_test", str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    if not hasattr(mod, "main"):
        raise AssertionError("infra/ops/polycarpic-ops defines no main(argv, ctx)")
    return mod


def ctx_class():
    need(OPS / "lib" / "ctx.py")
    if str(OPS) not in sys.path:
        sys.path.insert(0, str(OPS))
    import importlib
    return importlib.import_module("lib.ctx").Ctx


class Term(io.StringIO):
    """What the real terminal would show for a child that inherits stdout/stderr."""


def _tok(arg, token):
    """A token with no "/" also matches the basename of a path element (scripts are run by their full bundle path)."""
    return arg == token or ("/" not in token and arg.endswith("/" + token))


class Runner:
    """ctx.run / ctx.run_inherit fake: answers from rules (last match wins), records every call, refuses what it was not told about."""

    def __init__(self, term):
        self.calls, self.rules, self.term, self.unexpected = [], [], term, []

    def on(self, tokens, code=0, out="", err="", term="", raises=None, fn=None):
        self.rules.append((tokens, dict(code=code, out=out, err=err, term=term, raises=raises, fn=fn)))

    def _find(self, argv):
        for tokens, r in reversed(self.rules):
            if callable(tokens):
                if tokens(argv):
                    return r
                continue
            n = len(tokens)
            if any(all(_tok(a, t) for a, t in zip(argv[i:i + n], tokens)) for i in range(len(argv) - n + 1)):
                return r
        self.unexpected.append(list(argv))
        raise AssertionError("FAKE: unexpected child process %r" % (argv,))

    def _rec(self, kind, argv, stdin, timeout, env):
        if not isinstance(argv, list) or not all(isinstance(a, str) for a in argv):
            raise AssertionError("argv must be a list of str, got %r" % (argv,))
        self.calls.append(dict(kind=kind, argv=list(argv), stdin=stdin, timeout=timeout, env=None if env is None else dict(env)))
        return self._find(argv)

    def __call__(self, argv, stdin=None, timeout=None, env=None):
        r = self._rec("run", argv, stdin, timeout, env)
        if r["raises"]:
            raise r["raises"]
        if r["fn"]:
            return r["fn"](argv, stdin)
        return (r["code"], r["out"], r["err"])

    def inherit(self, argv, env=None, timeout=None):
        r = self._rec("inherit", argv, None, timeout, env)
        if r["raises"]:
            raise r["raises"]
        self.term.write(r["term"])
        return r["code"]

    def argvs(self):
        return [c["argv"] for c in self.calls]

    def with_tokens(self, *tokens):
        n = len(tokens)
        return [c for c in self.calls if any(tuple(c["argv"][i:i + n]) == tokens for i in range(len(c["argv"]) - n + 1))]


class Result(object):
    pass


class Host(object):
    """A fake box root: installed bundle, compose files, roles.sql, secret directories, state files."""

    def __init__(self, tmp, ops_id=ID):
        self.tmp = Path(tmp)
        self.root = self.tmp / "root"
        self.root.mkdir(mode=0o755)
        self.ops_id = ops_id
        self.id_dir = self.p("/opt/polycarpic/ops/" + ops_id)
        for d in ("/opt", "/opt/polycarpic", "/opt/polycarpic/ops", "/etc", "/etc/polycarpic", "/var", "/var/lib", "/var/lib/polycarpic", "/var/lib/polycarpic/state", "/usr", "/usr/local", "/usr/local/sbin"):
            self.mkdir(d)
        for rel in ("infra/compose/prod.yml", "infra/compose/staging.yml", "infra/compose/edge.yml", "packages/db/sql/roles.sql"):
            dst = self.id_dir / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO / rel, dst)
        for dirpath, dirs, files in os.walk(str(self.id_dir)):
            os.chmod(dirpath, 0o755)
            for f in files:
                os.chmod(os.path.join(dirpath, f), 0o644)
        os.symlink(ops_id, str(self.p("/opt/polycarpic/ops/current")))
        self.write("/etc/hostname", "box1\n")
        self.write("/etc/polycarpic/host.env", "PUBLIC_ORIGIN=https://app.example.com\n")
        self.write("/etc/polycarpic/staging-host.env", "PUBLIC_ORIGIN=https://staging.example.com\n")
        for project in ("prod", "staging"):
            top = "secrets" if project == "prod" else "staging-secrets"
            self.mkdir("/etc/polycarpic/" + top, 0o755)
            for svc in sorted(set(s for s, _, _ in mounts(project))):
                self.mkdir("/etc/polycarpic/%s/%s" % (top, svc), 0o750)
        self.mkdir("/etc/polycarpic/secrets/host", 0o700)  # POLY-99 H-1: host-only secrets (heartbeat_url), root:root, no service mounts it

    def p(self, path):
        return self.root / path.lstrip("/")

    def mkdir(self, path, mode=0o755):
        d = self.p(path)
        d.mkdir(parents=True, exist_ok=True)
        os.chmod(str(d), mode)
        return d

    def write(self, path, text, mode=0o644):
        f = self.p(path)
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text) if isinstance(text, str) else f.write_bytes(text)
        os.chmod(str(f), mode)
        return f

    def secret(self, svc, name, text="fixturevalue\n", staging=False, mode=0o440):
        return self.write("/etc/polycarpic/%s/%s/%s" % ("staging-secrets" if staging else "secrets", svc, name), text, mode)

    def secret_path(self, svc, name, staging=False):
        return self.p("/etc/polycarpic/%s/%s/%s" % ("staging-secrets" if staging else "secrets", svc, name))

    def gid(self, svc, staging=False):
        return os.stat(str(self.p("/etc/polycarpic/%s/%s" % ("staging-secrets" if staging else "secrets", svc)))).st_gid

    def tree(self):
        """Everything under the root as {relative path: bytes or link target}, for before/after comparisons."""
        out = {}
        for dirpath, dirs, files in os.walk(str(self.root)):
            for n in dirs + files:
                full = os.path.join(dirpath, n)
                rel = os.path.relpath(full, str(self.root))
                if os.path.islink(full):
                    out[rel] = "-> " + os.readlink(full)
                elif os.path.isfile(full):
                    out[rel] = Path(full).read_bytes()
                else:
                    out[rel] = None
        return out

    def go(self, *argv, runner=None, secrets=(), tty=True, euid=0, confirm=None, trusted=None, now=NOW, tls=None, statvfs=None, dispatcher=None, setup=None, getpass_impl=None):
        Ctx = ctx_class()
        r = Result()
        r.term, r.stdout, r.stderr = Term(), io.StringIO(), io.StringIO()
        r.runner = runner or Runner(r.term)
        r.runner.term = r.term
        r.prompts, r.confirms, r.chowns, r.sleeps = [], [], [], []
        vals = list(secrets)
        clock = [now]

        r.events = []

        def fake_getpass(prompt=""):
            r.events.append("getpass")
            r.prompts.append(prompt)
            if not vals:
                raise AssertionError("getpass asked more than the test supplied: %r" % prompt)
            v = vals.pop(0)
            if isinstance(v, Exception):
                raise v
            if callable(v):
                return v()
            return v

        def fake_confirm(prompt=""):
            r.events.append("confirm")
            r.confirms.append(prompt)
            if confirm is None:
                raise AssertionError("confirm asked but the test supplied no answer: %r" % prompt)
            return confirm

        def fake_sleep(s):
            r.sleeps.append(s)
            clock[0] = clock[0] + dt.timedelta(seconds=s)

        def fake_tls(host, port):
            if tls is None:
                raise ConnectionRefusedError("nothing answers")
            return tls(host, port) if callable(tls) else tls

        def fake_statvfs(path):
            if statvfs is None:
                raise AssertionError("statvfs not supplied")
            return statvfs(path)

        r.stdout_bytes = io.BytesIO()
        extra = {}
        if "stdout_bytes" in Ctx.__init__.__code__.co_varnames:  # POLY-99 pin 15: fetch-premigration writes bytes through ctx.stdout_bytes
            extra["stdout_bytes"] = r.stdout_bytes
        ctx = Ctx(root=str(self.root), run=r.runner, run_inherit=r.runner.inherit, getpass=getpass_impl or fake_getpass, isatty=lambda: tty,
                  confirm=fake_confirm, now=lambda: clock[0], sleep=fake_sleep, chown=lambda *a: r.chowns.append(a), geteuid=lambda: euid,
                  tls_probe=fake_tls, statvfs=fake_statvfs, stdout=r.stdout, stderr=r.stderr,
                  trusted_uid=os.getuid() if trusted is None else trusted, **extra)
        r.ctx = ctx
        mod = dispatcher or load_dispatcher()
        try:
            r.rc = mod.main(list(argv), ctx)
        except SystemExit as e:
            r.rc = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
        r.out, r.err = r.stdout.getvalue(), r.stderr.getvalue()
        r.clock = clock[0]
        return r


class OpsTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.host = Host(self.tmp)

        def deny(name):
            def f(*a, **k):
                raise AssertionError("a tool reached %s instead of its injected ctx" % name)
            return f

        self._patches = [mock.patch.object(subprocess, n, deny("subprocess." + n)) for n in ("run", "Popen", "call", "check_call", "check_output")]
        self._patches += [mock.patch.object(os, "system", deny("os.system")), mock.patch.object(os, "popen", deny("os.popen")),
                          mock.patch.object(socket, "create_connection", deny("a socket")), mock.patch.object(urllib.request, "urlopen", deny("the network"))]
        for p in self._patches:
            p.start()
        self.addCleanup(self._stop)
        self._umask = os.umask(0o022)
        os.umask(self._umask)

    def _stop(self):
        for p in self._patches:
            p.stop()
        os.umask(self._umask)
        self._tmp.cleanup()

    def assertLine(self, text, expected):
        lines = text.splitlines()
        self.assertIn(expected, lines, "no line %r in:\n%s" % (expected, text))

    def assertNoTrace(self, secret, r, extra_paths=()):
        """R12's R10-style sweep: the value is in no output, argv, env, prompt, or file outside the allowed paths."""
        blob = "\n".join([r.out, r.err, r.term.getvalue()] + r.prompts + r.confirms)
        self.assertNotIn(secret, blob, "a secret value reached the terminal or a prompt")
        for c in r.runner.calls:
            self.assertNotIn(secret, json.dumps(c), "a secret value reached a child's argv, stdin or env")
        allowed = set(str(p) for p in extra_paths)
        for dirpath, _, files in os.walk(str(self.tmp)):
            for f in files:
                full = os.path.join(dirpath, f)
                if full in allowed or os.path.islink(full):
                    continue
                self.assertNotIn(secret.encode(), Path(full).read_bytes(), "a secret value is on disk at %s" % full)

    def fix(self, **kw):
        """Group a fixture secret value built at run time (never a literal credential-looking string)."""
        return "fx" + os.urandom(12).hex()


def ps_json(services, names=None):
    """docker compose ps -a --format json: one JSON object per line. services: {svc: (state, health)}."""
    rows = []
    for svc, (state, health) in services.items():
        rows.append(json.dumps({"Service": svc, "Name": (names or {}).get(svc, "polycarpic-x-%s-1" % svc), "State": state, "Health": health, "ID": "id" + svc}))
    return "\n".join(rows) + ("\n" if rows else "")


def inspect_json(ref=APP_REF, created="2026-11-22T18:21:00.000000000Z", started="2026-11-01T00:00:00.000000000Z", image_id="sha256:" + "cd" * 32):
    return json.dumps([{"Id": "x", "Created": created, "Image": image_id, "Config": {"Image": ref}, "State": {"StartedAt": started}}])


def stack(runner, project="prod", services=None, refs=None, created=None, started=None):
    """Install the ps and inspect answers for one compose project. services default: postgres, web, auth, worker running and healthy."""
    services = services if services is not None else {"postgres": ("running", "healthy"), "web": ("running", "healthy"), "auth": ("running", "healthy"), "worker": ("running", "healthy")}
    proj = "polycarpic-" + project
    names = {s: "%s-%s-1" % (proj, s) for s in services}
    runner.on(("compose", "-p", proj, "ps", "-a", "--format", "json"), out=ps_json(services, names))
    for s, n in names.items():
        ref = (refs or {}).get(s, PG_REF if s == "postgres" else APP_REF)
        runner.on(("inspect", n), out=inspect_json(ref=ref, created=(created or {}).get(s, "2026-11-22T18:21:00.000000000Z"), started=(started or {}).get(s, "2026-11-01T00:00:00.000000000Z")))
    return names
