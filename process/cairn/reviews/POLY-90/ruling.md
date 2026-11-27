# POLY-90 — Multi-owner gate + founder: ruling (architect)

Gate 1 for POLY-90 (sub-issue POLY-90a). Base: `feature/poly-90-multi-owner-gate-founder` @ d591f5eb. Sources: ARCH §3.1b, §3.1c, §11;
SECURITY C-28, A-24, R-22, R-23; migrations 0002, 0003, 0007, 0009, 0013, 0014; `tests/db/tenancy.test.ts`. Rules are R1–R9; the seam is
§S; the guards it trips are §G; the verdict checklist is §V. Nothing here is measured: every runtime claim is tagged `(unmeasured)` and
names the test that measures it at tests-red. A claim tagged `(unmeasured)` that the named test contradicts reopens that rule.

## What is in this loop and what is not

In: the founder column and its commit-time invariant (R1–R3), the self-Person owner row (R4), `issued_via` set once and the revoked-token
tests (R5), the 1 → 2 revocation as a trigger on every owner-making membership write plus the lock order in the one path that seats
from an invitation today (R6–R7), the tombstone criterion met by the founder invariant (R8). Database only: no route, no screen, no
TypeScript in `packages/tenancy` beyond what the generated Drizzle schema needs.

Out: the request flow, `change_request`, `transfer_founder`, `force_change`, `polycarpic entity set-founder` (POLY-112); the held raise and
its cancellation at 1 → 2 (POLY-91); the tombstone itself (POLY-115); entity purge (POLY-114). **No acceptance-path code lands here.**
Today an invitation is accepted only inside sign-up (`app.claim_invitations` / `app.accept_invitations`, new user only) and a manager
or owner seat only at enrolment (`app.seat_claimed_invitations`). There is no path for a signed-in user to accept. This loop lands the
database rules that path will meet (R6's trigger fires on whatever membership write it makes; R5 refuses revoked rows; R7's lock order),
and the conditions on that path go to its issue as follow-ups (§F). R-22 stays an accepted risk unchanged. R-23 is a decision for the lead
(L1); the code it implies is a follow-up, not this loop.

## Rules

**R1 — The column.** `entity.founding_owner_user_id uuid NOT NULL DEFAULT app.current_user_id() REFERENCES public."user"(id)` (ON DELETE
no action). No login role holds INSERT or UPDATE on the column: poly_app's INSERT grant (type_id, name, tax_classification,
self_user_id) and UPDATE grant (name, tax_classification) stay as they are, and poly_govern's INSERT grant (0014) stays without it. So the
default is the only value any runtime role can write: the creator, the same `app.current_user_id()` that `app.seat_creator()` seats as
owner. `provision_person` inherits it (its insert runs with the new user in the marker). poly_authz gains `SELECT (founding_owner_user_id,
purged_at) ON public.entity` for R2. A supplied value is refused by privilege, 42501. An insert with no user in context still fails
on the existing RLS check, before NOT NULL is tested (unmeasured; `tenancy.test.ts` "an entity insert with no user set raises 42501"
measures it and must stay green unedited).

**R2 — The invariant.** `app.founder_holds_owner()` RETURNS trigger, LANGUAGE plpgsql, SECURITY DEFINER, owner poly_authz,
`SET search_path = ''`, EXECUTE to nobody (allowlist `execute: []`). Read-only. Two constraint triggers, DEFERRABLE INITIALLY DEFERRED,
FOR EACH ROW:
- `entity_z91_founder_holds_owner` AFTER INSERT OR UPDATE ON public.entity. The name sorts after `entity_seat_creator`, so a caller who
  runs `SET CONSTRAINTS ALL IMMEDIATE` before creating an entity is not refused for an owner row not yet written.
- `membership_91_founder_holds_owner` AFTER UPDATE OR DELETE ON public.membership.

Body: the entity id is `NEW.id` (entity) or `OLD.entity_id` (membership). Read the entity row's founder and `purged_at` in one statement.
No row, or `purged_at IS NOT NULL`: return. Otherwise, if no membership row has (entity, founder, role = 'owner'), raise. It applies to
**every role, superuser included**, as `user_90_stamp_cleared` does: no exemption is ruled here. The founder therefore cannot lower or
give up owner by any path until POLY-112's `transfer_founder` moves the column, which ARCH §3.1b already requires.

