---
id: POLY-90
title: Multi-owner gate + founder
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-62]
assignee: backend-lead
paths: [packages/db/migrations/**, packages/db/**, packages/tenancy/**, tests/**, process/cairn/issues/POLY-90.md, process/cairn/issues/POLY-90*.md, process/cairn/reviews/POLY-90/**, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, layers.json, eslint.config.js, apps/*/package.json, packages/*/package.json, pnpm-lock.yaml, package.json, scripts/layers/**, .github/workflows/**, infra/ci/**]
labels: [db, tenancy, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-27
---

The M1 half of co-owner approval (ARCH §3.1b Scope, §11): the database gate that refuses direct gated writes once an entity has two owners, entity.founding_owner_user_id with its deferred trigger, invitation.issued_via, and the 1 → 2 revocation. The request flow ships in POLY-1.0 (POLY-112); until then a multi-owner entity's gated actions are refused, which is safe on staging.

## Acceptance criteria

- [x] The multi-owner direct-write gate — landed in POLY-62 as `app.gate_owner_changes()` (PR #109): BEFORE UPDATE OR DELETE on membership and BEFORE INSERT on invitation, default-deny for every role except the named definer roles and a superuser, refusing when `app.owner_count` is not 1 (null included), with the entity row locked FOR UPDATE (the lock `keep_an_owner` takes), not FOR SHARE — tests/db/tenancy.test.ts, the two-owner gate cases. What remains here is the rest of this list.
- [ ] founding_owner_user_id NOT NULL, set to the creator; a deferred constraint trigger refuses any commit where the founder does not hold owner.
- [ ] invitation.issued_via is not updatable; revoked tokens are refused at acceptance.
- [ ] The 1 → 2 revocation of direct invitations runs in the membership write's transaction, entity row FOR UPDATE before owner_count, effective owners only (A-24).
- [ ] The founder invariant refuses a tombstone-shaped removal of the user's memberships while the user founds a multi-owner entity (ruling R8, test T-R8); the tombstone's own pre-check is POLY-115's.
- [ ] Tests: ARCH §3.1b Tests, the gate, founder and 1 → 2 items.
- [ ] The self user's owner row on their own Person cannot be lowered or deleted; test: A demotes or removes themselves on their own Person → 23514. Without it, once the accept path exists a user can share their Person, demote themselves, be removed, and then fail `provisionPerson` on every request (seceng F1, `reviewed @ 8779392`). Lands before the accept path ships.

## Comments

### @team-lead — 2026-11-10

Re-scoped after POLY-62 (PR #109, 2026-11-11). Criterion 1 is ticked in place: seceng's objection O1 pulled the multi-owner gate into POLY-62 as `app.gate_owner_changes()`, because leaving it out let either of two owners remove the other. Lead decision, same day: until this issue and POLY-112 land, an entity with more than one owner cannot change its owners by direct write.

One criterion added (seceng F1, the self-Person owner row). Standing condition from the POLY-62 verdict: `poly_govern` may write any audit row, which is acceptable only while every function running as `poly_govern` stays on the reviewed allowlist (`packages/db/sql/definers.json`); each definer this issue adds is role-targeted and narrow in its own right.

### @team-lead — 2026-11-12

From the POLY-87 loop: existing-user acceptance must require the invitation token plus consent, never an email match alone (`/change-email` can point an account at an invited address); the 1 → 2 revocation on acceptance and the sign-up stamp rule apply here. SECURITY R-22 and R-23 are reviewed at this issue: if a domain administrator is not trusted, require the token on the OAuth and magic-link paths too. Revoking an already-revoked invitation is refused by the set-once rule (42501), so a revoke action must be idempotent in the app.

### @team-lead — 2026-11-27

Feature started. Branch: `feature/poly-90-multi-owner-gate-founder`. The Principal's grant for this loop (2026-11-27): drive to completion, the lead takes the decisions on its own recommendations and reports them in the closing summary.

### @architect — 2026-11-27

Gate 1 ruling: `process/cairn/reviews/POLY-90/ruling.md` (R1–R9, seam §S, guards §G, verdict checklist §V, follow-ups §F, three items for the lead). Database only; no acceptance-path code in this loop.

### @architect — 2026-11-27

Seam (ruling @ 80607cfa §S), accepted for qa @ 42a8f226: (1) "T-R6 lock" in `owner-transition.test.ts` seats owners as superuser. It is the mutation probe for R6's own lock, because every real path already holds the entity lock by then, through the gate or R7a step 1. It is not criterion evidence: T-R6a/b stay on the raise and seat paths. (2) The R7b step 1 mutant counts as red on T-R7b (i) and the claim/accept lock probes. T-R7b (ii) passes without step 1, so it is not counted for that mutant.

### @architect — 2026-11-27

Gate 4 verdict: **pass**. See `process/cairn/reviews/POLY-90/verdict.md`: one table (axis, result, evidence, sha), the staging backfill answer, and three as-built items accepted.
