"""The shared directories of a deploy and what a render must be able to read (POLY-100 G1, S37).

One helper makes each shared directory and sets its mode by `chmod`, never by `makedirs(mode=)`, which a 077 umask turns into 0700. A directory is
repaired only when it is opened without following a link and is owned by the trusted uid; a link, another owner or a non-directory is the
refusal `render-path` and is left as found. A box fault never quarantines a digest.
"""
import os
import stat

from lib import release as rel
from lib.out import clean
from lib.release import Refusal

OPT = "/opt/polycarpic"
RELEASES = "/opt/polycarpic/releases"
STATE = "/var/lib/polycarpic/state/deploy"
RENDER_HOME = STATE + "/render-home"
SHARED = (OPT, RELEASES, STATE)


def _fail(ctx=None, path=None, project=None):
    """`render-path`; the bad directory is named on stderr and in deploy.log (through out.clean), never repaired."""
    if ctx is not None and path:
        text = clean(path)
        ctx.err("render-path: %s" % text)
        if project:
            try:
                rel.log(ctx, project, "refused", "render-path", text)
            except Exception:
                pass
    raise Refusal("render-path")


def ensure(ctx, logical, project=None, check_empty_env=False):
    """Create `logical` (and any missing parent) as root 0755 and keep it exactly 0755. -> the real path."""
    real = ctx.p(logical)
    parent = os.path.dirname(real)
    if not os.path.isdir(parent):
        ensure(ctx, os.path.dirname(logical), project)
    try:
        os.mkdir(real, 0o755)
    except FileExistsError:
        pass
    except OSError:
        _fail(ctx, logical, project)
    try:
        fd = os.open(real, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except OSError:  # a link (ELOOP), a file (ENOTDIR) or anything unreadable
        _fail(ctx, logical, project)
    try:
        st = os.fstat(fd)
        mode = stat.S_IMODE(st.st_mode)
        if st.st_uid != ctx.trusted_uid or mode & ~0o755:  # another owner, or any bit beyond 0755: refused, left as found
            _fail(ctx, logical, project)
        if mode != 0o755:  # too tight (0700, 0750): repaired
            os.fchmod(fd, 0o755)
    finally:
        os.close(fd)
    if check_empty_env:  # the render home holds nothing: a `.env` there would feed every compose call (G11), and any other file is not ours
        for name in os.listdir(real):
            _fail(ctx, logical + "/" + name, project)
    return real


def ensure_shared(ctx, project=None):
    """Every shared directory, the project's state directory and the render home, before anything else of a run."""
    for d in SHARED:
        ensure(ctx, d, project)
    for name in ((project,) if project else ()) + ("render-home",):
        ensure(ctx, "%s/%s" % (STATE, name), project, check_empty_env=(name == "render-home"))


def check_readable(ctx, real_files):
    """Before any render: each file the render names is root-owned and o+r, and every parent up to the root is o+x. A miss is `render-path`."""
    top = os.path.realpath(ctx.p("/"))
    for path in real_files:
        try:
            st = os.lstat(path)
        except OSError:
            continue  # absent files are the compose refusal's business (guard-render), not a permission fault
        if not stat.S_ISREG(st.st_mode) or st.st_uid != ctx.trusted_uid or not st.st_mode & stat.S_IROTH:
            _fail(ctx, path)
        parent = os.path.dirname(path)
        while parent and os.path.realpath(parent) != top and parent != os.path.dirname(parent):
            pst = os.lstat(parent)
            if not stat.S_ISDIR(pst.st_mode) or not pst.st_mode & stat.S_IXOTH:
                _fail(ctx, parent)
            parent = os.path.dirname(parent)
