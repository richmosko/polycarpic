"""status item deploy: what each project runs, whether a deploy stopped, and when GitHub was last read (POLY-100 R10)."""
import os

from lib import release as rel, ts
from lib.out import Line

PROJECTS = ("prod", "staging")
STALE = 3600


def _one(ctx, project):
    d = ctx.p("%s/%s" % (rel.STATE, project))
    cur = rel.load_pointer(ctx, project, "current") if os.path.isdir(d) else None
    if not cur:
        return Line("WAIT", "deploy", project, "not deployed")
    alert = (ts.read_text(os.path.join(d, "alert"), limit=512) or "").strip()
    if alert:
        parts = alert.split()
        return Line("RED", "deploy", project, "stopped: %s" % (parts[1] if len(parts) > 1 else "unknown"))
    poll = ts.parse((ts.read_text(os.path.join(d, "last-poll"), limit=64) or "").strip())
    age = None if poll is None else ctx.epoch() - poll
    tag = cur["tag"] if cur["tag"] != "-" else cur["commit"][:7]
    detail = "%s %s, %s old" % (tag, cur["digest"][7:19], ts.age(ctx.epoch() - (ts.parse(cur["at"]) or ctx.epoch())))
    if age is None or age > STALE:
        return Line("WARN", "deploy", project, detail + "; GitHub not read for over 1 h")
    return Line("OK", "deploy", project, detail)


def run(ctx):
    return [_one(ctx, p) for p in PROJECTS]
