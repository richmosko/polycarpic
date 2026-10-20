"""cairnlib.estimate — POLY-3 `cairn close` / `cairn estimate` (design
note §7): gate-cycle/token actuals close-out, the estimate calibration
report, and `loop-stats`.

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 20).
"""

import argparse
import collections
import datetime
import json
import re
import statistics
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from cairnlib.constants import CAIRN_DIR, _STAGE_ORDER
from cairnlib.errors import CairnError
from cairnlib.records import apply_patch, parse_frontmatter
from cairnlib.config import load_config, resolve_data_dir
from cairnlib.store import _dir_glob, find_record_path
from cairnlib.guards import _git_toplevel
from cairnlib.tokens import TOKEN_USAGE_REL, _read_token_usage_lines, load_prices
from cairnlib.actuals import _parse_iso_any, gate_cycle_actuals, token_actuals

__all__ = [
    "_append_calibration_record",
    "_at_ceiling",
    "_default_transcripts_dir",
    "_flush_receiver_and_wait",
    "_linked_worktree_main_checkout",
    "_normalize_iso_z",
    "_parent_flip",
    "_same_stage_sibling_assignees",
    "_sibling_floor",
    "_token_ceiling",
    "cmd_close",
    "cmd_estimate",
    "cmd_loop_stats",
]


# --------------------------------------------------------------------------
# POLY-3: `cairn close` / `cairn estimate` (design note §7)
# --------------------------------------------------------------------------


