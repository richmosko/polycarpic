---
id: POLY-69
title: Asset-allocation view with target adjustments
status: backlog
milestone: POLY-M4
parent: null
blocked_by: [POLY-67]
assignee: null
labels: []
priority: null
pr: null
created: 2026-09-27
updated: 2026-11-08
---

PRD §4 Story 7. Depends on securities sub-ledger. Source: docs/PRD/index.html

## Acceptance criteria

- [ ] Class totals equal the nature-account balances; real estate is outside Allocation.
- [ ] An unmapped holding appears as a visible gap row.
- [ ] The money-market sub-category reads the latest reported_position on the custodial (ARCH §3.6); allocation_node and allocation_target are seeded per entity from the DESIGN classes.

## Comments

### @architect — 2026-11-08

Decomposition 2026-11-08: sub-categories are a per-security mapping outside the ledger. Digital Assets sit under Alternatives. Allocation is contemporaneous and has no inflation toggle.
