---
id: POLY-50
title: Backfill attribution (grouped)
status: in-review
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P3
pr: https://github.com/richmosko/polycarpic/pull/23
created: 2026-09-25
updated: 2026-09-26
---

Grouped fix loop for `backfill_tokens.py` (user decision 2026-09-25). One PR closes every member; together they are the prerequisites for the first real backfill write on this repo (POLY-26 ruling §3).

**Members:** POLY-45, POLY-46.

**Carried here, not filed separately:**
- **milestone-window collision:** the POLY-26 dry-run (2026-09-25, 68c8dfa) printed `cairn: warning: milestone_windows dropped colliding milestone window(s) ['POLY-A', 'POLY-B']`. Both milestone files resolve to the same creation id/timestamp (bootstrapped in one commit), so every record that would match a milestone window falls back to `main`.

## Acceptance criteria

- [x] POLY-45, POLY-46 acceptance criteria met and closed by this PR
- [x] `worktree-*`/`HEAD` records resolve through the lead's main-dir branch timeline (ruling §1); dry run shows ≥ 95 % of resolved records on an issue
- [x] A write excludes every record at/after the earliest otel day (`_otel_cutoff`) and stamps `generated` = cutoff (ruling §2)
- [x] Milestones sharing a creation timestamp take their status-derived start; a still-`planned` one has no window and no warning; a true tie still drops + warns (ruling §3); tests use two milestones created in one commit
- [x] A real (non-dry-run) backfill write on this repo attributes every written record to an issue or milestone; `main` only for records before the first milestone window (pre-tracker, PT-84)

## Comments

### @team-lead — 2026-09-25

Grouped 2026-09-25 from the POLY-26 loop's follow-ups; spec is in the body above.

### @team-lead — 2026-09-26

Feature started. Branch: `feature/poly-50-backfill-attribution`.

### @architect — 2026-09-26

Gate-1 ruling: `process/reviews/POLY-50/ruling.md` (measurements N1–N9, seams, 19-test mutation matrix = review checklist, verdict guard thresholds).

- POLY-45: `_lead_branch_timeline(transcript_dir)` + `_branch_at(ts, timeline)`; `worktree-*`/`HEAD` records take the lead's main-checkout branch at their timestamp; between loops → milestone. Measured 5187/5242 resolve to an issue.
- POLY-46: `_otel_cutoff(out_path)` = earliest otel `window_start` day start; records at/after excluded (dry run too); `generated` stamped to the cutoff; locked re-check refuses on a race. Reader precedence rejected (buckets straddle the cutoff). Delta temporality assumed (unmeasured).
- Collision: tie groups in `cairn.milestone_windows` take the status-derived start; still-`planned` members get no window, silently; residual true tie keeps drop + warn.
- ACs amended in place (AC 3: 62 pre-first-window records stay `main`).

### @architect — 2026-09-26

Gate-4 verdict — **pass** @ 0566102 (build c5cfc8b + kwarg rename). Checklist: `process/reviews/POLY-50/ruling.md` §5.

| Axis | Result | Evidence |
|---|---|---|
| Full suite (`run_tests.py --gate verdict`) | 1860 tests OK, 4 skipped | 0566102 |
| Mutation matrix §5 (19 tests, 20 mutations incl. the judgment call) | 20/20 killed; each ruled test present and green | 0566102 |
| §1 worktree timeline, ≥ 95 % issue share | written slice: 535 resolved, 98.7 % issue; full population 5418, 98.9 % | dry run + write @ 0566102 |
| §2 otel cutoff + stamp | cutoff 2026-09-24T00:00:00Z, 6025 records excluded; all 13 backfill lines `generated` = cutoff; backfill max `window_end` 2026-09-23 < otel min `window_start` 2026-09-24 — no overlap | real write @ 0566102 |
| §3 tied milestones | no `milestone_windows dropped` warning; 4 `milestone:POLY-A` lines, no POLY-B | real write @ 0566102 |
| AC 5 real write | 13 backfill lines: 8 issue, 4 milestone, 1 `main` = 62 records, 2026-09-23 (exactly N6's pre-first-window count); 171 otel lines preserved | real write @ 0566102 |
| Receiver untouched | `otel_receiver.py` not in the diff; receiver tests green | 0566102 |

**Judgment call ruled:** endorsed. A tied member with no status-transition commit that is *not* currently `planned` stays on drop + warn. §3 only licensed silent removal for a still-planned milestone; anything else (a false-merge, a quoted/non-enum `status:` the `-G` regex misses) is an ambiguity, and the ruled direction is loud under-attribution. Mutation 20 (`planned` check → `True`) is killed by the existing collision tests.

**Minor, non-gating:** (a) the ruling's `worktree_resolved ≥ 5000` threshold was my error — §2 applies the cutoff before §1's resolution, so the counter covers only the written slice (535). The ratio criterion was measured on both slices instead. (b) `_truncate_fractional_seconds` in the cutoff compare is a sound addition, but no test kills its removal (it matters for a record within 1 s of the cutoff). (c) `_branch_at` rebuilds the timestamp list on every call; 0.9 s for the full run, so no action now.

### @team-lead — 2026-09-26

PR opened: https://github.com/richmosko/polycarpic/pull/23. Awaiting Validate.
