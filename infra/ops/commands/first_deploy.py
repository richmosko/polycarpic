"""first-deploy <prod|staging>: the first release of a project, run in the foreground (POLY-100 R6, R9, R11).

Waits up to 10 minutes for the deploy lock. When healthy it enables the project's deploy timer; for prod, once /opt/polycarpic/images.env
exists, also the backup and uploader timers.
"""
import os

from lib import deployer as deploy, release as rel

HELP = "first-deploy prod|staging [--existing-data] (the first release; enables the timers)"
WAIT = 10 * 60


def add_arguments(parser):
    parser.add_argument("project", choices=["prod", "staging"])
    parser.add_argument("--existing-data", action="store_true")


def run(args, ctx):
    project = args.project
    code = deploy.locked(project, ctx, first=True, wait=WAIT, existing_data=args.existing_data)
    if code != 0 or not rel.load_pointer(ctx, project, "current"):
        return code or 1
    units = ["polycarpic-deploy@%s.timer" % project]
    if project == "prod" and os.path.exists(ctx.p("/opt/polycarpic/images.env")):
        units += ["polycarpic-backup.timer", "polycarpic-uploader.timer"]
    for unit in units:
        c, _, _ = ctx.run(["systemctl", "enable", "--now", unit], timeout=60)
        if c != 0:
            ctx.err("first-deploy: could not enable " + unit)
            return 1
    if project == "prod":
        ctx.out("first-deploy: now create the app. A/AAAA record for the prod domain; no earlier (INFRA 7.1)")
    return 0