**R3 — The backfill.** Three migrations, so the Drizzle snapshot matches the schema at every step:
- `0022_entity_founder` (generated): the column, nullable, with its FK. `packages/db/src/schema/tenancy.ts` gains the column.
- `0023_founder_rules` (custom): the backfill, then every rule in R2, R4–R7. The backfill runs as poly_owner, so the file wraps it in
  `ALTER TABLE public.entity NO FORCE ROW LEVEL SECURITY` / `public.membership NO FORCE …` and restores FORCE on both before its next
  statement. Value per entity: the `self_user_id` when that user holds owner on it; else the owner row with the earliest `created_at`,
  ties by `membership.id`. Then a check: if any entity, purged or not, still has a null founder, the migration raises
  `founder backfill: an entity has no owner to found it` (23514) and the whole run rolls back. The migration never invents a founder
  and never deletes a row; an operator facing the refusal fixes or removes the ownerless entity by hand. Staging holds test data only, and
  `keep_an_owner` has kept an owner on every unpurged entity since 0003; whether staging has an ownerless row is (unmeasured) and only the
  staging migrate measures it.
- `0024_entity_founder_not_null` (generated): SET NOT NULL and SET DEFAULT `app.current_user_id()` (schema: `.notNull().default(sql…)`).

**R4 — The self-Person owner row (seceng F1).** `app.keep_own_person_owner()` RETURNS trigger, plpgsql, **invoker**, `SET search_path = ''`,
owned by poly_owner. Trigger `membership_15_own_person_owner` BEFORE UPDATE OR DELETE ON public.membership FOR EACH ROW, so it fires after
the gate (`_10_`) and before `keep_an_owner` (`_20_`). If `OLD.role = 'owner'` and (DELETE or `NEW.role <> 'owner'`): read the entity's
`self_user_id` in a statement; no row visible → 42501 `entity not available`; `self_user_id = OLD.user_id` → 23514. No role is exempt,
superuser included. Account deletion (POLY-115) and purge (POLY-114) rule their own exemption when they exist (§F).

**R5 — `issued_via` and revoked tokens.** `app.invitation_set_once()` (0007, invoker) is replaced with one added first check:
`NEW.issued_via IS DISTINCT FROM OLD.issued_via` → 42501. Every role, superuser included. No grant changes: no role holds
UPDATE (issued_via) today, and a pgTAP assertion pins that. Revoked tokens: `claim_invitations`, `accept_invitations` and
`seat_claimed_invitations` already filter `revoked_at IS NULL`; no code changes, the criterion is met by tests (§S, T-R5b/c).

**R6 — The 1 → 2 revocation.** `app.owner_transition()` RETURNS trigger, plpgsql, SECURITY DEFINER, owner poly_govern,
`SET search_path = ''`, EXECUTE to nobody. Trigger `membership_80_owner_transition` AFTER INSERT OR UPDATE OF role ON public.membership
FOR EACH ROW. Being a trigger, it runs in the transaction of every membership write that makes an owner: today the sole owner's direct
raise (poly_app UPDATE) and `seat_claimed_invitations` at enrolment; later the existing-user accept, `promote_held_roles` and
`apply_change`, none of which can forget to call it. Body, each step its own statement:
1. A superuser session that has not switched role (`rolsuper` of `session_user` and `current_setting('role') = 'none'`, the 0013
   pattern) returns: fixtures and restores. A test of the transition therefore never seats its second owner as superuser.
2. Return unless `NEW.role = 'owner'` and (INSERT, or `OLD.role <> 'owner'`).
3. `PERFORM 1 FROM public.entity WHERE id = NEW.entity_id FOR UPDATE`; not found → 42501 `entity not available`.
4. `n := app.owner_count(NEW.entity_id)`, read after the lock. Null → 42501 `entity not available`. `n < 2` → return. Owners are
   `membership.role = 'owner'` rows, which are effective owners only: §3.1c parks a held raise in `pending_role` and leaves `role` at
   viewer, so A-24 holds without a filter here.
5. `UPDATE public.invitation SET revoked_at = now() WHERE entity_id = NEW.entity_id AND issued_via = 'owner' AND revoked_at IS NULL AND
   accepted_at IS NULL RETURNING id, inviter_user_id, role`. Claimed-but-unseated rows are included (they seat at enrolment with no
   expiry check); expired rows are included. For each row: one `audit_event` (`entity_id` = the entity, `kind` =
   `invitation.revoked`, actor computed as `app.audit_membership()` computes it, `actor_user_id` = `app.current_user_id()`, payload
   `{invitation_id, reason: 'owner_transition'}`), and, when `inviter_user_id` is not null, one `notification` to the inviter (`kind` =
   `invitation.revoked`, payload `{invitation_id, entity_id, role, reason: 'owner_transition'}`).

