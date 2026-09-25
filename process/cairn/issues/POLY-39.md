---
id: POLY-39
title: CI: tracker data commits (process/cairn/issues|milestones|majors|archive) trigger the cairn job; narrow the change pattern
status: todo
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [ci, cairn]
priority: P3
pr: null
created: 2026-09-25
updated: 2026-09-25
---


## Comments

### @team-lead — 2026-09-25

Found on PR #12 (POLY-6, 2026-09-25): the `changes` step's pattern includes `process/`, so every ruling, verdict and close comment — tracker data under `process/cairn/` — starts a full one-minute `cairn` run. PR #12 produced 5 runs, 2 of them for tracker-only commits. Fix: exclude `process/cairn/{issues,milestones,majors,archive}/**` from the pattern while keeping `process/*.md` and `process/cairn/config.yml`. Before narrowing, the architect verifies no test lints the REAL tracker tree (grep hits for `cairn/issues` in scripts/cairn/tests/ are fixture paths in temp trees; `helpers.py`'s real-state guard reads `.sessions/`, not issues). One shape test in tests/workflow/test_cairn_test_boundary.py pins the exclusion. Also decide whether the required check's strict mode ("branch must be up to date") makes a tracker-only tip re-run unavoidable — if so, document it rather than fight it.
