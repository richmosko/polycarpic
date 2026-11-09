---
id: POLY-126
title: First Implement session planned
status: todo
milestone: POLY-C
parent: null
blocked_by: []
assignee: team-lead
paths: [process/STATE.md, process/cairn/issues/**]
labels: [plan, tracker]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

The gate needs "tracker issues populated for the first milestone" (WORKFLOW → Plan) and "first session planned" (POLY-C). POLY-M1's issues exist in backlog; this issue makes the first Implement session startable from a cold resume: the first loop's issues in `todo`, the active-feature pointer ready, and the roster named.

## Acceptance criteria

- [x] Every clause of POLY-M1's definition of done traces to at least one M1 issue; a clause with none gets an issue filed.
- [x] The first session's issue set (POLY-76 first, then the enablers it unblocks) is moved to `todo` with priorities set, `paths` declared and `blocked_by` checked against the M1 enabler order.
- [x] Each `todo` issue has acceptance criteria a test can check, and its ARCH / SECURITY / INFRA section references resolve.
- [x] `process/STATE.md`'s Active Feature names the first feature and the Implement roster (leads and qa-engineer) is written down, ready to flip when POLY-127's gate is approved.