It fires on every later owner addition too (`n > 2`); with the gate refusing direct invitations at `n ≠ 1`, there is nothing left to
revoke and the step is a no-op. "Direct" is `issued_via = 'owner'` alone until POLY-112 adds `change_request_id`; that issue adds
`AND change_request_id IS NULL` (§F).

Grants and policies for R6, nothing broader: EXECUTE on `app.owner_count(uuid)` to poly_govern; `UPDATE (founding_owner_user_id) ON
public.entity` to poly_govern (row locking needs an UPDATE privilege, and this is the column §3.1b already gives poly_govern for
`transfer_founder`); policies `entity_govern_lock_read` FOR SELECT TO poly_govern USING (true) and `entity_govern_lock` FOR UPDATE TO
poly_govern USING (true) **WITH CHECK (false)**, so poly_govern can lock any entity row and update none until POLY-112 replaces the check;
`invitation_govern_transition_revoke` FOR UPDATE TO poly_govern USING (issued_via = 'owner' AND entity_id IS NOT NULL AND revoked_at IS
NULL AND accepted_at IS NULL) WITH CHECK (issued_via = 'owner' AND revoked_at IS NOT NULL). That SELECT … FOR UPDATE under RLS needs both a
SELECT policy and an UPDATE USING policy is (unmeasured); T-R6a measures it.

**R7 — The lock order in the seating path.** `app.seat_claimed_invitations()` is replaced (same owner, signature, allowlist entry):
1. First statement: lock, in `entity.id` order, `FOR UPDATE`, every entity named by the user's claimed, unaccepted, unrevoked manager or
   owner invitations.
2. Then the existing loop, which re-reads those invitations in a new statement and so skips any row another transaction revoked while
   this one waited.
3. Inside the loop, `UPDATE … SET accepted_at` comes **before** the membership INSERT, so R6's "outstanding" predicate never matches
   the row being seated.

Every path then takes the entity row before any invitation row. Two invitees seating owner invitations on one entity at once: the second
waits on the entity lock, re-reads its invitation as revoked, and seats nothing; the end state is two owners and the other revoked, with
no deadlock (unmeasured; T-R7a measures it). Without step 1 each counts two owners under its own snapshot and both seat (three
owners), or they deadlock on each other's invitation row.

**R8 — The tombstone.** Account deletion does not exist yet. Its tombstone removes the user's memberships (POLY-115), and R2 refuses any
commit that removes a founder's owner row, so the tombstone is refused while the user founds any entity with another owner, and a
sole-owned entity is refused by `keep_an_owner` before it. This loop proves it with a tombstone-shaped write (T-R8). POLY-115's own
pre-check ("no multi-owner founder", already its criterion) gives the clear error; no new follow-up.

**R9 — Existing tests the design changes.** Founder O can no longer lower their own role. Two tests in `tests/db/tenancy.test.ts` change,
owned by qa:
- "on a two-owner entity an owner may still remove a viewer, lower their own role…": the lowering owner becomes O2 (not the founder).
- "two owners lowering their own role on two connections at once…": O2 lowers first and holds; O then lowers and is refused. Assert O's
  error **message** is `an entity keeps at least one owner` (keep_an_owner, after the lock), not the founder's. Dropping the entity lock
  turns O's refusal into the founder's commit-time error, so the message is what still proves the lock.

## §S — The seam

Every refusal test asserts SQLSTATE **and** message; every guard has a positive case beside it.

