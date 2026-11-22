"""status item backupdb: every poly_backup connection in 24 h falls inside a jobs.log window (R7; SECURITY C-79; K8, K9).

Only parsed times and counts are printed, never log text.
"""
import re

from lib import compose, ts
from lib.out import Line, hhmm

PROJECTS = ("prod",)
JOBS = "/var/lib/polycarpic/state/jobs.log"
CONN = re.compile(r"(replication )?connection authorized: user=poly_backup\b")
JOB = re.compile(r"^([0-9T:Z-]+) ([0-9T:Z-]+) ([a-z0-9-]+) (ok|failed)$")
CAPS = {"provision-check-d3": 600}
DEFAULT_CAP = 6 * 3600
PAD = 60


def _log_time(token):
    return ts.parse(token[:19] + "Z") if len(token) >= 19 else None


def run(ctx):
    rows = compose.ps(ctx, "polycarpic-prod") or []
    pg = next((r for r in rows if r.get("Service") == "postgres" and r.get("State") == "running"), None)
    if pg is None:
        return [Line("WAIT", "backupdb", "prod", "prod postgres is not running")]
    now = ctx.now()
    windows = []
    for n, raw in enumerate((ts.read_text(ctx, JOBS) or "").split("\n"), 1):
        if not raw.strip():
            continue
        m = JOB.match(raw)
        start, end = (ts.parse(m.group(1)), ts.parse(m.group(2))) if m else (None, None)
        if not m or start is None or end is None:
            return [Line("RED", "backupdb", "prod", "jobs.log line %d does not parse" % n)]
        if end < start or end > now + 300:
            return [Line("RED", "backupdb", "prod", "jobs.log line %d has a bad time" % n)]
        if end - start > CAPS.get(m.group(3), DEFAULT_CAP):
            return [Line("RED", "backupdb", "prod", "jobs.log line %d window is too long" % n)]
        windows.append((start - PAD, end + PAD))
    code, out, err = ctx.call(["docker", "logs", "--timestamps", "--since", "24h", pg.get("ID", "")], timeout=10)
    if code != 0:
        return [Line("RED", "backupdb", "prod", "docker logs failed")]
    times, conns = [], []
    for raw in (out + b"\n" + err).decode("utf-8", "replace").split("\n"):
        token = raw.split(" ", 1)[0]
        t = _log_time(token)
        if t is None:
            continue
        times.append(t)
        if CONN.search(raw):
            conns.append(t)
    code, started_raw, _ = ctx.call(["docker", "inspect", "--format", "{{.State.StartedAt}}", pg.get("ID", "")], timeout=10)
    started = _log_time(started_raw.decode("utf-8", "replace").strip()) if code == 0 else None
    young = started is not None and now - started < 24 * 3600
    if not young:
        covered = (now - min(times)) / 3600 if times else 0
        if covered < 23:
            return [Line("RED", "backupdb", "prod", "postgres log covers only %d h" % int(covered))]
    outside = [t for t in conns if not any(a <= t <= b for a, b in windows)]
    if outside:
        shown = ", ".join(hhmm(t) for t in sorted(outside)[:3])
        return [Line("RED", "backupdb", "prod", "%d poly_backup connections outside any job window: %s" % (len(outside), shown))]
    return [Line("OK", "backupdb", "prod", "%d poly_backup connections in 24 h, all accounted" % len(conns))]
