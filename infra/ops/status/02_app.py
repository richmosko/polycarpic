"""status item app: the four long-running services of each project, healthy and on one image (R7)."""
import re

from lib import compose, ts
from lib.out import Line, stamp

PROJECTS = ("prod", "staging")
NEED = ("postgres", "web", "auth", "worker")


def _word(text):
    return re.sub(r"[^a-z]", "?", str(text))[:12]


def _digest(info):
    m = re.search(r"@sha256:([0-9a-f]{12})", compose.image_ref(info))
    if m:
        return "sha256:" + m.group(1)
    m = re.match(r"sha256:([0-9a-f]{12})", str((info or {}).get("Image", "")))
    return "sha256:" + m.group(1) if m else "unknown"


def _one(ctx, project):
    rows = compose.ps(ctx, "polycarpic-" + project)
    if rows is None:
        return Line("RED", "app", project, "docker compose ps failed")
    if not rows:
        return Line("WAIT", "app", project, "not deployed")
    by = {r.get("Service"): r for r in rows}
    bad = []
    for svc in NEED:
        r = by.get(svc)
        if r is None:
            bad.append("%s missing" % svc)
        elif r.get("State") != "running":
            bad.append("%s %s" % (svc, _word(r.get("State", "?"))))
        elif r.get("Health") not in ("", None, "healthy"):
            bad.append("%s %s" % (svc, _word(r.get("Health"))))
    if bad:
        return Line("RED", "app", project, ", ".join(bad))
    info = {s: compose.inspect(ctx, by[s].get("Name", "")) for s in ("web", "auth", "worker")}
    if len({compose.image_ref(i) for i in info.values()}) != 1:
        return Line("RED", "app", project, "web, auth and worker run different images")
    created = ts.parse_docker((info["web"] or {}).get("Created", ""))
    when = "deployed %s (%s)" % (stamp(created), ts.age(ctx.epoch() - created)) if created is not None else "deployed ?"
    return Line("OK", "app", project, "%s, %s" % (_digest(info["web"]), when))


def run(ctx):
    return [_one(ctx, p) for p in PROJECTS]
