"""POLY-100 R13 seam for `polycarpic-ops deploy`. Contract pins: process/cairn/reviews/POLY-100/test-plan.md.

World = the outside of the box, faked: the registry (docker), GitHub (gh), a REAL git origin (git and ssh-keygen run for real, in the temp
tree; only the github.com URL is redirected to a local repo), a resolver, and scripted `polycarpic-ops backup premigration`. Everything
reaches the tool through ctx.run / ctx.run_bytes / ctx.resolve; subprocess stays patched to raise (base.OpsTest).
"""
import datetime as dt
import hashlib
import io
import json
import os
import subprocess
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
SYSTEM_PATH = os.environ.get("PATH", "/usr/bin:/bin")


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


class World(object):
    def __init__(self, tmp):
        self.tmp = Path(tmp)
        self.registry = {}   # "<ref>@<digest>" -> {"labels": {...}, "bundle": tar bytes}
        self.attested = set()  # (digest, source_digest) pairs `gh attestation verify` passes
        self.runs = []       # build.yml run objects, newest first
        self.releases = []   # release objects, newest first
        self.artifacts = {}  # run id -> digest.txt text
        self.names = {}      # resolver: name -> list of addresses; missing name raises OSError
        self.premigration = (0, "", "")
        self.gh_down = False  # a network outage: gh exits 1 with a transport error
        self.docker_log, self.unhandled, self.pulled = [], [], []
        self.cids = {}
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
        self.origin.mkdir()
        self.git("init", "-q", "-b", "main")
        for k, v in (("uploadpack.allowFilter", "true"), ("uploadpack.allowAnySHA1InWant", "true"), ("commit.gpgsign", "false")):
            self.git("config", k, v)
        self.commit_a = self.commit("a")
        self.commit_b = self.commit("b")

    def keygen(self, name):
        """-> (private key path, `ssh-ed25519 <base64>`)."""
        priv = self.tmp / ("key-" + name)
        REAL_RUN(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", name, "-f", str(priv)])
        return str(priv), " ".join((self.tmp / ("key-%s.pub" % name)).read_text().split()[:2])

    def tag(self, name, commit, kind="signed", key=None, ref=None):
        """kind: signed (ssh), light, gpg (an object carrying a PGP block), tree (ssh-signed tag of a tree). -> the tag object (or commit) sha."""
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
        runner.on(lambda a: a[0] == "docker", fn=self._docker)
        runner.on(lambda a: a[0] == "gh", fn=self._gh)
        runner.on(lambda a: a[0] in ("git", "ssh-keygen"), fn=self._real)
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

    def _gh(self, argv, stdin):
        env = self._last_env(argv) or {}
        if self.gh_down:
            return 1, "", "error connecting to api.github.com\n"
        if "GH_TOKEN" not in env:
            return 4, "", "To get started with GitHub CLI, please run:  gh auth login\n"
        sub = argv[1]
        if sub == "api":
            url = next(a for a in argv[2:] if not a.startswith("-"))
            if "/actions/workflows/build.yml/runs" in url:
                return 0, json.dumps({"total_count": len(self.runs), "workflow_runs": self.runs[:1]}), ""
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

    def _docker(self, argv, stdin):
        self.docker_log.append(list(argv))
        sub = argv[1]
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
        self.unhandled.append(list(argv))
        return 1, "", "FAKE docker: unhandled %r\n" % (argv,)

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

    def resolve(self, name):
        if name not in self.names:
            raise OSError("Name or service not known: " + name)
        return list(self.names[name])


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
        self.current_digest = digest("current")
        self.seed("staging", self.current_digest, "-", self.world.commit_a)

    # state files under the project directory
    def sdir(self, project):
        return self.host.p("%s/%s" % (STATE, project))

    def seed(self, project, dig, tag, commit):
        d = self.host.mkdir("%s/%s" % (STATE, project))
        self.host.write("%s/%s/current" % (STATE, project), "%s %s %s %s %s\n" % (dig, tag, commit, "0" * 64, utc()))

    def state(self, project, name):
        f = self.sdir(project) / name
        return f.read_text() if f.exists() else None

    def alert_name(self, project):
        a = self.state(project, "alert")
        return None if a is None else a.split()[1]

    def log_events(self, project):
        return [l.split()[1] for l in (self.state(project, "deploy.log") or "").splitlines()]

    def deploy(self, *argv, world=None, ctx_seams=True, **kw):
        w = world or self.world
        runner = kw.pop("runner", None) or Runner(None)
        w.runner = runner
        w.handler(runner)
        extra = {}
        names = ctx_class().__init__.__code__.co_varnames
        if ctx_seams and "resolve" in names:
            extra["resolve"] = w.resolve
        if ctx_seams and "run_bytes" in names:
            extra["run_bytes"] = w.run_bytes
        r = self.host.go("deploy", *argv, runner=runner, ctx_extra=extra, **kw)
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
