# POLY-50 gate-1 ruling — backfill attribution: worktree timeline, otel cutoff, tied milestones

Architect, 2026-09-26. Scope: `scripts/cairn/backfill_tokens.py`, `cairn.milestone_windows` (tie handling only), their
tests. Parent rulings: POLY-26 `ruling.md` (M5–M7, §3), PT-84 (milestone windows), PT-89 (generated-stamp guard).
Nothing here touches `otel_receiver.py`, `.claude/settings.json`, or the hooks. The receiver inherits §3 for free.

## Measurements (2026-09-26, main checkout transcripts + live `process/cairn/metrics/token-usage.jsonl`)

| # | What | Command / predicate | Result |
|---|---|---|---|
| N1 | Main-dir records usable as a branch timeline | every record in `<slug>/**` with `timestamp` + `gitBranch`, branch not `worktree-*` / `HEAD` | 9253 entries from 2026-09-23T05:46:38Z; 50 branch switches |
| N2 | Main-dir records on `worktree-*` | same walk, branch `worktree-*` | 3139 (the lead itself sat in worktrees early on) — must be excluded from the timeline, else resolution returns `worktree-*` again |
| N3 | Timestamp shape | `len(timestamp)` over N1 | 12398/12398 are 24 chars (`YYYY-MM-DDTHH:MM:SS.mmmZ`) — plain string compare is sound |
| N4 | Unique in-scope `worktree-*`/`HEAD` records resolved via N1 | dedupe by requestId, bisect-right lookup | 5242 `worktree-*`: **5187 → an issue branch**, 55 → lead on `main`/`phase/*` (→ milestone) |
| N5 | otel lines | parse data file | 167 lines, all `otel`; `window_start` is **date-granular**, min `2026-09-24`; earliest `generated` 2026-09-24T06:21:13Z |
| N6 | Unique in-scope records vs cutoff `2026-09-24T00:00:00Z` | dedupe, split by timestamp | 6843 total: **974 before** (818 issue, 94 milestone, 62 pre-first-window), 5869 at/after |
| N7 | Records in neither source | `[cutoff, first otel generated)` | ≤ 945 — upper bound; how many otel actually saw is (unmeasured) |
| N8 | POLY-A / POLY-B creation | `git log --follow --diff-filter=A --format=%H %aI` per file | both `42c39fd` 2026-09-23T09:44:25-07:00 — a genuine one-commit creation, not a `--follow` false-merge |
| N9 | Status-derived start | `git log --follow --format=%aI -G '^status: *(in-progress\|paused\|done\|cancelled)' -- <file>`, last line | POLY-A → 2026-09-23T09:44:25-07:00 (created in-progress); POLY-B → no output (still `planned`) |

## (1) POLY-45 — worktree records resolve through the lead's branch timeline

Seam (all in `backfill_tokens.py`, module-level, pure except the first):
- `_lead_branch_timeline(transcript_dir: Path) -> List[Tuple[str, str]]` — `(timestamp, gitBranch)` from **every record type**
  in `transcript_dir.rglob("*.jsonl")` (main dir only, nested `subagents/` included, **never** a worktree sibling dir) carrying
  both fields, dropping branch `worktree-*` and `HEAD`. Sorted by `(timestamp, path, line)`; returns the pairs. Built once in
  `scan_transcripts`, passed down beside `milestone_windows_table`. Unparseable lines are skipped here (the timeline is
  a hint source, not a record under audit); `_process_file`'s own fail-loud contract is unchanged.
- `_branch_at(ts: str, timeline) -> Optional[str]` — the branch of the **last** entry with `entry_ts <= ts` (`bisect_right`);
  `None` before the first entry or on an empty timeline. Plain string compare (N3).
- `_process_record`: when `branch.startswith("worktree-") or branch == "HEAD"`, `branch = _branch_at(timestamp, timeline) or
  "main"`, then the existing `_bucket_for_branch` → milestone path runs unchanged. The record's own branch is used as-is
  otherwise (a sibling record already on `feature/POLY-n-*` keeps it).
