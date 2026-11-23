"""status item token: the box's GitHub read token and when it expires (POLY-100 R10). Never prints the value."""
import os

from lib import release as rel, ts
from lib.out import Line

PROJECTS = ("host",)


def run(ctx):
    if not os.path.isfile(ctx.p(rel.TOKEN)):
        return [Line("WAIT", "token", "host", "no github_read_token set")]
    exp = ts.parse((ts.read_text(ctx.p(rel.STATE + "/token-expiry"), limit=64) or "").strip())
    note = ""
    if exp is None:  # no header seen: 90 days from the token file's mtime (INFRA 3.3)
        try:
            exp = int(os.stat(ctx.p(rel.TOKEN)).st_mtime) + 90 * 86400
        except OSError:
            return [Line("WARN", "token", "host", "expiry unknown")]
        note = ", estimated"
    left = exp - ctx.epoch()
    if left <= 0:
        return [Line("RED", "token", "host", "expired" + note)]
    days = left // 86400
    return [Line("OK" if days > 14 else "WARN", "token", "host", "expires in %d d%s" % (days, note))]
