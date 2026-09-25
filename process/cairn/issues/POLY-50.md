---
id: POLY-50
title: Backfill attribution (grouped): issue bucketing on worktree branches, write double-count guard, milestone-window collision
status: todo
milestone: POLY-A
parent: null
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

Grouped fix loop (user decision 2026-09-25). One PR closes every member; together they are the prerequisites for the first real backfill write on this repo (POLY-26 ruling §3). Members: POLY-45, POLY-46.

Additional acceptance criterion carried here, not filed separately:
- **milestone-window collision:** the POLY-26 dry-run (2026-09-25, 68c8dfa) printed `cairn: warning: milestone_windows dropped colliding milestone window(s) ['POLY-A', 'POLY-B']` — both milestone files resolve to the same creation id/timestamp (bootstrapped in one commit), so every record that would match a milestone window falls back to `main`. Disambiguate by file (not timestamp) or order same-timestamp milestones deterministically; add a test with two milestones created in one commit.
