"""provision-check: provision-check.sh from the installed bundle (R3). Output and exit code (0, 1, 3) pass through."""
import re

HELP = "read-only checks of the provisioned box (--prod once real data exists)"
BUCKET = re.compile(r"[a-z0-9-]{6,50}")


def add_arguments(parser):
    parser.add_argument("--prod", action="store_true")
    parser.add_argument("--b2-bucket")


def _conf_bucket(ctx):
    try:
        with open(ctx.p("/etc/polycarpic/ops.conf"), encoding="utf-8") as fh:
            for line in fh:
                m = re.fullmatch(r"B2_BUCKET=([a-z0-9-]{6,50})", line.rstrip("\n"))
                if m:
                    return m.group(1)
    except OSError:
        pass
    return None


def run(args, ctx):
    bucket = args.b2_bucket
    if bucket is not None and not BUCKET.fullmatch(bucket):
        ctx.err("provision-check: bad --b2-bucket")
        return 2
    bucket = bucket or _conf_bucket(ctx)
    if not bucket:
        ctx.err("no bucket: run provision --b2-bucket <name> once, or pass --b2-bucket")
        return 2
    argv = ["/bin/bash", ctx.bundle("infra/provision-check.sh"), "--b2-capabilities", ctx.bundle("infra/operator/b2-capabilities.json"),
            "--b2-bucket", bucket]
    if args.prod:
        argv.append("--prod")
    return ctx.run_inherit(argv)
