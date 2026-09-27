"""cairnlib.actuals — POLY-3 effort estimation: shared actuals readers
(design note §6, AC6) that `cairn close` and `loop-stats` both read
through.

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 14).
"""

import datetime
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

from cairnlib.tokens import TOKEN_USAGE_REL, _TOKEN_COUNTERS, _read_token_usage_lines, _row_cost_usd, load_prices

__all__ = [
    "_parse_iso_any",
    "gate_cycle_actuals",
    "token_actuals",
]


def token_actuals(
    data_dir: Path, issue_id: str, role: Optional[str] = None,
    since: Optional[str] = None, until: Optional[str] = None,
    prices: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """The ONE seam `cairn close` and `loop-stats` both read tokens
    through (design note §6, AC6) -- pure, never prints, never raises.

    `since`/`until` are `%Y-%m-%dT%H:%M:%SZ` strings, compared lexically
    against each line's `generated` stamp -- the same convention
    `build_tokens_payload` already uses for its own window bounds. The
    window is left-open (`generated <= since` is excluded, matching the
    design note's `(created_ts, close_ts]`): a line generated in the same
    flush as the sub-issue's own creation commit must not double-count
    into it.

    `build_tokens_payload` is deliberately NOT reused here (architect's
    design note §6): it sums a whole issue with no time filter, so it
    cannot separate two same-(parent, role) sub-issues sharing one parent
    issue's token stream.

    A missing `token-usage.jsonl`, OR one present but with zero lines
    matching (`issue_id`, `role`, window) -- addendum 1, design note @
    85c5fd6 §2 -- both give `tokens: None` (never `0`: "no evidence" must
    not look like "measured zero"; a real `0` only ever comes from
    summing >=1 matching line), `lines: 0`.
    """
    data_dir = Path(data_dir)
    prices = load_prices() if prices is None else prices
    models = prices.get("models") or {}
    usage_path = data_dir / TOKEN_USAGE_REL

    if not usage_path.is_file():
        result = {c: 0 for c in _TOKEN_COUNTERS}
        result["tokens"] = None
        result["cost_usd"] = None
        result["lines"] = 0
        result["unpriced_models"] = []
        return result

    rows, _warning = _read_token_usage_lines(usage_path)
    totals = {c: 0 for c in _TOKEN_COUNTERS}
    lines = 0
    raw_cost = 0.0
    any_unpriced = False
    # POLY-34 (ruling §0.2): names the unpriced model(s) in W -- `close`
    # prints them in its warning rather than just "some model was
    # unpriced".
    unpriced_models: set = set()
    for row in rows:
        # Architect's review of bbbc8f7 (R3, design note §2 formula): only
        # `source == "otel"` lines count -- a `transcript-backfill` line
        # whose `generated` falls inside the same window would otherwise
        # double-count alongside the live otel stream it was backfilled
        # to cover.
        if row.get("source") != "otel":
            continue
        if row.get("issue") != issue_id:
            continue
        if role is not None and row.get("role") != role:
            continue
        generated = row.get("generated")
        if since is not None and (generated is None or generated <= since):
            continue
        if until is not None and (generated is None or generated > until):
            continue
        for c in _TOKEN_COUNTERS:
            totals[c] += row.get(c, 0) or 0
        lines += 1
        rate = models.get(row.get("model"))
        if rate is None:
            any_unpriced = True
            unpriced_models.add(row.get("model"))
        else:
            raw_cost += _row_cost_usd(row, rate)

    result = dict(totals)
    if lines == 0:
        # Addendum 1: a present-but-empty-match file is "no evidence",
        # the same as a missing file entirely -- never a real 0.
        result["tokens"] = None
        result["cost_usd"] = None
    else:
        result["tokens"] = sum(totals.values())
        # 6dp, not `build_tokens_payload`'s 2dp: that function's rounding is a
        # UI-display convention (real usage sums to real dollars); this seam
        # feeds the calibration record, where a small-window sub-issue's own
        # cost can be a fraction of a cent, and 2dp would silently round it to
        # 0.0 -- indistinguishable from "no cost", which token_actuals must
        # never claim for a genuinely priced, non-empty window.
        result["cost_usd"] = None if any_unpriced else round(raw_cost, 6)
    result["lines"] = lines
    result["unpriced_models"] = sorted(unpriced_models)
    return result


def _parse_iso_any(value: str) -> datetime.datetime:
    """Real `datetime` parse of an ISO-8601 timestamp in either the
    otel receiver's `...Z` form or git's `%aI` `...+00:00` form -- unlike
    `token_actuals`'s lexical comparison (both its sides are always `...Z`
    in practice), `gate_cycle_actuals` compares git author dates against
    caller-supplied `since`/`until`, and the two sides are not guaranteed
    to share one literal suffix, so a real parse is used instead of a
    string comparison."""
    dt = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt


def gate_cycle_actuals(
    repo_root: Path, base: str, ref: str, assignee: str,
    same_stage_authors: List[str], since: Optional[str] = None,
    until: Optional[str] = None,
) -> Dict[str, Any]:
    """Design note §2/§6: one gate cycle is one maximal run of
    `assignee`'s commits in `ref`'s first-parent history, where a run is
    broken only by a commit whose author is neither `assignee` nor a
    same-stage sibling (`same_stage_authors`).

    Traverses `ref`'s full first-parent history rather than a literal
    `git log base..ref` range: `since`/`until` (the sub-issue's own
    creation-to-close window) already scope this precisely to the
    sub-issue's own commits, and a range exclusion would give nothing at
    all when those commits land directly on `base` itself, which is
    exactly what this loop's own commits do. `base` is accepted for CLI
    symmetry with `cairn close --base/--ref` and `loop-stats`, not used
    to exclude history here. The window is left-open on `since`, matching
    `token_actuals`'s own `(created_ts, close_ts]` boundary -- the
    sub-issue's own creation commit never counts as gate-cycle work.

    Zero commits by `assignee` in the window gives `gate_cycles: 0`.

    `last_commit_ts` (addendum 1, design note @ 85c5fd6 §2): the author
    date of `assignee`'s own chronologically LAST commit in the window,
    `None` with zero commits -- `cairn close`'s `actual.wall_clock` is
    measured against this, not `close_ts`, so a sub-issue closed long
    after its work finished doesn't count the idle gap.
    """
    repo_root = Path(repo_root)
    since_dt = _parse_iso_any(since) if since else None
    until_dt = _parse_iso_any(until) if until else None
    result = subprocess.run(
        ["git", "log", "--first-parent", "--reverse", "--format=%an%x1f%aI", ref],
        cwd=repo_root, capture_output=True, text=True, check=True,
    )
    allowed_siblings = set(same_stage_authors)
    gate_cycles = 0
    commits = 0
    in_run = False
    last_commit_ts: Optional[str] = None
    for line in result.stdout.splitlines():
        if not line:
            continue
        author, author_date = line.split("\x1f", 1)
        dt = _parse_iso_any(author_date)
        if since_dt is not None and dt <= since_dt:
            continue
        if until_dt is not None and dt > until_dt:
            continue
        if author == assignee:
            commits += 1
            last_commit_ts = author_date  # oldest-to-newest traversal -- last write wins
            if not in_run:
                gate_cycles += 1
                in_run = True
        elif author in allowed_siblings:
            continue  # same-stage sibling -- doesn't break the run
        else:
            in_run = False
    return {"gate_cycles": gate_cycles, "commits": commits, "last_commit_ts": last_commit_ts}
