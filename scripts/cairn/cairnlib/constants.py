"""cairnlib.constants — shared regexes, vocabularies, and small id-shape
helpers with no dependency on any other cairnlib module.

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 1). See
process/reviews/POLY-58/ruling.md for the split's design and cairn.py's
own module docstring for the project this belongs to.
"""

import datetime
import re
from pathlib import Path
from typing import Any, List, Optional

__all__ = [
    "AC_HEADING_RE",
    "BOARD_DIR",
    "COMMENTS_HEADING_RE",
    "COMMENT_DELIM_RE",
    "DASHBOARD_DIR",
    "DEFAULT_COLUMNS",
    "DEFAULT_PORT",
    "DEFAULT_STATUS",
    "ID_RE",
    "ISSUE_FIELD_ORDER",
    "MAJOR_FIELD_ORDER",
    "MAJOR_HEALTH_VALUES",
    "MILESTONE_FIELD_ORDER",
    "MILESTONE_KINDS",
    "PREFIX_RE",
    "PRIORITIES",
    "RECORD_STATUSES",
    "STATUSES",
    "STATUS_ORDER",
    "_CHECKLIST_ITEM_RE",
    "_MAJOR_N_RE",
    "_RECORD_BOARD_EDITABLE_FIELDS",
    "_STAGE_ORDER",
    "_SUFFIXED_ISSUE_ID_RE",
    "_check_archived_record_status",
    "_check_record_status",
    "_definition_milestone_id_re",
    "_development_milestone_id_re",
    "_ga_target_tag_for_major",
    "_issue_id_re",
    "_major_id_re",
    "_today",
]

# POLY-58 §3: scripts/cairn/, two parents up from this file
# (scripts/cairn/cairnlib/constants.py) -- not exported (import it
# explicitly as `from cairnlib.constants import CAIRN_DIR` if another
# cairnlib module needs it), so BOARD_DIR/DASHBOARD_DIR below resolve the
# same regardless of which module does the resolving.
CAIRN_DIR = Path(__file__).resolve().parent.parent
CAIRNLIB_DIR = CAIRN_DIR / "cairnlib"

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------

DEFAULT_PORT = 8766
DEFAULT_COLUMNS = ["backlog", "todo", "in-progress", "in-review", "done"]
# PT-36 (architect's ruling @ 49174b7, Part A): the append rule
# (`DEFAULT_COLUMNS` + `["cancelled"]`) had THREE Python-side copies
# (cairn.py:1277, tests/test_snapshot.py, and this constant's predecessor
# inline expression) -- collapsed to one real derivation here. A fresh list
# each import (`DEFAULT_COLUMNS + [...]` builds a new list, never mutates or
# aliases DEFAULT_COLUMNS), so mutating one can never touch the other.
STATUS_ORDER = DEFAULT_COLUMNS + ["cancelled"]
STATUSES = {"backlog", "todo", "in-progress", "in-review", "done", "cancelled"}
DEFAULT_STATUS = "backlog"
PRIORITIES = {"P0", "P1", "P2", "P3"}
MILESTONE_KINDS = {"process", "product"}

# PT-39 (architect's ruling § 1): the unified milestone/major status
# vocabulary -- one enum for BOTH schemas, not two that overlap by four
# values out of five. Deliberately a SEPARATE set object from STATUSES,
# never an alias: milestones have no `in-review`, majors have no
# `backlog` -- the issue-cycle vocabulary and the record-lifecycle
# vocabulary are related but distinct, and a milestone must never be able
# to carry `status: backlog` just because the two sets happened to be the
# same object. `completed` -> `done`, `active` -> `in-progress` is the
# rewrite the retired `migrate lifecycle-status` one-shot used to apply
# (POLY-6 deleted it; the detection lint stays); `paused` was already
# documented for milestones and is extended to majors here.
RECORD_STATUSES = {"planned", "in-progress", "paused", "done", "cancelled"}
MILESTONE_FIELD_ORDER = ["id", "name", "kind", "major", "status", "target_tag", "ga"]
MAJOR_FIELD_ORDER = ["id", "status", "owner", "target_ship", "health"]

# PT-51 §3: the major schema's `health` vocabulary (process/TRACKER.md's
# major-file example: "on-track | at-risk | off-track") -- validated at
# the record write path since it's a single-field syntactic check, unlike
# the cross-record invariants (GA cap, target_tag shape, major: resolves)
# this same section explicitly leaves to `cairn check`.
MAJOR_HEALTH_VALUES = {"on-track", "at-risk", "off-track"}

# PT-51 §3: board-editable fields per schema -- the ruling's "Editable in
# the drawer" list, encoded. Deliberately NARROWER than _RECORD_FIELD_ORDER
# (below): `id` (filename-authoritative; a rename is a `git mv`) and
# milestone `kind` (pinned to the id shape by lint, itself not board-
# editable) are legal CLI fields but excluded here on purpose, not
# special-cased in the validator -- "not in this set" already covers them.
_RECORD_BOARD_EDITABLE_FIELDS = {
    "milestone": {"name", "status", "major", "target_tag", "ga"},
    "major": {"status", "health", "owner", "target_ship"},
}

