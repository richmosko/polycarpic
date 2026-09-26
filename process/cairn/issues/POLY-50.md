---
id: POLY-50
title: Backfill attribution (grouped)
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P3
pr: null
created: 2026-09-25
updated: 2026-09-26
---

Grouped fix loop for `backfill_tokens.py` (user decision 2026-09-25). One PR closes every member; together they are the prerequisites for the first real backfill write on this repo (POLY-26 ruling §3).

**Members:** POLY-45, POLY-46.

**Carried here, not filed separately:**
- **milestone-window collision:** the POLY-26 dry-run (2026-09-25, 68c8dfa) printed `cairn: warning: milestone_windows dropped colliding milestone window(s) ['POLY-A', 'POLY-B']`. Both milestone files resolve to the same creation id/timestamp (bootstrapped in one commit), so every record that would match a milestone window falls back to `main`.

## Acceptance criteria

- [ ] POLY-45, POLY-46 acceptance criteria met and closed by this PR
- [ ] `worktree-*`/`HEAD` records resolve through the lead's main-dir branch timeline (ruling §1); dry run shows ≥ 95 % of resolved records on an issue
- [ ] A write excludes every record at/after the earliest otel day (`_otel_cutoff`) and stamps `generated` = cutoff (ruling §2)
- [ ] Milestones sharing a creation timestamp take their status-derived start; a still-`planned` one has no window and no warning; a true tie still drops + warns (ruling §3); tests use two milestones created in one commit
- [ ] A real (non-dry-run) backfill write on this repo attributes every written record to an issue or milestone; `main` only for records before the first milestone window (pre-tracker, PT-84)

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
