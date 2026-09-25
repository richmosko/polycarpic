---
id: POLY-26
title: backfill_tokens.py scans only the main project slug; backfilled teammate lines are unattributed
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P3
pr: null
created: 2026-09-24
updated: 2026-09-25
---


## Comments

### @team-lead — 2026-09-24

From the POLY-10 gate-1 ruling (architect, telemetry-attribution.md @ 3d83a20 §c): POLY-10 adds `_transcript_path_for` to otel_receiver.py so live lines resolve teammates via the `<slug>--claude-worktrees-*` sibling dirs, but `backfill_tokens.py` still scans only the main slug dir, so a backfill run leaves teammate lines as `subagent-unattributed`. Move the resolver into backfill_tokens (the shared module the receiver already imports from) and use it in the backfill scan, with a fixture test; then re-run the backfill on this repo.

### @team-lead — 2026-09-25

Feature started. Branch: `feature/poly-26-backfill-sibling-scan`.

Lead's estimate at start (calibration record): ~45 min wall clock, ~10 commits, 1 gate cycle, ~$25 team cost. Reference: POLY-10 (same telemetry-attribution area) took 62 min against a 50-min estimate.

Scope note for the gate-1 ruling: `process/cairn/metrics/token-usage.jsonl` today holds 108 lines, all `source: otel`; 26 are `subagent-unattributed` (POLY-3 ×7, POLY-10 ×9, POLY-16 ×8, main ×2). `merge_and_write` replaces only its own `backfill` source lines, so a re-run adds attributed `backfill` lines next to those `otel` lines rather than repairing them — the ruling needs to say what "re-run the backfill on this repo" means for the pre-POLY-10 otel lines (leave, or a one-off re-attribution). Sibling transcript dirs present locally: 22, holding 14 `.jsonl` files against 8 in the main slug dir.

### @architect — 2026-09-25

Gate-1 ruling: scripts/cairn/design/backfill-sibling-scan.md (this commit). Resolver + new `_worktree_sibling_dirs` move into backfill_tokens.py (glob-escaped anchor); receiver keeps no copy. scan_transcripts roots = main dir + anchored siblings; CLI adds an 'of which k under m worktree sibling dir(s)' line. Scope: no write to token-usage.jsonl this loop — a write overlaps all 112 otel lines and /api/tokens sums every source (double-count); token_actuals reads otel only. 'Re-run' = --dry-run from the main checkout, evidence recorded here. Pre-POLY-10 otel lines left (TRACKER general rule). Measured: 93% of teammate records carry worktree-<name> branches → bucket to milestone, not issue; follow-ups POLY-45 (issue attribution), POLY-46 (write-path double-count guard). Sub-issues POLY-41..44. Tests: 7 red in BackfillWorktreeSiblingScanTests; all existing backfill + otel_receiver tests unchanged.

### @team-lead — 2026-09-25

Gate-1 ruling accepted at 2f245a3 (`scripts/cairn/design/backfill-sibling-scan.md`, 2e1b462). Scope per §3: no write to `token-usage.jsonl` this loop; AC4 "re-run" = `--dry-run` from the main checkout; follow-ups POLY-45 (issue attribution on worktree branches) and POLY-46 (write-path double-count guard). POLY-41 closed at the gate without `--at`: the ceiling at 2f245a3 (19:16:20Z) excluded the receiver flush at 19:17:15Z that carried the plan-stage usage ($0.04 vs $1.91) — filed as POLY-47.

### @team-lead — 2026-09-25

AC4 (§3 acceptance) — `backfill_tokens.py --dry-run` from the main checkout at 68c8dfa:

```
scanned 38 transcript file(s) under ~/.claude/projects/-Users-mosko-Projects-polycarpic
  of which 30 under 25 worktree sibling dir(s) -Users-mosko-Projects-polycarpic--claude-worktrees-*
in-scope assistant/usage records: 7309 (4016 unique, 3293 duplicate)
window: 2026-09-23 .. 2026-09-25 · buckets: 28 · nothing written
```

