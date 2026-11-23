"""cli: the one app-CLI verb the operator wrapper enables, `user invite` (R8). The link goes container -> terminal, never through us."""
import argparse
import re

from lib import compose

HELP = "app CLI pass-through: user invite <email> [--bootstrap] (--staging for staging)"
EMAIL = re.compile(r"[^\s@\-][^\s@]*@[^\s@]+\.[^\s@]+")
DIGEST = re.compile(r"[a-z0-9./_-]+(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}")
REFUSED = ("user reset-mfa", "membership remove-owner", "entity set-founder", "secrets rotate", "secrets init")


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
        ctx.err("refused: unknown cli command; available: user invite")
        return 2
    email = words[2]
    if not (3 <= len(email) <= 254 and all(0x21 <= ord(c) <= 0x7E for c in email) and EMAIL.fullmatch(email)):
        ctx.err("refused: not a valid operator email address")
        return 2
    project = "staging" if args.staging else "prod"
    name = "polycarpic-" + project
    rows = compose.ps(ctx, name)
    found = {svc: compose.running(rows, svc) for svc in ("web", "postgres")}
    if not all(found.values()):
        ctx.err("%s is not running: deploy it first" % name)
        return 1
    images = {}
    for svc in ("web", "postgres"):
        ref = compose.image_ref(compose.inspect(ctx, found[svc].get("Name", "")))
        if not DIGEST.fullmatch(ref):
            ctx.err("running %s image is not pinned by digest" % svc)
            return 1
        images[svc] = ref
    cfile, cenv = compose.compose_source(ctx, project, project + ".yml", ctx.bundle("infra/compose/%s.yml" % project))
    argv = ["docker", "compose", "-f", cfile] + cenv + ["-p", name, "--profile", "operator",
            "run", "--rm", "-T", "--pull", "never", "--no-deps", "operator", "user", "invite", email]
    if len(words) == 4:
        argv.append("--bootstrap")
    return ctx.run_inherit(argv, extra_env={"POLY_APP_IMAGE": images["web"], "POLY_POSTGRES_IMAGE": images["postgres"]})
