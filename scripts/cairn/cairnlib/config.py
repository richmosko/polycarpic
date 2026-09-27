"""cairnlib.config — data-dir resolution, config.yml load/defaults, and the
board.columns/board.swimlane/paths validators.

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 5); `resolve_data_dir`
is relocated here from the CLI section (ruling §2 "+ resolve_data_dir").
"""

import argparse
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from cairnlib.constants import DEFAULT_COLUMNS, DEFAULT_PORT
from cairnlib.errors import CairnError
from cairnlib.yamlsub import parse_yaml_subset

__all__ = [
    "_VALID_COLUMN_STATUSES",
    "_VALID_SWIMLANE_VALUES",
    "_glob_to_regex",
    "_translate_glob_segment",
    "find_data_dir",
    "load_config",
    "resolve_board_columns",
    "resolve_board_swimlane",
    "resolve_data_dir",
    "validate_board_columns",
    "validate_board_swimlane",
    "validate_path_glob",
]


def find_data_dir() -> Path:
    """Locate the data dir when no --data-dir was given. See module docstring."""
    env = os.environ.get("CAIRN_DATA_DIR")
    if env:
        return Path(env).resolve()
    cwd = Path.cwd()
    for candidate in [cwd] + list(cwd.parents):
        d = candidate / "process" / "cairn"
        if (d / "config.yml").exists():
            return d
    return cwd / "process" / "cairn"


# PT-38 (architect's ruling § 1): board.columns is an ORDERED SUBSET of the
# known column statuses -- STATUSES minus "cancelled" (cancelled is owned
# by the Show-cancelled toggle, PT-35; two mechanisms producing one column
# is the drift class this ruling exists to avoid, not a feature to add).
# DEFAULT_COLUMNS already *is* exactly that five-status set, in the
# canonical order -- no second, separately-maintained set literal.
_VALID_COLUMN_STATUSES = frozenset(DEFAULT_COLUMNS)
# A tuple, not a frozenset -- `x in _VALID_SWIMLANE_VALUES` must stay safe
# for an UNHASHABLE `x` (a list, a dict -- both real inputs
# validate_board_swimlane's never-raises contract is tested against). `in`
# on a set/frozenset hashes its left operand before comparing, which
# raises TypeError for an unhashable value regardless of set membership;
# `in` on a tuple does a plain elementwise `==` scan, never hashes.
_VALID_SWIMLANE_VALUES = ("milestone", "none")


def validate_board_columns(value: Any) -> Tuple[bool, str]:
    """The ONE validity check for a `board.columns` config value (PT-38
    ruling § 1). Returns `(True, "")` when valid, `(False, <pointed
    reason>)` otherwise. This single function backs BOTH `cairn check`'s
    hard lint error and `load_config`'s soft fall-back-to-default warning
    -- one validator, two callers/postures, never two copies of the same
    condition that could drift apart (the ruling § 4's "one validator, not
    two that must agree" principle, applied server-side too).
    """
    if not isinstance(value, list):
        return False, f"board.columns must be a list, got {type(value).__name__}"
    if not value:
        return False, "board.columns must not be empty"
    seen: set = set()
    for entry in value:
        if not isinstance(entry, str):
            return False, f"board.columns entries must be strings, got {entry!r} ({type(entry).__name__})"
        if entry == "cancelled":
            return False, (
                "board.columns must not include \"cancelled\" -- it is owned by the "
                "Show-cancelled toggle, not column config"
            )
        if entry not in _VALID_COLUMN_STATUSES:
            return False, (
                f"board.columns entry {entry!r} is not a known status "
                f"(expected one of {sorted(_VALID_COLUMN_STATUSES)})"
            )
        if entry in seen:
            return False, f"board.columns contains a duplicate entry {entry!r}"
        seen.add(entry)
    return True, ""


def validate_board_swimlane(value: Any) -> Tuple[bool, str]:
    """The ONE validity check for a `board.swimlane` config value (PT-38
    ruling § 6, folded in by team-lead's ruling). Same one-validator,
    two-caller shape as validate_board_columns above.
    """
    if value not in _VALID_SWIMLANE_VALUES:
        return False, f"board.swimlane must be one of {sorted(_VALID_SWIMLANE_VALUES)}, got {value!r}"
    return True, ""


