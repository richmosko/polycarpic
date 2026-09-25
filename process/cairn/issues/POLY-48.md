---
id: POLY-48
title: Estimation-engine fixes (grouped): unpriced-model cost, check warning key, fixture hygiene, close --at flush ceiling, guard-push same-assignee scope, JS gate node_modules
status: todo
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, estimation]
priority: P2
pr: null
created: 2026-09-25
updated: 2026-09-25
---


## Comments

### @team-lead — 2026-09-25

Grouped fix loop (user decision 2026-09-25: each top-level issue costs a full I→V loop + CI, so small fixes in one area ride one loop). One PR closes every member.

Members (each keeps its own file and acceptance criteria): POLY-15, POLY-33, POLY-40, POLY-47, POLY-8.

Additional acceptance criteria carried here, not filed separately:
- **guard-push scope:** `cairn guard-push <sub-issue>` scans every same-assignee commit since merge-base with main, so the second sub-issue an agent holds on one branch trips on the first one's files (POLY-26 loop, POLY-44 push). Fix: scope the scan to commits after the assignee's earlier-stage sibling closed, or union same-assignee sibling paths under one parent; add a test with two sibling sub-issues for one assignee.
