"""The release machinery of `deploy` (POLY-100 R2-R4, R10): state files, the log, candidates, verification, the bundle as data.

Every value read from GitHub or a registry is matched against a fixed pattern before use; a miss is the refusal `malformed`.
Nothing here runs anything out of a release directory.
"""
import hashlib
import io
import json
import os
import re
import stat
import tarfile

from lib import ts

SLUG = "richmosko/polycarpic"
REGISTRY = "ghcr.io/" + SLUG
REPO_URL = "https://github.com/" + SLUG
BUILD_PATH = ".github/workflows/build.yml"
SIGNER = SLUG + "/" + BUILD_PATH
STATE = "/var/lib/polycarpic/state/deploy"
RELEASES = "/opt/polycarpic/releases"
TOKEN = "/etc/polycarpic/secrets/host/github_read_token"
SIGNERS = "/etc/polycarpic/allowed_signers"
TAGS_GIT = STATE + "/tags.git"
SIBLINGS = ("postgres", "tools", "caddy")
IMAGE_KEYS = ("POLY_POSTGRES_IMAGE", "POLY_TOOLS_IMAGE", "POLY_CADDY_IMAGE")
LABEL = "org.opencontainers.image.revision"
EVENTS = ("candidate", "verified", "refused", "transient", "busy", "quarantined", "not-newer", "premigration-set", "migrated", "up", "healthy",
          "rolled-back", "rollback-unhealthy")

DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
SHA = re.compile(r"[0-9a-f]{40}")
RUN_ID = re.compile(r"[0-9]{1,20}")
TAG = re.compile(r"v1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
BODY = re.compile(r"digest: (sha256:[0-9a-f]{64})")
MAX_FILE = 1 << 20
MAX_TREE = 8 << 20
MAX_TAR = 64 << 20
MAX_MEMBERS = 512
MAX_NAME = 200


class Refusal(Exception):
    def __init__(self, name, quarantine=False, code=1):
        Exception.__init__(self, name)
        self.name, self.quarantine, self.code = name, quarantine, code


class Transient(Exception):
    pass


# ---- state (R10): root 0755 directories, root 0644 files, tmp + rename ----
def sdir(ctx, project):
    d = ctx.p("%s/%s" % (STATE, project))
    os.makedirs(d, mode=0o755, exist_ok=True)
    return d


def read(ctx, project, name):
    return ts.read_text(os.path.join(sdir(ctx, project), name))


def write(ctx, path, text, mode=0o644):
    tmp = "%s.tmp-%d" % (path, os.getpid())
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, "w") as fh:
        fh.write(text)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def put(ctx, project, name, text):
    write(ctx, os.path.join(sdir(ctx, project), name), text)


def now_utc(ctx):
    return ctx.now().strftime("%Y-%m-%dT%H:%M:%SZ")


def log(ctx, project, event, *fields):
    assert event in EVENTS, event
    line = "%s %s %s" % (now_utc(ctx), event, " ".join(fields))
    path = os.path.join(sdir(ctx, project), "deploy.log")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd, "a") as fh:
        fh.write(line.rstrip() + "\n")


def alert(ctx, project, name):
    put(ctx, project, "alert", "%s %s\n" % (now_utc(ctx), name))


def clear_alert(ctx, project):
    try:
        os.unlink(os.path.join(sdir(ctx, project), "alert"))
    except FileNotFoundError:
        pass


def quarantine(ctx, project, digest, reason):
    path = os.path.join(sdir(ctx, project), "quarantine")
    prev = ts.read_text(path) or ""
    put(ctx, project, "quarantine", prev + "%s %s %s\n" % (digest, now_utc(ctx), reason))


def quarantined(ctx, project):
    text = read(ctx, project, "quarantine") or ""
    return set(line.split(" ", 1)[0] for line in text.splitlines() if line)


def load_pointer(ctx, project, name):
    """`current` / `previous`: -> dict(digest, tag, commit, tree, at) or None."""
    text = read(ctx, project, name)
    if not text:
        return None
    parts = text.strip().split(" ")
    if len(parts) != 5 or not DIGEST.fullmatch(parts[0]) or not SHA.fullmatch(parts[2]):
        return None
    return dict(digest=parts[0], tag=parts[1], commit=parts[2], tree=parts[3], at=parts[4])


def save_pointer(ctx, project, name, p):
    put(ctx, project, name, "%s %s %s %s %s\n" % (p["digest"], p["tag"], p["commit"], p["tree"], p["at"]))


