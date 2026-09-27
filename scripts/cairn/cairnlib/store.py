"""cairnlib.store — directory scanning, record path resolution/schema
classification, and atomic id allocation (O_CREAT|O_EXCL, retry on race).

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 6).
`_RECORD_FIELD_ORDER`/`_record_schema_for_path` relocate here from the
payloads section, `_repo_root_for` from the roster section, and
`_ID_SORT_RE`/`_id_sort_key` from the snapshot section (ruling §2 "+").
"""

import itertools
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Tuple

from cairnlib.constants import ID_RE, ISSUE_FIELD_ORDER, MAJOR_FIELD_ORDER, MILESTONE_FIELD_ORDER, _SUFFIXED_ISSUE_ID_RE, _today
from cairnlib.errors import BadParentError, CairnError, LegacyArchiveError
from cairnlib.records import dump_frontmatter, parse_frontmatter
from cairnlib.config import load_config

__all__ = [
    "_ID_SORT_RE",
    "_IdsExhausted",
    "_RECORD_FIELD_ORDER",
    "_RECORD_SEARCH_SUBDIRS",
    "_allocate_sub_issue",
    "_claim_issue_file",
    "_dir_glob",
    "_id_sort_key",
    "_letter_id_candidates",
    "_next_id_candidate",
    "_next_sub_issue_letter",
    "_numeric_id_candidates",
    "_read_frontmatter_dict",
    "_record_schema_for_path",
    "_repo_root_for",
    "_sub_issue_letter_re",
    "allocate_and_create_issue",
    "archived_issue_paths",
    "archived_milestone_paths",
    "find_issue_path",
    "find_record_path",
    "is_archived_path",
    "legacy_archived_issue_paths",
    "milestone_paths",
]


def _dir_glob(d: Path) -> List[Path]:
    return sorted(d.glob("*.md")) if d.exists() else []


def archived_issue_paths(data_dir: Path) -> List[Path]:
    """Every archived issue .md file -- `archive/issues/` ONLY (PT-52:
    the legacy flat `archive/*.md` leg PT-50 kept for the transition is
    gone; the engine no longer reads it at all). `_dir_glob` is
    non-recursive, so this never touches `archive/milestones/` or
    `archive/majors/`.

    Kept as a named helper rather than inlined at its 8 call sites (PT-52
    §1, architect's ruling): the property that made PT-50 tractable --
    one place that answers "where do archived issues live" -- is worth
    keeping in reverse too, so a future layout change touches one line,
    not eight. See `legacy_archived_issue_paths` below for the (now
    lint-only) legacy path.
    """
    data_dir = Path(data_dir)
    return _dir_glob(data_dir / "archive" / "issues")


def archived_milestone_paths(data_dir: Path) -> List[Path]:
    """Every archived milestone .md file -- `archive/milestones/` ONLY.
    Mirrors `archived_issue_paths` above (PT-66, architect's non-blocking
    PT-60-review suggestion, approved 666dcd3): single-sources the
    `archive/milestones/` spelling for a caller that needs the ARCHIVED
    half specifically and distinctly from the live half -- unlike
    `milestone_paths(include_archived=True)` below, which flattens both
    into one list. `check_repo`'s PT-59 target_tag lint is exactly that
    caller: it needs to know WHICH directory each file came from (to run
    archive-only checks like the done/cancelled-status requirement on the
    archived half only), so it can't use the flattening helper -- see that
    function's own docstring.
    """
    data_dir = Path(data_dir)
    return _dir_glob(data_dir / "archive" / "milestones")


def milestone_paths(data_dir: Path, include_archived: bool = False) -> List[Path]:
    """Every LIVE milestone .md file, plus `archive/milestones/`'s too
    when `include_archived=True`. PT-60: single-sources the "live dir
    glob, optionally plus the archive dir glob" pattern that had drifted
    across three call sites with identical logic and no shared name --
    `_find_release_milestone` (always both, PT-54's release join),
    `build_board_payload` (both when its own `archived` flag is set), and
    `compute_etag` (mirrors `build_board_payload`'s flag exactly, since
    the etag must change whenever the payload it fronts would).

    Deliberately NOT threaded through `check_repo`'s PT-59 target_tag
    lint, despite that lint reading the exact same two directories: that
    loop needs to know WHICH directory each file came from (to run
    archive-only checks like the done/cancelled-status requirement on
    the archived half only), not just a combined path list -- a fourth
    caller here would need to immediately re-derive that distinction,
    which this helper's return type (a flat list) can't carry. See
    `check_repo`'s own PT-59 comment at that scan.
    """
    data_dir = Path(data_dir)
    paths = list(_dir_glob(data_dir / "milestones"))
    if include_archived:
        paths += _dir_glob(data_dir / "archive" / "milestones")
    return paths


