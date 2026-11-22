"""status item backupdb: every poly_backup connection in 24 h falls inside a jobs.log window (R7; SECURITY C-79; K8, K9).

Only parsed times and counts are printed, never log text.
"""
import re

from lib import compose, ts
from lib.out import Line, hhmm

PROJECTS = ("prod",)
JOBS = "/var/lib/polycarpic/state/jobs.log"
CONN = re.compile(r"(replication )?connection authorized: user=poly_backup\b")
JOB = re.compile(r"([0-9T:Z-]+) ([0-9T:Z-]+) ([a-z0-9-]+) (ok|failed)")
CAPS = {"provision-check-d3": 600}
DEFAULT_CAP = 6 * 3600
PAD = 60
MAX_COVER = 8 * 3600  # B2: the windows may cover at most 8 of the last 24 hours


def covered(windows, now):
    """Seconds of the last 24 h inside the union of the windows."""
    total, end = 0, now - 24 * 3600
    for a, b in sorted((max(a, now - 24 * 3600), min(b, now)) for a, b in windows):
        if b > a:
            total += b - max(a, end)
            end = max(end, b)
    return total


def run(ctx):
    pg = compose.running(compose.ps(ctx, "polycarpic-prod"), "postgres")
    if pg is None:
        return [Line("WAIT", "backupdb", "prod", "prod postgres is not running")]
    now = ctx.epoch()
    windows = []
    for n, raw in enumerate((ts.read_text(ctx.p(JOBS)) or "").split("\n"), 1):
        if not raw.strip():
            continue
        m = JOB.fullmatch(raw)
        start, end = (ts.parse(m.group(1)), ts.parse(m.group(2))) if m else (None, None)
        if not m or start is None or end is None:
            return [Line("RED", "backupdb", "prod", "jobs.log line %d does not parse" % n)]
        if end < start or end > now + 300:
            return [Line("RED", "backupdb", "prod", "jobs.log line %d has a bad time" % n)]
        if end - start > CAPS.get(m.group(3), DEFAULT_CAP):
            return [Line("RED", "backupdb", "prod", "jobs.log line %d window is too long" % n)]
        windows.append((start - PAD, end + PAD))
    cover = covered(windows, now)
    if cover > MAX_COVER:
        return [Line("RED", "backupdb", "prod", "jobs.log windows cover %d h of 24" % (cover // 3600))]
    name = pg.get("Name", "")
    code, out, err = ctx.run(["docker", "logs", "--timestamps", "--since", "24h", name], timeout=10)
    if code != 0:
        return [Line("RED", "backupdb", "prod", "docker logs failed")]
    times, conns = [], []
    for raw in (out + "\n" + err).split("\n"):
        t = ts.parse_docker(raw.split(" ", 1)[0])
        if t is None:
            continue
        times.append(t)
        if CONN.search(raw):
            conns.append(t)
    info = compose.inspect(ctx, name)
    started = ts.parse_docker(((info or {}).get("State") or {}).get("StartedAt", ""))
    if not (started is not None and now - started < 24 * 3600):
        hours = (now - min(times)) / 3600 if times else 0
        if hours < 23:
            return [Line("RED", "backupdb", "prod", "postgres log covers only %d h" % int(hours))]
    outside = sorted(t for t in conns if not any(a <= t <= b for a, b in windows))
    if outside:
        shown = ", ".join(hhmm(t) for t in outside[:3])
        return [Line("RED", "backupdb", "prod", "%d poly_backup outside windows: %s" % (len(outside), shown))]
    return [Line("OK", "backupdb", "prod", "%d poly_backup connections in 24 h, all accounted" % len(conns))]
