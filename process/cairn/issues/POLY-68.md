---
id: POLY-68
title: Balance sheet views (GL + custodial) + NAV delta
status: backlog
milestone: POLY-M5
parent: null
blocked_by: [POLY-67, POLY-73]
assignee: null
labels: []
priority: null
pr: null
created: 2026-09-27
updated: 2026-11-08
---

PRD §4 Story 6. Depends on entity schema and securities sub-ledger. Source: docs/PRD/index.html

## Acceptance criteria

- [ ] Custodial figures read market value, book value and cash; a parent's balance sheet includes only its own accounts until POLY-118.

## Comments

### @architect — 2026-11-08

Decomposition 2026-11-08: the 'estimated tax since last close' line arrives with POLY-113 (POLY-1.0); this issue renders without it until then (ARCH §4.5).