def legacy_archived_issue_paths(data_dir: Path) -> List[Path]:
    """The legacy flat `archive/*.md` layout PT-52 stopped reading -- NOT
    a general-purpose helper; it exists for exactly two callers, and both
    must stay in lockstep: `check_repo`'s legacy-layout lint scan (so the
    reported count is accurate) and `allocate_and_create_issue`'s
    allocation guard (so it refuses to allocate over exactly the files the
    lint complains about). POLY-6 deleted the third caller,
    `migrate_archive_issues` (its source glob used this same helper) --
    if the lint ever reported a file the allocation guard didn't also
    see, the error would be unactionable -- one definition point is what
    keeps that impossible. `_dir_glob` is non-recursive, so this never
    touches `archive/issues/`, `archive/milestones/`, or `archive/majors/`.
    """
    data_dir = Path(data_dir)
    return _dir_glob(data_dir / "archive")


def find_issue_path(data_dir: Path, issue_id: str) -> Optional[Path]:
    data_dir = Path(data_dir)
    candidate = data_dir / "issues" / f"{issue_id}.md"
    if candidate.exists():
        return candidate
    candidate = data_dir / "archive" / "issues" / f"{issue_id}.md"
    if candidate.exists():
        return candidate
    return None


# PT-39 (architect's ruling § 6): the six subdirs find_record_path resolves
# an id against, in precedence order. Issues first (the common case, and
# the shape find_issue_path already optimizes for), then milestones, then
# majors -- each schema's live dir before its archive dir.
_RECORD_SEARCH_SUBDIRS = (
    "issues", "archive/issues", "milestones", "archive/milestones", "majors", "archive/majors",
)


def find_record_path(data_dir: Path, record_id: str) -> Optional[Path]:
    """Resolves `record_id` against issues/archive/milestones/majors (live
    and archived), in `_RECORD_SEARCH_SUBDIRS` order. NEW for PT-39's
    `cairn set` extension -- CLI-only.

    Deliberately a SEPARATE function from find_issue_path, not a widening
    of it: find_issue_path stays the only resolver the HTTP write path can
    reach (PT-3's read-only guarantee is structural, not a runtime check --
    see find_issue_path's own callers). A milestone/major must never
    become reachable from POST /api/issue/<id> just because this function
    exists.
    """
    data_dir = Path(data_dir)
    for sub in _RECORD_SEARCH_SUBDIRS:
        candidate = data_dir / sub / f"{record_id}.md"
        if candidate.exists():
            return candidate
    return None


def _read_frontmatter_dict(path: Path) -> Dict[str, Any]:
    frontmatter, _ = parse_frontmatter(path.read_text(encoding="utf-8"))
    return frontmatter


def is_archived_path(data_dir: Path, path: Path) -> bool:
    """Whether `path` lives under `data_dir`'s archive tree -- archive/
    (issues), archive/milestones/, or archive/majors/ alike. PT-42
    (architect's pre-PR extraction, security-relevant): the SINGLE
    predicate every "is this record archived" check routes through --
    four independently-typed spellings existed before this (three as
    `path.parent.name == "archive"`, one already as this parts-based
    form), and the parent-name spelling is a live correctness gap: it
    silently reads an issue under archive/milestones/ or archive/majors/
    as NOT archived (wrong directory depth), and would do the same for a
    hypothetical archive/issues/ -- for the HTTP-mutation 403 check
    specifically, that gap means an archived issue one directory level
    deeper than plain archive/ would stay wrongly writable over HTTP.
    Parts-based (`"archive" in path.relative_to(data_dir).parts`) is
    correct at any depth under archive/, not just one level in.
    """
    return "archive" in Path(path).relative_to(Path(data_dir)).parts


_RECORD_FIELD_ORDER = {"issue": ISSUE_FIELD_ORDER, "milestone": MILESTONE_FIELD_ORDER, "major": MAJOR_FIELD_ORDER}


