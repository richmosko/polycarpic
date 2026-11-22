"""set-secret: write one secret into every service directory that mounts it (R4)."""
import getpass
import os
import re
import secrets as _random
import stat
import warnings

from lib import compose, secrets as rules

HELP = "write a secret from a hidden prompt into each service that mounts it (--staging for staging)"


def add_arguments(parser):
    parser.add_argument("--staging", action="store_true")
    parser.add_argument("name")


def _read(ctx, name):
    """The value(s) typed at the terminal, or an exit code. Never echoes, never logs."""
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


def run(args, ctx):
    name = args.name
    project = "staging" if args.staging else "prod"
    if not rules.NAME.match(name):
        ctx.err("set-secret: bad name (want ^[a-z][a-z0-9_]{0,63}$)")
        return 2
    who = rules.owner(name)
    if who:
        ctx.err("set-secret: %s is written by %s, not by set-secret" % (name, who))
        return 2
    mounts = compose.parse_secrets(ctx, project)
    targets = [(svc, path) for svc, n, path in mounts if n == name]
    if not targets:
        settable = sorted({n for _, n, _ in mounts if not rules.owner(n)})
        ctx.err("set-secret: no service in %s mounts %s; names you can set: %s"
                % (", ".join(compose.FILES[project]), name, ", ".join(settable)))
        return 2
    if not ctx.isatty():
        ctx.err("set-secret reads from a terminal only")
        return 2

    existing = [svc for svc, path in targets if _exists(ctx, path)]
    if existing:
        answer = ctx.confirm("%s exists for: %s; type yes to replace: " % (name, ", ".join(existing)))
        if answer.strip() != "yes":
            ctx.err("not replaced")
            return 1

    values = _read(ctx, name)
    if isinstance(values, int):
        return values
    data = ("\n".join(values) + "\n").encode()
    del values

    # Phase 1: every directory and target is checked before anything is written.
    opened = []
    try:
        for svc, path in targets:
            real = ctx.path(path)
            dpath, fname = os.path.split(real)
            want = compose.GIDS[svc]
            try:
                dfd = os.open(dpath, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            except OSError:
                ctx.err("%s is not root:%d 0750: run provision" % (ctx.display(dpath), want))
                return 4
            opened.append(dfd)
            st = ctx.fstat(dfd)
            if st.st_uid != 0 or stat.S_IMODE(st.st_mode) != 0o750:
                ctx.err("%s is not root:%d 0750: run provision" % (ctx.display(dpath), want))
                return 4
            try:
                tst = os.stat(fname, dir_fd=dfd, follow_symlinks=False)
                if not stat.S_ISREG(tst.st_mode):
                    ctx.err("%s is not a regular file: nothing written" % ctx.display(real))
                    return 4
            except FileNotFoundError:
                pass
            targets_gid = st.st_gid
            opened[-1] = (dfd, fname, targets_gid, svc, real)
        # Phase 2: write each one.
        written = []
        for dfd, fname, gid, svc, real in opened:
            tmp = ".%s.tmp-%s" % (fname, _random.token_hex(8))
            fd = None
            try:
                fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o440, dir_fd=dfd)
                ctx.chown(fd, 0, gid)
                os.fchmod(fd, 0o440)  # K4: umask 077 masked the create mode to 0400
                os.write(fd, data)
                os.fsync(fd)
                os.close(fd)
                fd = None
                os.rename(tmp, fname, src_dir_fd=dfd, dst_dir_fd=dfd)
                os.fsync(dfd)
            except OSError as err:
                if fd is not None:
                    os.close(fd)
                try:
                    os.unlink(tmp, dir_fd=dfd)
                except OSError:
                    pass
                ctx.err("set-secret: write failed for %s (%s)" % (ctx.display(real), errno_name(err)))
                return 1
            written.append((svc, real, gid))
            ctx.out("written: %s (%d bytes, 0440 root:%d)" % (ctx.display(real), len(data), gid))
    finally:
        for item in opened:
            try:
                os.close(item[0] if isinstance(item, tuple) else item)
            except OSError:
                pass
    services = [svc for svc, _, _ in written]
    flag = "--staging " if args.staging else ""
    long_running = [s for s in services if s in compose.LONG_RUNNING]
    if long_running:
        tail = "run: sudo polycarpic-ops restart %s%s" % (flag, " ".join(long_running))
    else:
        tail = "the next uploader run reads it"
    ctx.out("set-secret: %s written for %s; %s" % (name, ", ".join(services), tail))
    return 0


def errno_name(err):
    import errno
    return errno.errorcode.get(err.errno, "error")


def _exists(ctx, path):
    try:
        ctx.stat(ctx.path(path))
        return True
    except OSError:
        return False
