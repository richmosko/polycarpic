---
id: POLY-89b
title: Second step security review
status: in-progress
milestone: POLY-M1
parent: POLY-89
blocked_by: []
assignee: seceng
paths: [process/cairn/issues/POLY-89.md, process/cairn/reviews/POLY-89/**, process/cairn/issues/POLY-89b.md, docs/SECURITY/**]
stage: review
estimate.cost_usd: "9.00"
estimate.gate_cycles: 2
labels: [auth, security]
priority: null
pr: null
created: 2026-11-16
updated: 2026-11-16
---

seceng reviews the architect's ruling before qa writes tests, then reviews the built migrations and hooks at the exact sha before the verdict. Owns any SECURITY edit (R-25's mitigation status, new threats).

## Acceptance criteria

- [ ] A ruling review is posted on POLY-89 before the first test commit: each guard's bypass paths, the marker's session id never used as proof of a session, no new poly_app grant on BetterAuth's tables.
- [ ] A build review of the exact sha is posted before the architect's verdict, naming each finding as blocking or not.
- [ ] SECURITY is updated for what this loop changes, with no history in the doc.