"""status item app: the four long-running services of each project, healthy and on one image (R7)."""
import re

from lib import compose, ts
from lib.out import Line, stamp

PROJECTS = ("prod", "staging")
NEED = ("postgres", "web", "auth", "worker")


def _digest(image):
    m = re.search(r"@sha256:([0-9a-f]{12})", image or "")
    return "sha256:" + m.group(1) if m else (image or "?")[:19]


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
            bad.append("%s %s" % (svc, re.sub(r"[^a-z]", "?", str(r.get("State", "?")))[:12]))
        elif r.get("Health") not in ("", None, "healthy"):
            bad.append("%s %s" % (svc, re.sub(r"[^a-z]", "?", str(r.get("Health")))[:12]))
    if bad:
        return Line("RED", "app", project, ", ".join(bad))
    images = {s: compose.inspect_image(ctx, by[s].get("ID", "")) for s in ("web", "auth", "worker")}
    if len(set(images.values())) != 1:
        return Line("RED", "app", project, "web, auth and worker run different images")
    code, out, _ = ctx.call(["docker", "inspect", "--format", "{{.Created}}", by["web"].get("ID", "")], timeout=10)
    created = out.decode("utf-8", "replace").strip()[:19] + "Z"
    epoch = ts.parse(created)
    when = "deployed %s (%s)" % (stamp(epoch), ts.age(int(ctx.now() - epoch))) if epoch else "deployed ?"
    return Line("OK", "app", project, "%s, %s" % (_digest(images["web"]), when))


def run(ctx):
    return [_one(ctx, p) for p in PROJECTS]
