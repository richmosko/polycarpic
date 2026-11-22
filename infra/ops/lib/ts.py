"""Timestamps and the database session helper shared by the status items."""
import calendar
import re
import time

STAMP = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$")


def parse(text):
    """YYYY-MM-DDTHH:MM:SSZ -> epoch seconds, or None."""
    m = STAMP.match(text or "")
    if not m:
        return None
    try:
        y, mo, d, h, mi, s = (int(x) for x in m.groups())
        return calendar.timegm((y, mo, d, h, mi, s, 0, 0, 0)) if (mo <= 12 and d <= 31 and h < 24 and mi < 60 and s < 61) else None
    except (ValueError, OverflowError):
        return None


def age(seconds):
    if seconds < 3600:
        return "%d m" % (seconds // 60)
    if seconds < 172800:
        return "%d h" % (seconds // 3600)
    return "%d d" % (seconds // 86400)


def psql(ctx, project, sql, timeout=10):
    """Read-only SQL on stdin through the project's postgres container. -> (code, stdout text)."""
    stdin = ("SET default_transaction_read_only = on;\n" + sql).encode()
    code, out, _ = ctx.call(["docker", "compose", "-p", "polycarpic-" + project, "exec", "-T", "postgres", "psql", "-U", "postgres",
                             "-d", "polycarpic", "-XAtq", "-v", "ON_ERROR_STOP=1"], stdin=stdin, timeout=timeout)
    return code, out.decode("utf-8", "replace")


def read_text(ctx, logical, limit=1 << 20):
    try:
        with open(ctx.path(logical), "rb") as fh:
            return fh.read(limit).decode("utf-8", "replace")
    except OSError:
        return None
