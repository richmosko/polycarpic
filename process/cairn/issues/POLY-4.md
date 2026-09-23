---
id: POLY-4
title: Test-suite health after template scrub: color-safe run_tests.py, fix 5 stale failures
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: team-lead
labels: [workflow, cairn, tests]
priority: P2
pr: null
created: 2026-09-23
updated: 2026-09-23
---


Two findings from the POLY-1 loop (implementation-lead's green-gate comment on
POLY-1 @ b02ca11, reproduced by team-lead), both outside POLY-1's scope.

**1. `run_tests.py` mis-parses colorized output.** Its stderr summary regex does
not tolerate ANSI escape codes. With `FORCE_COLOR` set in the shell (tmux
teammate panes leak it), every file reports as an error even when unittest
prints `OK`; `FORCE_COLOR=0 NO_COLOR=1` is the current workaround. A gate that
lies about its result is worse than one that fails.

**2. Six pre-existing failing files left by the template scrub** (kickoff
§ 2.2): `test_test_run_hooks.py` (missing `process/reviews/PT-97` fixture,
deleted with `process/reviews/`), `test_backfill_tokens.py`,
`test_otel_receiver.py` (cwd / prefix resolution), `test_state_releases_bound.py`
(STATE.md Releases row format), `test_agent_setting_role.py` (backfill role
matrix keyed on scrubbed `PT-301`–`PT-306` fixtures; resolves everything to
`main`). None touch product code; they are template debris.

## Acceptance criteria

- [ ] `run_tests.py` strips ANSI sequences before parsing the unittest summary, or forces `NO_COLOR` on the child process; a test covers colorized output
- [ ] The six listed files are fixed or deleted with a one-line rationale each (a fixture pointing at scrubbed template history is deleted, not recreated)
- [ ] `python3 scripts/cairn/run_tests.py --gate green` is fully green on `main`
- [ ] `process/cairn/metrics/test-runs.jsonl` handling reviewed: decide whether hook-recorded runs are committed with feature work or gitignored, and record the call in `process/WORKFLOW.md`

## Comments

### @team-lead — 2026-09-23

Feature started. Branch: `feature/poly-4-test-suite-health`. Team: implementation-lead + qa-engineer; architect reviews. The uncommitted `test-runs.jsonl` diff from prior sessions rides on this branch pending AC #4.
