"""POLY-100 R13 seam for `polycarpic-ops deploy`. Contract pins: process/cairn/reviews/POLY-100/test-plan.md.

World = the outside of the box, faked: the registry (docker), GitHub (gh), a REAL git origin (git and ssh-keygen run for real, in the temp
tree; only the github.com URL is redirected to a local repo), a scripted compose, and scripted `polycarpic-ops backup premigration`. Everything
reaches the tool through ctx.run / ctx.run_bytes / ctx.https_status / ctx.owner_of / ctx.stdin; subprocess stays patched to raise (base.OpsTest). No resolver: R9 is strict.
"""
import atexit
import datetime as dt
import hashlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import tarfile
from pathlib import Path

from base import NOW, OPS, REPO, OpsTest, Runner, ctx_class

REAL_POPEN = subprocess.Popen  # captured at import, before OpsTest patches subprocess: only World's real git / ssh-keygen use it


class _Done(object):
    pass


def REAL_RUN(argv, env=None, input=None, cwd=None, capture_output=True, text=True, check=False):
    p = REAL_POPEN(argv, env=env, cwd=cwd, stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    out, err = p.communicate(input)
    d = _Done()
    d.returncode, d.stdout, d.stderr = p.returncode, out, err
    return d
SLUG = "richmosko/polycarpic"
REGISTRY = "ghcr.io/" + SLUG
BUILD_PATH = ".github/workflows/build.yml"
RUN_ID = "45196636649"
STATE = "/var/lib/polycarpic/state/deploy"
_TEMPLATE = None
_KEYS = {}
STAGING_AUTH_PATHS = ("/etc/polycarpic/secrets/caddy", "/etc/polycarpic/secrets/caddy/staging_basic_auth")
SYSTEM_PATH = os.environ.get("PATH", "/usr/bin:/bin")
_GH_VERSION = REPO / "infra" / "deploy" / "gh-version"
GH_PINNED = _GH_VERSION.read_text().strip() if _GH_VERSION.exists() else "2.106.0"  # POLY-104 F15


_FLAGS = json.loads((Path(__file__).parent / "fixtures" / "flags.json").read_text())
_VALUED = {"-p", "-f", "--env-file", "--project-directory", "--profile", "--name", "--pull", "--timeout", "-t", "-e", "--entrypoint", "-u", "--user", "-w", "--workdir", "-v", "--volume",
           "-l", "--label", "--format", "--scale", "--repo", "--signer-workflow", "--source-ref", "--source-digest", "--predicate-type", "-D", "--dir", "-n", "--name", "-H", "--header",
           "--jq", "-q", "-X", "--method", "-F", "--field", "-R", "--hostname"}
_SHORT_GLOBAL = {"-p", "-f"}


def bad_options(argv):
    """F16: the options of a docker / docker compose / gh argv that the real subcommand does not have (from the tool's own --help, fixtures/flags.json). [] when all are real."""
    tool = argv[0]
    toks = list(argv[1:])
    bad, i = [], 0

    def scan(key, allow_extra=(), stop=True):
        nonlocal i
        known = set(_FLAGS.get(key, [])) | set(allow_extra) | {"--help", "-h"}
        while i < len(toks):
            t = toks[i]
            if t == "--":
                i += 1
                return "--"
            if t.startswith("-") and len(t) > 1:
                name = t.split("=", 1)[0]
                if name not in known:
                    bad.append((key, name))
                i += 2 if (name in _VALUED and "=" not in t) else 1
                continue
            if not stop:
                i += 1
                continue
            return t
        return None
    if tool == "docker":
        first = scan("docker")
        if first == "compose":
            i += 1
            sub = scan("docker compose")
            if sub in ("config", "up", "run", "exec", "ps", "restart", "stop", "rm"):
                i += 1
                scan("docker compose " + sub)  # run/exec: the first positional is the service; what follows is the container's command, not options
        elif first in ("pull", "create", "cp", "rm", "inspect"):
            i += 1
            scan("docker " + first)
        elif first == "image" and toks[i + 1:i + 2] == ["inspect"]:
            i += 2
            scan("docker image inspect")
    elif tool == "gh":
        first = toks[0] if toks else ""
        key = {"api": "gh api", "run": "gh run " + (toks[1] if len(toks) > 1 else ""), "attestation": "gh attestation " + (toks[1] if len(toks) > 1 else "")}.get(first)
        if key in _FLAGS:
            i = 1 if first == "api" else 2
            scan(key, stop=False)
    return bad


def hexd(seed):
    return hashlib.sha256(seed.encode()).hexdigest()


def digest(seed):
    return "sha256:" + hexd(seed)


def utc(t=NOW):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def tar_of(files):
    """files: {path: bytes} -> tar bytes of regular members, root-owned."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as t:
        for name, data in sorted(files.items()):
            ti = tarfile.TarInfo(name)
            ti.size, ti.mode, ti.uid, ti.gid = len(data), 0o644, 0, 0
            t.addfile(ti, io.BytesIO(data))
    return buf.getvalue()


class HookList(list):
    """r.sleeps that fires `fire` once, at the first sleep: the moment a command is still waiting (for the lock)."""

    def __init__(self, fire):
        super().__init__()
        self.fire = fire

    def append(self, v):
        if self.fire:
            f, self.fire = self.fire, None
            f()
        super().append(v)


class World(object):
    def __init__(self, tmp):
        self.tmp = Path(tmp)
        self.registry = {}   # "<ref>@<digest>" -> {"labels": {...}, "bundle": tar bytes}
        self.attested = set()  # (digest, source_digest) pairs `gh attestation verify` passes
        self.runs = []       # build.yml run objects, newest first
        self.releases = []   # release objects, newest first
        self.artifacts = {}  # run id -> digest.txt text
        self.premigration = (0, "", "")
        self.gh_down = False  # a network outage: gh exits 1 with a transport error
        self.gh_version = GH_PINNED  # POLY-104 F15: what `gh --version` answers: a version string, None (no gh on the box: the real seam's 127) or (code, out, err)
        self.gh_fails = {}  # {"api" | "api -i" | "run download" | "attestation verify": (code, stderr)}: that call fails with exactly this
        self.docker_log, self.unhandled, self.pulled = [], [], []
        self.cids = {}
        self.compose_log, self.containers, self.by_name, self.render_hooks = [], {}, {}, {}
        self.stopped_names, self.stop_log, self.stop_fail, self.stop_unknown_flags = set(), [], set(), []  # POLY-160: plain `docker ps -q` / `inspect <cid>` / `stop`; stop_fail holds cids, ("ps", proj, svc) or "stop"
        self.bad_apps, self.run_codes, self.plan_code, self.polls = set(), {}, 3, 0
        self.up_marks, self.stopped, self.sleeps_ref = [], [], None
        self.systemctl_log, self.premigration_calls, self.on_compose = [], [], None
        self.https_calls, self.https_always, self.edge_bad = [], None, {}
        self.bad_caddy = set()
        self.bad_flags = []
        self.run_hang, self.run_names, self.stuck_oneoff, self.run_started = set(), [], set(), set()
        self.inspect_fail, self.inspect_calls = {}, []
        self.config_rules = []
        self.compose_versions = {"root": "5.7.1", "render": "5.7.1"}  # G10: what `docker compose version --short` answers per identity: a string, None (fails) or (code, out, err)
        self.version_asks = []
        self.roles_answer = (0, "1\n", "")  # G12: what `SELECT count(*) FROM pg_roles WHERE rolname = 'poly_migrator'` answers; default: the role exists
        self.role_queries = []
        self.inspect_missing_msg = "No such object\n"  # what `docker inspect` of an unknown name says (Docker 29.1.3: `error: no such object: <name>`)
        self.child_secs = None  # G7: each health child (compose ps, exec; docker inspect) after the run's first `up` takes this long on the fake clock, or its timeout if shorter (and then times out)
        self.hang, self.raise_cmd, self.hang_from, self.hang_through = set(), {}, 10 ** 9, False
        self.config_wrapped = []
        self.wrapped_calls, self._isolated, self.network_attempts, self.rerender_hook = [], False, 0, None
        self.unmounted = set()
        self.owners = {}
        self.dir_hooks = {}
        self.ps_fails = set()
        self.plan_out, self.psql_result = "", (0, "0\n", "")
        self.origin = self.tmp / "github-origin"
        self.commit_a = self.commit_b = None
        self._git_origin()

    # --- real git origin: A (what staging runs now) <- B (what main is) ---
    def _genv(self):
        return {"PATH": SYSTEM_PATH, "HOME": str(self.tmp), "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid"}

    def git(self, *args, cwd=None, env=None, stdin=None):
        p = REAL_RUN(["git", *args], cwd=str(cwd or self.origin), env=env or self._genv(), input=stdin, capture_output=True, text=True, check=False)
        if p.returncode != 0:
            raise AssertionError("fixture git %r failed: %s" % (args, p.stderr))
        return p.stdout.strip()

    def _git_origin(self):
        global _TEMPLATE
        if _TEMPLATE is None:  # built once per process, copied per test (an init and two commits cost ~0.2 s each time)
            base = Path(tempfile.mkdtemp(prefix="poly100-origin-"))
            atexit.register(shutil.rmtree, str(base), True)
            self.origin = base / "github-origin"
            self.origin.mkdir()
            self.git("init", "-q", "-b", "main")
            for k, v in (("uploadpack.allowFilter", "true"), ("uploadpack.allowAnySHA1InWant", "true"), ("commit.gpgsign", "false")):
                self.git("config", k, v)
            _TEMPLATE = (self.origin, self.commit("a"), self.commit("b"))
        src, self.commit_a, self.commit_b = _TEMPLATE
        self.origin = self.tmp / "github-origin"
        shutil.copytree(str(src), str(self.origin), symlinks=True)

    def keygen(self, name):
        """-> (private key path, `ssh-ed25519 <base64>`)."""
        priv = self.tmp / ("key-" + name)
        if name not in _KEYS:  # one real keypair per name per process, copied into each test's tree
            d = Path(tempfile.mkdtemp(prefix="poly100-key-"))
            atexit.register(shutil.rmtree, str(d), True)
            REAL_RUN(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", name, "-f", str(d / "k")])
            _KEYS[name] = ((d / "k").read_bytes(), (d / "k.pub").read_bytes())
        priv.write_bytes(_KEYS[name][0])
        os.chmod(str(priv), 0o600)
        (self.tmp / ("key-%s.pub" % name)).write_bytes(_KEYS[name][1])
        return str(priv), " ".join((self.tmp / ("key-%s.pub" % name)).read_text().split()[:2])

    def tag(self, name, commit, kind="signed", key=None, ref=None):
        """kind: signed (ssh), light, gpg (an object carrying a PGP block), tree (ssh-signed tag of a tree). -> the tag object (or commit) sha."""
        if self.git("tag", "-l", name):
            self.git("tag", "-d", name)  # a scenario may be run again in one test
        if kind == "light":
            self.git("tag", name, commit)
            return commit
        if kind == "gpg":
            body = "object %s\ntype commit\ntag %s\ntagger t <t@example.invalid> 1 +0000\n\nm\n-----BEGIN PGP SIGNATURE-----\n\nAAAA\n-----END PGP SIGNATURE-----\n" % (commit, name)
            sha = self.git("hash-object", "-t", "tag", "-w", "--literally", "--stdin", stdin=body)
            self.git("update-ref", "refs/tags/" + name, sha)
            return sha
        target = self.git("rev-parse", commit + "^{tree}") if kind == "tree" else commit
        self.git("-c", "gpg.format=ssh", "-c", "user.signingkey=" + key, "tag", "-s", "-m", "m", name, target)
        sha = self.git("rev-parse", "refs/tags/" + name)
        if ref:
            self.git("update-ref", "refs/tags/" + ref, sha)
            self.git("tag", "-d", name)
        return sha

    def commit(self, msg):
        self.git("commit", "-q", "--allow-empty", "-m", msg)
        return self.git("rev-parse", "HEAD")

    # --- registry / github fixtures ---
    def image(self, name, dig, commit, labels=None, bundle=None):
        ref = "%s/%s@%s" % ("ghcr.io/richmosko", name, dig)
        lab = {"org.opencontainers.image.revision": commit}
        lab.update(labels or {})
        self.registry[ref] = {"labels": lab, "bundle": bundle}
        return ref

    def staging_run(self, head_sha, dig, run_id=RUN_ID, **over):
        run = {"id": int(run_id), "head_sha": head_sha, "head_branch": "main", "event": "push", "path": BUILD_PATH, "status": "completed", "conclusion": "success"}
        run.update(over)
        self.runs.insert(0, run)
        self.artifacts[str(run["id"])] = dig + "\n"
        return run

    # --- the children ---
    def handler(self, runner):
        self._runner = runner
        runner.on(lambda a: a[0] == "docker", fn=self._docker)
        runner.on(lambda a: a[0] == "unshare", fn=self._unshare)
        runner.on(lambda a: a[0] == "setpriv", fn=self._setpriv)
        runner.on(lambda a: a[0] == "gh", fn=self._gh)
        runner.on(lambda a: a[0] in ("git", "ssh-keygen"), fn=self._real)
        runner.on(lambda a: a[0] == "systemctl", fn=self._systemctl)
        runner.on(lambda a: a[-2:] == ["backup", "premigration"], fn=lambda a, i: self._premigration(a))
        return runner

    def _real(self, argv, stdin):
        env = self._last_env(argv)
        argv = [a.replace("https://github.com/" + SLUG, str(self.origin)) if a.startswith("https://github.com/" + SLUG) else a for a in argv]
        real_env = {"PATH": SYSTEM_PATH, "HOME": str(self.tmp)}  # the tool's own GIT_* only: a fixture global config in HOME must not rescue it
        real_env.update({k: v for k, v in (env or {}).items() if k.startswith("GIT_") or k == "SSH_AUTH_SOCK"})
        p = REAL_RUN(argv, env=real_env, input=stdin, capture_output=True, text=True, check=False)
        return p.returncode, p.stdout, p.stderr

    def _last_env(self, argv):
        return self.runner.calls[-1]["env"] if self.runner.calls else None

    def _systemctl(self, argv, stdin):
        self.systemctl_log.append(list(argv))
        return 0, "", ""

    def _premigration(self, argv):
        self.premigration_calls.append(list(argv))
        return self.premigration

    def _gh(self, argv, stdin):
        env = self._last_env(argv) or {}
        if argv[1:] == ["--version"]:  # no network, no token
            got = self.gh_version
            if got is None:
                return 127, "", "gh: No such file or directory\n"
            if isinstance(got, tuple):
                return got
            return 0, "gh version %s (2026-09-01)\nhttps://github.com/cli/cli/releases/tag/v%s\n" % (got, got), ""
        key = "api -i" if argv[1:3] == ["api", "-i"] else "api" if argv[1] == "api" else " ".join(argv[1:3])
        if key in self.gh_fails:
            code, text = self.gh_fails[key]
            return code, "", text
        bad = bad_options(argv)
        if bad:
            self.bad_flags.append((list(argv), bad))
            return 1, "", "unknown flag: %s\n" % bad[0][1]
        if self.gh_down:
            return 1, "", "error connecting to api.github.com\n"
        if "GH_TOKEN" not in env:
            return 4, "", "To get started with GitHub CLI, please run:  gh auth login\n"
        sub = argv[1]
        if sub == "api":
            url = next(a for a in argv[2:] if not a.startswith("-"))
            if "/actions/workflows/build.yml/runs" in url:
                return 0, json.dumps({"total_count": len(self.runs), "workflow_runs": self.runs[:1]}), ""
            if "/releases/tags/" in url:
                tag = url.split("/releases/tags/", 1)[1].split("?", 1)[0]
                hit = [r for r in self.releases if r["tag_name"] == tag]
                return (0, json.dumps(hit[0]), "") if hit else (1, "", "HTTP 404: Not Found\n")
            if "/releases" in url:
                return 0, json.dumps(self.releases), ""
            return 1, "", "FAKE gh api: no fixture for %s\n" % url
        if sub == "run" and argv[2] == "download":
            rid, name, dest = argv[3], argv[argv.index("-n") + 1], argv[argv.index("-D") + 1]
            if rid not in self.artifacts or not name.startswith("image-"):
                return 1, "", "no artifact\n"
            Path(dest).mkdir(parents=True, exist_ok=True)
            Path(dest, "digest.txt").write_text(self.artifacts[rid])
            return 0, "", ""
        if sub == "attestation" and argv[2] == "verify":
            ref = argv[3]
            dig = ref.split("@", 1)[1]
            src = argv[argv.index("--source-digest") + 1] if "--source-digest" in argv else None
            if (dig, src) in self.attested:
                return 0, "", ""
            return 1, "", "verification failed\n"
        return 1, "", "FAKE gh: unhandled %r\n" % (argv,)

    def _unshare(self, argv, stdin):
        """F4: `unshare --net -- setpriv ... -- docker compose ... config`: recorded whole, then served as the docker command inside it, marked as isolated."""
        env = self._last_env(argv) or {}
        self.wrapped_calls.append((list(argv), dict(env)))
        try:
            inner = argv[len(argv) - argv[::-1].index("docker") - 1:]
        except ValueError:
            return 1, "", "FAKE unshare: no docker command inside %r\n" % (argv,)
        self._isolated = True
        try:
            return self._docker(inner, stdin)
        finally:
            self._isolated = False

    def _setpriv(self, argv, stdin):
        """G10: `setpriv ... -- docker compose version --short` as the render user, with no network namespace: served as that user's docker, not recorded as a render."""
        try:
            inner = argv[len(argv) - argv[::-1].index("docker") - 1:]
        except ValueError:
            return 1, "", "FAKE setpriv: no docker command inside %r\n" % (argv,)
        self._isolated = True
        try:
            return self._docker(inner, stdin)
        finally:
            self._isolated = False

    def _docker(self, argv, stdin):
        self.docker_log.append(list(argv))
        bad = bad_options(argv)
        if bad:
            self.bad_flags.append((list(argv), bad))
            return 1, "", "unknown flag: %s\n" % bad[0][1]
        sub = argv[1]
        if argv[:2] == ["docker", "compose"] and "version" in argv[2:] and "--short" in argv[2:]:  # G10: the pinned Compose, asked as root and as the render user (setpriv, its own HOME)
            self.docker_log.pop()  # the version query is not a container operation: "no docker compose call was made" pins ignore it
            who = "render" if self._isolated else "root"
            got = self.compose_versions[who]
            self.version_asks.append(who)
            if got is None:
                return 1, "", "FAKE: compose is not installed for %s\n" % who
            if isinstance(got, tuple):
                return got
            return 0, got + "\n", ""
        if sub == "pull":
            if argv[2] in self.registry:
                self.pulled.append(argv[2])
                return 0, "", ""
            return 1, "", "manifest unknown\n"
        if sub == "image" and argv[2] == "inspect":
            e = self.registry.get(argv[3])
            if e is None:
                return 1, "[]", "No such image\n"
            return 0, json.dumps([{"RepoDigests": [argv[3]], "Config": {"Labels": e["labels"]}}]), ""
        if sub == "create":
            ref = argv[-1]
            cid = "cid" + hexd(ref)[:12]
            self.cids[cid] = ref
            return 0, cid + "\n", ""
        if sub == "rm":
            return 0, "", ""
        if sub == "compose":
            return self._compose(argv, stdin)
        if sub == "ps" and "-q" in argv:  # POLY-160 R1.2: stand_down lists by compose labels, plain Docker
            flt = [argv[j + 1] for j, a in enumerate(argv) if a == "--filter"]
            lab = dict(f.split("=", 1)[1].split("=", 1) for f in flt if f.startswith("label="))
            proj, svc = lab.get("com.docker.compose.project"), lab.get("com.docker.compose.service")
            c = self.containers.get(proj, {}).get(svc)
            self.stop_log.append(("ps", proj, svc))
            if c is None or c["name"] in self.stopped_names or ("ps", proj, svc) in self.stop_fail:
                return (1, "", "FAKE: ps failed\n") if ("ps", proj, svc) in self.stop_fail else (0, "", "")
            return 0, "cid-%s\n" % c["name"], ""
        if sub == "inspect" and len(argv) > 2 and argv[2].startswith("cid-"):
            c = self.by_name.get(argv[2][4:])
            if c is None:
                return 1, "[]", self.inspect_missing_msg
            return 0, json.dumps([{"Id": argv[2], "Config": {"Image": c["image"]}, "State": {"Status": "running"}}]), ""
        if sub == "stop":
            cid = argv[-1]
            flags = [a for a in argv[2:-1] if a.startswith("-")]
            if any(f not in ("-t", "--timeout") for f in flags):  # POLY-160 B3: `--time` is deprecated and gone from newer Docker's help: only the short `-t` (and `--timeout`) are known
                self.stop_unknown_flags.append(list(argv))
                return 1, "", "unknown flag: %s\n" % [f for f in flags if f not in ("-t", "--timeout")][0]
            self.stop_log.append(("stop", cid))
            if cid in self.stop_fail or "stop" in self.stop_fail:
                return 1, "", "FAKE: cannot stop\n"
            self.stopped_names.add(cid[4:])
            return 0, cid + "\n", ""
        if sub == "inspect" and "inspect" in self.hang and self.hang_from < len(self.up_marks) <= self.hang_from + (10 ** 9 if self.hang_through else 1):
            raise TimeoutError("inspect")
        if sub == "inspect":
            self._child_time()
        if sub == "inspect" and argv[2] in self.inspect_fail and argv[2] in self.run_started:  # G4: how `docker inspect` of a hung one-off fails ("timeout" or (code, stderr))
            f = self.inspect_fail[argv[2]]
            self.inspect_calls.append(argv[2])
            if f == "timeout":
                raise TimeoutError("inspect")
            return f[0], "", f[1]
        if sub == "inspect" and argv[2] in self.stuck_oneoff and argv[2] in self.run_started:
            return 0, json.dumps([{"Id": "x", "Config": {"Image": "x"}, "State": {"Status": "running"}}]), ""
        if sub == "inspect":
            c = self.by_name.get(argv[2])
            if c is None:
                return 1, "[]", self.inspect_missing_msg
            return 0, json.dumps([{"Id": "x", "Created": utc(), "Image": "sha256:" + "cd" * 32, "Config": {"Image": c["image"]}, "State": {"StartedAt": utc()}}]), ""
        self.unhandled.append(list(argv))
        return 1, "", "FAKE docker: unhandled %r\n" % (argv,)

    # --- docker compose: renders from committed fixtures (gen_compose.py), containers scripted ---
    APP_SVC = ("web", "auth", "worker", "migrate", "operator")
    KEY = {"postgres": "POSTGRES", "caddy": "CADDY"}

    def _child_time(self, hang_window=True):
        if self.child_secs is None or not self.up_marks or not (self.hang_from < len(self.up_marks) <= self.hang_from + 1):
            return
        timeout = self._runner.calls[-1]["timeout"] if getattr(self, "_runner", None) and self._runner.calls else None
        take = self.child_secs if timeout is None else min(self.child_secs, timeout)
        if getattr(self, "_ctx_sleep", None):
            self._ctx_sleep(take)  # the fake clock moves by what the child took
        if timeout is not None and timeout < self.child_secs:
            raise TimeoutError("health child")

    def sleeps_total(self):
        return sum(self.sleeps_ref) if self.sleeps_ref is not None else 0

    def images_from(self, env_file):
        out = {}
        for line in Path(env_file).read_text().splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                out[k] = v
        return out

    def render(self, argv, raw):
        files = sorted(os.path.basename(argv[i + 1]) for i, a in enumerate(argv) if a == "-f")
        name = {("prod.yml",): "prod", ("staging.yml",): "staging", ("edge.yml", "prod.yml"): "prod-edge", ("edge.yml",): "edge"}[tuple(files)]
        text = (Path(__file__).parent / "fixtures" / "compose" / ("%s.%s.json" % (name, "raw" if raw else "plain"))).read_text()
        envs = {}
        for i, a in enumerate(argv):
            if a == "--env-file":
                envs.update(self.images_from(argv[i + 1]))
        sent = {"POSTGRES": "a", "TOOLS": "b", "CADDY": "c", "APP": "d"}
        for k, ch in sent.items():
            if "POLY_%s_IMAGE" % k in envs:
                repo = {"POSTGRES": "polycarpic-postgres", "TOOLS": "polycarpic-tools", "CADDY": "polycarpic-caddy", "APP": "polycarpic"}[k]
                text = text.replace("ghcr.io/richmosko/%s@sha256:%s" % (repo, ch * 64), envs["POLY_%s_IMAGE" % k])
        pd = argv[argv.index("--project-directory") + 1] if "--project-directory" in argv else "/rel/infra/compose"
        d = json.loads(text.replace("@@REL@@", pd[:-len("/infra/compose")]))
        hook = self.render_hooks.get((name, raw)) or self.render_hooks.get((name, None))
        if hook:
            d = hook(d) or d
        for sub, fn in self.dir_hooks.items():  # an edit that applies only to renders of one release directory (a refusal of `current`, not of the candidate)
            if sub in pd:
                d = fn(d) or d
        return json.dumps(d)

    def _compose(self, argv, stdin=None):
        i = 2
        project, subcmd = None, None
        while i < len(argv):
            if argv[i] == "-p":
                project = argv[i + 1]
                i += 2
            elif argv[i] in ("-f", "--env-file", "--project-directory", "--profile"):
                i += 2
            elif argv[i].startswith("-"):
                i += 1
            else:
                subcmd = argv[i]
                break
        self.compose_log.append(dict(argv=list(argv), project=project, cmd=subcmd, rest=argv[i + 1:]))
        if self.hang_from < len(self.up_marks) <= self.hang_from + (10 ** 9 if self.hang_through else 1):  # F2: from the run's first `up` until the next one (the rollback's), these hang (TimeoutError, as ctx.run raises) or raise
            if subcmd in self.hang:
                raise TimeoutError(subcmd)
            if subcmd in self.raise_cmd:
                raise self.raise_cmd[subcmd]
        if subcmd in ("ps", "exec"):
            self._child_time()
        rest = argv[i + 1:]
        if self.on_compose:
            self.on_compose(subcmd, list(argv))
        if subcmd == "config":
            self.config_wrapped.append(self._isolated)
            for rule in self.config_rules:  # G9: fail one file and pass another, or time out: rule(argv, stdin) -> None | "timeout" | (exit code, stderr[, stdout])
                got = rule(list(argv), stdin)
                if got == "timeout":
                    raise TimeoutError("config")
                if got:
                    return got[0], (got[2] if len(got) > 2 else ""), got[1]
            if stdin is not None:  # the re-render of the saved judged file (`-f -`): the same JSON back, unless a test makes the second answer differ
                d = json.loads(stdin)
                return 0, json.dumps(self.rerender_hook(d) or d if self.rerender_hook else d), ""
            for i, a in enumerate(argv):  # a remote include in a compose file: fetched over the network unless the render is isolated
                if a == "-f" and argv[i + 1].endswith((".yml", ".yaml")) and os.path.exists(argv[i + 1]) and "oci://" in open(argv[i + 1], errors="replace").read():
                    if not self._isolated:
                        self.network_attempts += 1
                    else:
                        return 1, "", "failed to resolve remote include: network unreachable\n"
            return 0, self.render(argv, "--no-interpolate" in rest), ""
        if subcmd == "ps" and project in self.ps_fails:
            return 1, "", "Cannot connect to the Docker daemon\n"
        if subcmd == "ps":
            self.polls += 1
            rows = []
            for svc, c in sorted(self.containers.get(project, {}).items()):
                bad = c["image"].split("@")[1] in self.bad_apps and svc in self.APP_SVC
                bad = bad or (svc == "caddy" and c["image"].split("@")[1] in self.bad_caddy)
                health = "unhealthy" if bad else "healthy"
                rows.append(json.dumps({"Service": svc, "Name": c["name"], "State": "running", "Health": health, "ID": "id" + svc}))
            return 0, "\n".join(rows) + "\n", ""
        if subcmd == "up":
            envs = {}
            for j, a in enumerate(argv):
                if a == "--env-file":
                    envs.update(self.images_from(argv[j + 1]))
            self.up_marks.append(self.sleeps_total())
            saved = [argv[j + 1] for j, a in enumerate(argv) if a == "-f" and argv[j + 1].endswith(".json") and os.path.exists(argv[j + 1])]
            saved_images = json.load(open(saved[0]))["services"] if saved else {}
            svcs = [rest[k] for k in self._positionals(rest)] or ["postgres", "web", "auth", "worker"]
            for svc in svcs:
                key = self.KEY.get(svc, "APP")
                ref = (saved_images.get(svc) or {}).get("image") or envs.get("POLY_%s_IMAGE" % key)
                if ref is None:
                    return 1, "", "FAKE compose up: no image for %s\n" % svc
                self.set_container(project, svc, ref)
            return 0, "", ""
        if subcmd == "run":
            pos = self._positionals(rest)
            svc = rest[pos[0]]
            tail = rest[pos[0] + 2:]
            self.run_names.append((svc, rest[rest.index("--name") + 1] if "--name" in rest else None))
            if (svc, tail[0] if tail else "") in self.run_hang:
                if "--name" in rest:
                    self.run_started.add(rest[rest.index("--name") + 1])  # a stuck one-off exists only once a run of it has hung
                raise TimeoutError("run %s" % svc)
            if "--plan" in tail:
                return self.plan_code, self.plan_out, ""
            return self.run_codes.get((svc, tail[0] if tail else ""), 0), "", ""
        if subcmd == "exec" and "psql" in argv and stdin and "pg_roles" in stdin:  # G12
            self.role_queries.append(list(argv))
            if self.roles_answer == "timeout":
                raise TimeoutError("roles query")
            return self.roles_answer
        if subcmd == "exec" and "psql" in argv:
            return self.psql_result  # S19's table read: (code, out, err); stdout's last line is the user-table count
        if subcmd == "exec":
            web = self.containers.get(project, {}).get("web")
            bad = web and web["image"].split("@")[1] in self.bad_apps
            return 0, ("503\n" if bad else "200\n"), ""
        if subcmd in ("stop", "rm", "restart", "down", "kill"):
            self.stopped.append((project, subcmd, rest))
            return 0, "", ""
        self.unhandled.append(list(argv))
        return 1, "", "FAKE compose: unhandled %r\n" % (argv,)

    @staticmethod
    def _positionals(rest):
        """Indexes of non-flag tokens, skipping the value of --pull (and --timeout)."""
        out, skip = [], False
        for k, a in enumerate(rest):
            if skip:
                skip = False
            elif a in ("--pull", "--timeout", "-t", "--name"):
                skip = True
            elif not a.startswith("-"):
                out.append(k)
        return out

    def set_container(self, project, svc, ref):
        name = "%s-%s-1" % (project, svc)
        c = {"name": name, "image": ref}
        self.containers.setdefault(project, {})[svc] = c
        self.by_name[name] = c
        self.stopped_names.discard(name)  # an `up` starts it again

    def run_bytes(self, argv, stdin, timeout, env):
        self.runner._rec("run_bytes", argv, stdin, timeout, env)
        if argv[:2] == ["docker", "cp"]:
            self.docker_log.append(list(argv))
            cid = argv[2].split(":", 1)[0]
            data = self.registry[self.cids[cid]]["bundle"]
            if data is None:
                return 1, b"", "no bundle\n"
            return 0, data, ""
        raise AssertionError("FAKE run_bytes: unexpected %r" % (argv,))

    def owner_of(self, fd, path):
        """ctx.owner_of(fd, logical path) -> (uid, gid): root:10010 as far as the box is concerned (a unit test cannot own that group)."""
        if path not in STAGING_AUTH_PATHS:
            raise AssertionError("ctx.owner_of is for the two staging-auth paths only, got %r" % (path,))
        return self.owners.get(path, (os.getuid(), 10010))

    def ismount(self, path):
        """F13's seam: /srv/polycarpic is a mount point unless a test says it is not."""
        return path not in self.unmounted

    def https_status(self, host, addr, path):
        """A13's seam: by default 200 while the web container runs an image not in `edge_bad`; a digest in `edge_bad` answers its scripted status or raises."""
        self.https_calls.append((host, addr, path))
        if self.https_always is not None:
            v = self.https_always
        else:
            web = self.containers.get("polycarpic-prod", {}).get("web")
            d = web["image"].split("@")[1] if web else None
            v = self.edge_bad.get(d, 200)
        if isinstance(v, Exception):
            raise v
        return v


class DeployTest(OpsTest):
    """A staging box with a `current` release already deployed (A), main one commit ahead (B), a fixture token."""

    def setUp(self):
        super().setUp()
        h = self.host
        self.world = World(self.tmp)
        self.token = "github_pat_" + os.urandom(41).hex()[:82]  # built at run time: never a literal credential
        for d in ("/run/polycarpic", "/var/lib/polycarpic/state/deploy", "/etc/polycarpic/secrets/host"):
            h.mkdir(d, 0o755 if "secrets" not in d else 0o700)
        h.write("/etc/polycarpic/secrets/host/github_read_token", self.token + "\n", 0o400)
        h.write("/etc/polycarpic/edge.env", "POLY_DOMAIN=example.com\nPOLY_BIND_ADDR=0.0.0.0\nPOLY_STAGING_ALLOW=\nPOLY_TLS=internal\n")
        allow = REPO / "infra" / "deploy" / "compose-allow.json"
        if allow.exists():
            h.write("/opt/polycarpic/ops/%s/infra/deploy/compose-allow.json" % h.ops_id, allow.read_bytes())
        pinned = REPO / "infra" / "deploy" / "compose-version"  # G10: the installed bundle holds the pinned Compose version (install.sh's PATHS)
        if pinned.exists():
            h.write("/opt/polycarpic/ops/%s/infra/deploy/compose-version" % h.ops_id, pinned.read_bytes())
        gh_pin = REPO / "infra" / "deploy" / "gh-version"  # POLY-104 F15: as compose-version
        if gh_pin.exists():
            h.write("/opt/polycarpic/ops/%s/infra/deploy/gh-version" % h.ops_id, gh_pin.read_bytes())
        self.staging_auth_file()
        h.write("/etc/passwd", "root:x:0:0:root:/root:/bin/bash\npolycarpic-render:x:10020:10020::/nonexistent:/usr/sbin/nologin\n")  # A18: the render user, as provision.sh makes it
        self.current_digest = digest("current")
        self.seed("staging", self.current_digest, "-", self.world.commit_a)

    def staging_auth_file(self, text=None, mode=0o440, dir_mode=0o750):
        """S29/S30: the file the Caddyfile imports as text, in its 0750 directory. Ownership comes from the ctx.owner_of seam (the fake answers root:10010), so a
        non-root test user needs no patching; world.owners overrides it per logical path to test a wrong owner or group."""
        h = self.host
        h.mkdir("/etc/polycarpic/secrets/caddy", dir_mode)
        if h.p("/etc/polycarpic/secrets/caddy/staging_basic_auth").is_symlink() or h.p("/etc/polycarpic/secrets/caddy/staging_basic_auth").exists():
            os.unlink(str(h.p("/etc/polycarpic/secrets/caddy/staging_basic_auth")))
        h.write("/etc/polycarpic/secrets/caddy/staging_basic_auth", text if text is not None else "staging $2y$10$" + "a1B./" * 10 + "xyz" + "\n", mode)

    # state files under the project directory
    def sdir(self, project):
        return self.host.p("%s/%s" % (STATE, project))

    def seed(self, project, dig, tag, commit):
        d = self.host.mkdir("%s/%s" % (STATE, project))
        self.host.write("%s/%s/current" % (STATE, project), "%s %s %s %s %s\n" % (dig, tag, commit, "0" * 64, utc()))
        # what V6 reads of `current`: its release's Postgres major (a seeded current is not a full release; first-deploy builds real ones)
        rdir = "/opt/polycarpic/releases/sha256-%s" % dig.split(":")[1]
        self.host.write(rdir + "/infra/postgres-major", (REPO / "infra" / "postgres-major").read_bytes())
        self.host.write(rdir + "/images.env", "".join("POLY_%s_IMAGE=ghcr.io/richmosko/polycarpic-%s@%s\n" % (n.upper(), n, digest("cur-" + n)) for n in ("postgres", "tools", "caddy"))
                        + "POLY_APP_IMAGE=ghcr.io/richmosko/polycarpic@%s\n" % dig)

    def state(self, project, name):
        f = self.sdir(project) / name
        return f.read_text() if f.exists() else None

    def alert_name(self, project):
        a = self.state(project, "alert")
        return None if a is None else a.split()[1]

    def log_events(self, project):
        return [l.split()[1] for l in (self.state(project, "deploy.log") or "").splitlines()]

    def deploy(self, *argv, world=None, ctx_seams=True, cmd="deploy", sleeps_hook=None, **kw):
        w = world or self.world
        runner = kw.pop("runner", None) or Runner(None)
        w.runner = runner
        w.handler(runner)
        extra = {}
        names = ctx_class().__init__.__code__.co_varnames
        if ctx_seams and "ismount" in names:
            extra["ismount"] = w.ismount
        if ctx_seams and "owner_of" in names:
            extra["owner_of"] = w.owner_of
        if ctx_seams and "https_status" in names:
            extra["https_status"] = w.https_status
        if ctx_seams and "run_bytes" in names:
            extra["run_bytes"] = w.run_bytes
        def ready(rr):
            if sleeps_hook:
                rr.sleeps = HookList(sleeps_hook)
            w.sleeps_ref = rr.sleeps
            w._ctx_sleep = rr.ctx.sleep
        r = self.host.go(cmd, *argv, runner=runner, ctx_extra=extra, on_ready=ready, **kw)
        r.world = w
        return r

    def signers(self, *pubs):
        """allowed_signers on the box, plain form (R11): one principal per key."""
        self.host.write("/etc/polycarpic/allowed_signers", "".join('rel%d namespaces="git" %s\n' % (i, p) for i, p in enumerate(pubs)))

    def release(self, version, key, commit=None, kind="signed", attested=True, **tagkw):
        """A published prod release: tag in the origin, Release JSON, the image in the registry (label = its commit), attested at the commit."""
        w = self.world
        commit = commit or w.commit_b
        w.tag(version, commit, kind=kind, key=key, **tagkw)
        dig = digest("img-" + version)
        w.image("polycarpic", dig, commit)
        if attested:
            w.attested.add((dig, commit))
        w.releases.insert(0, {"tag_name": version, "draft": False, "prerelease": False, "body": "digest: " + dig, "published_at": utc()})
        return dig

    def nothing_ran(self, r):
        self.assertEqual([a for a in r.world.docker_log if a[1] in ("create", "compose", "run", "cp")], [])

    def argv_text(self, r, binary):
        return [" ".join(c["argv"]) for c in r.runner.calls if c["argv"][0] == binary]