def _record_schema_for_path(data_dir: Path, path: Path) -> str:
    """"issue" | "milestone" | "major", by which subdir `path` resolved
    under (PT-39 § 6) -- the classifier cmd_set uses to pick
    ISSUE_FIELD_ORDER/MILESTONE_FIELD_ORDER/MAJOR_FIELD_ORDER and
    STATUSES/RECORD_STATUSES. Checked via relative-path PARTS membership,
    not just the immediate parent dir name: "milestones" is the immediate
    parent for BOTH milestones/<id>.md and archive/milestones/<id>.md, so
    parts-membership handles the live and archived cases identically with
    no separate archive branch.
    """
    parts = Path(path).relative_to(Path(data_dir)).parts
    if "milestones" in parts:
        return "milestone"
    if "majors" in parts:
        return "major"
    return "issue"


def _repo_root_for(data_dir: Path) -> Path:
    """The repo root `.claude/` lives at -- `git -C data_dir rev-parse
    --show-toplevel`, falling back to `data_dir.parent.parent` (this
    project's own process/cairn -> repo-root convention) when git is
    unavailable or `data_dir` isn't inside a worktree. Same never-raises
    contract as `read_git_tags`: the fallback is a plain Path computation
    that cannot itself fail.
    """
    data_dir = Path(data_dir)
    try:
        result = subprocess.run(
            ["git", "-C", str(data_dir), "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            out = result.stdout.strip()
            if out:
                return Path(out)
    except (FileNotFoundError, OSError):
        pass
    return data_dir.parent.parent


_ID_SORT_RE = re.compile(r"^(.*?)-(\d+)[a-z]?$")


def _id_sort_key(issue_id: Any) -> Tuple[str, int, str]:
    """Numeric-aware sort key for an issue id ("PT-2" < "PT-9" < "PT-10").

    `_dir_glob`'s filename order is lexicographic ("PT-10" sorts before
    "PT-2") -- wrong once a tracker passes 10 issues (QA's PT-2 finding;
    also a latent, out-of-scope bug in `cmd_ls` today). Falls back to a
    pure string key for anything that doesn't match the "<prefix>-<digits>"
    shape, so a malformed id still sorts (just not meaningfully) instead of
    raising.

    POLY-51 (ruling §1): the trailing `[a-z]?` keeps a sub-issue's own
    number as the sort tuple's numeric slot -- "PT-26a" and "PT-26" both key
    to (prefix="PT", n=26); the third tuple element (the full id string) is
    the tiebreak, and a string is always less than its own suffixed
    extension ("PT-26" < "PT-26a" < "PT-26b"), so PT-26 < PT-26a < PT-26b <
    PT-27 falls out with NO change to the tuple shape or its callers.
    """
    s = str(issue_id or "")
    m = _ID_SORT_RE.match(s)
    if m:
        return (m.group(1), int(m.group(2)), s)
    return (s, -1, s)


# --------------------------------------------------------------------------
# ID allocation — O_CREAT|O_EXCL atomic claim, retry on race
# --------------------------------------------------------------------------

def _next_id_candidate(data_dir: Path, prefix: str) -> int:
    # PT-50/PT-52: archived ids come from archived_issue_paths (archive/
    # issues/ only, post-PT-52) so `cairn new` never re-allocates an id an
    # archived issue already holds (the one invariant the id scheme exists
    # to protect). An UNMIGRATED repo's legacy-held ids are not covered by
    # this glob any more -- see allocate_and_create_issue's PT-52 §3 guard,
    # which refuses to allocate at all on such a repo rather than risk it.
    data_dir = Path(data_dir)
    max_n = 0
    live_dir = data_dir / "issues"
    candidates: List[Path] = (list(live_dir.glob(f"{prefix}-*.md")) if live_dir.exists() else [])
    candidates += [p for p in archived_issue_paths(data_dir) if p.stem.startswith(f"{prefix}-")]
    for p in candidates:
        m = ID_RE.match(p.stem)
        if m and m.group(1) == prefix:
            max_n = max(max_n, int(m.group(2)))
    return max_n + 1


def _sub_issue_letter_re(parent_id: str) -> "re.Pattern[str]":
    """`^<parent_id>([a-z])$` -- matches ONLY a direct lettered sub-issue of
    `parent_id`, never an unrelated id that happens to start with the same
    characters (`PT-30` does not match `_sub_issue_letter_re("PT-3")`: its
    trailing char is `0`, not in `[a-z]`)."""
    return re.compile(rf"^{re.escape(parent_id)}([a-z])$")


def _next_sub_issue_letter(data_dir: Path, parent_id: str) -> str:
    """The next unused lowercase letter for `parent_id`'s sub-issues (POLY-51
    ruling §2 step 4): max(letters) + 1 over stems matching
    `_sub_issue_letter_re(parent_id)` in both `issues/` and
    `archive/issues/` -- no gap reuse (`a`, `c` present -> `d`, never `b`).
    Raises BadParentError (POLY-48 item 7), before any file is written,
    once a..z is already exhausted among the existing siblings.
    """
    letter_re = _sub_issue_letter_re(parent_id)
    data_dir = Path(data_dir)
    live_dir = data_dir / "issues"
    candidates: List[Path] = list(live_dir.glob(f"{parent_id}?.md")) if live_dir.exists() else []
    candidates += [p for p in archived_issue_paths(data_dir) if p.stem.startswith(parent_id)]
    max_ord = -1
    for p in candidates:
        m = letter_re.match(p.stem)
        if m:
            max_ord = max(max_ord, ord(m.group(1)) - ord("a"))
    next_ord = max_ord + 1
    if next_ord >= 26:
        raise BadParentError(f"parent {parent_id} has exhausted sub-issue letters a..z")
    return chr(ord("a") + next_ord)


class _IdsExhausted(Exception):
    """Private signal from `_claim_issue_file` (POLY-48 item 8): its `ids`
    iterable ran out with no free id claimed. Never a `CairnError` itself
    -- each of the two callers catches it and raises its own,
    differently-worded error (a numeric attempt budget vs a letter
    range), the same way they did before the loop bodies were shared.
    """


def _claim_issue_file(
    issues_dir: Path, ids: Iterable[str], fields: Dict[str, Any], today_str: str, body: str = "",
) -> Path:
    """The O_CREAT|O_EXCL claim-and-write loop shared by the numeric and
    letter paths of `allocate_and_create_issue` (POLY-48 item 8, follow-up
    (b) from the POLY-51 review, POLY-51.md @ 006848e). Tries each
    candidate id from `ids` in order, claims the first one not already on
    disk, and writes `fields` (plus `id`/`created`/`updated`) to it
    atomically. Returns the claimed path; raises `_IdsExhausted` once
    `ids` is spent with nothing claimed.

    POLY-56 (gate-1 ruling R3): `body` rides the SAME O_EXCL write (M6) --
    no second rewrite, so a seeded issue never has a moment where the file
    exists with frontmatter but no body. Default `""` preserves every
    existing caller's exact prior output (frontmatter block + one blank
    line, nothing after).
    """
    for issue_id in ids:
        path = issues_dir / f"{issue_id}.md"
        full_fields = dict(fields)
        full_fields["id"] = issue_id
        full_fields["created"] = today_str
        full_fields["updated"] = today_str
        content = dump_frontmatter(full_fields) + "\n" + body
        try:
            fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            continue
        try:
            os.write(fd, content.encode("utf-8"))
        finally:
            os.close(fd)
        return path
    raise _IdsExhausted()


def _numeric_id_candidates(prefix: str, n: int) -> Iterator[str]:
    """`<prefix>-<n>`, `<prefix>-<n+1>`, ... forever (POLY-48 item 8) --
    bounded by the caller's `itertools.islice(..., max_attempts)`, the
    numeric path's own budget."""
    while True:
        yield f"{prefix}-{n}"
        n += 1


def _letter_id_candidates(parent_id: str, letter: str) -> Iterator[str]:
    """`<parent_id>a`, `<parent_id>b`, ... up to and including `z`, then
    stops (POLY-48 item 8) -- the letter path's own bound, independent of
    `max_attempts`."""
    while True:
        yield f"{parent_id}{letter}"
        next_ord = ord(letter) - ord("a") + 1
        if next_ord >= 26:
            return
        letter = chr(ord("a") + next_ord)


def _allocate_sub_issue(
    data_dir: Path, issues_dir: Path, parent_id: str, fields: Dict[str, Any], today_str: str, max_attempts: int,
    body: str = "",
) -> Path:
    """The `--parent X` half of `allocate_and_create_issue` (POLY-51 ruling
    §2): validates `X`, then claims `X<letter>` via `_claim_issue_file`,
    the same O_CREAT|O_EXCL retry-on-collision discipline the numeric path
    uses.
    """
    parent_path = find_issue_path(data_dir, parent_id)
    if parent_path is None:
        raise BadParentError(f"parent {parent_id}: no such issue")
    parent_fm, _ = parse_frontmatter(parent_path.read_text(encoding="utf-8"))
    # Depth 1 only: `X` may not itself be a sub-issue -- checked on the
    # RECORD (its own `parent:`), which also catches a legacy numbered
    # sub-issue (e.g. POLY-28) that a shape check alone would miss, and on
    # the SHAPE (`_SUFFIXED_ISSUE_ID_RE`), which catches a suffixed id whose
    # frontmatter was hand-edited to drop its own `parent:`.
    if parent_fm.get("parent") is not None or _SUFFIXED_ISSUE_ID_RE.match(parent_id):
        raise BadParentError(f"parent {parent_id} is itself a sub-issue -- sub-issues nest one level")

    letter = _next_sub_issue_letter(data_dir, parent_id)
    try:
        return _claim_issue_file(issues_dir, _letter_id_candidates(parent_id, letter), fields, today_str, body)
    except _IdsExhausted:
        raise BadParentError(f"parent {parent_id} has exhausted sub-issue letters a..z")


def allocate_and_create_issue(
    data_dir: Path, fields: Dict[str, Any], max_attempts: int = 50, body: str = "",
) -> Path:
    """Atomically claim the next free ID and create issues/<PREFIX>-<n>.md
    -- or, when `fields["parent"]` is set, `issues/<PARENT><letter>.md`
    (POLY-51 ruling §2).

    `fields` supplies everything except id/created/updated, which this
    function fills in. `prefix` comes from load_config(data_dir)["prefix"].
    `body` (POLY-56 gate-1 ruling R3), when given, is written verbatim
    after the frontmatter's trailing blank line, in the same O_EXCL write
    -- default `""` is byte-identical to every pre-POLY-56 caller.

    PT-52 §3 (architect's ruling, required companion to the legacy-read
    deletion): the single allocation path both `cmd_new` and the HTTP
    `_create_issue` funnel through, so it's also the single place to guard
    -- for BOTH the numeric and the letter path (POLY-51 ruling §2 step 1).
    `_next_id_candidate` no longer counts ids held by a legacy-layout
    archived issue (PT-52 §1 collapsed `archived_issue_paths` to
    `archive/issues/` only) -- on an unmigrated repo, allocating anyway
    would silently re-issue an id an archived issue already holds, the one
    invariant the id scheme exists to protect, and NOT repairable
    afterwards (the new issue would already exist). Refuse before any
    O_EXCL attempt: one non-recursive glob per allocation, on an operation
    measured in units per day. Self-clearing -- moving the legacy files
    into archive/issues/ and this raise stops firing. POLY-6 gate-1
    ruling (section (b)): the fix hint naming the now-deleted
    `migrate archive-issues` command is gone.
    """
    data_dir = Path(data_dir)
    legacy = legacy_archived_issue_paths(data_dir)
    if legacy:
        raise LegacyArchiveError(
            f"{len(legacy)} archived issue(s) at the legacy archive/*.md layout -- refusing to allocate a "
            f"new id (it could collide with one an archived issue already holds)."
        )
    config = load_config(data_dir)
    prefix = config["prefix"]
    issues_dir = data_dir / "issues"
    issues_dir.mkdir(parents=True, exist_ok=True)
    today_str = _today()

    parent = fields.get("parent")
    if parent is not None:
        return _allocate_sub_issue(data_dir, issues_dir, str(parent), fields, today_str, max_attempts, body)

    n = _next_id_candidate(data_dir, prefix)
    candidates = itertools.islice(_numeric_id_candidates(prefix, n), max_attempts)
    try:
        return _claim_issue_file(issues_dir, candidates, fields, today_str, body)
    except _IdsExhausted:
        raise CairnError(f"could not allocate an ID for prefix {prefix!r} after {max_attempts} attempts")
