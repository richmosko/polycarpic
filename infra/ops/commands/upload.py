"""upload: run the uploader container and act on what it reports (POLY-99 R5, N1, A5).

The uploader only reads the spool. Root accepts a `verified <dir> <name> <sha256>` line only for a known directory and an R2 name, opens
the file without following a link, recomputes the sha256 and, only when it matches (and, for dump/ and premigration/, the spool record
too), deletes the file or writes the uploaded marker. A line that fails validation makes the whole run touch nothing.
"""
import os
import re

from lib import compose, spool, ts as tsmod

HELP = "run the uploader container; root verifies what it reports, then deletes or marks the spool files"
PROJECT = "polycarpic-prod"
BUNDLE_COMPOSE = "/opt/polycarpic/ops/current/infra/compose/prod.yml"
CONTAINER = "polycarpic-prod-uploader"
TIMEOUT = 3600
MAX_OUT = 1 << 20
MAX_LINE = 4096
PRUNE_DAYS = 7
IMAGE_LINE = re.compile(r"([A-Z][A-Z0-9_]*)=([a-z0-9./_-]+(?::[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64})")
VERIFIED = re.compile(r"verified (wal|dump|premigration) (\S+) ([0-9a-f]{64})")


def add_arguments(parser):
    pass


def _images(ctx):
    try:
        with open(ctx.p("/opt/polycarpic/images.env"), encoding="utf-8") as fh:
            lines = [l for l in fh.read().split("\n") if l]
    except OSError:
        return None
    found = {}
    for line in lines:
        m = IMAGE_LINE.fullmatch(line)
        if not m:
            return None
        found[m.group(1)] = m.group(2)
    return found if "POLY_TOOLS_IMAGE" in found and "POLY_POSTGRES_IMAGE" in found else None


def _parse(out):
    """-> [(dir, name, sha)] or None when any line is a fault (N1, A5)."""
    if len(out.encode("utf-8", "replace")) > MAX_OUT:
        return None
    found = []
    for line in out.split("\n"):
        if line == "":
            continue
        if len(line) > MAX_LINE:
            return None
        m = VERIFIED.fullmatch(line)
        if not m or spool.parse_name(m.group(1), m.group(2)) is None:  # N1
            return None
        found.append(m.groups())
    return found


def run(args, ctx):
    fd = spool.lock(ctx, "upload.lock", wait=0)
    if fd is None:
        return 0  # the minute timer overlaps a long run
    try:
        return _locked(ctx)
    finally:
        os.close(fd)


def _locked(ctx):
    images = _images(ctx)
    if images is None:
        ctx.err("upload: /opt/polycarpic/images.env missing or malformed")
        return 3
    ctx.run(["docker", "rm", "-f", CONTAINER], timeout=60)
    try:
        cfile, cenv = compose.compose_source(ctx, "prod", "prod.yml", BUNDLE_COMPOSE)
    except compose.ComposeError:
        ctx.err("upload: refused state (no saved render of current)")
        return 1
    argv = ["docker", "compose", "-p", PROJECT] + compose.file_opts(ctx, cfile) + ["-f", cfile] + cenv + ["--profile", "uploader", "run", "--rm", "--no-deps", "-T", "--name",
            CONTAINER, "uploader", "/usr/local/bin/upload.sh"]
    ok, out = True, ""
    try:
        code, out, _ = ctx.run(argv, timeout=TIMEOUT, extra_env={"POLY_TOOLS_IMAGE": images["POLY_TOOLS_IMAGE"],
                                                                   "POLY_POSTGRES_IMAGE": images["POLY_POSTGRES_IMAGE"]})
        ok = code == 0
    except TimeoutError:
        ok = False
        ctx.run(["docker", "rm", "-f", CONTAINER], timeout=60)
    lines = _parse(out)
    if lines is None:
        ctx.err("upload: the uploader's report failed validation; nothing was touched")
        spool.ping(ctx, "/fail")
        return 1
    done = _act(ctx, lines)
    ok = ok and done is not None
    if done is not None:
        ok = _prune(ctx) and ok
    if not ok:
        spool.ping(ctx, "/fail")
        return 1
    if _complete_set(ctx, done):
        spool.ping(ctx)
    return 0


def _act(ctx, lines):
    """Verify and act on each line. -> set of (dir, name) confirmed, or None when any line failed its check."""
    record = spool.read_record(ctx)
    confirmed, failed = set(), False
    dirs = {}
    try:
        for d, name, reported in lines:
            if d not in dirs:
                dirs[d] = spool.open_dir(ctx, d)
            fd = spool.open_regular(dirs[d], name)
            if fd is None:
                ctx.err("upload: %s/%s is not a regular file" % (d, name))
                failed = True
                continue
            try:
                actual = spool.sha_fd(fd)
            finally:
                os.close(fd)
            mismatch = actual != reported or (d != "wal" and record.get("%s/%s" % (d, name)) != actual)
            if mismatch:  # T15
                ctx.err("upload: %s/%s does not match what the uploader reported or the spool record; kept" % (d, name))
                failed = True
                continue
            if d == "premigration":
                _marker(dirs[d], name, actual)
            else:
                os.unlink(name, dir_fd=dirs[d])
            confirmed.add((d, name))
    finally:
        for fd in dirs.values():
            os.close(fd)
    return None if failed else confirmed


def _marker(dirfd, name, digest):
    fd = os.open(name + ".sha256", os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600, dir_fd=dirfd)
    try:
        os.write(fd, ("%s  %s\n" % (digest, name)).encode())
        os.fchmod(fd, 0o644)
    finally:
        os.close(fd)


def _prune(ctx):
    """Premigration sets uploaded and older than 7 days go, with their markers; the record loses lines for files that are gone."""
    now = ctx.epoch()
    base = ctx.p("%s/premigration" % spool.SPOOL)
    try:
        dirfd = spool.open_dir(ctx, "premigration")
        names = sorted(os.listdir(base))
    except OSError:
        return True
    try:
        for name in names:
            got = spool.parse_name("premigration", name)
            if got is None or name + ".sha256" not in names:
                continue
            born = tsmod.parse("%s-%s-%sT%s:%s:%sZ" % (got[3][0:4], got[3][4:6], got[3][6:8], got[3][9:11], got[3][11:13], got[3][13:15]))
            if born is not None and now - born > PRUNE_DAYS * 86400:
                os.unlink(name + ".sha256", dir_fd=dirfd)
                os.unlink(name, dir_fd=dirfd)
    finally:
        os.close(dirfd)
    record = spool.read_record(ctx)
    kept = {k: v for k, v in record.items() if os.path.lexists(ctx.p("%s/%s" % (spool.SPOOL, k)))}
    if kept != record:
        spool.write_record(ctx, kept)
    return True


def _complete_set(ctx, confirmed):
    """Root confirmed a globals file this run, and no base or dump of the same system id and time is left in dump/."""
    for d, name in sorted(confirmed):
        got = spool.parse_name(d, name)
        if d != "dump" or got is None or got[0] != "globals":
            continue
        _, major, sysid, ts = got
        base, dump = (spool.name_of(k, major, sysid, ts) for k in ("base", "dump"))
        left = os.listdir(ctx.p("%s/dump" % spool.SPOOL))
        if base in left or dump in left:
            continue
        inst = spool.instance(ctx)
        if inst is None:
            continue
        text = spool.iso(ctx.now()) + "\n" + "".join("%s/%s/dump/%s\n" % (inst, major, n) for n in (base, dump, name))
        spool.write_atomic(spool.state_path(ctx, "last-upload"), text)
        return True
    return False
