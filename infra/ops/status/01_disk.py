"""status item disk: used space of / and /srv/polycarpic (R7)."""
from lib.out import Line

PROJECTS = ("host",)


def _pct(ctx, path):
    sv = ctx.statvfs(path)
    return (sv.f_blocks - sv.f_bfree) * 100 // sv.f_blocks if sv.f_blocks else 0


def run(ctx):
    try:
        root = _pct(ctx, "/")
    except OSError:
        return [Line("RED", "disk", "host", "/ cannot be read")]
    try:
        srv = _pct(ctx, "/srv/polycarpic")
    except OSError:
        return [Line("RED", "disk", "host", "/ %d%%, /srv/polycarpic not mounted" % root)]
    detail = "/ %d%%, /srv/polycarpic %d%%" % (root, srv)
    return [Line("RED" if max(root, srv) >= 80 else "OK", "disk", "host", detail)]
