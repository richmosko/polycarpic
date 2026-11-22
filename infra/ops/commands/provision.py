"""provision: the host or database stage of provision.sh from the installed bundle (R3). Only listed flags are forwarded (K2)."""
import os
import re

HELP = "provision the host (--stage host) or re-apply the database roles (--stage database --project prod|staging)"
DOMAIN = re.compile(r"[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+")
BUCKET = re.compile(r"[a-z0-9-]{6,50}")
OPS_CONF = "/etc/polycarpic/ops.conf"


def add_arguments(parser):
    parser.add_argument("--stage")
    parser.add_argument("--target")
    parser.add_argument("--domain")
    parser.add_argument("--mail-from")
    parser.add_argument("--b2-bucket")
    parser.add_argument("--project")


def _bad(ctx, text):
    ctx.err("provision: " + text)
    return 2


def run(args, ctx):
    if args.stage is not None and args.stage not in ("host", "database"):
        return _bad(ctx, "--stage must be host or database")
    if args.target is not None and args.target != "hetzner":
        return _bad(ctx, "--target home is not available" if args.target == "home" else "--target must be hetzner")
    if args.domain is not None and not DOMAIN.fullmatch(args.domain):
        return _bad(ctx, "bad --domain")
    if args.mail_from is not None and not (1 <= len(args.mail_from) <= 254 and all(0x20 <= ord(c) <= 0x7E for c in args.mail_from)):
        return _bad(ctx, "bad --mail-from")
    if args.b2_bucket is not None and not BUCKET.fullmatch(args.b2_bucket):
        return _bad(ctx, "bad --b2-bucket")
    if args.project is not None and args.project not in ("prod", "staging"):
        return _bad(ctx, "--project must be prod or staging")
    if args.stage == "database" and args.project is None:
        return _bad(ctx, "--stage database needs --project prod|staging")

    argv = ["/bin/bash", ctx.bundle("infra/provision.sh")]
    for flag, value in (("--stage", args.stage), ("--target", args.target), ("--domain", args.domain), ("--mail-from", args.mail_from),
                        ("--project", args.project)):
        if value is not None:
            argv += [flag, value]
    code = ctx.run_inherit(argv)
    if code == 0 and args.b2_bucket is not None:
        _write_conf(ctx, args.b2_bucket)
    return code


def _write_conf(ctx, bucket):
    """ops.conf: root:root 0644, one line B2_BUCKET=<name>; a line printed only when it changes."""
    real = ctx.p(OPS_CONF)
    want = "B2_BUCKET=%s\n" % bucket
    try:
        with open(real, encoding="utf-8") as fh:
            if fh.read() == want:
                return
    except OSError:
        pass
    os.makedirs(os.path.dirname(real), mode=0o755, exist_ok=True)
    tmp = real + ".new"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o644)
    try:
        ctx.chown(fd, 0, 0)
        os.fchmod(fd, 0o644)
        os.write(fd, want.encode())
        os.fsync(fd)
    finally:
        os.close(fd)
    os.rename(tmp, real)
    ctx.out("change: ops.conf B2_BUCKET=%s" % bucket)
