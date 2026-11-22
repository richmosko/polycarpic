"""status item backup: when the last verified upload happened (R7, INFRA 6.5). Only the first line of last-upload is read."""
from lib import ts
from lib.out import Line, stamp

PROJECTS = ("prod",)
LAST = "/var/lib/polycarpic/state/last-upload"


def run(ctx):
    text = ts.read_text(ctx, LAST, limit=4096)
    first = (text or "").split("\n", 1)[0].strip()
    if not first:
        return [Line("WAIT", "backup", "prod", "no upload recorded yet")]
    when = ts.parse(first)
    if when is None:
        return [Line("RED", "backup", "prod", "last-upload first line does not parse")]
    delta = ctx.now() - when
    if delta < -300:
        return [Line("RED", "backup", "prod", "timestamp in the future")]
    detail = "last upload %s (%s)" % (stamp(when), ts.age(max(0, int(delta))))
    if delta >= 26 * 3600:
        return [Line("RED", "backup", "prod", detail + ", 26 h or older")]
    return [Line("OK", "backup", "prod", detail)]
