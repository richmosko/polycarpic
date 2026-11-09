---
id: POLY-106
title: M1 integration check
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-62, POLY-90, POLY-86, POLY-87, POLY-89, POLY-91, POLY-93, POLY-94, POLY-104, POLY-128, POLY-129]
assignee: qa-engineer
paths: [tests/integration/**, apps/web/tests/**]
labels: [qa]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

The ARCH §11 POLY-M1 close check, run end to end on staging through the real deploy path. It closes the milestone and does not re-test what the feature issues prove.

## Acceptance criteria

- [ ] A user invited by the operator signs in (email and one OAuth provider), creates an entity after the second-step gate, and grants another user a viewer membership; the viewer sees exactly that entity.
- [ ] The RLS battery is green in CI, inversion self-test and pool-reuse test included.
- [ ] On a two-owner entity, a direct invite, a role raise and a co-owner removal are refused, and the founder cannot drop owner (ARCH §3.1b).
- [ ] An owner raise of an unenrolled viewer is held, and promoted on enrolment (ARCH §3.1c).
- [ ] Migrations apply in CI and on staging through the real runner as poly_migrator; the app shell renders DESIGN tokens.
