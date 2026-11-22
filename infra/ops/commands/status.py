"""status: one screen of the box's health, read-only (R7). At most 24 lines of at most 80 characters."""
import os

from lib import ts
from lib.ctx import BUNDLE
from lib.discover import load, modules
from lib.out import Line, fit, fmt_line, stamp

HELP = "one-screen health of the box: disk, app, cert, backup, backup logins, slots, revokes"
ORDER = {"host": 0, "prod": 1, "staging": 2}
MAX_LINES = 24
OPS_DIR = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))


def add_arguments(parser):
    pass


def collect(ctx):
    lines = []
    for name, path in modules(OPS_DIR, "status").items():
        mod = load(path, "ops_status_" + name)
        item = name.split("_", 1)[1]
        projects = getattr(mod, "PROJECTS", ("prod",))
        try:
            lines.extend(mod.run(ctx))
        except TimeoutError:
            lines.extend(Line("RED", item, p, "timed out after 10 s") for p in projects)
        except Exception as err:  # one failing item must not hide the others
            lines.extend(Line("RED", item, p, "error: " + err.__class__.__name__) for p in projects)
    return sorted(lines, key=lambda line: ORDER.get(line.project, 9))  # stable: module order inside a project


def _names(lines):
    return ", ".join("%s %s" % (line.item, line.project) for line in lines)


def run(args, ctx):
    lines = collect(ctx)
    red = [x for x in lines if x.state == "RED"]
    wait = [x for x in lines if x.state == "WAIT"]
    if red:
        summary, code = "STATUS RED: %d: %s" % (len(red), _names(red)), 1
    elif wait:
        summary, code = "STATUS GREEN; %d WAITING: %s" % (len(wait), _names(wait)), 3
    else:
        summary, code = "STATUS GREEN", 0
    fixes = ["run: sudo polycarpic-ops provision --stage database --project " + x.project
             for x in red if x.item == "revokes" and x.project in ("prod", "staging")]
    host = (ts.read_text(ctx.p("/etc/hostname")) or "?").strip()[:40]
    current = ctx.p(BUNDLE)
    version = os.path.basename(os.readlink(current)) if os.path.islink(current) else "unknown"
    header = "polycarpic-ops status  %s  %s  ops %s" % (host, stamp(ctx.epoch()), version)
    budget = MAX_LINES - 2 - len(fixes)
    body = list(lines)
    cut = False
    while len(body) > budget:
        cut = True
        ok = [i for i, x in enumerate(body) if x.state == "OK"]
        del body[ok[-1] if ok else -1]
    out = [header] + [fmt_line(x) for x in body]
    if cut:
        out[-1] = "…"
    out += fixes + [summary]
    for text in out:
        ctx.out(fit(text))
    return code
