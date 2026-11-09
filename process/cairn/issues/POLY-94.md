---
id: POLY-94
title: Parent placement consent
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-62, POLY-89]
assignee: null
paths: [packages/db/migrations/**, packages/tenancy/**, apps/web/src/routes/**]
labels: [db, tenancy, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

Placing an entity under a parent needs no approval from its owners; the placement step and the notices state the C-25 consent wording. When an invitation to a parent goes live, every owner beneath at any depth gets one notice per new member with a pull-out link. Nesting is any depth, acyclic, with a sanity limit (ARCH §3.1 entity_rollup, §3.3b; SECURITY A-16, A-17, A-21, A-28). The roll-up view ships in POLY-1.1.

## Acceptance criteria

- [ ] The placement step shows the exact consent sentence from PRD §5 before confirming.
- [ ] An invite to a parent sends each owner beneath, at any depth, exactly one notice per new member with the consent sentence and a pull-out link; any role triggers it, a later raise does not.
- [ ] The pull-out link removes the link after a fresh sign-in; the parent's owner can also remove it.
- [ ] A child's owner can list the parent names above their entity (app.parents_of) and sees nothing else of the parent.
- [ ] A cycle, or a depth above 8 levels, is refused with a plain error that names no hidden entity.
- [ ] A parent can hold its own accounts; a base entity may sit in several parents.
- [ ] app.check_rollup_edge() (poly_graph) under a fixed advisory lock; refuses an own-Person child whose user has no second step (A-28).
- [ ] Tests: ARCH §3.3b Tests, except the roll-up totals items (POLY-118).
