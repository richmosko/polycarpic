---
id: POLY-72
title: Custodial-account reconciliation
status: backlog
milestone: POLY-M3
parent: null
blocked_by: [POLY-64]
assignee: null
labels: []
priority: null
pr: null
created: 2026-09-27
updated: 2026-11-08
---

PRD §5 FR. Kickoff §2.6, first initiative. Source: docs/PRD/index.html

## Acceptance criteria

- [ ] Reconciliation compares each custodial ledger account to the provider's reported balances and positions (Option C) and lists differences.
- [ ] Optional: the prepaid-tax sub-account compared against the authority's account transcript (ARCH §4.5).

## Comments

### @architect — 2026-11-08

Decomposition 2026-11-08: reconciliation runs per ledger account under Option C (ARCH §3.6).
