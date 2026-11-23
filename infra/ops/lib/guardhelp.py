"""What a guard refusal tells the operator (POLY-100 R10, S21): one exact template, filled only from values the box verified itself.

Nothing comes from the bundle, a render, a compose error, the Release body or the run record. No line checks C out (a checkout would run C's
tracked git hooks on the laptop). Every line goes through `out.clean`.
"""
import os
import re

from lib import release as rel
from lib.out import clean

RULES = ("service", "key", "pinned", "image", "name", "mount", "file", "env", "network", "ports")
TARGET = "/opt/polycarpic/ops/ssh-target"
TARGET_OK = re.compile(r"polyops@[A-Za-z0-9][A-Za-z0-9._-]{0,252}")
BASE_PLACEHOLDER = "<commit you last installed>"
TARGET_PLACEHOLDER = "polyops@<this box>"


def _target(ctx):
    try:
        with open(ctx.p(TARGET), encoding="utf-8") as fh:
            text = fh.read(512).strip()
    except OSError:
        return TARGET_PLACEHOLDER
    return text if TARGET_OK.fullmatch(text) else TARGET_PLACEHOLDER


def _base(ctx):
    ident = rel.bundle_id(ctx)
    if ident and ident.startswith("git-"):
        return ident[4:]
    return BASE_PLACEHOLDER


def lines(ctx, name, commit, tag):
    """-> the template's lines for refusal `name` of a candidate at C, or None when `name` is not a guard rule of the installed list."""
    if not name.startswith("guard-") or name[6:] not in RULES:
        return None
    rule = name
    if not (isinstance(commit, str) and re.fullmatch(r"[0-9a-f]{40}", commit)):
        return [clean("%s: this release needs a wider safety policy than the one installed. None of its containers was started." % rule)]
    signed = tag not in (None, "-") and rel.TAG.fullmatch(tag)
    who = "signed tag %s" % tag if signed else "unsigned: any merge to main"
    base = _base(ctx)
    out = [
        "%s: this release needs a wider safety policy than the one installed. None of its containers was started." % rule,
        "1. review, on the laptop, in a checkout you already trust (%s):" % who,
        "   git fetch origin && git merge-base --is-ancestor %s origin/main && git diff --text --no-ext-diff --no-textconv %s %s -- infra packages/db/sql "
        "':(glob)**/.gitattributes' && echo 'review: on main'" % (commit, base, commit),
    ]
    if signed:
        out.append("   git fetch origin tag %s && git verify-tag %s && test \"$(git rev-parse '%s^{commit}')\" = %s && echo 'review: tag signed'" % (tag, tag, tag, commit))
    out += [
        "2. only if each command above ended with its review: line and you agree with every line; this installs root code on the box:",
        "   infra/ops/install.sh %s --ssh-key <file> --commit %s" % (_target(ctx), commit),
        "3. the release then deploys on the next poll; there is nothing to clear.",
    ]
    return [clean(l) for l in out]