# PT-28: `prefix:` format -- the SAME regex /setup-tracker already uses for
# the interactive path (architect's ruling § 7), now also enforced at lint
# time so a hand-edited config.yml can't silently corrupt every id-shape
# regex below, all four of which are DERIVED from this value.
PREFIX_RE = re.compile(r"^[A-Z]{2,5}$")

# PT-27/PT-28: milestone id-shape <-> kind agreement, and (PT-28) major/issue
# id shape -- all four now PREFIXED (architect's ruling § 1, addendum-
# confirmed #1): `<P>-V<n>` (major), `<P>-<letter>` (definition milestone,
# `M`/`V` both reserved out of the letter sequence), `<P>-M<n>` or
# `<P>-<version>` (development milestone), `<P>-<n>` (issue). Functions, not
# module-level constants, because `<P>` is the repo's CONFIGURED prefix:,
# never a literal "PT" -- check_repo builds each of these once per call,
# after validating the prefix itself (see check_repo's own comment).
def _major_id_re(prefix: str) -> "re.Pattern[str]":
    return re.compile(rf"^{re.escape(prefix)}-V\d+$")


# PT-41 (architect's Option A ruling, review finding #2): "V<n> means the
# line that culminates in v<n>.0.0". Extracts N only AFTER `major_re`
# (the caller's already-built, PREFIX-SCOPED `_major_id_re(prefix)`
# pattern -- PT-28's rule, same as the other three id-shape regexes)
# confirms `major_id` matches THIS repo's configured shape -- a
# prefix-agnostic literal regex could match a foreign-prefix or
# otherwise-malformed id (e.g. a stray "XX-V1" in a multi-root payload)
# and derive a meaningless N from it. Handles multi-digit N correctly
# (`PT-V10` -> `v10.0.0`, not a single-digit assumption).
_MAJOR_N_RE = re.compile(r"-V(\d+)$")


def _ga_target_tag_for_major(major_id: Any, major_re: Optional["re.Pattern[str]"]) -> Optional[str]:
    """The expected `v<N>.0.0` GA target_tag for `major_id`, or `None`
    when `major_re` is unavailable (the prefix itself didn't validate) or
    `major_id` doesn't match it -- a malformed/foreign-prefix major id is
    a DIFFERENT, already-reported lint error (the id-shape check above);
    this rider has nothing safe to check a GA milestone's target_tag
    against in that case, so it silently skips rather than raising a
    second, confusing error on the same root cause.
    """
    if major_re is None or not major_re.match(str(major_id)):
        return None
    m = _MAJOR_N_RE.search(str(major_id))
    return f"v{m.group(1)}.0.0" if m else None


def _definition_milestone_id_re(prefix: str) -> "re.Pattern[str]":
    return re.compile(rf"^{re.escape(prefix)}-(?!M|V)[A-Z][a-z]?$")


def _development_milestone_id_re(prefix: str) -> "re.Pattern[str]":
    return re.compile(rf"^{re.escape(prefix)}-(?:M\d+[a-z]?|\d+\.\d+(?:\.\d+)?)$")


def _issue_id_re(prefix: str) -> "re.Pattern[str]":
    # POLY-51 (ruling §1): widened to admit a sub-issue's trailing lowercase
    # letter (`PT-14a`) alongside the plain numeric shape -- both are valid
    # issue ids now; uppercase (`PT-14A`) is deliberately NOT admitted (macOS
    # case-insensitive-filesystem collision risk, ruling §1).
    return re.compile(rf"^{re.escape(prefix)}-\d+[a-z]?$")


def _check_record_status(errors: List[str], stem: str, status: Any) -> None:
    """PT-39 (architect's ruling § 3 item 1): the ONE status-validity check
    for a milestone/major record, called once per major and once per
    milestone in check_repo -- factored out (standing duplicated-inline-
    expression rule) so the two schemas' identical "missing or invalid
    status" condition can't drift into two slightly different messages.
    Appends to `errors` in place; returns nothing.
    """
    if status is None or status not in RECORD_STATUSES:
        errors.append(
            f"{stem}: missing or invalid status {status!r} -- "
            f"expected one of {sorted(RECORD_STATUSES)}"
        )


