"""status item token: the box's GitHub read token and when it expires (POLY-100 R10). Never prints the value."""
import os

from lib import release as rel, ts
from lib.out import Line

PROJECTS = ("host",)


def run(ctx):
    if not os.path.isfile(ctx.p(rel.TOKEN)):
        return [Line("WAIT", "token", "host", "no github_read_token set")]
    exp = ts.parse((ts.read_text(ctx.p(rel.STATE + "/token-expiry"), limit=64) or "").strip())
    if exp is None:
        return [Line("WARN", "token", "host", "expiry unknown")]
    left = exp - ctx.epoch()
    if left <= 0:
        return [Line("RED", "token", "host", "expired")]
    days = left // 86400
    return [Line("OK" if days > 14 else "WARN", "token", "host", "expires in %d d" % days)]