- **Between loops** (lead on `main`, `phase/*`, `docs/*`): the resolved branch is not an issue branch → `main` → the
  milestone active at the record's timestamp. That is the correct answer: no issue loop was in flight (N4: 55 records).
- No staleness cap: the lead's branch persists until it changes; a teammate working while the lead idles is on that loop.
- `stats` gains `worktree_resolved` (int) and `worktree_unresolved` (before first timeline entry). stdout gains one line after
  line 2: `  worktree/HEAD records resolved via lead timeline: {r} ({u} before the first lead record)`.

## (2) POLY-46 — a timestamp cutoff at the earliest otel day; reader precedence rejected

- **Rejected: per-window precedence in the reader.** A backfill line aggregates one `(issue, role, model)` over its bucket's
  min..max record time; with the run spanning 2026-09-23..now (N6) most buckets straddle the first otel day, and the reader
  cannot split a bucket after the fact. Precedence would need date-granular backfill lines — a schema change for no gain.
- **Ruled: cutoff on the write path, derived from the data file, no flag.** `_otel_cutoff(out_path) -> Optional[str]` =
  `f"{min(window_start over source == 'otel')}T00:00:00Z"`, `None` when no otel line exists (a missing `window_start` on an
  otel line → `BackfillError` naming the line). Day-start because N5's `window_start` is date-granular; a later cutoff
  would double-count the first otel day.
- `scan_transcripts` takes `cutoff: Optional[str]`; `_process_record` drops a record with `timestamp >= cutoff` **after** dedupe
  (so `duplicates` stays comparable) into `stats["after_cutoff"]`. The timeline (1) is **not** cut — it is a lookup source.
- `--dry-run` applies the same cutoff (the dry run shows exactly what a write writes). stdout line:
  `otel cutoff: {cutoff} ({n} record(s) at/after it excluded)` or `otel cutoff: none (no otel lines)`.
- **Stamp:** when a cutoff applies, every backfill line's `generated` = the cutoff. PT-89's receiver guard reads the newest
  backfill `generated` as "backfill covered up to here"; stamping `now` would make the receiver drop in-memory groups the
  backfill never counted (up to one flush). With no cutoff, `generated` stays `now`.
- **Race guard:** `merge_and_write` re-derives `_otel_cutoff` under the lock; if it is non-`None` and earlier than the scan's
  cutoff (including scan `None`), raise `BackfillError("otel lines appeared before the backfill cutoff; re-run")`, write nothing.
- The ≤ 945-record hole (N7) is accepted: under-attributed, never double-counted. Assumes Claude Code's default **delta**
  temporality (no `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` in settings) — (unmeasured); under cumulative, a session
  spanning the cutoff would be counted whole by otel at first sight.

## (3) Tied milestone windows — status-derived start, tie groups only

In `cairn.milestone_windows`, **before** the collision check: for each group of ≥ 2 ids sharing one creation `start_iso`,
replace each member's start with its status-derived start (N9 command, last line, UTC-normalised via `_git_iso_to_utc_z`);
a member with no such commit (still `planned`) is **removed silently** — a planned milestone owning no window is correct, not
a collision. Re-sort, then the existing duplicate/tie check runs unchanged: a residual tie (two members both created
non-planned in one commit) still drops + warns (`strict=True` still raises). Non-tied milestones are untouched (no extra git
call; PT-84 semantics unchanged). Cost: one extra `git log` per tied file (2 here). On this repo: POLY-A owns
`[2026-09-23T16:44:25Z, ∞)`; POLY-B gains its window the day its file first says `in-progress`.

## (4) Acceptance-criteria effect

AC 3 amended in `POLY-50.md`: the 62 pre-first-window records (N6, the bootstrap before the milestone files were committed)
stay `main` per PT-84's pre-tracker answer; the engine is not bent to absorb them.

