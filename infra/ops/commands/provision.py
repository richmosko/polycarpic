"""provision: the host or database stage of provision.sh from the installed bundle (R3). Only listed flags are forwarded (K2)."""
import os
import re
import signal

HELP = "provision the host (--stage host) or re-apply the database roles (--stage database --project prod|staging)"
DOMAIN = re.compile(r"[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+")
BUCKET = re.compile(r"[a-z0-9-]{6,50}")
ENDPOINT = re.compile(r"https://s3\.[a-z0-9-]+\.backblazeb2\.com")
OPS_CONF = "/etc/polycarpic/ops.conf"
# edge.env's three flags, no wider than provision.sh's edge_env accepts: Caddy substitutes them before it parses the Caddyfile
EDGE = (
    ("--bind-addr", re.compile(r"[0-9]{1,3}(\.[0-9]{1,3}){3}")),
    ("--staging-allow", re.compile(r"[0-9a-fA-F:./]+(,[0-9a-fA-F:./]+)*")),
    ("--acme-email", re.compile(r"""(?:(?![@{}"'\\])[!-~])+@(?:(?![@{}"'\\])[!-~])+""")),
)


def add_arguments(parser):
    parser.add_argument("--stage")
    parser.add_argument("--target")
    parser.add_argument("--domain")
    parser.add_argument("--mail-from")
    parser.add_argument("--b2-bucket")
    parser.add_argument("--b2-endpoint")
    parser.add_argument("--project")
    for flag, _ in EDGE:
        parser.add_argument(flag)
    plain = parser.parse_args

    def checked(argv=None, namespace=None):
        argv = list(argv or [])
        # a value starting with '-' would be read as an option: refuse it with the named message (B3)
        for flag in ["--mail-from", "--b2-endpoint"] + [f for f, _ in EDGE]:
            if any(a == flag and b.startswith("-") for a, b in zip(argv, argv[1:])):
                parser.error("provision: bad " + flag)
        return plain(argv, namespace)

    parser.parse_args = checked


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
    if args.b2_endpoint is not None and not ENDPOINT.fullmatch(args.b2_endpoint):
        return _bad(ctx, "bad --b2-endpoint")
    if args.project is not None and args.project not in ("prod", "staging"):
        return _bad(ctx, "--project must be prod or staging")
    if args.stage == "database" and args.project is None:
        return _bad(ctx, "--stage database needs --project prod|staging")

    edge = [(flag, getattr(args, flag[2:].replace("-", "_"))) for flag, _ in EDGE]
    for (flag, value), (_, pattern) in zip(edge, EDGE):
        if value is not None and not pattern.fullmatch(value):
            return _bad(ctx, "bad " + flag)

    argv = ["/bin/bash", ctx.bundle("infra/provision.sh")]
    for flag, value in [("--stage", args.stage), ("--target", args.target), ("--domain", args.domain), ("--b2-endpoint", args.b2_endpoint), ("--mail-from", args.mail_from),
                        ("--project", args.project)] + edge:
        if value is not None:
            argv += [flag, value]
    code = ctx.run_inherit(argv)
    number = _signal_of(code)
    if number:  # a killed stage prints no reason of its own, so the tool says it (POLY-104 F3)
        ctx.err("provision: the %s stage was stopped by %s (exit %d) and did not finish" % (args.stage, signal.Signals(number).name, 128 + number))
        return 128 + number
    if code == 0 and args.b2_bucket is not None:
        _write_conf(ctx, args.b2_bucket)
    return code


def _signal_of(code):
    """-> the signal number behind an exit status, or None. Negative: bash itself was killed. 128+n: a command in it was."""
    number = -code if code < 0 else code - 128
    return number if number in set(signal.Signals) else None


def _write_conf(ctx, bucket):
    """ops.conf: root:root 0644, B2_BUCKET=<name> then the endpoint line provision.sh wrote; a line printed only when it changes."""
    real = ctx.p(OPS_CONF)
    other = []
    try:
        with open(real, encoding="utf-8") as fh:
            current = fh.read()
        other = [l for l in current.split("\n") if l and not l.startswith("B2_BUCKET=")]  # provision.sh's B2_S3_ENDPOINT line stays
    except OSError:
        current = None
    want = "".join(l + "\n" for l in ["B2_BUCKET=%s" % bucket] + other)
    if current == want:
        return
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
