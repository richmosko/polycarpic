"""deploy <prod|staging>: the pull-based deploy (POLY-100). Finds the candidate, verifies all of it, and only then runs anything of it.

Exit codes: 0 done, nothing to do, busy or a transient outage; 1 refused or failed; 4 precondition.
"""
import fcntl
import os
import tempfile

from lib import release as rel

HELP = "deploy prod|staging (pull the latest verified release)"
LOCK = "/run/polycarpic/deploy.lock"


def add_arguments(parser):
    parser.add_argument("project", choices=["prod", "staging"])


def take_lock(ctx):
    run_dir = ctx.p("/run/polycarpic")
    os.makedirs(run_dir, mode=0o755, exist_ok=True)
    fd = os.open(ctx.p(LOCK), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        return None
    return fd


def run(args, ctx):
    project = args.project
    fd = take_lock(ctx)
    if fd is None:
        rel.log(ctx, project, "busy")
        return 0
    work = None
    try:
        work = tempfile.mkdtemp(prefix="work-", dir=rel.sdir(ctx, project))
        os.chmod(work, 0o700)
        return _deploy(project, ctx, work)
    finally:
        if work:
            rel.remove_tree(work)
        os.close(fd)


def _deploy(project, ctx, work):
    seen = {"digest": "-"}
    try:
        tok = rel.token(ctx)
        cur = rel.load_pointer(ctx, project, "current")
        try:
            digest, commit, tag = _candidate(project, ctx, tok, work, cur, seen)
        except _Skip:
            return 0
        rel.log(ctx, project, "candidate", digest, commit)
        _verify(project, ctx, tok, work, digest, commit)
        rel.log(ctx, project, "verified", digest)
        return 0
    except rel.Transient as err:
        rel.log(ctx, project, "transient", str(err))
        return 0
    except rel.Refusal as err:
        digest = seen["digest"]
        rel.log(ctx, project, "refused", err.name, digest)
        if err.quarantine and digest != "-":
            rel.quarantine(ctx, project, digest, err.name)
        rel.alert(ctx, project, err.name)
        ctx.err("deploy: refused " + err.name)
        return err.code


class _Skip(Exception):
    pass


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
    raise rel.Refusal("not-newer")


def _verify(project, ctx, tok, work, digest, commit):
    """R3 V1-V5: the app image, then the bundle and each sibling. Nothing of the digest is run."""
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
    return rdir