def _normalize_iso_z(value: str) -> str:
    """Any ISO-8601 timestamp (git's `+00:00` offset or the receiver's
    `Z`) -> the `%Y-%m-%dT%H:%M:%SZ` form `token-usage.jsonl`'s
    `generated` stamps use, so `token_actuals`'s lexical `since`/`until`
    comparison never mixes two suffix conventions for what is the same
    instant."""
    dt = _parse_iso_any(value).astimezone(datetime.timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _same_stage_sibling_assignees(data_dir: Path, issue_id: str, parent: str, stage: str, assignee: str) -> List[str]:
    """Other sub-issues under the same `parent` and `stage` -- their
    assignees are the "same-stage sibling" authors whose commits don't
    break `assignee`'s own gate-cycle run (design note §2)."""
    siblings: List[str] = []
    for p in _dir_glob(Path(data_dir) / "issues"):
        if p.stem == issue_id:
            continue
        try:
            fm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        except CairnError:
            continue
        if fm.get("parent") == parent and fm.get("stage") == stage:
            sib_assignee = fm.get("assignee")
            if sib_assignee and sib_assignee != assignee:
                siblings.append(sib_assignee)
    return siblings


def _flush_receiver_and_wait(repo_root: Path, usage_path: Path, timeout: float = 5.0) -> None:
    """Design note §2/§7: best-effort -- signals the running otel receiver
    to flush (`otel_receiver.py --flush-now`), then polls
    `token-usage.jsonl` for up to `timeout` seconds for its `generated`
    stamp to advance. Never raises: no running receiver, or a flush that
    doesn't land in time, degrades to reading whatever is already on disk
    -- the same never-block posture `token_actuals` already takes for a
    missing file entirely."""
    def _latest_generated() -> Optional[str]:
        if not usage_path.is_file():
            return None
        lines, _ = _read_token_usage_lines(usage_path)
        gens = [l.get("generated") for l in lines if l.get("generated")]
        return max(gens) if gens else None

    before = _latest_generated()
    receiver_script = CAIRN_DIR / "otel_receiver.py"
    try:
        subprocess.run(
            [sys.executable, str(receiver_script), "--flush-now", "--repo-root", str(repo_root)],
            cwd=repo_root, capture_output=True, text=True, timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError):
        return
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _latest_generated() != before:
            return
        time.sleep(0.2)


def _token_ceiling(
    usage_path: Path, at_sha: str, at_ts: str, max_gap_seconds: int,
) -> Tuple[str, Optional[str]]:
    """POLY-48 item 4 (POLY-47, gate-1 ruling process/cairn/reviews/POLY-48/ruling.md
    §1(b)): the TOKEN-side ceiling for a `--at <sha>` close. `at_ts`
    (the commit's own author time) almost never lines up with a flush
    boundary -- the flush actually carrying this stage's last tokens can
    land seconds to minutes after the commit, and the plain commit-time
    ceiling drops that whole interval's usage (POLY-41, measured 55 s).

    Returns `(to_ts, warning)`:
    - `to_ts` is the smallest `generated` stamp over lines with
      `source == "otel"` in `token-usage.jsonl` strictly after `at_ts` --
      a flush is a global event, not scoped to one issue/role, but a
      `transcript-backfill` line's `generated` is the backfill RUN time,
      not a flush (architect's review of d1f2e08, addendum 1 -- a
      backfill line landing inside the gap was previously mistaken for
      the flush and hid the real one) -- provided it lands within
      `max_gap_seconds` of `at_ts` (the receiver's own flush interval).
      That flush is never double-counted: the next same-assignee stage's
      floor reads this close's `window.to`, i.e. `to_ts` itself.
    - Otherwise `to_ts` falls back to `at_ts` (unchanged from before this
      fix), and `warning` is the stderr line `cmd_close` should print,
      naming the nearest otel flush actually found after `at_ts` (even
      one excluded for being too far away) or, when none exists at all,
      `at_ts` itself. `warning` is `None` when a flush was admitted.

    No special tip case: when `--at` names the branch's own tip, the
    caller's forced flush (`_flush_receiver_and_wait`) already ran first,
    so IT is the first flush after the commit and shows up here as an
    ordinary candidate.
    """
    at_dt = _parse_iso_any(at_ts)
    nearest_after: Optional[Tuple[datetime.datetime, str]] = None
    if usage_path.is_file():
        rows, _ = _read_token_usage_lines(usage_path)
        for row in rows:
            if row.get("source") != "otel":
                continue
            gen = row.get("generated")
            if not gen:
                continue
            gen_dt = _parse_iso_any(gen)
            if gen_dt > at_dt and (nearest_after is None or gen_dt < nearest_after[0]):
                nearest_after = (gen_dt, gen)
    if nearest_after is not None and (nearest_after[0] - at_dt).total_seconds() <= max_gap_seconds:
        return nearest_after[1], None
    last_flush = nearest_after[1] if nearest_after is not None else at_ts
    warning = (
        f"close: warning: no flush within {max_gap_seconds} s after --at {at_sha}; "
        f"tokens after {last_flush} unattributed"
    )
    return at_ts, warning


def _parent_flip(repo_root: Path, base: str, ref: str) -> Optional[str]:
    """Addendum 1 (design note @ 85c5fd6 §2): the author date of the
    OLDEST commit in `<base>..<ref>` -- `/start-feature`'s own "feature
    started" commit, the same default `loop-stats` uses for `since`.
    `None` when the range is empty (no divergence between `base` and
    `ref` -- e.g. `base` itself resolves to `ref`), which lets `from_ts`
    fall back to the sibling floor alone, or to no floor at all.
    """
    result = subprocess.run(
        ["git", "log", "--first-parent", "--reverse", "--format=%aI", f"{base}..{ref}"],
        cwd=repo_root, capture_output=True, text=True, check=True,
    )
    lines = [l for l in result.stdout.splitlines() if l]
    return lines[0] if lines else None


def _sibling_floor(data_dir: Path, parent: str, assignee: str, self_id: str, stage: Optional[str]) -> Optional[str]:
    """Addendum 1 + POLY-16 ruling (design note §2 -- Stage windows): the
    latest calibration `window.to` (last line per id) among closed
    sub-issues sharing this one's `parent` AND `assignee`, with a
    **different id** and a stage **no later** than `stage`
    (plan < execute < review) -- the floor that keeps a second
    same-(parent, assignee) sub-issue's actuals from re-counting the first
    one's already-closed window. Excluding `self_id` makes a re-close
    re-measure from the same floor instead of flooring at its own prior
    close; excluding later-stage siblings keeps a plan re-close from
    flooring at its own review's close. `None` when there is no such
    sibling yet."""
    cal_path = Path(data_dir) / "metrics" / "calibration.jsonl"
    if not cal_path.is_file():
        return None
    self_rank = _STAGE_ORDER.get(stage) if stage is not None else None
    # Last line per id wins -- a sibling's own re-close must not let its
    # earlier calibration line outvote its latest one.
    rows_by_id: Dict[str, Dict[str, Any]] = {}
    for line in cal_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        row_id = row.get("id")
        if row_id:
            rows_by_id[row_id] = row
    latest_dt: Optional[datetime.datetime] = None
    latest_str: Optional[str] = None
    for row_id, row in rows_by_id.items():
        if row_id == self_id:
            continue
        if row.get("parent") != parent or row.get("assignee") != assignee:
            continue
        sib_rank = _STAGE_ORDER.get(row.get("stage"))
        if self_rank is not None and sib_rank is not None and sib_rank > self_rank:
            continue  # a later-stage sibling never floors an earlier stage
        window_to = (row.get("window") or {}).get("to")
        if not window_to:
            continue
        dt = _parse_iso_any(window_to)
        if latest_dt is None or dt > latest_dt:
            latest_dt = dt
            latest_str = window_to
    return latest_str


def _at_ceiling(repo_root: Path, base: str, ref: str, at_arg: str) -> Optional[Tuple[str, str]]:
    """POLY-16 ruling (design note §2 -- Stage windows): resolves `--at
    <at_arg>` to a `(full_sha, author_ts)` pair, but only when the commit
    sits on `ref`'s first-parent history strictly AFTER the parent flip
    (the oldest commit in `base..ref`, the same commit `_parent_flip`
    would report). Returns `None` when `at_arg` doesn't resolve to a
    commit, isn't on that first-parent range at all, or IS the flip commit
    itself (at, not after) -- the caller turns `None` into an exit-1
    refusal rather than silently accepting an arbitrary commit as the
    ceiling."""
    resolved = subprocess.run(
        ["git", "rev-parse", "--verify", f"{at_arg}^{{commit}}"],
        cwd=repo_root, capture_output=True, text=True,
    )
    if resolved.returncode != 0:
        return None
    at_sha = resolved.stdout.strip()
    range_result = subprocess.run(
        ["git", "log", "--first-parent", "--reverse", "--format=%H%x1f%aI", f"{base}..{ref}"],
        cwd=repo_root, capture_output=True, text=True, check=True,
    )
    rows = [tuple(l.split("\x1f", 1)) for l in range_result.stdout.splitlines() if l]
    if not rows:
        return None
    shas = [sha for sha, _ in rows]
    if at_sha not in shas or at_sha == shas[0]:
        return None
    at_ts = next(date for sha, date in rows if sha == at_sha)
    return at_sha, _normalize_iso_z(at_ts)


def _append_calibration_record(data_dir: Path, record: Dict[str, Any]) -> None:
    import backfill_tokens  # sibling module; imported here so `cairn` stays import-light
    out_path = Path(data_dir) / "metrics" / "calibration.jsonl"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = out_path.parent / ".lock"
    backfill_tokens._acquire_lock(lock_path)
    try:
        existing = out_path.read_text(encoding="utf-8") if out_path.exists() else ""
        if existing and not existing.endswith("\n"):
            existing += "\n"
        backfill_tokens._atomic_write_text(out_path, existing + json.dumps(record) + "\n")
    finally:
        backfill_tokens._release_lock(lock_path)


def _linked_worktree_main_checkout(start: Path) -> Optional[Path]:
    """POLY-48 item 9 (`close` from a worktree, gate-1 ruling
    process/cairn/reviews/POLY-48/ruling.md §1(d)): `git rev-parse --git-dir` vs
    `--git-common-dir` is the one reliable test for "is `start` inside a
    LINKED git worktree" -- the two paths are identical in the main
    checkout and differ in a linked worktree, regardless of layout (never
    a `.git`-file-vs-directory guess, which a submodule can also produce).

    Returns the main checkout's root (the common dir's parent) when
    `start` is inside a linked worktree; `None` when it's the main
    checkout, or when git itself is unavailable/not a repo at all --
    `_git_toplevel`'s own check already covers that case with its own
    message.
    """
    def _rev_parse(flag: str) -> Optional[str]:
        try:
            out = subprocess.run(
                ["git", "rev-parse", flag], cwd=start, capture_output=True, text=True, check=True,
            ).stdout.strip()
        except (subprocess.CalledProcessError, OSError):
            return None
        return out or None

    git_dir = _rev_parse("--git-dir")
    common_dir = _rev_parse("--git-common-dir")
    if git_dir is None or common_dir is None:
        return None
    git_dir_path = (start / git_dir).resolve()
    common_dir_path = (start / common_dir).resolve()
    if git_dir_path == common_dir_path:
        return None  # the main checkout: git-dir IS the common dir
    return common_dir_path.parent


def cmd_close(args: argparse.Namespace) -> int:
    """`cairn close <ID>` (design note §7, §2, §3, §5): pulls actuals for
    a sub-issue's assignee from the OTel receiver and the commit log,
    writes `actual.*`/`ratio`/`status: done`/a `bloat` label through one
    `apply_patch`, and appends a calibration record. Never commits either
    file -- the caller commits the issue file by pathspec; the metrics
    branch is committed the usual way (WORKFLOW.md → Metrics branch).

    `--at <sha>` (POLY-16 ruling, design note §2 -- Stage windows) sets the
    ceiling: `close_ts` becomes `<sha>`'s own author time and `ref` becomes
    `<sha>`, so a close run late measures as if it had run at the gate.
    `close` on an already-`done` sub-issue is a re-close: it rewrites
    `actual.*`/`ratio`, adds or removes `bloat` to match the new
    evaluation, leaves `status: done`, and appends a fresh calibration
    line -- the last line per id is the record readers trust.

    POLY-48 item 9: refuses outright, before any flush or read (including
    `--dry-run`), when run from a linked git worktree -- a worktree has
    no `process/cairn/metrics/` mount (`ensure_metrics_worktree.py` is a
    no-op there), so it would otherwise silently write null actuals
    instead of ever reading the real token log.
    """
    main_checkout = _linked_worktree_main_checkout(Path.cwd())
    if main_checkout is not None:
        print(
            f"close: {args.id}: run from the main checkout ({main_checkout}) -- a worktree has no metrics "
            "mount; nothing written",
            file=sys.stderr,
        )
        return 2

    data_dir = resolve_data_dir(args)
    path = find_record_path(data_dir, args.id)
    if path is None:
        print(f"close: no such issue: {args.id}", file=sys.stderr)
        return 1
    fm, _ = parse_frontmatter(path.read_text(encoding="utf-8"))

    stage = fm.get("stage")
    parent = fm.get("parent")
    assignee = fm.get("assignee")
    missing = []
    if stage is None:
        missing.append("stage")
    if parent is None:
        missing.append("parent")
    if assignee is None:
        missing.append("assignee")
    if (
        fm.get("estimate.cost_usd") is None
        and fm.get("estimate.tokens") is None
        and fm.get("estimate.gate_cycles") is None
    ):
        missing.append("estimate.cost_usd, estimate.tokens, or estimate.gate_cycles")
    if missing:
        print(f"close: {args.id} is missing required field(s): {', '.join(missing)}", file=sys.stderr)
        return 1

    root = _git_toplevel(Path.cwd())
    if root is None:
        print("close: not inside a git repository", file=sys.stderr)
        return 2

    # POLY-16 ruling (design note §2 -- Stage windows): `--at <sha>` sets
    # the ceiling -- close_ts becomes <sha>'s author time and ref becomes
    # <sha>, so a close run late (as in POLY-3) measures as if it had run
    # at the gate. Validated against the ORIGINAL ref/base, before ref is
    # overwritten below.
    at_sha: Optional[str] = None
    at_ts: Optional[str] = None
    if args.at_sha:
        ceiling = _at_ceiling(root, args.base, args.ref, args.at_sha)
        if ceiling is None:
            print(
                f"close: --at {args.at_sha!r} is not on {args.ref}'s first-parent history after the parent "
                f"flip ({args.base}..{args.ref}) -- refusing an arbitrary ceiling",
                file=sys.stderr,
            )
            return 1
        at_sha, at_ts = ceiling
        args.ref = at_sha

    # Addendum 1 (design note @ 85c5fd6 §2): W's floor is
    # from_ts = max(parent flip, sibling floor) -- the sub-issue file's
    # own creation commit is no longer used at all (sub-issues are often
    # written after work has started; the assignee/role filters already
    # keep other agents' commits and tokens out of W). Neither candidate
    # is required: with no divergence from `base` and no closed sibling,
    # from_ts is `None` -- no floor at all, only `close_ts` bounds W.
    parent_flip = _parent_flip(root, args.base, args.ref)
    sibling_floor = _sibling_floor(data_dir, parent, assignee, args.id, stage)
    floor_candidates = [(v, _parse_iso_any(v)) for v in (parent_flip, sibling_floor) if v]
    if floor_candidates:
        from_ts = _normalize_iso_z(max(floor_candidates, key=lambda pair: pair[1])[0])
    else:
        # Architect's review of bbbc8f7 (R2, note @ c195c37): a bounded
        # window is mandatory once `gate_cycle_actuals` walks `ref`'s full
        # history rather than a `base..ref` range -- an undefined floor
        # must refuse, not silently read the assignee's whole-repo/
        # whole-file history as if it were all this sub-issue's own work.
        print(
            f"close: {args.id}'s window has no floor -- {args.base}..{args.ref} is empty (no feature-branch "
            f"divergence) and no closed sibling exists for (parent={parent}, assignee={assignee}); "
            "refusing an unbounded window",
            file=sys.stderr,
        )
        return 1

    usage_path = data_dir / TOKEN_USAGE_REL
    if not args.no_flush and not args.dry_run:
        _flush_receiver_and_wait(root, usage_path)

    # POLY-16 ruling: `--at` pins close_ts to the ceiling commit's own
    # author time; the default ceiling is real wall-clock now(). Commits
    # and wall-clock (gate_cycle_actuals below) stay bounded by close_ts,
    # unchanged (POLY-48 item 4, gate-1 ruling
    # process/cairn/reviews/POLY-48/ruling.md §1(b)) -- only the TOKEN ceiling differs.
    close_ts = at_ts if at_sha is not None else datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # POLY-34 (ruling §0.2): prices loaded once here (not inside
    # token_actuals) so `prices_retrieved` can be stamped on the
    # calibration record from the exact table that priced this close.
    prices = load_prices()

    # POLY-48 item 4 (POLY-47): with `--at`, admit the first flush after
    # the ceiling commit (within one flush interval) as the TOKEN
    # window's upper bound, rather than the commit's own timestamp --
    # see `_token_ceiling`. Without `--at`, close_ts is already real
    # wall-clock now() and the forced flush above already ran
    # synchronously, so there is no ceiling to admit.
    token_until_ts = close_ts
    if at_sha is not None:
        import otel_receiver  # sibling module; imported here so cairn stays import-light (mirrors _append_calibration_record's backfill_tokens import) -- safe despite otel_receiver itself importing cairn, since by now cairn is already fully loaded
        token_until_ts, ceiling_warning = _token_ceiling(
            usage_path, at_sha, close_ts, otel_receiver.DEFAULT_FLUSH_INTERVAL_SECONDS,
        )
        if ceiling_warning is not None:
            print(ceiling_warning, file=sys.stderr)

    token_result = token_actuals(data_dir, parent, role=assignee, since=from_ts, until=token_until_ts, prices=prices)
    if token_result["tokens"] is None:
        if usage_path.is_file():
            print(
                f"close: warning: no matching {usage_path} line for (parent={parent}, role={assignee}, window) "
                "-- actual.tokens: null",
                file=sys.stderr,
            )
        else:
            print(f"close: warning: {usage_path} not found -- actual.tokens: null", file=sys.stderr)
    if token_result["unpriced_models"]:
        print(
            f"close: warning: unpriced model(s) {token_result['unpriced_models']} in window "
            "-- actual.cost_usd: null",
            file=sys.stderr,
        )

    same_stage_authors = _same_stage_sibling_assignees(data_dir, args.id, parent, stage, assignee)
    gate_result = gate_cycle_actuals(root, args.base, args.ref, assignee, same_stage_authors, since=from_ts, until=close_ts)
    if gate_result["commits"] == 0:
        print(f"close: warning: zero commits by {assignee} in window -- actual.gate_cycles: 0", file=sys.stderr)

    # Addendum 1: wall_clock is measured against the assignee's own last
    # commit in W, not close_ts -- a sub-issue closed long after its work
    # finished (POLY-11 closes only once `cairn close` exists) must not
    # count the idle gap. `None` with zero commits, or no floor to
    # measure from.
    last_ts = gate_result.get("last_commit_ts")
    wall_clock: Optional[int] = None
    if last_ts is not None and from_ts is not None:
        wall_clock = round((_parse_iso_any(last_ts) - _parse_iso_any(from_ts)).total_seconds() / 60)

    estimate_cost_usd_raw = fm.get("estimate.cost_usd")
    estimate_cost_val: Optional[float] = float(estimate_cost_usd_raw) if estimate_cost_usd_raw is not None else None
    estimate_tokens = fm.get("estimate.tokens")
    estimate_gate_cycles = fm.get("estimate.gate_cycles")

    actual_cost_val = token_result["cost_usd"]

    # POLY-34 (ruling §0.3): `ratio` is now the COST ratio; the token
    # ratio is kept in the calibration record only, as `ratio_tokens`,
    # for continuity -- nothing reads it.
    ratio_val: Optional[float] = None
    if actual_cost_val is not None and estimate_cost_val:
        ratio_val = actual_cost_val / estimate_cost_val
    ratio_tokens_val: Optional[float] = None
    if token_result["tokens"] is not None and estimate_tokens:
        ratio_tokens_val = token_result["tokens"] / estimate_tokens

    config = load_config(data_dir)
    bloat_ratio_raw = (config.get("estimation") or {}).get("bloat_ratio")
    bloat_ratio: Optional[float] = None
    if bloat_ratio_raw is not None:
        try:
            bloat_ratio = float(bloat_ratio_raw)
        except (TypeError, ValueError):
            bloat_ratio = None
    else:
        print("close: bloat: cost threshold unset (estimation.bloat_ratio) — skipped", file=sys.stderr)

    gate_bloat = estimate_gate_cycles is not None and gate_result["gate_cycles"] > estimate_gate_cycles
    cost_bloat = bloat_ratio is not None and ratio_val is not None and ratio_val > bloat_ratio
    bloat_reasons = []
    if gate_bloat:
        bloat_reasons.append("gate_cycles")
    if cost_bloat:
        bloat_reasons.append("cost")
    if gate_bloat or cost_bloat:
        calibration_bloat: Optional[bool] = True
    elif bloat_ratio_raw is not None:
        calibration_bloat = False
    else:
        calibration_bloat = None  # not evaluated: threshold unset and no gate overrun

    # POLY-34 (ruling §0.3): close always writes actual.cost_usd/
    # actual.tokens/actual.wall_clock as a value or null -- a stale value
    # from an earlier close must not survive a re-close that no longer
    # computes one. `ratio` is the one exception: it is only written when
    # a value now exists OR the file already carried one to clear (a
    # sub-issue that was never closed with a cost estimate must not grow
    # a `ratio: null` line it never had).
    patch: Dict[str, Any] = {
        "status": "done",
        "actual.gate_cycles": gate_result["gate_cycles"],
        "actual.wall_clock": wall_clock,
        "actual.tokens": token_result["tokens"],
        "actual.cost_usd": (f"{actual_cost_val:.4f}" if actual_cost_val is not None else None),
    }
    if ratio_val is not None:
        patch["ratio"] = f"{ratio_val:.2f}"
    elif fm.get("ratio") is not None:
        patch["ratio"] = None
    # POLY-16 ruling: a re-close adds OR REMOVES the `bloat` label to match
    # the new evaluation -- a revised estimate (or a corrected window) that
    # no longer overruns must not leave the label stuck from an earlier close.
    labels = list(fm.get("labels") or [])
    if bloat_reasons and "bloat" not in labels:
        labels.append("bloat")
        patch["labels"] = labels
    elif not bloat_reasons and "bloat" in labels:
        labels = [l for l in labels if l != "bloat"]
        patch["labels"] = labels

    ref_sha = subprocess.run(
        ["git", "rev-parse", args.ref], cwd=root, capture_output=True, text=True,
    ).stdout.strip() or None

    record = {
        "schema": 2, "closed": close_ts, "id": args.id, "parent": parent,
        "stage": stage, "assignee": assignee, "labels": labels,
        "milestone": fm.get("milestone"),
        "estimate": {"cost_usd": estimate_cost_val, "tokens": estimate_tokens, "gate_cycles": estimate_gate_cycles},
        "actual": {
            "tokens": token_result["tokens"], "gate_cycles": gate_result["gate_cycles"],
            "wall_clock": wall_clock, "input": token_result["input"],
            "cache_write": token_result["cache_write"], "cache_read": token_result["cache_read"],
            "output": token_result["output"], "cost_usd": actual_cost_val,
        },
        "ratio": ratio_val, "ratio_tokens": ratio_tokens_val, "prices_retrieved": prices.get("retrieved"),
        "bloat": calibration_bloat, "bloat_reasons": bloat_reasons,
        # POLY-48 item 4: window.to is the admitted TOKEN ceiling
        # (token_until_ts), not the commit-time close_ts -- the next
        # same-assignee stage's floor reads this value (_sibling_floor),
        # so the admitted flush is never counted twice.
        "window": {"from": from_ts, "to": token_until_ts, "at": at_sha},
        "base": args.base, "ref_sha": ref_sha,
    }

    print(
        f"close {args.id}: cost={patch['actual.cost_usd']} tokens={token_result['tokens']} "
        f"gate_cycles={gate_result['gate_cycles']} wall_clock={wall_clock}m "
        f"ratio={patch.get('ratio')} bloat={bloat_reasons or 'no'}"
    )
    if args.dry_run:
        print("close: --dry-run -- nothing written")
        return 0

    apply_patch(path, patch)
    _append_calibration_record(data_dir, record)
    return 0


def cmd_estimate(args: argparse.Namespace) -> int:
    """`cairn estimate <ID>` (design note §4): prints the closest
    reference classes (same stage + assignee, then same stage + shared
    labels) with their actuals, to seed a new estimate. Reads only the
    calibration records -- never the token log or git -- so it is fast
    and deterministic. Never writes.
    """
    data_dir = resolve_data_dir(args)
    path = find_record_path(data_dir, args.id)
    if path is None:
        print(f"estimate: no such issue: {args.id}", file=sys.stderr)
        return 1
    fm, _ = parse_frontmatter(path.read_text(encoding="utf-8"))
    stage = fm.get("stage")
    parent = fm.get("parent")
    if stage is None or parent is None:
        print(f"estimate: {args.id} has no stage/parent set -- both are required to query reference classes", file=sys.stderr)
        return 1
    assignee = fm.get("assignee")
    labels = set(fm.get("labels") or [])

    cal_path = Path(data_dir) / "metrics" / "calibration.jsonl"
    rows_by_id: Dict[str, Dict[str, Any]] = {}
    if cal_path.is_file():
        for line in cal_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("id") == args.id:
                continue  # self-exclusion
            rows_by_id[row["id"]] = row  # last line per id wins

    tier_a = sorted(
        (r for r in rows_by_id.values() if r.get("stage") == stage and r.get("assignee") == assignee),
        key=lambda r: r.get("closed") or "", reverse=True,
    )[: args.limit]
    tier_b = sorted(
        (
            r for r in rows_by_id.values()
            if r.get("stage") == stage and r.get("assignee") != assignee
            and (set(r.get("labels") or []) & labels)
        ),
        key=lambda r: (len(set(r.get("labels") or []) & labels), r.get("closed") or ""), reverse=True,
    )[: args.limit]

    if not tier_a and not tier_b:
        print("no closed reference classes yet — hand-estimate")
        return 0

    if args.json:
        print(json.dumps({"tier_a": tier_a, "tier_b": tier_b}, indent=1, default=str))
        return 0

    out = [f"reference classes for {args.id} ({stage} / {assignee} / {sorted(labels)})"]
    suggestion = None
    for tier_name, tier_desc, rows in (("A", "same stage + assignee", tier_a), ("B", "same stage, shared labels", tier_b)):
        if not rows:
            continue
        out.append(f"tier {tier_name} — {tier_desc} ({len(rows)})")
        # POLY-34 (ruling §0.4): cost columns lead; tokens is a printed
        # secondary (`act.tok`), never an estimate/median input.
        out.append("  id       closed      est.$    act.$     ratio  est.gc  act.gc  wall  act.tok   bloat")
        for r in rows:
            est, act = r.get("estimate") or {}, r.get("actual") or {}

            def _cell(v: Any) -> str:
                return "null" if v is None else str(v)

            # A schema-1 row's stored `ratio` is the OLD token ratio --
            # not comparable to a schema-2 cost ratio, so it prints as a
            # dash rather than a misleading number.
            ratio_cell = "-" if r.get("schema") != 2 else _cell(r.get("ratio"))
            out.append(
                f"  {r.get('id', ''):<8} {str(r.get('closed') or '')[:10]:<11} "
                f"{_cell(est.get('cost_usd')):<8} {_cell(act.get('cost_usd')):<9} "
                f"{ratio_cell:<6} {_cell(est.get('gate_cycles')):<7} "
                f"{_cell(act.get('gate_cycles')):<7} {_cell(act.get('wall_clock')):<5} "
                f"{_cell(act.get('tokens')):<9} "
                f"{'yes' if r.get('bloat') else 'no'}"
            )
        # POLY-34 (architect verdict R1, @ 6a6df12; §9.1 item 9 rewritten
        # @ 0a0b1f7): only a null `actual.cost_usd` is excluded from the
        # cost median (an unpriced model, or a schema-1 row with no cost
        # at all) -- the same "no evidence must never enter a median"
        # rule the token median already followed (addendum 1, design
        # note @ 85c5fd6 §2). A schema-1 row's non-null `cost_usd` STILL
        # COUNTS: it came from the same `token_actuals` pricing as a
        # schema-2 row's -- only its `ratio` (the token ratio) is
        # incomparable, which is why that column prints a dash instead.
        cost_values = [
            r["actual"]["cost_usd"] for r in rows
            if r["actual"].get("cost_usd") is not None
        ]
        cost_median = round(statistics.median(cost_values), 2) if cost_values else None
        gc_median = int(statistics.median(r["actual"]["gate_cycles"] for r in rows))
        wall_values = [r["actual"]["wall_clock"] for r in rows if r["actual"].get("wall_clock") is not None]
        wall_median = int(statistics.median(wall_values)) if wall_values else None
        token_values = [r["actual"]["tokens"] for r in rows if r["actual"].get("tokens") is not None]
        tok_median = int(statistics.median(token_values)) if token_values else None
        out.append(
            f"  median actual: cost {'$' + format(cost_median, '.2f') if cost_median is not None else 'n/a'} · "
            f"gate_cycles {gc_median} · wall {wall_median if wall_median is not None else 'n/a'}m · "
            f"tokens {tok_median if tok_median is not None else 'n/a'}"
        )
        if suggestion is None:
            suggestion = (cost_median, gc_median, tier_name)

    if suggestion is not None:
        cost, gc, tier_name = suggestion
        if cost is not None:
            out.append(f"suggested: estimate.cost_usd={cost:.2f} estimate.gate_cycles={gc}   (tier {tier_name} median)")
        else:
            out.append(f"suggested: estimate.gate_cycles={gc}   (tier {tier_name} median; no non-null cost actuals)")
    print("\n".join(out))
    return 0


def cmd_loop_stats(args: argparse.Namespace) -> int:
    import loop_stats  # sibling module; imported here so `cairn` stays import-light
    data_dir = resolve_data_dir(args)
    root = _git_toplevel(Path.cwd()) or data_dir.resolve().parent.parent
    tdir = Path(args.transcripts_dir) if args.transcripts_dir else _default_transcripts_dir(root)
    since = loop_stats.parse_ts(args.since) if args.since else None
    until = loop_stats.parse_ts(args.until) if args.until else None
    try:
        card = loop_stats.scorecard(root, data_dir, args.id, base=args.base, since=since, until=until, transcripts_dir=tdir)
    except subprocess.CalledProcessError as e:
        print(f"error: git failed: {e.stderr.strip() if e.stderr else e}", file=sys.stderr)
        return 1
    if args.steps:
        out = Path(args.steps)
        s, u = loop_stats.parse_ts(card["since"]), loop_stats.parse_ts(card["until"])
        seen: Dict[str, int] = {}
        for p, role in loop_stats.transcript_roles(tdir).items():
            steps, _ = loop_stats.audit_agent(p, s, u, lead=(role == "team-lead"))
            if not steps:
                continue
            seen[role] = seen.get(role, 0) + 1
            name = role if seen[role] == 1 else f"{role}-{p.stem[:8]}"
            loop_stats.write_steps(out, name, steps, card["since"][:16], card["until"][:16])
            if role == "team-lead":
                rows, _ = loop_stats.lead_inbound(p, s, u)
                loop_stats.write_lead_inbound(out, rows)
        print(f"steps written to {out}", file=sys.stderr)
    if args.json:
        card = dict(card)
        card["per_agent"] = {k: {kk: (dict(vv) if isinstance(vv, collections.Counter) else vv) for kk, vv in v.items()} for k, v in card["per_agent"].items()}
        print(json.dumps(card, indent=1, default=str))
    else:
        print(loop_stats.format_scorecard(card), end="")
    return 0


def _default_transcripts_dir(repo_root: Path) -> Path:
    return Path.home() / ".claude" / "projects" / re.sub(r"[/_.]", "-", str(Path(repo_root).resolve()))


