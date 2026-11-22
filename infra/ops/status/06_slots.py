"""status item slots: no non-temporary replication slot (R7; SECURITY C-79)."""
import re

from lib import compose, ts
from lib.out import Line

PROJECTS = ("prod", "staging")


def _one(ctx, project):
    rows = compose.ps(ctx, "polycarpic-" + project) or []
    if not any(r.get("Service") == "postgres" and r.get("State") == "running" for r in rows):
        return Line("WAIT", "slots", project, "postgres is not running")
    code, text = ts.psql(ctx, project, "SELECT slot_name FROM pg_replication_slots WHERE NOT temporary;\n")
    if code != 0:
        return Line("RED", "slots", project, "the slot query failed")
    names = [re.sub(r"[^a-z0-9_]", "?", n)[:30] for n in text.split("\n") if n.strip()]
    if names:
        return Line("RED", "slots", project, "%d slot(s): %s" % (len(names), ", ".join(names[:3])))
    return Line("OK", "slots", project, "no non-temporary replication slot")


def run(ctx):
    return [_one(ctx, p) for p in PROJECTS]
