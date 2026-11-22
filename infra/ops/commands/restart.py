"""restart: restart services of the project and wait for them to be healthy (R9)."""
from lib import compose

HELP = "restart services (postgres web auth worker; caddy on prod) and wait for health (--staging for staging)"
WAIT = 120


def add_arguments(parser):
    parser.add_argument("--staging", action="store_true")
    parser.add_argument("service", nargs="+")


def _project(svc, staging):
    return "polycarpic-edge" if svc == "caddy" else "polycarpic-" + ("staging" if staging else "prod")


def run(args, ctx):
    valid = sorted(s for s in compose.LONG_RUNNING if not (args.staging and s == "caddy"))
    bad = [s for s in args.service if s not in valid]
    if bad:
        shown = "".join(c if 0x21 <= ord(c) <= 0x7E else "?" for c in bad[0])[:40]
        ctx.err("restart: unknown service %s; available: %s" % (shown, ", ".join(sorted(compose.LONG_RUNNING))))
        return 2
    start = ctx.epoch()
    for svc in args.service:
        code, _, _ = ctx.run(["docker", "compose", "-p", _project(svc, args.staging), "restart", svc], timeout=WAIT)
        if code != 0:
            ctx.err("restart: docker compose restart %s failed (exit %d)" % (svc, code))
            return 1
    failed = 0
    for svc in args.service:
        while True:
            row = compose.running(compose.ps(ctx, _project(svc, args.staging)), svc)
            if row is not None and row.get("Health") in ("", None, "healthy"):
                ctx.out("%s: %s" % (svc, "healthy" if row.get("Health") == "healthy" else "running"))
                break
            if ctx.epoch() - start >= WAIT:
                state = (row or {}).get("Health") or (row or {}).get("State") or "missing"
                if row is None:
                    state = _state_of(ctx, svc, args.staging)
                ctx.out("%s: not healthy after %d s (%s)" % (svc, WAIT, "".join(c if 0x21 <= ord(c) <= 0x7E else "?" for c in state)[:20]))
                failed = 1
                break
            ctx.sleep(2)
    return failed


def _state_of(ctx, svc, staging):
    for r in compose.ps(ctx, _project(svc, staging)) or []:
        if r.get("Service") == svc:
            return r.get("Health") or r.get("State") or "missing"
    return "missing"
