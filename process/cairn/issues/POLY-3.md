---
id: POLY-3
title: Effort estimation loop in cairn (tokens + gate cycles)
status: todo
milestone: POLY-A
parent: null
blocked_by: [POLY-2]
assignee: null
labels: [workflow, cairn]
priority: P2
pr: null
created: 2026-09-23
updated: 2026-09-23
---


Kickoff decision: `docs/project_kickoff.md` § 2.12. Effort is estimated in
**tokens** (cost) and **gate cycles** (bloat; one red→green pass or one review
round); wall-clock is recorded but secondary; human minutes never appear. Each
issue is decomposed into cairn sub-issues, one per agent, tagged with stage
(plan / execute / review), owned paths (POLY-2), dependencies, and an estimate.
At close, actuals are pulled from the OTel token telemetry
(`scripts/cairn/otel_receiver.py`) and the per-agent commit log (POLY-1), the
actual/estimate ratio is written onto the sub-issue, and a calibration record
is appended. Closed sub-issues become reference classes for new estimates.
Built into cairn; neither *Claude Code Time Estimator* nor *OpenSpec* is
adopted. **Architect design pass precedes implementation** — this issue's own
sub-issues are the first hand-estimated reference class.

## Acceptance criteria

- [ ] Architect design note beside cairn (`scripts/cairn/design/estimation.md`) covering: sub-issue fields, actuals sources, calibration record format, reference-class query — reviewed by team-lead before code
- [ ] `process/TRACKER.md` schema gains on sub-issues: `stage` (plan | execute | review), `estimate: {tokens, gate_cycles}`, `actual: {tokens, gate_cycles, wall_clock}`, `ratio`; `cairn check` validates them
- [ ] `cairn close <ID>` pulls actuals for the sub-issue's assignee from the OTel receiver and the commit log, writes `actual` + `ratio`, and appends a calibration record under `process/cairn/metrics/`
- [ ] `cairn estimate <ID>` prints the closest reference classes (same stage + assignee, then same labels) with their actuals, to seed a new estimate
- [ ] Bloat flag: a sub-issue whose gate cycles exceed the estimate, or whose token ratio exceeds `config.yml` → `estimation.bloat_ratio`, is labelled `bloat`; the threshold key ships unset and the flag is skipped until POLY-A's baseline sets it
- [ ] `loop-stats` reuses the same actuals source rather than a second reader
- [ ] Unit tests in `scripts/cairn/tests/` for close, estimate, and the unset-threshold path
- [ ] `process/WORKFLOW.md` gains a short *Estimation* section: when the lead decomposes, when the architect reviews, when close runs
