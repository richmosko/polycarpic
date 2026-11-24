"""staging-auth: write the staging basic-auth hash for Caddy (POLY-100 R11, S29, S30).

Generate the password on the laptop (`openssl rand -hex 16`, kept in your secret store), then `htpasswd -nBC 10 staging` at its own prompt, never
`-b`, and paste the one line `staging:$2y$10$...` here. The hash is read at a hidden prompt only: no argument, option, environment variable or pipe.
"""
import getpass
import os
import secrets as _random
import stat
import warnings

from lib import compose, sauth

HELP = "write the staging basic-auth hash Caddy reads (paste the htpasswd line at the hidden prompt)"


def add_arguments(parser):
    pass


def _write(ctx, data):
    dpath = ctx.p(sauth.DIR)
    try:
        dfd = os.open(dpath, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError:
        ctx.err("staging-auth: %s is missing or a link: run provision" % sauth.DIR)
        return 4, False
    try:
        st = os.fstat(dfd)
        uid, gid = ctx.owner_of(dfd, sauth.DIR)
        if uid != ctx.trusted_uid or gid != sauth.GID or stat.S_IMODE(st.st_mode) != 0o750:
            ctx.err("staging-auth: %s is not root:%d 0750: run provision" % (sauth.DIR, sauth.GID))
            return 4, False
        existed = True
        try:
            tst = os.stat("staging_basic_auth", dir_fd=dfd, follow_symlinks=False)
            if not stat.S_ISREG(tst.st_mode):
                ctx.err("staging-auth: the file is not a regular file: run provision")
                return 4, False
        except FileNotFoundError:
            existed = False
        if existed and ctx.confirm("staging_basic_auth exists; type yes to replace:") != "yes":
            ctx.err("not replaced")
            return 1, False
        return None, (dfd, existed)
    except BaseException:
        os.close(dfd)
        raise


def run(args, ctx):
    if not ctx.isatty():
        ctx.err("staging-auth reads from a terminal only")
        return 2
    code, state = _write(ctx, None)
    if code is not None:
        return code
    dfd, _ = state
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            value = ctx.getpass("staging hash from htpasswd -nBC 10 staging (input hidden): ")
        if any(issubclass(w.category, getpass.GetPassWarning) for w in caught):
            ctx.err("staging-auth: the terminal cannot hide input; nothing written")
            return 2
        if not sauth.INPUT.fullmatch(value or ""):
            ctx.err("staging-auth: not the one line `staging:$2y$10$<53>`; nothing written")
            return 2
        data = ("staging " + value[len("staging:"):] + "\n").encode("ascii")
        del value
        tmp = ".staging_basic_auth.tmp-%s" % _random.token_hex(8)
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o440, dir_fd=dfd)
        try:
            ctx.chown(fd, 0, sauth.GID)
            os.fchmod(fd, 0o440)
            os.write(fd, data)
            os.fsync(fd)
            os.close(fd)
            fd = None
            os.rename(tmp, "staging_basic_auth", src_dir_fd=dfd, dst_dir_fd=dfd)
            os.fsync(dfd)
        except OSError as err:
            if fd is not None:
                os.close(fd)
            try:
                os.unlink(tmp, dir_fd=dfd)
            except OSError:
                pass
            ctx.err("staging-auth: write failed (%s)" % (err.strerror or "error"))
            return 1
    finally:
        os.close(dfd)
    ctx.out("written: %s (%d bytes, 0440 root:%d)" % (sauth.PATH, len(data), sauth.GID))
    rows = compose.ps(ctx, "polycarpic-edge") or []
    prod = compose.ps(ctx, "polycarpic-prod") or []
    if compose.running(rows, "caddy") or compose.running(prod, "caddy"):
        ctx.out("run: sudo polycarpic-ops restart caddy")
    return 0