| Id | Guard | How it is reached | SQLSTATE | Message (exact) | Positive case |
|---|---|---|---|---|---|
| T-R1a | founder column, insert | poly_app INSERT naming `founding_owner_user_id` | 42501 | `permission denied for table entity` | A creates an entity; founder = A |
| T-R1b | founder column, update | poly_app UPDATE SET `founding_owner_user_id` | 42501 | `permission denied for table entity` | owner renames the entity |
| T-R2a | `app.founder_holds_owner()` | founder A lowers self on a two-owner entity: the UPDATE succeeds, the COMMIT fails | 23514 | `the founding owner must hold owner` | co-owner B lowers self and commits |
| T-R2b | same, deferred | superuser lowers A's row and restores it in one transaction | — | commits | — |
| T-R2c | same, trigger order | `SET CONSTRAINTS ALL IMMEDIATE`, then create an entity | — | commits | — |
| T-R3 | backfill | migration test: rows seeded at 0021, then the rest | 23514 | `founder backfill: an entity has no owner to found it` | self user chosen on a Person; earliest owner elsewhere |
| T-R4 | `app.keep_own_person_owner()` | A, on their own Person with a second owner B, demotes self; then deletes self | 23514 | `a user keeps owner on their own Person` | B lowers self on A's Person; A lowers self on a Business A does not found |
| T-R5a | `app.invitation_set_once()` | superuser UPDATE of `issued_via` | 42501 | `an invitation's issued_via never changes` | owner revokes the same row |
| T-R5b | revoked token, sign-up | sign-up with the token of a revoked invitation | 42501 | `invitation_required` | same flow, unrevoked twin, seats |
| T-R5c | revoked after claim | owner revokes a claimed owner invitation; invitee enrols | — | no membership, `accepted_at` null | unrevoked twin seats at enrolment |
| T-R6a | `app.owner_transition()`, raise path | sole owner O raises enrolled V to owner; O's outstanding direct invitations (unclaimed, claimed, expired, any role) | — | each `revoked_at` = that transaction's `now()`; one audit and one inviter notification each | an invitation on O's other entity, an operator row and an accepted row are untouched; a raise to manager revokes nothing |
| T-R6b | seat path | X's owner invitation seats at enrolment | — | others revoked; X's own row accepted, not revoked | — |
| T-R6c | back to one | after O2 leaves, O's new direct invitation is revoked at the next 1 → 2 | — | revoked | — |
| T-R6d | definer reach | pgTAP: poly_govern UPDATE of an entity row is refused by `entity_govern_lock` | 42501 | `new row violates row-level security policy for table "entity"` | the lock itself (T-R6a) |
| T-R7a | R7 lock order | X and Y, each with a claimed owner invitation on E, enrol on two connections | — | exactly two owners; the loser's invitation revoked; no 40P01 on either | — |
| T-R8 | tombstone shape | founder A deletes every own membership, one transaction, entity has owner B | 23514 | `the founding owner must hold owner` | B does the same and commits |

`entity not available` (42501) is R4's and R6's fail-closed branch; it is not reachable from a fixture without breaking RLS, so it is
asserted by reading the function source in pgTAP, not by a runtime case. "Enrols" means any write that fires `two_factor_80_sync` or
`passkey_80_sync` for the invitee, as `tests/db/helpers/second-step.ts` already drives.

## §G — Standing guards this design trips

| Guard | Why | Owner |
|---|---|---|
| `packages/db/sql/definers.json` + `tests/db/helpers/definers.ts` (C-15 allowlist) | new `app.founder_holds_owner()` (poly_authz, []), `app.owner_transition()` (poly_govern, []); `app.owner_count(uuid)` execute gains poly_govern | builder; seceng reviews |
| `tests/db/pgtap/04_tenancy.sql` lines 32–38 | pins `owner_count` EXECUTE to poly_app, poly_worker | qa |
| `tests/db/pgtap/09_poly_govern_grants.sql` | pins poly_govern on entity exactly, and exactly three policies naming it on entity | qa |
| `tests/db/pgtap/02_rls_catalog.sql`, `05_invitation.sql` | policy and trigger inventories on entity, membership, invitation | qa |
| generated freshness (`tests/ci/generated-freshness.test.ts`, drizzle-kit regenerate) | 0022 and 0024 come from `schema/tenancy.ts`; meta snapshots must match | builder |
| `DB_AREAS` in `infra/ci/changes.mjs` + `tests/ci/db-areas.test.ts` | every new `tests/db/*.test.ts` joins an area: the founder and transition files join `tenancy`, the migration test joins the area that lists `migration-0017` | qa |
| `tests/db/tenancy.test.ts` (R9) | two tests change | qa |
| layer lint (`layers.json`, `eslint.config.js`) | not tripped: no new package, no new import edge | — |

## §V — Pre-registered verdict checklist

Each criterion of POLY-90 is ticked only on the evidence named; the verdict reads the tree at its sha.

1. Founder: T-R1a/b, T-R2a/b/c, T-R3 green; the catalog shows the column NOT NULL with the default, no login role with INSERT/UPDATE
   on it, poly_govern's UPDATE on it bound by `WITH CHECK (false)`.
