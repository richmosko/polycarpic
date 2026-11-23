"""The spool as root sees it (POLY-99 R2, R5, N1): names by grammar, files opened without following links, records only root writes.

Nothing a container prints is a path until it has passed `valid_name`; `open_regular` then opens relative to the spool directory with
O_NOFOLLOW and requires a regular file. Only after both does root hash, delete or write a sibling.
"""
import fcntl
import hashlib
import os
import re
import stat

SPOOL = "/srv/polycarpic/spool"
STATE = "/var/lib/polycarpic/state"
DIRS = ("wal", "dump", "premigration")
TS_RE = re.compile(r"[0-9]{8}T[0-9]{6}Z")
SHA_RE = re.compile(r"[0-9a-f]{64}")
_DUMP = re.compile(r"(base|dump|globals)-([0-9]{2})-([0-9]{1,20})-([0-9]{8}T[0-9]{6}Z)\.age")
_PREM = re.compile(r"(dump|globals)-([0-9]{2})-([0-9]{1,20})-([0-9]{8}T[0-9]{6}Z)\.age")
_WAL = re.compile(r"wal-([0-9]{2})-([0-9]{1,20})-([0-9A-F]{24}(?:\.[0-9A-F]{8}\.backup|\.partial)?|[0-9A-F]{8}\.history)\.age")
CHUNK = 1 << 20


def parse_name(d, name):
    """-> (kind, major, sys, ts) for a name valid in spool directory `d`, else None. wal names carry no time ('wal', M, sys, None)."""
    if not isinstance(name, str) or d not in DIRS:
        return None
    if d == "wal":
        m = _WAL.fullmatch(name)
        return ("wal", m.group(1), m.group(2), None) if m else None
    m = (_DUMP if d == "dump" else _PREM).fullmatch(name)
    return m.groups() if m else None


def name_of(kind, major, sys, ts):
    return "%s-%s-%s-%s.age" % (kind, major, sys, ts)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def lock(ctx, name, wait=0):
    """flock /run/polycarpic/<name>: waits (polling with ctx.sleep) up to `wait` seconds of ctx.now(). -> fd, or None when not got."""
    run_dir = ctx.p("/run/polycarpic")
    os.makedirs(run_dir, mode=0o755, exist_ok=True)
    fd = os.open(os.path.join(run_dir, name), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    start = ctx.epoch()
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fd
        except OSError:
            if ctx.epoch() - start >= wait:
                os.close(fd)
                return None
            ctx.sleep(30)


def open_dir(ctx, d):
    return os.open(ctx.p("%s/%s" % (SPOOL, d)), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)


def open_regular(dirfd, name):
    """Open `name` inside the spool directory without following a link. -> fd of a regular file, or None."""
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=dirfd)
    except OSError:
        return None
    if not stat.S_ISREG(os.fstat(fd).st_mode):
        os.close(fd)
        return None
    return fd


def sha_fd(fd):
    h = hashlib.sha256()
    os.lseek(fd, 0, os.SEEK_SET)
    while True:
        block = os.read(fd, CHUNK)
        if not block:
            return h.hexdigest()
        h.update(block)


def state_path(ctx, name):
    return ctx.p("%s/%s" % (STATE, name))


def record_trusted(ctx):
    """True when spool.sha256 is absent or is root-owned 0644 (C10)."""
    try:
        st = os.lstat(state_path(ctx, "spool.sha256"))
    except FileNotFoundError:
        return True
    return stat.S_ISREG(st.st_mode) and st.st_uid == ctx.trusted_uid and stat.S_IMODE(st.st_mode) == 0o644


def read_record(ctx):
    """-> {'<dir>/<name>': sha256}; the last line for a name wins. Malformed lines are dropped."""
    out = {}
    try:
        with open(state_path(ctx, "spool.sha256"), encoding="utf-8", errors="replace") as fh:
            lines = fh.read().split("\n")
    except OSError:
        return out
    for line in lines:
        parts = line.split(" ")
        if len(parts) == 2 and SHA_RE.fullmatch(parts[0]):
            out[parts[1]] = parts[0]
    return out


def write_atomic(path, data, mode=0o644):
    tmp = "%s.new.%d" % (path, os.getpid())
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    try:
        os.write(fd, data.encode())
        os.fchmod(fd, mode)
    finally:
        os.close(fd)
    os.rename(tmp, path)


def write_record(ctx, record):
    write_atomic(state_path(ctx, "spool.sha256"), "".join("%s %s\n" % (v, k) for k, v in sorted(record.items())))


def append_line(path, line, mode=0o644):
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(fd, mode)
        os.write(fd, (line + "\n").encode())
    finally:
        os.close(fd)


def log_window(ctx, t0, t1, job, ok):
    append_line(state_path(ctx, "jobs.log"), "%s %s %s %s" % (iso(t0), iso(t1), job, "ok" if ok else "failed"))


HB_URL = re.compile(r"https://[A-Za-z0-9._~:/?&=%+-]{1,500}")


def ping(ctx, suffix=""):
    """Root pings the backup check: the URL goes to curl on stdin, never argv or env. A failed ping changes nothing."""
    try:
        with open(ctx.p("/etc/polycarpic/secrets/host/heartbeat_url"), encoding="utf-8") as fh:
            url = fh.readline().strip()
    except OSError:
        return
    if not HB_URL.fullmatch(url):
        return
    try:
        ctx.run(["curl", "-fsS", "--max-time", "15", "--config", "-"], stdin='url = "%s%s"\n' % (url, suffix), timeout=30)
    except TimeoutError:
        pass


def instance(ctx):
    try:
        with open(ctx.p("/etc/polycarpic/host.env"), encoding="utf-8") as fh:
            for line in fh.read().split("\n"):
                m = re.fullmatch(r"POLY_INSTANCE=([A-Za-z0-9][A-Za-z0-9_-]{0,62})", line)
                if m:
                    return m.group(1)
    except OSError:
        pass
    return None