def _check_archived_record_status(errors: List[str], stem: str, status: Any) -> None:
    """PT-46 (architect's Pass-2 finding on PT-39 § 3 item 2): the hand-
    `git mv` bypass, milestone/major half. `cairn archive --milestone`/
    `--major` refuses unless the record's own status is already
    done/cancelled (test_archive_records.py pins that precondition) --
    but nothing stops a human from `git mv`-ing a still-in-progress
    milestone/major file straight into archive/milestones/ or
    archive/majors/, skipping the precondition entirely. Same defect
    class PT-39 § 3 item 2 closed for an ARCHIVED ISSUE's milestone; this
    closes it for the record itself.

    Deliberately STRICTER than, and separate from, _check_record_status
    above: "planned"/"paused"/"in-progress" are all valid RECORD_STATUSES
    values (that general check passes them), but none is valid for a
    record that is ALREADY living in an archive dir -- this is an
    archive-location-specific rule the general check never asserted.
    Callers must scope this to archived records only; a live, in-progress
    milestone/major is normal and must never trip it. A missing status
    (`None`) also fails "not in (done, cancelled)" and is caught here too,
    not as a separately-shaped case.
    """
    if status not in ("done", "cancelled"):
        errors.append(
            f"{stem}: archived but status is {status!r}, not done/cancelled -- "
            f"looks like it was moved into archive/ by hand, bypassing "
            f"`cairn archive`'s precondition"
        )


ISSUE_FIELD_ORDER = [
    "id", "title", "status", "milestone", "parent", "blocked_by", "assignee",
    "paths",
    # POLY-3 (design note §1): effort estimation -- flat dotted keys, not
    # nested maps (dump_frontmatter has no dict-emitting branch, and a
    # nested shape would need three new surfaces: the dumper, a
    # `key.sub=value` cmd_set path syntax, and apply_patch's merge). All
    # are optional; an absent key is omitted from the dump, same as
    # `paths` already is.
    # POLY-34 (ruling §0.3): estimate.cost_usd/actual.cost_usd lead their
    # token siblings -- cost is the driving axis now, tokens are the
    # secondary.
    "stage", "estimate.cost_usd", "estimate.tokens", "estimate.gate_cycles",
    "actual.cost_usd", "actual.tokens", "actual.gate_cycles", "actual.wall_clock", "ratio",
    "labels", "priority", "pr", "created", "updated",
]

COMMENTS_HEADING_RE = re.compile(r"^## Comments\s*$")
COMMENT_DELIM_RE = re.compile(r"^### @([a-z0-9][a-z0-9-]*) — (\d{4}-\d{2}-\d{2})\s*$")
ID_RE = re.compile(r"^([A-Za-z][A-Za-z0-9]*)-(\d+)$")

# POLY-56 (gate-1 ruling R1): the ONE checklist parser, Python-side --
# board.js's client-side splitAcceptanceCriteria/AC_ITEM_RE is deleted, so
# this pair is the sole source of truth for "what counts as a checklist
# item" (both the board payload's counts and check-item's target line read
# through it). Scope is column 0 only (an indented/nested `- [ ]` is not
# counted) starting after the first line matching AC_HEADING_RE. `\s*`
# before AC_HEADING_RE's `$` already absorbs a trailing `\r` on a CRLF
# heading line, same as the JS original. The item regex's trailing `\r?`
# is what keeps a CRLF file's item TEXT clean of the carriage return
# without going through any newline-translating read -- the one place this
# matters is check-item's byte-exact rewrite, which decodes raw bytes
# rather than using `read_text` (see cmd_check_item).
AC_HEADING_RE = re.compile(r"^##\s*Acceptance criteria\s*$")
_CHECKLIST_ITEM_RE = re.compile(r"^- \[( |x|X)\] ?(.*?)\r?$")

# POLY-51 (ruling §1): a sub-issue id split into its parent's id (group 1,
# includes the parent's own prefix+number) and its single lowercase letter
# (group 2) -- shared by allocate_and_create_issue's depth-1 guard (§2 step
# 3) and check_repo's suffixed-id<->parent agreement check (§3), so both
# read the exact same "is this a sub-issue, and who must its parent be"
# shape. Deliberately NOT `ID_RE` widened: `ID_RE` stays numeric-only on
# purpose (§1) so a suffixed stem never advances the top-level counter.
_SUFFIXED_ISSUE_ID_RE = re.compile(r"^([A-Za-z][A-Za-z0-9]*-\d+)([a-z])$")

BOARD_DIR = CAIRN_DIR / "board"

# PT-54 (architect ruling §1): sibling of BOARD_DIR, same cwd-independent
# shape. Points at the COMMITTED build output, not the app source --
# `scripts/cairn/dashboard/` (source) vs. `scripts/cairn/dashboard/dist/`
# (built, what actually gets served).
DASHBOARD_DIR = CAIRN_DIR / "dashboard" / "dist"


def _today() -> str:
    return datetime.date.today().isoformat()


# POLY-16 ruling (design note §2 -- Stage windows): plan < execute < review.
# Shared by `check_repo`'s stage-enum validation and `_sibling_floor`'s
# later-stage exclusion, so the ordering is defined exactly once.
_STAGE_ORDER = {"plan": 0, "execute": 1, "review": 2}