2. `issued_via` / revoked tokens: T-R5a/b/c green; pgTAP pins no UPDATE (issued_via) for any role.
3. 1 → 2: T-R6a–d and T-R7a green; the function body takes the lock before `owner_count` (read the source at the sha).
4. Tombstone: T-R8 green.
5. Tests: §3.1b Tests items in scope here map to the rows above; the request-flow, held-raise and force items stay with POLY-112 / 91.
6. F1: T-R4 green.
7. Guards: every §G row changed in the same PR; `definers.json` diff is exactly the three entries.
8. Mutation runs, one per guard, each shown red: drop the founder trigger; drop the F1 trigger; drop the `issued_via` check; drop R6's
   lock; drop R7 step 1; swap R7 step 3; drop the entity lock in `keep_an_owner` (R9 race test).

**Assertions that would pass a wrong build.**

| Weak assertion | Wrong build it passes | Required instead |
|---|---|---|
| founder refusal checks SQLSTATE 23514 only | keep_an_owner or F1 refuses instead; no founder trigger at all | assert the message, and that the statement succeeded and the COMMIT failed |
| T-R5a run as poly_app | grant refusal (`permission denied`) hides a missing trigger | run as superuser; assert the message |
| T-R6 checks only that `revoked_at` is set | revocation in a later transaction or a job | `revoked_at` equals the membership write's `now()` |
| T-R6b checks the other rows only | X's own invitation revoked and accepted (R7 step 3 swapped) | X's row: `accepted_at` set, `revoked_at` null |
| T-R7a checks owner count only | deadlock aborts one side; its invitation stays claimed and unrevoked | no 40P01; the loser's row revoked |
| T-R4 on a sole-owner Person | keep_an_owner refuses with the same 23514 | a second owner on the Person; assert the message |
| R9 race asserts 23514 only | entity lock removed; founder trigger refuses at commit | assert `an entity keeps at least one owner` |
| T-R6a seeds the second owner as superuser | step 1 skips; test passes vacuously or is red for the wrong reason | second owner via the raise or the seat path only |
| T-R3 run on an empty database | backfill and refusal never execute | rows seeded before 0022, as `migration-0017.test.ts` does |

## §F — Follow-ups (the lead files; none in POLY-M1 unless its gate needs it)

- **POLY-112** (comment): add `AND change_request_id IS NULL` to R6's predicate; replace `entity_govern_lock`'s `WITH CHECK (false)` with
  `transfer_founder`'s narrow check; the existing-user accept definer requires the token plus consent (never an email match alone),
  takes the entity lock before any invitation lock, marks the invitation accepted before the membership write, and refuses a revoked
  row. A revoke action in the app is idempotent (set-once returns 42501 on a second revoke).
- **POLY-91** (comment): extend `app.owner_transition()` to cancel direct-path held raises under the same lock; `promote_held_roles` locks
  the entity before reading `owner_count`.
- **POLY-115** (comment): R2 and R4 refuse the tombstone's membership removal; rule an account-deletion exemption, if any, with seceng.
- **POLY-114** (comment): a purged entity keeps its founder id; R2 skips purged rows; the FK refuses deleting a founding user.
- **POLY-116** (comment, restore drill): R2 checks at commit for every role, so a restore loads entity and membership in one
  transaction or with triggers disabled.
- **ARCH** (this loop, architect, after seceng's review): §3.1b gate text to match the code (default-deny for every role but the named
  definers and a superuser; entity row FOR UPDATE, not FOR SHARE), the founder default, R4, R5 and R6's trigger form.

## For the lead

- **L1 — R-23 (domain administrator).** Recommendation: require the invitation token for manager and owner invitations on every sign-up
  path, OAuth and magic link included; viewer invitations keep the verified-email claim. An administrator-minted address that claims an
  owner invitation becomes a co-owner whom the real owner can then remove only through POLY-112's approval and force path. The change is
  one predicate in `claim_invitations` / `accept_invitations` plus the web flow carrying the token through OAuth; file it in POLY-1.0,
  blocking the first production deploy (POLY-164), since staging has no outside users. Alternative: accept R-23 as is.
- **L2 — No superuser exemption on R2, R4, R5.** Recommendation: keep none, as `user_90_stamp_cleared` has none; the cost is the restore
  note to POLY-116 and fixtures that never seat a founder-less state.
- **L3 — Criterion wording.** Recommendation: re-word "The user tombstone check refuses…" to "The founder invariant refuses a
  tombstone-shaped removal while the user founds a multi-owner entity (R8)", and tick it on T-R8.
