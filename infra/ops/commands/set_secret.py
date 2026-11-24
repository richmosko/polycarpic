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
        if name == "github_read_token" and not rules.GITHUB_TOKEN.fullmatch(value):
            ctx.err("set-secret: github_read_token must be a fine-grained token (github_pat_...); nothing written")
            return 2
        values.append(value)
    return values


def _plan(ctx, targets):
    """Phase 1: open and check every service directory and target before anything is written. -> (plan, exit code)."""
    plan = []
    for svc, path in targets:
        real = ctx.p(path)
        dpath, fname = os.path.split(real)
        try:
            gid_hint = os.stat(dpath).st_gid
        except OSError:
            gid_hint = compose.GIDS.get(svc, 0)
        dmode = 0o700 if svc == rules.HOST_DIR else 0o750
        fail = "%s is not root:%d %04o: run provision" % (dpath, gid_hint, dmode)
        try:
            dfd = os.open(dpath, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        except OSError:
            ctx.err(fail)
            return plan, 4
        entry = [dfd, fname, svc, real, False]
        plan.append(entry)
        st = os.fstat(dfd)
        if st.st_uid != ctx.trusted_uid or stat.S_IMODE(st.st_mode) != dmode:
            ctx.err(fail)
            return plan, 4
        try:
            tst = os.stat(fname, dir_fd=dfd, follow_symlinks=False)
            entry[4] = True
            if not stat.S_ISREG(tst.st_mode):
                ctx.err("%s is not a regular file: run provision" % real)
                return plan, 4
        except FileNotFoundError:
            pass
    return plan, 0


def _write(ctx, dfd, fname, data, fmode=0o440):
    """Temporary file in the directory, 0440 root:<dir gid>, fsync, rename over the target, fsync the directory."""
    gid = 0 if fmode == 0o400 else os.fstat(dfd).st_gid  # host-only files are root:root, whatever the directory says
    tmp = ".%s.tmp-%s" % (fname, _random.token_hex(8))
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, fmode, dir_fd=dfd)
    try:
        ctx.chown(fd, 0, gid)
        os.fchmod(fd, fmode)  # K4: umask 077 masked the create mode to 0400
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
    if not rules.NAME.fullmatch(name):
        ctx.err("set-secret: bad name (want ^[a-z][a-z0-9_]{0,63}$)")
        return 2
    who = rules.refused_by(name)
    if who:
        ctx.err("set-secret: %s is written by %s, not set-secret" % (name, who))
        return 2
    mounts = compose.parse_secrets(ctx, project)
    targets = [(svc, path) for svc, n, path in mounts if n == name]
    if not targets and name in rules.HOST_ONLY and not args.staging:
        targets = [(rules.HOST_ONLY[name], rules.SECRET_ROOT + rules.HOST_ONLY[name] + "/" + name)]
    if not targets:
        settable = sorted({n for _, n, _ in mounts if not rules.refused_by(n)} | (set() if args.staging else set(rules.HOST_ONLY)))
        ctx.err("set-secret: no service in %s mounts %s; names you can set: %s" % (",".join(compose.FILES[project]), name, ", ".join(settable)))
        return 2
    if not ctx.isatty():
        ctx.err("set-secret reads from a terminal only")
        return 2

    plan, code = _plan(ctx, targets)
    written = []
    try:
        if code:
            return code
        existing = [item[2] for item in plan if item[4]]
        if existing and ctx.confirm("%s exists for: %s; type yes to replace:" % (name, ", ".join(existing))) != "yes":
            ctx.err("not replaced")
            return 1
        values = _read(ctx, name)
        if isinstance(values, int):
            return values
        data = ("\n".join(values) + "\n").encode()
        del values
        for dfd, fname, svc, real, _ in plan:
            try:
                gid = _write(ctx, dfd, fname, data, 0o400 if svc == rules.HOST_DIR else 0o440)
            except OSError as err:
                ctx.err("set-secret: write failed for %s (%s)" % (real, errno.errorcode.get(err.errno, "error")))
                return 1
            written.append(svc)
            ctx.out("written: %s (%d bytes, %s root:%d)" % (real, len(data), "0400" if svc == rules.HOST_DIR else "0440", gid))
    finally:
        for item in plan:
            os.close(item[0])
    flag = "--staging " if args.staging else ""
    long_running = [s for s in written if s in compose.LONG_RUNNING]
    tail = "run: sudo polycarpic-ops restart %s%s" % (flag, " ".join(long_running)) if long_running else "the next uploader run reads it"
    if name in rules.HOST_ONLY:
        ctx.out("set-secret: %s written; root reads it on the next backup or upload run" % name)
        return 0
    ctx.out("set-secret: %s written for %s; %s" % (name, ", ".join(written), tail))
    return 0
