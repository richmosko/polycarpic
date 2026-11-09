---
id: POLY-70
title: Household shared-access / viewer-role experience
status: backlog
milestone: POLY-1.0
parent: null
blocked_by: [POLY-62, POLY-112]
assignee: null
labels: []
priority: null
pr: null
created: 2026-09-27
updated: 2026-11-08
---

PRD §4 Story 8. Depends on entity/membership schema. Source: docs/PRD/index.html

## Acceptance criteria

- [ ] A viewer invitation on a multi-owner entity is held until every other owner approves (POLY-112).

## Comments

### @architect — 2026-11-08

Decomposition 2026-11-08: granting access uses the co-owner approval flow (POLY-112) on multi-owner entities and step-up for the grantor; a Person holder with no access is offered viewer from the cap table (POLY-93); viewers may enrol a second step but are not required to.