# ---- gh, git ----
def token(ctx):
    text = ts.read_text(ctx.p(TOKEN))
    if not text or not text.strip():
        raise Refusal("token", code=4)
    return text.strip()


def gh(ctx, tok, work, argv, timeout=120):
    """gh gets the token in its own environment only (S6), and an empty config directory."""
    cfg = os.path.join(work, "gh")
    os.makedirs(cfg, mode=0o700, exist_ok=True)
    try:
        code, out, err = ctx.run(["gh"] + argv, timeout=timeout, extra_env={"GH_TOKEN": tok, "GH_CONFIG_DIR": cfg})
    except TimeoutError:
        raise Transient("gh timed out")
    return code, out, err


def gh_json(ctx, tok, work, path):
    code, out, err = gh(ctx, tok, work, ["api", path])
    if code != 0:
        raise Transient("gh api failed")
    try:
        return json.loads(out)
    except ValueError:
        raise Refusal("malformed")


GIT_ENV = {"GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0"}


def git(ctx, argv, timeout=120, extra=None):
    env = dict(GIT_ENV)
    env.update(extra or {})
    return ctx.run(["git", "-c", "credential.helper="] + argv, timeout=timeout, extra_env=env)


def tags_repo(ctx):
    path = ctx.p(TAGS_GIT)
    if not os.path.isdir(path):
        os.makedirs(os.path.dirname(path), mode=0o755, exist_ok=True)
        code, _, _ = git(ctx, ["init", "--bare", "-q", path])
        if code != 0:
            raise Transient("git init failed")
    return path


# ---- R2: the candidate ----
def staging_candidate(ctx, tok, work):
    """-> (digest, commit, run id). Accepts one run only after every field matches."""
    data = gh_json(ctx, tok, work, "repos/%s/actions/workflows/build.yml/runs?branch=main&status=success&per_page=1" % SLUG)
    runs = data.get("workflow_runs") if isinstance(data, dict) else None
    if not isinstance(runs, list) or not runs:
        raise Transient("no run")
    run = runs[0]
    if not isinstance(run, dict):
        raise Refusal("malformed")
    rid, sha = str(run.get("id", "")), run.get("head_sha", "")
    if not RUN_ID.fullmatch(rid) or not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise Refusal("malformed")
    if run.get("head_branch") != "main" or run.get("event") not in ("push", "schedule") or run.get("path") != BUILD_PATH:
        raise Refusal("malformed")
    dest = os.path.join(work, "artifact")
    code, _, _ = gh(ctx, tok, work, ["run", "download", rid, "-R", SLUG, "-n", "image-" + sha, "-D", dest])
    if code != 0:
        raise Transient("download failed")
    text = ts.read_text(os.path.join(dest, "digest.txt"))
    if text is None or not re.fullmatch(r"sha256:[0-9a-f]{64}\n", text):
        raise Refusal("malformed")
    return text[:-1], sha, rid


def semver(tag):
    m = TAG.fullmatch(tag)
    return None if not m else (1, int(m.group(1)), int(m.group(2)))


def prod_candidate(ctx, tok, work):
    """-> (digest, tag): the highest semver among the well-formed releases, never the newest by date."""
    data = gh_json(ctx, tok, work, "repos/%s/releases?per_page=100" % SLUG)
    if not isinstance(data, list):
        raise Refusal("malformed")
    best = None
    for rel in data:
        if not isinstance(rel, dict) or rel.get("draft") or rel.get("prerelease"):
            continue
        tag = rel.get("tag_name")
        v = semver(tag) if isinstance(tag, str) else None
        if v is None:
            continue
        m = BODY.fullmatch(rel.get("body") if isinstance(rel.get("body"), str) else "")
        if not m:
            continue
        if best is None or v > best[0]:
            best = (v, tag, m.group(1))
    if best is None:
        raise Transient("no release")
    return best[2], best[1]


