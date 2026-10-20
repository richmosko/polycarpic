---
id: POLY-65
title: Transaction categorization + tax-treatment tagging
status: backlog
milestone: POLY-M2
parent: null
blocked_by: [POLY-64]
assignee: null
labels: []
priority: null
pr: null
created: 2026-09-27
updated: 2026-10-02
---

PRD §4 Story 3. Depends on the import adapter issue. Source: docs/PRD/index.html

## Comments

### @architect — 2026-10-02

Scope addition (team-lead ruling, 2026-10-02): the General Ledger screens fold into this issue. (1) Chart-of-accounts tree: category → account → sub-account, with balances and a custodial marker (ChartTree DTO). (2) Account register page: the lines hitting one account in date order, with a running balance, each linking to its full entry, reached by clicking an account in the tree with a breadcrumb back (AccountRegister DTO). Read-only for all roles. Source: ARCH §2.4 @ 884748c; DESIGN sidebar IA (Principal, 2026-10-02).
