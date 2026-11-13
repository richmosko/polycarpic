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
updated: 2026-11-12
---

The M1 half of co-owner approval (ARCH §3.1b Scope, §11): the database gate that refuses direct gated writes once an entity has two owners, entity.founding_owner_user_id with its deferred trigger, invitation.issued_via, and the 1 → 2 revocation. The request flow ships in POLY-1.0 (POLY-112); until then a multi-owner entity's gated actions are refused, which is safe on staging.

## Acceptance criteria

- [x] The multi-owner direct-write gate — landed in POLY-62 as `app.gate_owner_changes()` (PR #109): BEFORE UPDATE OR DELETE on membership and BEFORE INSERT on invitation, default-deny for every role except the named definer roles and a superuser, refusing when `app.owner_count` is not 1 (null included), with the entity row locked FOR UPDATE (the lock `keep_an_owner` takes), not FOR SHARE — tests/db/tenancy.test.ts, the two-owner gate cases. What remains here is the rest of this list.
- [ ] founding_owner_user_id NOT NULL, set to the creator; a deferred constraint trigger refuses any commit where the founder does not hold owner.
- [ ] invitation.issued_via is not updatable; revoked tokens are refused at acceptance.
- [ ] The 1 → 2 revocation of direct invitations runs in the membership write's transaction, entity row FOR UPDATE before owner_count, effective owners only (A-24).
- [ ] The user tombstone check refuses while the user founds a multi-owner entity.
- [ ] Tests: ARCH §3.1b Tests, the gate, founder and 1 → 2 items.
- [ ] The self user's owner row on their own Person cannot be lowered or deleted; test: A demotes or removes themselves on their own Person → 23514. Without it, once the accept path exists a user can share their Person, demote themselves, be removed, and then fail `provisionPerson` on every request (seceng F1, `reviewed @ 8779392`). Lands before the accept path ships.

## Comments

### @team-lead — 2026-11-10

Re-scoped after POLY-62 (PR #109, 2026-11-11). Criterion 1 is ticked in place: seceng's objection O1 pulled the multi-owner gate into POLY-62 as `app.gate_owner_changes()`, because leaving it out let either of two owners remove the other. Lead decision, same day: until this issue and POLY-112 land, an entity with more than one owner cannot change its owners by direct write.

One criterion added (seceng F1, the self-Person owner row). Standing condition from the POLY-62 verdict: `poly_govern` may write any audit row, which is acceptable only while every function running as `poly_govern` stays on the reviewed allowlist (`packages/db/sql/definers.json`); each definer this issue adds is role-targeted and narrow in its own right.

### @team-lead — 2026-11-12

From the POLY-87 loop: existing-user acceptance must require the invitation token plus consent, never an email match alone (`/change-email` can point an account at an invited address); the 1 → 2 revocation on acceptance and the sign-up stamp rule apply here. SECURITY R-22 and R-23 are reviewed at this issue: if a domain administrator is not trusted, require the token on the OAuth and magic-link paths too. Revoking an already-revoked invitation is refused by the set-once rule (42501), so a revoke action must be idempotent in the app.
