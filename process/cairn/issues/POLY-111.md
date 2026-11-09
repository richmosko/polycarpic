---
id: POLY-111
title: Cross-entity transfer treatment
status: backlog
milestone: POLY-M3
parent: null
blocked_by: [POLY-71]
assignee: null
paths: [packages/posting/**, apps/web/src/routes/**]
labels: [ledger]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

A transfer between two entities carries one choice on the draft: contribution/distribution (preselected) or due-to/due-from, each explained in plain language at the point of choice (OQ-6, Principal 2026-11-06; ARCH §4.3). Groups span one bank date.

## Acceptance criteria

- [ ] A cross-entity transfer draft shows the choice with contribution/distribution preselected and a plain-language line for each option.
- [ ] Confirming with contribution/distribution posts equity on both sides; due-to/due-from posts a receivable and a payable; both entries balance and tie out.
- [ ] Legs on different bank dates are never grouped into one entry.
- [ ] An unmatched leg stays a draft; approving it into Cash in Transit is an explicit action.