def tag_commit(ctx, tag):
    """V4: fetch the tag object into tags.git and verify its SSH signature against the installed signers. -> (commit, tag object's name)."""
    repo = tags_repo(ctx)
    ref = "refs/tags/" + tag
    code, _, _ = git(ctx, ["--git-dir", repo, "fetch", "--no-tags", REPO_URL, "%s:%s" % (ref, ref)])
    if code != 0:
        raise Transient("tag fetch failed")
    code, out, _ = git(ctx, ["--git-dir", repo, "cat-file", "-t", ref])
    if code != 0 or out.strip() != "tag":
        raise Refusal("tag-signature", True)
    code, body, _ = git(ctx, ["--git-dir", repo, "cat-file", "tag", ref])
    if code != 0 or "-----BEGIN SSH SIGNATURE-----" not in body:
        raise Refusal("tag-signature", True)
    code, _, _ = git(ctx, ["--git-dir", repo, "-c", "gpg.format=ssh", "-c", "gpg.ssh.allowedSignersFile=" + ctx.p(SIGNERS), "verify-tag", ref])
    if code != 0:
        raise Refusal("tag-signature", True)
    head = body.split("\n\n", 1)[0].splitlines()
    objs = [l[7:] for l in head if l.startswith("object ")]
    if "type commit" not in head or len(objs) != 1 or not SHA.fullmatch(objs[0]):
        raise Refusal("tag-commit", True)
    if [l[4:] for l in head if l.startswith("tag ")] != [tag]:
        raise Refusal("tag-name", True)
    commit = objs[0]
    return commit


def descends(ctx, current_commit, commit):
    """Staging monotonic: C is `current`'s commit or descends from it (ancestry is part of the commit object)."""
    repo = tags_repo(ctx)
    code, _, _ = git(ctx, ["--git-dir", repo, "fetch", "--no-tags", "--filter=tree:0", REPO_URL, commit])
    if code != 0:
        raise Transient("commit fetch failed")
    code, _, _ = git(ctx, ["--git-dir", repo, "merge-base", "--is-ancestor", current_commit, commit])
    return code == 0


# ---- R3: verification ----
def attest(ctx, tok, work, name, digest, commit):
    argv = ["attestation", "verify", "oci://%s/%s@%s" % ("ghcr.io/richmosko", name, digest), "--repo", SLUG, "--signer-workflow", SIGNER,
            "--source-ref", "refs/heads/main", "--deny-self-hosted-runners", "--source-digest", commit, "--predicate-type",
            "https://slsa.dev/provenance/v1"]
    code, _, _ = gh(ctx, tok, work, argv)
    return code == 0


def pull_and_label(ctx, name, digest, commit, sibling=False):
    """V2 and V3: pull by digest, then the image must list the digest and carry the revision label equal to C."""
    ref = "ghcr.io/richmosko/%s@%s" % (name, digest)
    try:
        code, _, _ = ctx.run(["docker", "pull", ref], timeout=900)
    except TimeoutError:
        code = 1
    if code != 0:
        raise Transient("docker pull failed")
    code, out, _ = ctx.run(["docker", "image", "inspect", ref], timeout=60)
    try:
        info = json.loads(out)[0]
    except (ValueError, IndexError, KeyError, TypeError):
        info = None
    if code != 0 or not isinstance(info, dict) or ref not in (info.get("RepoDigests") or []):
        raise Refusal("pull")
    labels = (info.get("Config") or {}).get("Labels") or {}
    if labels.get(LABEL) != commit:
        raise Refusal("label", True)
    return ref


def verify_image(ctx, tok, work, name, digest, commit, sibling=False):
    """V1 (before any pull), V2, V3 for one image. -> its reference."""
    if not attest(ctx, tok, work, name, digest, commit):
        raise Refusal("sibling-%s" % name if sibling else "attestation")
    return pull_and_label(ctx, name, digest, commit, sibling)


# ---- R4: the bundle is data ----
FILES = ("infra/compose/prod.yml", "infra/compose/staging.yml", "infra/compose/edge.yml", "infra/caddy/Caddyfile", "infra/backup/backup.sh",
         "infra/backup/upload.sh", "infra/postgres-major", "infra/release/images.env")
DIRS = ("infra", "infra/compose", "infra/caddy", "infra/postgres", "infra/backup", "infra/release")


def allowed_member(name):
    return name in FILES or name in DIRS or (name.startswith("infra/postgres/") and not name.endswith("/"))


