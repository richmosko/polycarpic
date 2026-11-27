# POLY-90 — Multi-owner gate + founder: ruling (architect)

Gate 1 for POLY-90 (sub-issue POLY-90a), **re-issued whole** on backend-lead-90's measured objection (40P01 in 3 of 3 runs: a raise to
owner against a viewer sign-up on the same entity; test "R7 measurement: raise to owner against a viewer sign-up on the same entity").
This text replaces the earlier ruling and both of its addenda. It folds in seceng's conditions (`seceng-conditions.md` @ 2fffea15), its
review (`security-review.md` @ f0d63083) and the lead's answers (DECISIONS @ 816190c1). What changed from e5ba4b2d: R5 and R7 now cover
the sign-up definers (R7b), R7 gains the builder's in-loop guard, and §S gains T-R7b plus qa's two seam notes. Sources: ARCH §3.1b,
§3.1c, §11; SECURITY C-20, C-28, A-24, R-22, R-23; migrations 0002, 0003, 0007, 0009, 0013, 0014. A claim tagged `(unmeasured)` names the
test that measures it; a contradicting result reopens that rule.

## What is in this loop and what is not

In: the founder column and its commit-time invariant (R1–R3), the self-Person owner row (R4), `issued_via` set once and revoked rows
refused (R5), the 1 → 2 revocation as a trigger on every owner-making membership write (R6), one lock order, entity before invitation,
in every definer that locks invitation rows (R7), the tombstone criterion met by the founder invariant (R8). Database only: no route, no
screen, no TypeScript beyond the generated Drizzle schema.

Out: the request flow, `change_request`, `transfer_founder`, `force_change`, `polycarpic entity set-founder` (POLY-112); the held raise
and its cancellation at 1 → 2 (POLY-91); the tombstone itself (POLY-115); entity purge (POLY-114); existing-user acceptance and the
R-23 token rule (POLY-129). Today an invitation is accepted only inside sign-up and a manager or owner seat only at enrolment; no
signed-in user can accept. This loop changes those definers only for lock order (R7). R-22 stays an accepted risk unchanged.

## Rules

**R1 — The column.** `entity.founding_owner_user_id uuid DEFAULT app.current_user_id() REFERENCES public."user"(id)` (ON DELETE no
action), with two checks:
- `entity_founder_tombstone_check ((purged_at IS NULL) = (founding_owner_user_id IS NOT NULL))`: every live entity has a founder; a
  purged one has none (POLY-114 clears it with the rest of the tombstone).
- `entity_person_founder_check (self_user_id IS NULL OR founding_owner_user_id = self_user_id)`: a Person's founder is its own user.

