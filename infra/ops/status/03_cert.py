"""status item cert: the public certificate of each project's PUBLIC_ORIGIN host (R7)."""
import re

from lib import compose
from lib.out import Line
from lib.ts import read_text

PROJECTS = ("prod", "staging")
ENV = {"prod": "/etc/polycarpic/host.env", "staging": "/etc/polycarpic/staging-host.env"}
HOST = re.compile(r"^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$")


def _one(ctx, project):
    text = read_text(ctx, ENV[project]) or ""
    m = re.search(r"^PUBLIC_ORIGIN=https://([^/\s:]+)", text, re.M)
    host = m.group(1) if m and HOST.match(m.group(1)) else None
    if not host:
        return Line("RED", "cert", project, "no PUBLIC_ORIGIN host in " + ENV[project].rsplit("/", 1)[-1])
    not_after, error, answered = ctx.tls_probe(host, 443, 10)
    if not answered:
        edge = compose.ps(ctx, "polycarpic-edge")
        if not edge:
            return Line("WAIT", "cert", project, "edge is not deployed")
        return Line("RED", "cert", project, "%s: nothing answers on 443" % host)
    if error is not None or not_after is None:
        return Line("RED", "cert", project, "%s: %s" % (host, re.sub(r"[^ -~]", "?", str(error or "no certificate"))[:40]))
    days = int((not_after - ctx.now()) // 86400)
    if days < 14:
        return Line("RED", "cert", project, "%s, %d days left (under 14)" % (host, days))
    return Line("OK", "cert", project, "%s, %d days left" % (host, days))


def run(ctx):
    return [_one(ctx, p) for p in PROJECTS]
