"""cli: the one app-CLI verb the operator wrapper enables, `user invite` (R8). The link goes container -> terminal, never through us."""
import argparse
import re

from lib import compose

HELP = "app CLI pass-through: user invite <email> [--bootstrap] (--staging for staging)"
EMAIL = re.compile(r"^[^\s@\-][^\s@]*@[^\s@]+\.[^\s@]+$")
DIGEST = re.compile(r"^[a-z0-9./_-]+(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$")
REFUSED = ("user reset-mfa", "membership remove-owner", "entity set-founder", "secrets rotate", "secrets init")
AVAILABLE = "refused: unknown cli command; available: user invite"


def add_arguments(parser):
    parser.add_argument("--staging", action="store_true")
    parser.add_argument("words", nargs=argparse.REMAINDER)


def run(args, ctx):
    words = args.words
    verb = " ".join(words[:2])
    if verb in REFUSED:
        ctx.err("refused: cli %s is not enabled in polycarpic-ops: it needs its own security review first" % verb)
        return 2
    if verb != "user invite" or len(words) not in (3, 4) or (len(words) == 4 and words[3] != "--bootstrap"):
        ctx.err(AVAILABLE)
        return 2
    email = words[2]
    if not (3 <= len(email) <= 254 and all(0x21 <= ord(c) <= 0x7E for c in email) and EMAIL.match(email)):
        ctx.err("refused: not a valid operator email address")
        return 2
    project = "staging" if args.staging else "prod"
    name = "polycarpic-" + project
    rows = compose.ps(ctx, name) or []
    running = {r.get("Service"): r for r in rows if r.get("State") == "running"}
    if "postgres" not in running or "web" not in running:
        ctx.err("%s is not running: deploy it first" % name)
        return 1
    images = {}
    for svc in ("web", "postgres"):
        image = compose.inspect_image(ctx, running[svc].get("ID", ""))
        if not image or not DIGEST.match(image):
            ctx.err("running %s image is not pinned by digest" % svc)
            return 1
        images[svc] = image
    argv = ["docker", "compose", "-f", ctx.bundle_path("infra/compose/%s.yml" % project), "-p", name, "--profile", "operator",
            "run", "--rm", "-T", "--pull", "never", "--no-deps", "operator", "user", "invite", email]
    if len(words) == 4:
        argv.append("--bootstrap")
    return ctx.call_inherit(argv, extra_env={"POLY_APP_IMAGE": images["web"], "POLY_POSTGRES_IMAGE": images["postgres"]})