No login role holds INSERT or UPDATE on the column: poly_app's entity grants and poly_govern's INSERT grant (0014) stay without it. The
default is the only value a runtime role can write: the creator, the same `app.current_user_id()` that `app.seat_creator()` seats as
owner, inherited by `provision_person`. poly_authz gains `SELECT (founding_owner_user_id, purged_at) ON public.entity`. An insert with no
user in context still fails on the existing RLS check first (unmeasured; `tenancy.test.ts` "an entity insert with no user set raises
42501" measures it, unedited).

**R2 — The invariant.** `app.founder_holds_owner()` RETURNS trigger, plpgsql, SECURITY DEFINER, owner poly_authz, `SET search_path = ''`,
execute `[]`. Read-only. Two constraint triggers, DEFERRABLE INITIALLY DEFERRED, FOR EACH ROW:
- `entity_z91_founder_holds_owner` AFTER INSERT OR UPDATE ON public.entity (sorts after `entity_seat_creator`, so `SET CONSTRAINTS ALL
  IMMEDIATE` before an entity insert is not refused for an owner row not yet written).
- `membership_91_founder_holds_owner` AFTER UPDATE OR DELETE ON public.membership.

Body: entity id is `NEW.id` or `OLD.entity_id`; read the entity's founder and `purged_at` in one statement. No row → raise. Purged →
return. No membership row (entity, founder, role = 'owner') → raise 23514 `the founding owner must hold owner`. **Every role, superuser
included; no exemption** (lead, L2).

**R3 — The migrations and the backfill.** Three files, so the Drizzle snapshot matches the schema at each step:
- `0022_entity_founder` (generated): the column, nullable, with its FK; `packages/db/src/schema/tenancy.ts` gains it.
- `0023_founder_rules` (custom): the backfill, then every rule in R2 and R4–R7. The backfill runs as poly_owner inside
  `ALTER TABLE public.entity NO FORCE ROW LEVEL SECURITY` / `public.membership NO FORCE …`, with FORCE restored on both before the
  next statement. Value per live entity: a Person takes `self_user_id`; any other the subject of its earliest `membership.created`
  audit row with role owner who still holds owner, else the earliest owner row (ties by `membership.id`). A live entity with no
  answer, or a Person whose user holds no owner, raises 23514 `founder backfill: an entity has no owner to found it` and the run rolls
  back. The migration never invents a founder and never deletes a row. Whether staging has such a row is (unmeasured); the staging
  migrate measures it.
- `0024_entity_founder_checks` (generated): the two checks and the default.

**R4 — The self-Person owner row (seceng F1).** `app.keep_own_person_owner()` RETURNS trigger, plpgsql, SECURITY DEFINER, owner poly_authz,
`SET search_path = ''`, execute `[]`. Trigger `membership_15_own_person_owner` BEFORE UPDATE OR DELETE ON public.membership FOR EACH ROW:
after the gate (`_10_`), before `keep_an_owner` (`_20_`). If `OLD.role = 'owner'` and (DELETE or `NEW.role <> 'owner'`): read the
entity's `self_user_id`; no row → 42501 `entity not available`; `self_user_id = OLD.user_id` → 23514 `a user keeps owner on their own
Person`. No role is exempt; POLY-114 / POLY-115 rule their own exemption with seceng.

**R5 — `issued_via` and revoked rows.** `app.invitation_set_once()` (0007, invoker) is replaced with one added first check: `NEW.issued_via
IS DISTINCT FROM OLD.issued_via` → 42501 `an invitation's issued_via never changes`, every role. No grant changes; a pgTAP assertion pins
that no role holds UPDATE (issued_via). Revoked rows: `claim_invitations`, `accept_invitations` and `seat_claimed_invitations` keep
`revoked_at IS NULL` in their locked (`FOR UPDATE`) query, never in an earlier unlocked read; R7 changes their lock order only.

**R6 — The 1 → 2 revocation.** `app.owner_transition()` RETURNS trigger, plpgsql, SECURITY DEFINER, owner poly_govern, `SET search_path =
''`, execute `[]`. Trigger `membership_80_owner_transition` AFTER INSERT OR UPDATE OF role ON public.membership FOR EACH ROW, every role:
it runs in whichever transaction makes an owner (today the sole owner's raise and the enrolment seat; later the existing-user accept,
`promote_held_roles`, `apply_change`). Body, each step its own statement:
1. Return unless `NEW.role = 'owner'` and (INSERT, or `OLD.role <> 'owner'`).
2. `PERFORM 1 FROM public.entity WHERE id = NEW.entity_id FOR UPDATE`; not found → 42501 `entity not available`.
3. `n := app.effective_owner_count(NEW.entity_id)`; `n < 2` → return. Owners are `role = 'owner'` rows: §3.1c parks a held raise in
   `pending_role`, so this counts effective owners only (A-24).
4. `UPDATE public.invitation SET revoked_at = now() WHERE entity_id = NEW.entity_id AND issued_via = 'owner' AND revoked_at IS NULL AND
   accepted_at IS NULL RETURNING id, inviter_user_id`. Claimed and expired rows are included. Per row: one `audit_event` (`kind`
   `invitation.revoked`, the entity, actor as `app.audit_membership()` computes it, `actor_user_id` = `app.current_user_id()`, payload
   `{invitation_id, reason: 'owner_transition'}`) and, when `inviter_user_id` is not null, one `notification` to the inviter (`kind`
   `invitation.revoked`, payload `{invitation_id, entity_id, reason: 'owner_transition'}`; no role, no email).

At `n > 2` the gate has already refused new direct invitations, so step 4 is a no-op. "Direct" is `issued_via = 'owner'` alone until
POLY-112 adds `change_request_id` (§F).

New: `app.effective_owner_count(p_entity uuid) RETURNS int`, plpgsql or sql, VOLATILE, SECURITY DEFINER, owner poly_authz, `search_path
= ''`, execute `[poly_govern]`: the count of `role = 'owner'` rows, whoever calls. `app.owner_count` gets no new grantee. Grants and
policies, nothing broader: `UPDATE (founding_owner_user_id) ON public.entity` to poly_govern (row locks need an UPDATE privilege; this is
the column §3.1b gives poly_govern for `transfer_founder`); `entity_govern_lock_read` FOR SELECT TO poly_govern USING (true);
`entity_govern_lock` FOR UPDATE TO poly_govern USING (true) **WITH CHECK (false)**, so poly_govern locks any entity row and updates none
until POLY-112 replaces the check; `invitation_govern_transition_revoke` FOR UPDATE TO poly_govern USING (issued_via = 'owner' AND
entity_id IS NOT NULL AND revoked_at IS NULL AND accepted_at IS NULL) WITH CHECK (issued_via = 'owner' AND revoked_at IS NOT NULL).
`invitation_govern_update` and `invitation_bootstrap_revoke` do not change (T-R6f). That a row lock under RLS needs both the SELECT and
the UPDATE USING policy is (unmeasured); T-R6a measures it.

**R7 — One lock order: the entity row before any invitation row, in every definer that locks invitation rows.**

*R7a — `app.seat_claimed_invitations()`* (makes owners; replaced, same owner, signature and allowlist entry):
1. First statement: lock `FOR UPDATE`, in `entity.id` order, every entity named by the user's claimed, unaccepted, unrevoked manager or
   owner invitations.
2. Then the loop, which re-reads those invitations `FOR UPDATE` in a new statement and so skips any row revoked while it waited.
3. In the loop: `UPDATE … SET accepted_at = now() WHERE id = r.id AND revoked_at IS NULL`; no row → `CONTINUE` with no membership
   write (a row the loop fetched and the user's own earlier owner seat revoked). Then the membership INSERT. Accepting first means R6
   never matches the row being seated.

*R7b — `app.claim_invitations(bytea, text)` and `app.accept_invitations(bytea)`* (seat viewers only; replaced, same owner, signatures and
allowlist entries; the bootstrap predicate of 0009 kept as is):
1. First statement: lock `FOR KEY SHARE`, in `entity.id` order, the entities named by the live rows the function's existing predicate
   matches, and keep their ids.
2. Then today's invitation `FOR UPDATE` query, restricted to `entity_id IS NULL OR entity_id = ANY (<the ids locked in step 1>)`. A row
   whose entity was not locked (issued between the two statements, token-less path only) is not claimed or seated; if none is left,
   the existing `invitation_required` refusal applies.

KEY SHARE, not FOR UPDATE: a viewer seat never changes the owner count. KEY SHARE conflicts with the gate's and R6's FOR UPDATE, which
puts sign-up in the same order as the raise, and does not conflict with itself, so sign-ups do not queue on each other. The viewer
INSERT's foreign-key check takes the same KEY SHARE, already held. No new grant: the lock uses R6's poly_govern UPDATE privilege and
`entity_govern_lock*` policies (unmeasured; T-R7b measures it).

Every path now takes the entity before invitation rows: the raise (user row FOR SHARE, entity, invitations), the enrolment seat (user
row, entity, invitations), sign-up (entity, invitations), a manual revoke (invitation only). No cycle (seceng's review checked the first
three; T-R7a and T-R7b measure them).

**R8 — The tombstone.** Account deletion does not exist yet. Its tombstone removes the user's memberships (POLY-115); R2 refuses any
commit that removes a founder's owner row, so it is refused while the user founds an entity with another owner, and `keep_an_owner`
refuses a sole-owned one before that. Proved by a tombstone-shaped write (T-R8). POLY-115's own pre-check gives the clear error.

**R9 — Existing tests the design changes** (qa). In `tests/db/tenancy.test.ts`:
- "on a two-owner entity an owner may still remove a viewer, lower their own role…": the lowering owner becomes O2, not the founder.
- "two owners lowering their own role on two connections at once…": O2 lowers first and holds; O then lowers and is refused with
  message `an entity keeps at least one owner` (keep_an_owner after the lock). Without the entity lock, O's refusal becomes the
  founder's commit-time error, so the message proves the lock.
- "purged_at is all-or-nothing": the purge also clears `founding_owner_user_id` (R1's tombstone check).

## §S — The seam

Every refusal asserts SQLSTATE **and** message; every guard has a positive case. In T-R2a/b/d the superuser transaction carries a
member's marker, so `keep_an_owner` can count; T-R6e stays unmarked. "Enrols" means a write that fires `two_factor_80_sync` or
`passkey_80_sync` for the invitee (`tests/db/helpers/second-step.ts`). No transition test seats its second owner as superuser except
T-R6e.

| Id | Guard | How it is reached | SQLSTATE | Message (exact) | Positive case |
|---|---|---|---|---|---|
| T-R1a | column, insert | poly_app INSERT naming `founding_owner_user_id` | 42501 | `permission denied for table entity` | A creates an entity; founder = A |
| T-R1b | column, update | poly_app UPDATE SET `founding_owner_user_id` | 42501 | `permission denied for table entity` | owner renames the entity |
| T-R1c | Person check | superuser sets a Person's founder to its other owner | 23514 | constraint `entity_person_founder_check` | — |
| T-R2a | `founder_holds_owner` | founder A lowers self on a two-owner entity: UPDATE succeeds, COMMIT fails; also committed in a poly_auth-marked and a superuser transaction | 23514 | `the founding owner must hold owner` | co-owner B lowers self and commits |
| T-R2b | deferred | superuser lowers A's row and restores it in one transaction | — | commits | — |
| T-R2c | trigger order | `SET CONSTRAINTS ALL IMMEDIATE`, then create an entity | — | commits | — |
| T-R2d | every role | superuser deletes the founder's owner row on a two-owner entity | 23514 | `the founding owner must hold owner` (at commit) | — |
| T-R3 | backfill | migration test: rows seeded at 0021, then 0022–0024 | 23514 | `founder backfill: an entity has no owner to found it` | Person takes its user; elsewhere the audited creator, else the earliest owner |
| T-R4 | `keep_own_person_owner` | A, on their own Person with second owner B, demotes self; deletes self; superuser does each | 23514 | `a user keeps owner on their own Person` (at the statement) | B lowers self on A's Person; A removes a viewer; A lowers self on a Business A does not found |
| T-R5a | `invitation_set_once` | superuser UPDATE of `issued_via` | 42501 | `an invitation's issued_via never changes` | owner revokes the same row |
| T-R5b | revoked, sign-up | sign-up with a revoked invitation's token | 42501 | `invitation_required` | unrevoked twin seats |
| T-R5c | revoked after claim | owner revokes a claimed owner invitation; invitee enrols | — | no membership; `accepted_at` null | unrevoked twin seats at enrolment |
| T-R5d | revoke vs enrol | T1 revokes a claimed owner invitation and holds; T2 enrols and blocks; T1 commits | — | T2 commits with no seat | — |
| T-R6a | `owner_transition`, raise | sole owner O raises enrolled V to owner; O's outstanding direct invitations: unclaimed, claimed, expired, any role | — | each `revoked_at` = that transaction's `now()`; one audit and one inviter notification each | O's other entity, an operator row and an accepted row untouched; a raise to manager revokes nothing |
| T-R6b | seat path | X's owner invitation seats at enrolment | — | the others revoked; X's own row accepted, not revoked | — |
| T-R6c | back to one | after O2 leaves, O's new direct invitation is revoked at the next 1 → 2 | — | revoked | — |
| T-R6d | lock-only policy | pgTAP: poly_govern UPDATE of an entity row | 42501 | `new row violates row-level security policy for table "entity"` | the lock itself (T-R6a) |
| T-R6e | no user, one statement | superuser, unmarked, INSERTs two owner rows on a sole-owner entity with a direct invitation open | — | revoked | — |
| T-R6f | neighbour policies | pgTAP: `qual` / `with_check` of `invitation_govern_update` and `invitation_bootstrap_revoke` equal their 0007 / 0009 text; poly_govern's invitation column grants exactly those of 0007 + 0009 | — | — | — |
| T-R7a | seat order | X and Y, each with a claimed owner invitation on E, enrol on two connections | — | both commit; no 40P01 or 40001; exactly two owners; the loser's row revoked, its enrolment committed with no seat | — |
| T-R7b | sign-up order | the builder's measurement, both orders, with a barrier: (i) sign-up holds after claim, the raise blocks, both commit; (ii) the raise holds, sign-up blocks at claim, the raise commits | (ii) 42501 | (ii) `invitation_required` (its row revoked) | (i) the viewer seated, the raise applied; no 40P01 in either order |
| T-R8 | tombstone shape | founder A deletes every own membership in one transaction; the entity has owner B | 23514 | `the founding owner must hold owner` | B does the same and commits |

`entity not available` (42501) in R4 and R6 is the fail-closed branch no fixture reaches without breaking RLS; pgTAP reads the source.

## §G — Standing guards this design trips

| Guard | Why | Owner |
|---|---|---|
| `packages/db/sql/definers.json` + `tests/db/helpers/definers.ts` | exactly four new entries: `app.founder_holds_owner()` (poly_authz, []), `app.keep_own_person_owner()` (poly_authz, []), `app.effective_owner_count(p_entity uuid)` (poly_authz, [poly_govern]), `app.owner_transition()` (poly_govern, []); the three replaced definers keep theirs | builder; seceng reviews |
| `tests/db/pgtap/09_poly_govern_grants.sql` | pins poly_govern on entity exactly, and exactly three policies naming it there | qa |
| `tests/db/pgtap/02_rls_catalog.sql`, `04_tenancy.sql`, `05_invitation.sql` | policy and trigger inventories on entity, membership, invitation | qa |
| `tenancy_column_updatable` battery | names `invitation.issued_via` and `entity.founding_owner_user_id` | qa |
| generated freshness (`tests/ci/generated-freshness.test.ts`) | 0022 and 0024 come from `schema/tenancy.ts`; meta snapshots match | builder |
| `DB_AREAS` (`infra/ci/changes.mjs`) + `tests/ci/db-areas.test.ts` | a new founder or transition test file joins `tenancy`; the migration test joins the area that lists `migration-0017` | qa |
| `tests/db/tenancy.test.ts` (R9) | three tests change | qa |
| layer lint | not tripped: no new package or import edge | — |

## §V — Pre-registered verdict checklist

1. Founder: T-R1a–c, T-R2a–d, T-R3 green; the catalog shows the default, both checks, no login role with INSERT or UPDATE on the
   column, and poly_govern's UPDATE on it bound by `WITH CHECK (false)`.
2. `issued_via` and revoked rows: T-R5a–d green; pgTAP pins no UPDATE (issued_via) for any role.
3. 1 → 2: T-R6a–f, T-R7a, T-R7b green; at the sha, each of the three replaced definers and `owner_transition` takes the entity lock in
   its first locking statement, before any invitation lock or count.
4. Tombstone: T-R8. 5. Tests: §3.1b items in scope map to §S; the request-flow, held-raise and force items stay with POLY-112 / 91.
6. F1: T-R4. 7. Guards: every §G row changed in the same PR; the `definers.json` diff is exactly the four entries.
8. Mutations, each shown red: drop the founder trigger; drop the F1 trigger; drop the `issued_via` check; drop R6's lock; drop R7a step
   1; swap R7a step 3; drop R7a's `revoked_at IS NULL` guard; drop R7b step 1; drop the entity lock in `keep_an_owner` (R9 race).

**Assertions that would pass a wrong build.**

| Weak assertion | Wrong build it passes | Required instead |
|---|---|---|
| founder refusal checks 23514 only | keep_an_owner or F1 refuses instead; no founder trigger | the message, and statement-succeeds / commit-fails |
| T-R5a run as poly_app | the grant refusal hides a missing trigger | superuser; the message |
| T-R6 checks only that `revoked_at` is set | revocation in a later transaction or a job | `revoked_at` equals the membership write's `now()` |
| T-R6b checks the other rows only | X's own row revoked and accepted (R7a step 3 swapped) | X's row accepted, not revoked |
| T-R7a / T-R7b check outcome only | a deadlock aborts one side | no 40P01 or 40001 on either connection |
| T-R4 on a sole-owner Person | keep_an_owner refuses with the same 23514 | a second owner; the message; at the statement |
| R9 race asserts 23514 only | entity lock removed; the founder trigger refuses at commit | `an entity keeps at least one owner` |
| T-R6a seeds the second owner as superuser | the test never exercises the raise or seat path | second owner via the raise or the seat |
| T-R3 on an empty database | backfill and refusal never run | rows seeded before 0022, as `migration-0017.test.ts` does |

## §F — Follow-ups (the lead files)

- **POLY-112** (comment): add `AND change_request_id IS NULL` to R6's predicate; `change_request_id` is written only by
  `app.apply_change`, at insert, by no login role, and set once in `app.invitation_set_once()`; replace `entity_govern_lock`'s `WITH
  CHECK (false)` with `transfer_founder`'s narrow check; a revoke in the app is idempotent (set-once returns 42501 on a second revoke).
- **POLY-129** (comment): the existing-user accept requires the token plus an explicit consent action (never an email match alone),
  follows R7's order (entity first; accepted before the membership write; revoked rows refused under the lock), and fires R6 by being a
  membership write. The R-23 token rule is already there (SECURITY @ d99b9013).
- **POLY-91** (comment): extend `owner_transition` to cancel direct-path held raises under the same lock; `promote_held_roles` locks the
  entity before counting; a held owner raise does not revoke, its promotion does.
- **POLY-166** (comment): if an unenrolled owner stops counting as effective, the gate's count and `effective_owner_count` become one.
- **POLY-115** (comment): R2 and R4 refuse the tombstone's membership removal; any account-deletion exemption is ruled with seceng.
- **POLY-114** (comment): the purge clears the founder (R1's tombstone check); R2 skips purged rows; the FK refuses deleting a founder.
- **POLY-116** (comment, restore drill): R2 checks at commit for every role, so a restore loads entity and membership in one
  transaction or with triggers disabled.

## Decided by the lead (DECISIONS @ 816190c1)

L1 (R-23) is a condition on POLY-129. L2: no role exemption on R2, R4, R5, R6. L3: POLY-90's tombstone criterion is re-worded in place
and ticked on T-R8. ARCH §3.1b states these rules (ARCH 1.32.0); R7b needs no ARCH change, since §3.1b already says every path that
seats from an invitation locks the entity first.