def validate_path_glob(entry: Any) -> Tuple[bool, str]:
    """The ONE validity check for a single entry of an issue's `paths:`
    list (POLY-2, architect's gate-1 ruling § 4). Shape only, never
    existence -- a feature creates its own files, so a glob naming a path
    that doesn't exist yet on disk is completely normal and must never
    fail this. Same one-validator shape as validate_board_columns/
    validate_board_swimlane above: check_repo (`cairn check`) is the only
    caller today, but a second caller (e.g. a board-side pre-submit
    check) would read this, not a second copy of the condition.

    Rejects: not a non-empty string; a leading `/` (paths are
    repo-relative, never absolute); any `\\`; a bare `..` path segment;
    and `**` fused to other characters within one segment (`a**b`,
    `**b`, `a**`) -- `**` is only meaningful as a WHOLE segment (see
    _glob_to_regex).
    """
    if not isinstance(entry, str) or not entry:
        return False, "must be a non-empty string"
    if entry.startswith("/"):
        return False, "must not start with '/' -- paths are repo-relative"
    if "\\" in entry:
        return False, "must not contain '\\\\'"
    for seg in entry.split("/"):
        if seg == "..":
            return False, "must not contain a '..' segment"
        if "**" in seg and seg != "**":
            return False, f"'**' must be a whole path segment, not fused with other characters (got {seg!r})"
    return True, ""


def _translate_glob_segment(seg: str) -> str:
    """One non-`**` path segment -> its regex equivalent. `*` matches
    within the segment only (never crosses `/`); `?` matches exactly one
    non-`/` char; every other char -- including `[`/`]` -- is literal, no
    bracket-class support (POLY-2 ruling § 2: hand-rolled, stdlib only,
    deliberately narrower than shell glob)."""
    out = []
    for ch in seg:
        if ch == "*":
            out.append("[^/]*")
        elif ch == "?":
            out.append("[^/]")
        else:
            out.append(re.escape(ch))
    return "".join(out)


def _glob_to_regex(pattern: str) -> "re.Pattern[str]":
    """Translate one `paths:` glob entry into a compiled, fully-anchored
    regex (POLY-2, architect's gate-1 ruling § 2). Hand-rolled, stdlib
    `re` only -- not `fnmatch` (no `**` semantics) and not
    `PurePath.full_match` (needs Python 3.13+; cairn has no stated
    version floor).

    `**` as a WHOLE path segment matches zero or more path segments,
    including the separators either side of it -- `src/auth/**` matches
    `src/auth/a.py` (one extra segment) and `src/auth/x/y.py` (two), but
    not `src/authz/a.py` (a different segment, not an extension of
    `auth`). A pattern with no wildcards matches exactly one path.

    Implementation note: a `**` segment's own regex expansion always
    swallows the separator on exactly one side of itself (trailing:
    absorbs the separator BEFORE it, since `(?:/.*)?` embeds an optional
    leading `/`; leading/internal: absorbs the separator AFTER it, since
    `(?:.*/)?` embeds an optional trailing `/`) -- the OTHER side's
    separator is a plain literal `/`, emitted by the normal segment-join
    logic below. Emitting a literal `/` on both sides of a `**` that
    matches zero segments would require two slashes where the input has
    one; folding both sides into the `**` expansion would let it match
    an empty segment inside a `//` on its own. This asymmetric split is
    what makes the zero-segments case collapse to exactly one `/`.

    Architect's gate-4 verdict (defect A, POLY-2.md @ c311ae7): consecutive
    `**` segments (`a/**/**/b`, or the whole pattern `**/**`) are collapsed
    to one BEFORE translation -- `a/**/**/b` means the same thing as
    `a/**/b` ("zero or more segments" twice in a row is still "zero or
    more segments"), but the untranslated pair compiled to
    `(?:.*/)?(?:/.*)?`, which requires TWO separators where the zero-
    segments case has none -- a lint-clean pattern that matched nothing at
    all, silently flagging every covered file as stray.
    """
    segments = pattern.split("/")
    collapsed: List[str] = []
    for seg in segments:
        if seg == "**" and collapsed and collapsed[-1] == "**":
            continue
        collapsed.append(seg)
    segments = collapsed
    n = len(segments)
    parts: List[str] = []
    for i, seg in enumerate(segments):
        is_globstar = seg == "**"
        # Emit the literal '/' this segment is joined to the previous one
        # by -- unless the previous segment was '**' (it already absorbed
        # this separator into its own expansion) or THIS segment is a
        # trailing '**' (its own '(?:/.*)?' expansion embeds the leading
        # '/' itself).
        if i > 0 and segments[i - 1] != "**" and not (is_globstar and i == n - 1):
            parts.append("/")
        if is_globstar:
            if n == 1:
                parts.append(".*")
            elif i == n - 1:
                parts.append("(?:/.*)?")
            else:
                parts.append("(?:.*/)?")
        else:
            parts.append(_translate_glob_segment(seg))
    return re.compile("^" + "".join(parts) + "$")


