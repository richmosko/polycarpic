---
id: POLY-7
title: ensure_metrics_worktree.py: tests for the failed-add recovery path and the no-network/no-local-metrics skip
status: backlog
milestone: null
parent: POLY-49
blocked_by: []
assignee: null
labels: [workflow, cairn, tests]
priority: P3
pr: null
created: 2026-09-23
updated: 2026-09-25
---


## Comments

### @team-lead — 2026-09-23

Follow-up from the architect's POLY-4 re-review (POLY-4 @ e4438c0, items 3a nit and 3d). Two paths in `scripts/cairn/ensure_metrics_worktree.py` were fixed but are exercised only by hand:

- **3d recovery:** `git worktree add` fails mid-swap (e.g. the otel receiver recreated the path); the backup must be merged back into whatever is at the path, never stranded.
- **3a skip:** no `refs/remotes/origin/metrics` and origin unreachable → the script skips with one stderr line and creates nothing.

## Acceptance criteria

- [ ] Both paths covered in `scripts/cairn/tests/test_ensure_metrics_worktree.py` against throwaway repos, in the style of the existing 3a/3b/3c tests
