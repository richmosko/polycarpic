"""status: one screen of the box's health, read-only (R7). At most 24 lines of at most 80 characters."""
from lib import main as _main
from lib.ctx import Timeout
from lib.out import Line, fmt_line, fit, stamp

HELP = "one-screen health of the box: disk, app, cert, backup, backup logins, slots, revokes"
ORDER = {"host": 0, "prod": 1, "staging": 2}
MAX_LINES = 24


def add_arguments(parser):
    pass


def collect(ctx):
    lines = []
    for name, path in _main.modules(_main.ops_dir(ctx), "status").items():
        mod = _main.load(path, "ops_status_" + name)
        try:
            lines.extend(mod.run(ctx))
        except Timeout:
            lines.extend(Line("RED", name.split("_", 1)[1], p, "timed out after 10 s") for p in getattr(mod, "PROJECTS", ("prod",)))
        except Exception as err:  # one failing item must not hide the others
            lines.extend(Line("RED", name.split("_", 1)[1], p, "error: " + err.__class__.__name__) for p in getattr(mod, "PROJECTS", ("prod",)))
    return sorted(lines, key=lambda l: ORDER.get(l.project, 9))  # stable: module order inside a project


def run(args, ctx):
    lines = collect(ctx)
    red = [l for l in lines if l.state == "RED"]
    wait = [l for l in lines if l.state == "WAIT"]
    names = lambda ls: ", ".join("%s %s" % (l.item, l.project) for l in ls)
    if red:
        summary, code = "STATUS RED: %d: %s" % (len(red), names(red)), 1
    elif wait:
        summary, code = "STATUS GREEN; %d WAITING: %s" % (len(wait), names(wait)), 3
    else:
        summary, code = "STATUS GREEN", 0
    fixes = ["run: sudo polycarpic-ops provision --stage database --project %s" % l.project for l in red if l.item == "revokes" and l.project in ("prod", "staging")]
    header = "polycarpic-ops status  %s  %s  ops %s" % (ctx.hostname(), stamp(ctx.now()), ctx.version)
    budget = MAX_LINES - 2 - len(fixes)
    body = list(lines)
    cut = False
    while len(body) > budget:
        cut = True
        ok = [i for i, l in enumerate(body) if l.state == "OK"]
        del body[ok[-1] if ok else -1]
    out = [header] + [fmt_line(l) for l in body]
    if cut:
        out[-1] = "…"
    out += fixes + [summary]
    for text in out:
        ctx.out(fit(text))
    return code
