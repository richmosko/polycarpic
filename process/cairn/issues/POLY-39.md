---
id: POLY-39
title: CI: tracker data commits (process/cairn/issues|milestones|majors|archive) trigger the cairn job; narrow the change pattern
status: done
milestone: POLY-A
parent: POLY-34
blocked_by: []
assignee: devops-engineer
paths: [.github/**, process/cairn/issues/POLY-34.md, process/cairn/issues/POLY-39.md]
stage: execute
estimate.tokens: 2000000
estimate.gate_cycles: 1
actual.cost_usd: "1.1707"
actual.tokens: 3520064
actual.gate_cycles: 1
actual.wall_clock: 16
labels: [ci, cairn]
priority: P2
pr: null
created: 2026-09-25
updated: 2026-09-25
---


## Comments

### @team-lead — 2026-09-25

Found on PR #12 (POLY-6, 2026-09-25): the `changes` step's pattern includes `process/`, so every ruling, verdict and close comment — tracker data under `process/cairn/` — starts a full one-minute `cairn` run. PR #12 produced 5 runs, 2 of them for tracker-only commits. Fix: exclude `process/cairn/{issues,milestones,majors,archive}/**` from the pattern while keeping `process/*.md` and `process/cairn/config.yml`. Before narrowing, the architect verifies no test lints the REAL tracker tree (grep hits for `cairn/issues` in scripts/cairn/tests/ are fixture paths in temp trees; `helpers.py`'s real-state guard reads `.sessions/`, not issues). One shape test in tests/workflow/test_cairn_test_boundary.py pins the exclusion. Also decide whether the required check's strict mode ("branch must be up to date") makes a tracker-only tip re-run unavoidable — if so, document it rather than fight it.

### @team-lead — 2026-09-25

Pulled into the POLY-34 loop as its first deliverable (user, 2026-09-25): devops-engineer owns the pattern change, qa-engineer the shape test, the architect verifies in the gate-1 ruling that no test reads the real tracker tree. Goes green before the cost-axis work so the rest of this loop's pushes stop triggering runs.

### @team-lead — 2026-09-25

Live measurement on PR #13 (2026-09-25): run 36168991108 on the code tip d7cf281 ran the full suite (no anchor yet) and passed; run 36169164996 on dbc738e (in-review flip: POLY-34.md + process/STATE.md) correctly did NOT skip — STATE.md is read by tests and is not excluded. This comment is the first tracker-only push after a green code tip; its run is the §0.8 measurement.
