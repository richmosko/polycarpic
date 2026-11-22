"""status item disk: used space of / and /srv/polycarpic (R7)."""
from lib.out import Line

PROJECTS = ("host",)


def _pct(ctx, logical):
    sv = ctx.statvfs(ctx.path(logical))
    used = sv.f_blocks - sv.f_bfree
    total = used + sv.f_bavail
    return -(-used * 100 // total) if total else 0


def run(ctx):
    pcts = {}
    for p in ("/", "/srv/polycarpic"):
        try:
            pcts[p] = _pct(ctx, p)
        except OSError:
            pcts[p] = None
    detail = "/ %s%%, /srv/polycarpic %s%%" % (pcts["/"], pcts["/srv/polycarpic"])
    if pcts["/srv/polycarpic"] is None or not ctx.ismount("/srv/polycarpic"):
        return [Line("RED", "disk", "host", "/srv/polycarpic is not mounted")]
    if pcts["/"] is None or max(pcts.values()) >= 80:
        return [Line("RED", "disk", "host", detail + " (80 or over)")]
    return [Line("OK", "disk", "host", detail)]
