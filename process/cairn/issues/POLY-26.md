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
