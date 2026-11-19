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
updated: 2026-11-19
---

PRD §4 Story 7. Depends on securities sub-ledger. Source: docs/PRD/index.html

## Acceptance criteria

- [ ] Class totals equal the nature-account balances; real estate is outside Allocation.
- [ ] An unmapped holding appears as a visible gap row.
- [ ] The money-market sub-category reads the latest reported_position on the custodial (ARCH §3.6); allocation_node and allocation_target are seeded per entity from the DESIGN classes.

## Comments

### @architect — 2026-11-08

Decomposition 2026-11-08: sub-categories are a per-security mapping outside the ledger. Digital Assets sit under Alternatives. Allocation is contemporaneous and has no inflation toggle.

### @team-lead — 2026-11-19

Pointer from the 2026-11-06 Plan follow-ups (placed at the temp sweep, 2026-11-19): ARCH §3 is the only home of two rules this issue's criteria do not name. The in-place holdings popover reads through the `HoldingsByClass` screen DTO (one class or sub-category across every custodial account, grouped by account), and sub-targets are whole-portfolio percent that must sum to their class (`allocation_target`). Build to those.
