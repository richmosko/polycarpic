---
id: POLY-45
title: backfill_tokens: teammate records on worktree-<name> branches bucket to the milestone, not the active issue
status: backlog
milestone: POLY-A
parent: POLY-50
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P3
pr: null
created: 2026-09-25
updated: 2026-09-25
---


## Comments

### @architect — 2026-09-25

From the POLY-26 ruling (scripts/cairn/design/backfill-sibling-scan.md, M5): of 4204 assistant records in worktree-sibling transcripts, 3897 carry gitBranch worktree-<name>, which _bucket_for_branch maps to main -> milestone:<id>. After POLY-26 these lines carry the right role but the milestone bucket. The receiver avoids this by reading the main checkout's branch at flush time; the backfill equivalent is a timeline from the lead's own (main-dir) records: the issue branch the lead was on at the record's timestamp. Needs its own ruling (the between-loops case where the lead is on main).
