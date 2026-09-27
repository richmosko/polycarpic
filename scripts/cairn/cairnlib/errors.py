"""cairnlib.errors — the CairnError hierarchy, no dependency on any other
cairnlib module.

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 2).
"""

from typing import Any, Dict, Optional

__all__ = [
    "BadParentError",
    "CairnError",
    "ConflictError",
    "FrontmatterError",
    "LegacyArchiveError",
    "MilestoneWindowError",
    "YamlError",
]


class CairnError(Exception):
    """Base error for cairn CLI/engine failures — caught at the CLI boundary."""


class YamlError(CairnError):
    """Raised by parse_yaml_subset on anything outside the documented subset."""


class FrontmatterError(CairnError):
    """Raised by parse_frontmatter when the '---'/'---' fences are missing or malformed."""


class MilestoneWindowError(CairnError):
    """Raised by milestone_windows when its own strictly-increasing/one-
    entry-per-file invariant is violated (architect's ruling, 7341e2e) --
    a duplicate milestone id, or two milestone files resolving to the
    same (or an inverted) creation timestamp. Converts what would
    otherwise be a silent mis-bucketing (two milestones sharing a
    window, or a `--follow` rename false-merge) into an immediate,
    named error instead."""


class ConflictError(CairnError):
    """Raised on the server-side patch path when a write's `seen` token is stale.

    Carries `.current`, the on-disk payload at conflict time, so the HTTP
    layer can render the spec's 409 body directly.
    """

    def __init__(self, message: str, current: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.current = current


class BadParentError(CairnError):
    """Raised by allocate_and_create_issue's letter path: `--parent X`
    where X doesn't resolve, or X is itself a sub-issue (suffixed or a
    legacy numbered one -- sub-issues nest one level only) (POLY-51 ruling
    §2 steps 2-3) -- AND, since POLY-48 item 7 (gate-1 ruling
    process/reviews/POLY-48/ruling.md §1, "confirmed as filed"), a..z letter
    exhaustion under an otherwise-valid parent (both raise sites:
    `_next_sub_issue_letter` and `_allocate_sub_issue`'s retry loop). A
    client can fix any of these four cases by retrying with a different
    `--parent` or waiting for a letter to free up -- unlike the legacy-
    archive guard below, which no retry of the identical request can fix.
    A distinct subclass exists only so `_create_issue` can map it to 400
    `bad_parent`.
    """


class LegacyArchiveError(CairnError):
    """Raised by allocate_and_create_issue's legacy-layout guard (PT-52
    §3): a repo carrying an archived issue at the pre-migration
    `archive/*.md` layout must not allocate a new id, since it could
    collide with one an archived issue already holds. Distinct from
    `BadParentError` (POLY-48 item 7) so `_create_issue` can map it to its
    own 400 `legacy_archive` -- a client retry of the identical request
    can't fix this, only running the migration can.
    """
