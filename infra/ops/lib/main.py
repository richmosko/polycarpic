"""The dispatcher (R1): preconditions, module discovery by pattern, argument parsing, exit codes.

Exit codes: 0 done or green; 1 failed or red; 2 usage error or refused request; 3 green with waiting items; 4 precondition.
"""
import argparse
import importlib.util
import os
import re
import stat as statmod
import sys

from lib.ctx import Ctx
from lib.compose import ComposeError

MODULE = re.compile(r"^[a-z][a-z0-9_]*\.py$")
STATUS_MODULE = re.compile(r"^[0-9]{2}_[a-z][a-z0-9_]*\.py$")  # status/<nn>_<item>.py: the ruled name form starts with digits
CODE_DIR = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))


class Usage(Exception):
    pass


class Parser(argparse.ArgumentParser):
    def __init__(self, *a, **kw):
        kw.setdefault("allow_abbrev", False)  # K2
        kw.setdefault("add_help", False)
        super().__init__(*a, **kw)
        self.sink = None

    def error(self, message):
        raise Usage("%s: %s" % (self.prog, message))

    def exit(self, status=0, message=None):
        raise Usage(message or self.prog)


def ops_dir(ctx):
    """Where the commands live: the bundle's own infra/ops when the context has one, else this code's directory."""
    if ctx.ops_dir:
        return ctx.ops_dir
    bundle = ctx.path(ctx.bundle_path("infra/ops"))
    if os.path.isdir(os.path.join(bundle, "commands")):
        return bundle
    return CODE_DIR


def modules(directory, sub):
    """name -> path for every file in <directory>/<sub> whose name matches the module pattern."""
    folder = os.path.join(directory, sub)
    try:
        names = sorted(os.listdir(folder))
    except OSError:
        return {}
    pattern = STATUS_MODULE if sub == "status" else MODULE
    return {n[:-3]: os.path.join(folder, n) for n in names if pattern.match(n)}


def load(path, label):
    spec = importlib.util.spec_from_file_location(label, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def commands(ctx):
    return {name.replace("_", "-"): path for name, path in modules(ops_dir(ctx), "commands").items()}


def integrity(ctx):
    """R1: every directory and file from the bundle down, and each parent up to /, is root-owned and not group/world-writable."""
    real = os.path.realpath(ctx.path(ctx.bundle))
    problems = []

    def check(p):
        try:
            st = ctx.stat(p)
        except OSError:
            return
        if st.st_uid != 0 or st.st_mode & 0o022:
            problems.append(p)

    parent = os.path.dirname(real)
    chain = []
    while True:
        chain.append(parent)
        if parent == os.path.dirname(parent):
            break
        parent = os.path.dirname(parent)
    for p in [ctx.path(ctx.bundle)] + chain[::-1]:
        check(p)
    for base, dirs, files in os.walk(real):
        for n in dirs + files:
            p = os.path.join(base, n)
            if not os.path.islink(p):
                check(p)
        check(base)
    return problems[0] if problems else None


def usage_text(ctx):
    return "usage: polycarpic-ops <subcommand> [args]; try: polycarpic-ops help"


def help_text(ctx):
    lines = ["polycarpic-ops subcommands:"]
    for name, path in sorted(commands(ctx).items()):
        lines.append("  %-16s %s" % (name, getattr(load(path, "ops_help_" + name.replace("-", "_")), "HELP", "")))
    lines.append("  %-16s %s" % ("help", "list the subcommands"))
    return lines


def main(argv, ctx=None):
    if ctx is None:
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))  # A2: a crash writes no core file holding a secret
        except (ImportError, ValueError, OSError):
            pass
        sys.dont_write_bytecode = True
        ctx = Ctx()
    if ctx.version is None:
        real = os.path.realpath(ctx.path(ctx.bundle))
        ctx.version = os.path.basename(real) if os.path.dirname(real).endswith("/opt/polycarpic/ops") else "dev"
    if CODE_DIR not in sys.path:
        sys.path.insert(0, CODE_DIR)
    argv = list(argv)
    if not argv:
        ctx.err(usage_text(ctx))
        return 2
    if argv[0] == "--version":
        ctx.out("polycarpic-ops " + ctx.version)
        return 0
    if argv[0] == "help":
        for line in help_text(ctx):
            ctx.out(line)
        return 0
    if ctx.geteuid() != 0:
        ctx.err("polycarpic-ops: run with sudo")
        return 4
    bad = integrity(ctx)
    if bad:
        ctx.err("polycarpic-ops: install is not root-owned: " + ctx.display(bad))
        return 4
    table = commands(ctx)
    name = argv[0]
    if name not in table:
        ctx.err("polycarpic-ops: unknown subcommand %s; available: %s" % (re.sub(r"[^\x21-\x7e]", "?", name)[:40], ", ".join(sorted(table) + ["help"])))
        return 2
    mod = load(table[name], "ops_cmd_" + name.replace("-", "_"))
    parser = Parser(prog="polycarpic-ops " + name)
    mod.add_arguments(parser)
    try:
        args = parser.parse_args(argv[1:])
    except Usage as err:
        ctx.err(str(err))
        return 2
    try:
        return mod.run(args, ctx)
    except ComposeError as err:
        ctx.err("polycarpic-ops: " + str(err))
        return 4
