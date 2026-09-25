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

### @team-lead — 2026-09-25

Two more members carried here from the POLY-51 review (architect verdict 006848e), not filed separately:
- **HTTP error code for letter-path refusals:** over `_create_issue`, a–z exhaustion (and the other `--parent` refusals) return 400 with code `legacy_archive`; the POLY-51 ruling §2 reserved that code for the legacy-archive guard and specified `bad_parent`, which no test pins. Fix the code and add the HTTP test.
- **Shared claim-and-write helper:** the O_EXCL create loop is duplicated between the numeric and letter paths of `allocate_and_create_issue` (~20 lines). Factor one helper; both paths call it.
- **`cairn close` from a teammate worktree writes `actual.cost_usd: None`** (architect, POLY-52): a worktree has no metrics mount, so `close` finds no `token-usage.jsonl` and records nulls. It should refuse with a message naming the main checkout, not write.
