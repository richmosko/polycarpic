"""backup: the root job runner for the backup container (POLY-99 R5, R6) and the two commands restore.sh runs over ssh.

nightly | premigration   run backup.sh in its container under a lock; root alone writes the window, the spool record and pings.
list-premigration        one line per complete premigration set, with the sha256 root recorded.
fetch-premigration NAME  the encrypted file's bytes on stdout, after root's own hash matches the record.
"""
import os

from lib import compose, spool

HELP = "backup nightly|premigration (run the backup container); list-premigration; fetch-premigration <name>"
PROJECT = "polycarpic-prod"
BUNDLE_COMPOSE = "/opt/polycarpic/ops/current/infra/compose/prod.yml"
CONTAINER = "polycarpic-prod-backup"
MODES = {"nightly": ("dump", ("base", "dump", "globals"), 3 * 3600), "premigration": ("premigration", ("dump", "globals"), 30 * 60)}
WAIT = 30 * 60
MAX_OUT = 4096


def add_arguments(parser):
    parser.add_argument("action", choices=["nightly", "premigration", "list-premigration", "fetch-premigration"])
    parser.add_argument("name", nargs="?")


def run(args, ctx):
    if args.action in MODES:
        return _backup(args.action, ctx)
    if args.action == "list-premigration":
        return _list(ctx)
    return _fetch(args.name, ctx)


# ---- nightly / premigration ----
def _parse_published(out, mode):
    """The container's one stdout line -> [names] or None. Anything but exactly one well-formed line is untrusted (N1)."""
    d, kinds, _ = MODES[mode]
    if len(out) > MAX_OUT or not out.endswith("\n") or "\n" in out[:-1]:
        return None
    parts = out[:-1].split(" ")
    if len(parts) != 4 + len(kinds) or parts[0] != "published" or parts[1] != d:
        return None
    ts, sysid, names = parts[2], parts[3], parts[4:]
    if not spool.TS_RE.fullmatch(ts):
        return None
    for kind, name in zip(kinds, names):
        got = spool.parse_name(d, name)
        if got is None or got[0] != kind or got[2] != sysid or got[3] != ts:
            return None
    return names


def _backup(mode, ctx):
    d, kinds, timeout = MODES[mode]
    rows = compose.ps(ctx, PROJECT)
    pg = compose.running(rows, "postgres")
    image = compose.image_ref(compose.inspect(ctx, pg.get("Name", ""))) if pg else ""
    if not image:
        ctx.err("backup: prod postgres is not running")
        return 3
    fd = spool.lock(ctx, "backup.lock", wait=WAIT)
    if fd is None:
        ctx.err("backup: the backup lock was not got in 30 minutes")
        return 4
    try:
        return _run_locked(mode, ctx, image, d, kinds, timeout)
    finally:
        os.close(fd)


def _run_locked(mode, ctx, image, d, kinds, timeout):
    t0 = ctx.now()
    ctx.run(["docker", "rm", "-f", CONTAINER], timeout=60)
    argv = ["docker", "compose", "-p", PROJECT, "-f", BUNDLE_COMPOSE, "--profile", "backup", "run", "--rm", "--no-deps", "-T", "--name",
            CONTAINER, "backup", "/usr/local/bin/backup.sh", mode]
    ok, out = True, ""
    try:
        code, out, _ = ctx.run(argv, timeout=timeout, extra_env={"POLY_POSTGRES_IMAGE": image})
        ok = code == 0
    except TimeoutError:
        ok = False
        ctx.run(["docker", "rm", "-f", CONTAINER], timeout=60)
    t1 = ctx.now()  # the container is gone, failures and timeouts included
    hashes = []
    if ok:
        names = _parse_published(out, mode)
        ok = names is not None
        if ok:
            dirfd = spool.open_dir(ctx, d)
            try:
                for name in names:
                    fd = spool.open_regular(dirfd, name)
                    if fd is None:
                        ok = False
                        break
                    try:
                        hashes.append((name, spool.sha_fd(fd)))
                    finally:
                        os.close(fd)
            finally:
                os.close(dirfd)
    if not ok:
        spool.log_window(ctx, t0, t1, "backup-" + mode, False)
        ctx.err("backup: %s failed" % mode)
        spool.ping(ctx, "/fail")
        return 1
    for name, digest in hashes:
        spool.append_line(spool.state_path(ctx, "spool.sha256"), "%s %s/%s" % (digest, d, name))
    spool.log_window(ctx, t0, t1, "backup-" + mode, True)
    ctx.run(["systemctl", "start", "--no-block", "polycarpic-uploader.service"], timeout=30)
    if mode == "premigration":
        parts = spool.parse_name(d, hashes[0][0])
        ctx.out("premigration-set %s %s" % (parts[3], " ".join("%s=%s" % h for h in hashes)))
    else:
        ctx.out(out.rstrip("\n"))
    return 0


# ---- list-premigration / fetch-premigration (run by restore.sh over ssh) ----
def _list(ctx):
    if not spool.record_trusted(ctx):
        ctx.err("backup: spool.sha256 is not root-owned 0644")
        return 1
    record = spool.read_record(ctx)
    try:
        names = sorted(os.listdir(ctx.p("%s/premigration" % spool.SPOOL)))
    except OSError:
        names = []
    present, sets, stray = set(names), {}, 0
    for name in names:
        if name == ".inflight":
            continue
        base = name[:-len(".sha256")] if name.endswith(".sha256") else None
        if base is not None and spool.parse_name("premigration", base):
            continue
        got = spool.parse_name("premigration", name)
        if got is None:
            stray += 1
            continue
        sets.setdefault((got[3], got[2]), {})[got[0]] = name
    lines = []
    for (ts, _sys), files in sorted(sets.items()):
        if set(files) != {"dump", "globals"}:
            continue
        keys = ["premigration/" + files["dump"], "premigration/" + files["globals"]]
        if not all(k in record for k in keys):
            continue
        state = "uploaded" if all(files[k] + ".sha256" in present for k in files) else "pending"
        lines.append("%s %s %s %s %s %s" % (ts, files["dump"], record[keys[0]], files["globals"], record[keys[1]], state))
    for line in lines:
        ctx.out(line)
    if stray:
        ctx.out("stray %d" % stray)
    return 0


def _fetch(name, ctx):
    if not name or spool.parse_name("premigration", name) is None:
        ctx.err("backup: bad name")
        return 2
    if not spool.record_trusted(ctx):
        ctx.err("backup: spool.sha256 is not root-owned 0644")
        return 1
    dirfd = spool.open_dir(ctx, "premigration")
    try:
        fd = spool.open_regular(dirfd, name)
    finally:
        os.close(dirfd)
    if fd is None:
        ctx.err("backup: %s is not a regular file" % name)
        return 1
    try:
        want = spool.read_record(ctx).get("premigration/" + name)
        if want is None:
            ctx.err("backup: no spool record for %s" % name)
            return 1
        if spool.sha_fd(fd) != want:  # C4
            ctx.err("backup: %s does not match the spool record" % name)
            return 1
        os.lseek(fd, 0, os.SEEK_SET)
        while True:
            block = os.read(fd, spool.CHUNK)
            if not block:
                break
            ctx.stdout_bytes.write(block)
        ctx.stdout_bytes.flush()
    finally:
        os.close(fd)
    return 0
