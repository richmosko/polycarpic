"""restart: restart services of the project and wait for them to be healthy (R9)."""
import re

from lib import compose

HELP = "restart services (postgres web auth worker; caddy on prod) and wait for health (--staging for staging)"
WAIT = 120


def add_arguments(parser):
    parser.add_argument("--staging", action="store_true")
    parser.add_argument("service", nargs="+")


def _state(ctx, project, svc):
    rows = compose.ps(ctx, project) or []
    for r in rows:
        if r.get("Service") == svc:
            return r
    return {}


def run(args, ctx):
    valid = [s for s in compose.LONG_RUNNING if not (args.staging and s == "caddy")]
    bad = [s for s in args.service if s not in valid]
    if bad:
        ctx.err("restart: unknown service %s; valid: %s" % (re.sub(r"[^\x21-\x7e]", "?", bad[0])[:40], ", ".join(valid)))
        return 2
    for svc in args.service:
        project = "polycarpic-edge" if svc == "caddy" else "polycarpic-" + ("staging" if args.staging else "prod")
        code, _, err = ctx.call(["docker", "compose", "-p", project, "restart", svc], timeout=WAIT)
        if code != 0:
            ctx.err("restart: docker compose restart %s failed (exit %d)" % (svc, code))
            return 1
    failed = 0
    deadline = ctx.now() + WAIT
    for svc in args.service:
        project = "polycarpic-edge" if svc == "caddy" else "polycarpic-" + ("staging" if args.staging else "prod")
        while True:
            row = _state(ctx, project, svc)
            state, health = row.get("State", "missing"), row.get("Health", "")
            if state == "running" and health in ("", "healthy"):
                ctx.out("%s: %s" % (svc, "healthy" if health == "healthy" else "running"))
                break
            if ctx.now() >= deadline:
                ctx.out("%s: not healthy after %d s (%s)" % (svc, WAIT, re.sub(r"[^\x21-\x7e]", "?", health or state)[:20]))
                failed = 1
                break
            ctx.sleep(2)
    return failed
