---
id: POLY-47
title: cairn close --at: commit-time ceiling excludes the receiver flush that carries the stage's usage
status: backlog
milestone: POLY-A
parent: POLY-48
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P3
pr: null
created: 2026-09-25
updated: 2026-09-25
---


## Comments

### @team-lead — 2026-09-25

Observed closing POLY-41 (POLY-26 loop, 2026-09-25): `cairn close POLY-41 --at 2f245a3` read $0.0396 / 156k tokens; the same close without `--at` read $1.9090 / 3.2M tokens. The commit 2f245a3 is timestamped 19:16:20Z; the receiver flush carrying the architect's plan-stage usage is `generated` 19:17:15Z, 55 s later, so the POLY-16 ceiling (`generated <= commit time`) dropped it. The receiver aggregates per flush interval, so any stage whose last commit lands inside a flush interval loses that interval's usage under `--at`. Options: `close` forces a flush before computing the ceiling and takes ceiling = that flush's `generated` when the sha is the branch tip; or the ceiling admits the first flush after the commit time; or the close-at-stage-end rule in estimation.md says to flush-then-commit. Decide in a gate-1 ruling; add a test with a flush line 1 s after the ceiling commit.
