"""gate-check: the deploy gate of INFRA 7.1 step 16, run through the project's postgres container (R6)."""
from lib import compose

HELP = "run the deploy gate against the running database (--staging for staging)"


def add_arguments(parser):
    parser.add_argument("--staging", action="store_true")


def run(args, ctx):
    project = "polycarpic-" + ("staging" if args.staging else "prod")
    if not compose.running(compose.ps(ctx, project), "postgres"):
        ctx.out("gate: error (%s postgres is not running)" % project)
        return 1
    argv = ["/bin/sh", ctx.bundle("infra/postgres/gate-check.sh"), "docker", "compose", "-p", project] + compose.opts(ctx) + ["exec", "-T", "postgres",
            "psql", "-U", "postgres", "-d", "polycarpic"]
    return ctx.run_inherit(argv)