## (5) Tests qa writes red first — the mutation matrix is the review checklist

Fixtures: scrubbed header + usage records only. Milestone fixtures are real git repos with **distinct prose** per file (7341e2e).

| # | Test (file) | Kills mutation |
|---|---|---|
| 1 | `test_worktree_record_resolves_to_lead_issue_branch` (backfill) — lead `feature/POLY-7-x` at t0, sibling `worktree-arch` at t1 > t0 → bucket `POLY-7` | resolution removed |
| 2 | `test_head_record_resolves_via_timeline` | `HEAD` not in the predicate |
| 3 | `test_timeline_excludes_worktree_and_head_entries` — main-dir `worktree-x` entry at t1-ε does not shadow the lead's `feature/POLY-7` | timeline keeps `worktree-*`/`HEAD` |
| 4 | `test_timeline_ignores_sibling_dirs` — sibling `feature/POLY-9` record later than lead's POLY-7 does not redirect a `worktree-*` record | timeline built from all roots |
| 5 | `test_record_at_switch_instant_takes_new_branch` — equal timestamps | `bisect_left` / `<` |
| 6 | `test_between_loops_resolves_to_milestone` — lead on `main` → `milestone:<id>` | `or "main"` replaced by first-entry branch |
| 7 | `test_before_first_lead_record_is_unresolved` — `_branch_at` → `None`; `worktree_unresolved == 1` | fallback to `timeline[0]` |
| 8 | `test_own_issue_branch_is_not_rewritten` — sibling `feature/POLY-9` record stays `POLY-9` while lead is on POLY-7 | predicate widened to all sibling records |
| 9 | `test_cutoff_is_earliest_otel_day_start` — otel lines 09-25 and 09-24 → `2026-09-24T00:00:00Z` | `max`, or `generated` used |
| 10 | `test_cutoff_ignores_backfill_lines` | source filter dropped |
| 11 | `test_record_at_cutoff_is_excluded` — `timestamp == cutoff` excluded; one second earlier kept | `>` instead of `>=` |
| 12 | `test_no_otel_lines_means_no_cutoff` — every record written, `generated` = now | cutoff defaulting to now/epoch |
| 13 | `test_generated_is_stamped_to_cutoff` | stamp left at `now` |
| 14 | `test_dry_run_reports_cutoff_and_excluded_count` | dry-run skipping the cutoff |
| 15 | `test_write_refuses_when_otel_precedes_scan_cutoff` — monkeypatch an earlier otel line in before the locked re-read; file unchanged | re-check removed |
| 16 | `test_tied_planned_milestone_gets_no_window_and_no_warning` (cairn) — A in-progress + B planned in one commit → `[(T, A)]`, stderr empty | tie still drops+warns |
| 17 | `test_tied_milestone_window_starts_at_status_change` — B flips to in-progress in a later commit at T2 → `[(T, A), (T2, B)]` | first-commit date kept |
| 18 | `test_true_tie_still_drops_and_warns` — both created in-progress in one commit; `strict=True` raises | residual tie silently resolved by id |
| 19 | `test_untied_planned_milestone_keeps_creation_window` | status rule applied to all milestones |

**Must keep passing unchanged:** all existing tests in `test_backfill_tokens.py`, the milestone-window tests, and every
`test_otel_receiver*.py` (the receiver imports `backfill_tokens` and calls `milestone_windows`).

## Guard thresholds for the verdict

Post-green dry run from the main checkout: `worktree_resolved` ≥ 5000 and the issue share of resolved records ≥ 95 % (N4:
98.9 %); `otel cutoff: 2026-09-24T00:00:00Z`; no `milestone_windows dropped` warning on stderr; no `main` bucket except
the pre-first-window records. Receiver behaviour byte-identical outside `milestone_windows`' tie groups.
