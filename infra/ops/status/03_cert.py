"""status item cert: the public certificate of each project's PUBLIC_ORIGIN host (R7)."""
import re

from lib import compose
from lib.out import Line, clean
from lib.ts import read_text

PROJECTS = ("prod", "staging")
ENV = {"prod": "/etc/polycarpic/host.env", "staging": "/etc/polycarpic/staging-host.env"}
HOST = re.compile(r"[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?")


def _one(ctx, project):
    text = read_text(ctx.p(ENV[project])) or ""
    m = re.search(r"^PUBLIC_ORIGIN=https://([^/\s:]+)", text, re.M)
    host = m.group(1) if m and HOST.fullmatch(m.group(1)) else None
    if not host:
        return Line("RED", "cert", project, "no PUBLIC_ORIGIN host in " + ENV[project].rsplit("/", 1)[-1])
    try:
        got = ctx.tls_probe(host, 443)
    except OSError:
        if not compose.ps(ctx, "polycarpic-edge"):
            return Line("WAIT", "cert", project, "edge is not deployed")
        return Line("RED", "cert", project, "%s: nothing answers on 443" % host)
    if not got.get("ok"):
        return Line("RED", "cert", project, clean(got.get("reason", "no certificate")))  # the reason first: the line is cut at 80 characters
    days = (got["not_after"] - ctx.now()).days
    return Line("RED" if days < 14 else "OK", "cert", project, "%s, %d days left" % (host, days))


def run(ctx):
    return [_one(ctx, p) for p in PROJECTS]
