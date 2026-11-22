"""set-secret: write one secret into every service directory that mounts it (R4)."""
import errno
import getpass
import os
import secrets as _random
import stat
import warnings

from lib import compose
from lib import secrets as rules

HELP = "write a secret from a hidden prompt into each service that mounts it (--staging for staging)"


def add_arguments(parser):
    parser.add_argument("--staging", action="store_true")
    parser.add_argument("name")


def _read(ctx, name):
    """The typed value(s), or an exit code. Never echoes, never logs."""
    prompts = ["key id (input hidden): ", "application key (input hidden): "] if name == rules.TWO_LINES else ["%s (input hidden): " % name]
    values = []
    for prompt in prompts:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            value = ctx.getpass(prompt)
        if any(issubclass(w.category, getpass.GetPassWarning) for w in caught):
            ctx.err("set-secret: the terminal cannot hide input; nothing written")
            return 2
        why = rules.bad_value(value)
        if why:
            ctx.err("set-secret: %s; nothing written" % why)
            return 2
        if name == "heartbeat_url" and not value.startswith("https://"):
            ctx.err("set-secret: heartbeat_url must start with https://; nothing written")
            return 2
        values.append(value)
    return values


def _exists(ctx, path):
    try:
        os.lstat(ctx.p(path))
        return True
    except OSError:
        return False


def _plan(ctx, targets):
    """Phase 1: open and check every service directory and target before anything is written. -> (plan, exit code)."""
    plan = []
    for svc, path in targets:
        real = ctx.p(path)
        dpath, fname = os.path.split(real)
        try:
            gid_hint = os.stat(dpath).st_gid
        except OSError:
            gid_hint = compose.GIDS[svc]
        fail = "%s is not root:%d 0750: run provision" % (dpath, gid_hint)
        try:
            dfd = os.open(dpath, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        except OSError:
            ctx.err(fail)
            return plan, 4
        plan.append((dfd, fname, svc, real))
        st = os.fstat(dfd)
        if st.st_uid != ctx.trusted_uid or stat.S_IMODE(st.st_mode) != 0o750:
            ctx.err(fail)
            return plan, 4
        try:
            tst = os.stat(fname, dir_fd=dfd, follow_symlinks=False)
            if not stat.S_ISREG(tst.st_mode):
                ctx.err("%s is not a regular file: run provision" % real)
                return plan, 4
        except FileNotFoundError:
            pass
    return plan, 0


def _write(ctx, dfd, fname, data):
    """Temporary file in the directory, 0440 root:<dir gid>, fsync, rename over the target, fsync the directory."""
    gid = os.fstat(dfd).st_gid
    tmp = ".%s.tmp-%s" % (fname, _random.token_hex(8))
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o440, dir_fd=dfd)
    try:
        ctx.chown(fd, 0, gid)
        os.fchmod(fd, 0o440)  # K4: umask 077 masked the create mode to 0400
        os.write(fd, data)
        os.fsync(fd)
        os.close(fd)
        fd = None
        os.rename(tmp, fname, src_dir_fd=dfd, dst_dir_fd=dfd)
        os.fsync(dfd)
    except OSError:
        if fd is not None:
            os.close(fd)
        try:
            os.unlink(tmp, dir_fd=dfd)
        except OSError:
            pass
        raise
    return gid


def run(args, ctx):
    name = args.name
    project = "staging" if args.staging else "prod"
    if not rules.NAME.match(name):
        ctx.err("set-secret: bad name (want ^[a-z][a-z0-9_]{0,63}$)")
        return 2
    who = rules.refused_by(name)
    if who:
        ctx.err("set-secret: %s is written by %s, not set-secret" % (name, who))
        return 2
    mounts = compose.parse_secrets(ctx, project)
    targets = [(svc, path) for svc, n, path in mounts if n == name]
    if not targets:
        settable = sorted({n for _, n, _ in mounts if not rules.refused_by(n)})
        ctx.err("set-secret: no service in %s mounts %s; names you can set: %s" % (",".join(compose.FILES[project]), name, ", ".join(settable)))
        return 2
    if not ctx.isatty():
        ctx.err("set-secret reads from a terminal only")
        return 2

    existing = [svc for svc, path in targets if _exists(ctx, path)]
    if existing and ctx.confirm("%s exists for: %s; type yes to replace:" % (name, ", ".join(existing))) != "yes":
        ctx.err("not replaced")
        return 1

    values = _read(ctx, name)
    if isinstance(values, int):
        return values
    data = ("\n".join(values) + "\n").encode()
    del values

    plan, code = _plan(ctx, targets)
    written = []
    try:
        if code:
            return code
        for dfd, fname, svc, real in plan:
            try:
                gid = _write(ctx, dfd, fname, data)
            except OSError as err:
                ctx.err("set-secret: write failed for %s (%s)" % (real, errno.errorcode.get(err.errno, "error")))
                return 1
            written.append(svc)
            ctx.out("written: %s (%d bytes, 0440 root:%d)" % (real, len(data), gid))
    finally:
        for item in plan:
            os.close(item[0])
    flag = "--staging " if args.staging else ""
    long_running = [s for s in written if s in compose.LONG_RUNNING]
    tail = "run: sudo polycarpic-ops restart %s%s" % (flag, " ".join(long_running)) if long_running else "the next uploader run reads it"
    ctx.out("set-secret: %s written for %s; %s" % (name, ", ".join(written), tail))
    return 0
