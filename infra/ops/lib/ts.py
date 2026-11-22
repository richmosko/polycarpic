"""Timestamps and the read-only database session helper shared by the status items."""
import calendar
import re

STAMP = re.compile(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z")


def parse(text):
    """YYYY-MM-DDTHH:MM:SSZ -> epoch seconds, or None."""
    m = STAMP.fullmatch(text or "")
    if not m:
        return None
    y, mo, d, h, mi, s = (int(x) for x in m.groups())
    if not (1 <= mo <= 12 and 1 <= d <= 31 and h < 24 and mi < 60 and s < 61):
        return None
    try:
        return calendar.timegm((y, mo, d, h, mi, s, 0, 0, 0))
    except (ValueError, OverflowError):
        return None


def parse_docker(text):
    """A docker RFC 3339 time (fraction allowed) -> epoch seconds, or None."""
    return parse((text or "")[:19] + "Z") if len(text or "") >= 19 else None


def age(seconds):
    seconds = max(0, int(seconds))
    if seconds < 3600:
        return "%d m" % (seconds // 60)
    if seconds < 48 * 3600:
        return "%d h" % (seconds // 3600)
    return "%d d" % (seconds // 86400)


def psql(ctx, project, sql, timeout=10):
    """SQL on stdin (it sets the session read-only first) through the project's postgres container. -> (code, stdout text)."""
    stdin = sql  # the query text starts with the read-only SET itself (K10)
    code, out, _ = ctx.run(["docker", "compose", "-p", "polycarpic-" + project, "exec", "-T", "postgres", "psql", "-U", "postgres",
                            "-d", "polycarpic", "-XAtq", "-v", "ON_ERROR_STOP=1"], stdin=stdin, timeout=timeout)
    return code, out


def read_text(path, limit=1 << 20):
    try:
        with open(path, "rb") as fh:
            return fh.read(limit).decode("utf-8", "replace")
    except OSError:
        return None