def load_config(data_dir: Path) -> Dict[str, Any]:
    """Read and parse data_dir/config.yml. An ABSENT key within an existing
    file falls back to a default; an ABSENT `config.yml` file raises.

    PT-80 (architect's ruling, filed off the PT-77 review at 0e8832c):
    previously, a missing `data_dir` or `config.yml` silently returned the
    built-in defaults (`prefix: "ISS"`, ...) instead of raising -- every
    caller that reached this function directly, bypassing `resolve_data_dir`'s
    own separate "no cairn tracker found" guard (CLI commands do this;
    PT-77's `backfill_tokens.py` did not, and paid for it: a run from
    outside the repo silently mis-attributed every issue to `main`, exit
    0). `process/TRACKER.md`'s standing rule -- "a missing or config-less
    data dir is an error, never an empty result" -- applies to this
    function too, not just to the CLI's own resolver. Callers that
    legitimately want defaults for a missing file have none today; if one
    is ever needed, it opts in explicitly rather than getting silence.

    Still defaulting-only for an EXISTING file's absent keys, and still
    does NOT validate a present-but-invalid board.columns/board.swimlane
    value (that value is passed through UNCHANGED; `resolve_board_columns`/
    `resolve_board_swimlane` below are where a bad value actually gets
    caught). Called from many CLI paths that have nothing to do with the
    board (`cairn new`, `cairn ls`, ...), so it is deliberately NOT the
    validation/fallback/stderr entry point -- that would print PT-38's
    warning on every unrelated invocation of a repo with a stale bad
    config, not just the ones that render a board.
    """
    data_dir = Path(data_dir)
    config_path = data_dir / "config.yml"
    if not config_path.exists():
        # Architect's review of 109fd25, delta 1: resolve before naming it
        # in the error -- an unresolved relative `data_dir` (e.g.
        # `Path(".")`) would otherwise render as the confusing, unpointed
        # "no config.yml at config.yml". Absolute callers already got a
        # useful message; this just makes relative ones useful too.
        raise CairnError(
            f"no config.yml at {config_path.resolve()} -- this is not a cairn tracker data dir"
        )
    parsed = parse_yaml_subset(config_path.read_text(encoding="utf-8"))

    config = dict(parsed)
    config.setdefault("prefix", "ISS")
    config.setdefault("port", DEFAULT_PORT)
    config.setdefault("data_dir", str(data_dir))
    board = dict(parsed.get("board") or {})
    board.setdefault("columns", list(DEFAULT_COLUMNS))
    board.setdefault("swimlane", "milestone")
    config["board"] = board
    return config


def resolve_board_columns(config: Dict[str, Any]) -> Tuple[List[str], Optional[str]]:
    """The RESOLVED `board.columns` for `config` (already `load_config`-
    defaulted, so `config["board"]["columns"]` is always present -- may
    still carry a raw invalid value, since `load_config` itself never
    validates). Returns `(value, None)` when valid, `(list(DEFAULT_COLUMNS),
    "<pointed warning>")` otherwise. PURE -- never prints, never raises;
    the warning is returned as DATA. `build_multi_board_payload` is the
    actual stderr print site (PT-38 ruling § 2), not this function.
    """
    value = (config.get("board") or {}).get("columns")
    ok, reason = validate_board_columns(value)
    if ok:
        return list(value), None
    return list(DEFAULT_COLUMNS), f"board.columns invalid ({reason}) -- falling back to the default column set"


def resolve_board_swimlane(config: Dict[str, Any]) -> Tuple[str, Optional[str]]:
    """Mirror of resolve_board_columns for `board.swimlane` -- falls back
    to `"milestone"`. Same PURE, never-prints, never-raises contract.
    """
    value = (config.get("board") or {}).get("swimlane")
    ok, reason = validate_board_swimlane(value)
    if ok:
        return value, None
    return "milestone", f"board.swimlane invalid ({reason}) -- falling back to \"milestone\""


def resolve_data_dir(args: argparse.Namespace) -> Path:
    """Resolve the data dir for a CLI invocation, or fail loudly.

    A missing or config-less data dir is an error, never an empty result
    (process/TRACKER.md, "The layout is fixed at process/cairn/ in v1" —
    architect conformance review, finding 3): "no tracker here" and "no
    issues here" must never render identically. Applies uniformly whether
    the path came from an explicit --data-dir or from find_data_dir()'s
    walk-up, since every command downstream assumes a real tracker.
    """
    explicit = getattr(args, "data_dir", None)
    data_dir = Path(explicit) if explicit else find_data_dir()
    if not (data_dir / "config.yml").exists():
        raise CairnError(
            f"no cairn tracker found at {data_dir} (missing config.yml) — "
            "pass --data-dir to an existing tracker, or run /setup-tracker to create one"
        )
    return data_dir