def read_tar(data):
    """-> {path: (bytes, executable)} or raises Refusal('bundle'). Nothing is written until every member passed."""
    files, total = {}, 0
    if len(data) > MAX_TAR:
        raise Refusal("bundle", True)
    try:
        tar = tarfile.open(fileobj=io.BytesIO(data), mode="r:")
        members = tar.getmembers()
    except (tarfile.TarError, EOFError, OSError):
        raise Refusal("bundle", True)
    if len(members) > MAX_MEMBERS:
        raise Refusal("bundle", True)
    for m in members:
        if len(m.name) > MAX_NAME or m.pax_headers or m.type not in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE):
            raise Refusal("bundle", True)
        name = m.name.rstrip("/") if m.isdir() else m.name
        parts = name.split("/")
        if name.startswith("/") or ".." in parts or "" in parts or "." in parts:
            raise Refusal("bundle", True)
        if m.mode & 0o7000 or m.issym() or m.islnk() or m.isdev() or m.isfifo() or not (m.isreg() or m.isdir()):
            raise Refusal("bundle", True)
        if not allowed_member(name):
            raise Refusal("bundle", True)
        if m.isreg():
            if m.size > MAX_FILE or name in files:
                raise Refusal("bundle", True)
            total += m.size
            if total > MAX_TREE:
                raise Refusal("bundle", True)
            files[name] = (tar.extractfile(m).read(), bool(m.mode & 0o111))
    for need in FILES:
        if need not in files:
            raise Refusal("bundle", True)
    return files


def tree_hash(root):
    """sha256 over (relative path, executable bit, file sha256) for every file under `root`; a link or odd file makes it None."""
    h = hashlib.sha256()
    for base, dirs, names in os.walk(root):
        dirs.sort()
        for n in sorted(names):
            full = os.path.join(base, n)
            st = os.lstat(full)
            if not stat.S_ISREG(st.st_mode):
                return None
            with open(full, "rb") as fh:
                digest = hashlib.sha256(fh.read()).hexdigest()
            h.update(("%s %d %s\n" % (os.path.relpath(full, root), 1 if st.st_mode & 0o111 else 0, digest)).encode())
    return h.hexdigest()


def release_dir(ctx, digest):
    return ctx.p("%s/sha256-%s" % (RELEASES, digest.split(":", 1)[1]))


def extract(ctx, ref, digest):
    """docker create (never started) + cp + rm, the tar filtered, then written 0755/0644 into a fresh directory and renamed. -> release dir."""
    name = "polycarpic-bundle-" + os.urandom(6).hex()
    code, out, _ = ctx.run(["docker", "create", "--name", name, ref], timeout=120)
    cid = out.strip()
    if code != 0 or not cid:
        raise Refusal("bundle", True)
    try:
        code, data, _ = ctx.run_bytes(["docker", "cp", "%s:/app/infra" % cid, "-"], timeout=120)
    finally:
        ctx.run(["docker", "rm", cid], timeout=60)
    if code != 0:
        raise Refusal("bundle", True)
    files = read_tar(data)
    root = ctx.p(RELEASES)
    os.makedirs(root, mode=0o755, exist_ok=True)
    incoming = os.path.join(root, ".incoming-" + os.urandom(6).hex())
    os.mkdir(incoming, 0o700)
    try:
        for path, (body, exe) in sorted(files.items()):
            dest = os.path.join(incoming, path)
            os.makedirs(os.path.dirname(dest), mode=0o755, exist_ok=True)
            fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as fh:
                fh.write(body)
            os.chmod(dest, 0o755 if exe else 0o644)
        for base, dirs, _ in os.walk(incoming):
            os.chmod(base, 0o755)
        final = release_dir(ctx, digest)
        if os.path.isdir(final):
            remove_tree(final)
        os.rename(incoming, final)
    except BaseException:
        remove_tree(incoming)
        raise
    return final


def remove_tree(path):
    import shutil
    shutil.rmtree(path, ignore_errors=True)


def parse_images_env(text):
    """The bundle's images.env: exactly the three sibling keys, each a digest-pinned ref of its own repository."""
    got = {}
    for line in text.splitlines():
        m = re.fullmatch(r"(POLY_[A-Z]+_IMAGE)=ghcr\.io/richmosko/polycarpic-([a-z]+)@(sha256:[0-9a-f]{64})", line)
        if not m:
            raise Refusal("bundle", True)
        key, repo, dig = m.groups()
        if key in got or repo not in SIBLINGS or key != "POLY_%s_IMAGE" % repo.upper():
            raise Refusal("bundle", True)
        got[key] = (repo, dig)
    if sorted(got) != sorted(IMAGE_KEYS):
        raise Refusal("bundle", True)
    return got


def write_images_env(ctx, rdir, app_ref, bundle_text):
    write(ctx, os.path.join(rdir, "images.env"), bundle_text.rstrip("\n") + "\nPOLY_APP_IMAGE=%s\n" % app_ref)
