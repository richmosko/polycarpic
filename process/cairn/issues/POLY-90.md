---
id: POLY-90
title: Multi-owner gate + founder
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-62]
assignee: backend-lead
paths: [packages/db/migrations/**, packages/tenancy/**]
labels: [db, tenancy, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

The M1 half of co-owner approval (ARCH §3.1b Scope, §11): the database gate that refuses direct gated writes once an entity has two owners, entity.founding_owner_user_id with its deferred trigger, invitation.issued_via, and the 1 → 2 revocation. The request flow ships in POLY-1.0 (POLY-112); until then a multi-owner entity's gated actions are refused, which is safe on staging.

## Acceptance criteria

- [ ] A BEFORE INSERT / UPDATE / DELETE trigger on membership and invitation raises when current_user = poly_app, the action is (a)–(c) of ARCH §3.1b, and app.owner_count > 1 (poly_authz, entity row FOR SHARE).
- [ ] founding_owner_user_id NOT NULL, set to the creator; a deferred constraint trigger refuses any commit where the founder does not hold owner.
- [ ] invitation.issued_via is not updatable; revoked tokens are refused at acceptance.
- [ ] The 1 → 2 revocation of direct invitations runs in the membership write's transaction, entity row FOR UPDATE before owner_count, effective owners only (A-24).
- [ ] The user tombstone check refuses while the user founds a multi-owner entity.
- [ ] Tests: ARCH §3.1b Tests, the gate, founder and 1 → 2 items.