Role set across buckets: architect, implementation-lead, qa-engineer, team-lead, claude (192 records with agentSetting `claude`, the catch-all agent, kept verbatim by design). No `subagent-unattributed` bucket. m = 25 = the live sibling-dir count; k = 30 > 0. Sibling teammate lines carry their role (POLY-45 still puts most of them under the milestone bucket, as ruled).

Side finding for the backfill group: stderr `cairn: warning: milestone_windows dropped colliding milestone window(s) ['POLY-A', 'POLY-B']` — both milestone files resolve to the same creation id/timestamp, so every record that would have matched a milestone window falls back to `main` instead of `milestone:POLY-A`. Not this loop's scope; to be tracked with POLY-45/46.

qa bubble-up during the red gate: `test_otel_receiver_watchdog_attribution.WatchdogRecreatesAfterAbsentBoundTests.test_watchdog_recreates_after_absent_bound` flaked once under the 8-worker full run (0.5 s recreate bound missed), clean on 4 reruns. Timing-sensitivity class; to be tracked with the receiver group.
### @architect — 2026-09-25

Verdict (POLY-44) on green 68c8dfa, against scripts/cairn/design/backfill-sibling-scan.md: **PASS**.

| Axis | Result | Evidence |
|---|---|---|
| §1 resolver moved, one copy | pass | 68c8dfa: suffix/cache/`_transcript_path_for` + `_worktree_sibling_dirs` in backfill_tokens.py; receiver defines none, both call sites use `backfill_tokens._transcript_path_for` |
| §1 receiver byte-identical | pass | same lookup order + anchor; only delta is `glob.escape`, a no-op for a slug without `[*?` (ruled) |
| §2 roots + anchor + dedupe | pass | `roots = [dir] + _worktree_sibling_dirs(dir)`, set-union of rglob; seen_keys run-global; tests 2–4 |
| §2 stdout | pass | line 1 unchanged; line 2 prints counts + `<name>--claude-worktrees-*` only; no sibling path |
| §3 token-usage.jsonl untouched | pass | 2f245a3..68c8dfa touches no metrics path |
| §3 TRACKER sentence | pass | rewritten, names POLY-45 |
| §4 tests | pass | 7 new tests at 5872a43 unchanged in green; existing tests 0 deletions; 5 modules, 137 tests OK (unittest, this worktree) |

No debt findings. Note: the new `Path.is_relative_to` needs Python ≥ 3.9 (local 3.14).

### @team-lead — 2026-09-25

Architect verdict PASS accepted (5ad725f on green 68c8dfa). POLY-44 closed at the verdict without `--at` (POLY-47 again: ceiling at 3120e92 read $0.21, without it $0.49). Guard-push design gap surfaced by the review push: `guard-push` scans every same-assignee commit since merge-base, so the second sub-issue an agent holds on one branch trips on the first one's files; POLY-44 declared the union as the workaround. To be tracked in the cairn-engine umbrella. Sending qa the verdict run at tip 3120e92.

### @qa-engineer — 2026-09-25

Verdict run at 9e2fbf2 (feature tip, only tracker commits since green 68c8dfa): PASS.

- `run_tests.py --gate verdict`: 1772 tests, 103 files, 8 workers, 27.2s -- OK (skipped=4).
- JS suite (46 files, excludes token-chart-logic.test.js per the CI exclusion, POLY-8): 432 tests -- all pass.
- Flushed the receiver from the main checkout (otel_receiver.py --flush-now, exit 0) per the lead's instruction, before this comment.
- BackfillWorktreeSiblingScanTests (7 tests, test_backfill_tokens.py) all green: sibling scan attributes teammate lines, near-neighbour <slug>-old dirs never scanned, nested subagents/ transcripts under a sibling scanned, cross-root duplicate requestId dedupes once, --dry-run reports sibling file/dir counts, _transcript_path_for/_worktree_sibling_dirs live only in backfill_tokens.py (not hasattr(otel_receiver, "_transcript_path_for") holds), glob metacharacters in a slug matched literally.
- No regression: every pre-existing test in test_backfill_tokens.py (43), test_otel_receiver_watchdog_attribution.py, test_otel_receiver.py, test_otel_receiver_hardening.py, test_otel_receiver_self_stop.py still green.
