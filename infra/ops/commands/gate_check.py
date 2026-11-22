"""gate-check: the deploy gate of INFRA 7.1 step 16, run through the project's postgres container (R6)."""
from lib import compose

HELP = "run the deploy gate against the running database (--staging for staging)"


def add_arguments(parser):
    parser.add_argument("--staging", action="store_true")


def run(args, ctx):
    project = "polycarpic-" + ("staging" if args.staging else "prod")
    rows = compose.ps(ctx, project)
    if not rows or not any(r.get("Service") == "postgres" and r.get("State") == "running" for r in rows):
        ctx.out("gate: error (%s postgres is not running)" % project)
        return 1
    code, out, err = ctx.call(["/bin/sh", ctx.bundle_path("infra/postgres/gate-check.sh"), "docker", "compose", "-p", project,
                               "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "polycarpic"])
    ctx.stdout.write(out.decode("utf-8", "replace"))
    ctx.stderr.write(err.decode("utf-8", "replace"))
    return code
