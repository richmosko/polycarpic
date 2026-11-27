# POLY-90 — seceng review of the ruling

Ruling read: `process/cairn/reviews/POLY-90/ruling.md` @ bef08baf, against `seceng-conditions.md` @ 2fffea15 and the migrations at that sha (0003, 0007, 0009, 0013, 0014).

**Verdict: nothing blocks the build.** S1 and S2 go into one architect addendum before tests-red; the rest are follow-up text or notes.

## Conditions

| Condition | Result | Note |
|---|---|---|
| F-1 written once, by the database | met | R1: DEFAULT plus no INSERT/UPDATE grant to any login role; §V1 catalog check. |
| F-2 a Person's founder is its user | **not met** | S1. |
| F-3 backfill before NOT NULL | met | R3 uses membership rows, not audit rows. Refusal on a missing founder; seeded migration test (T-R3). |
| F-4 deferred, re-reads state, caller-independent | met; one change accepted | poly_authz definer, re-reads the entity and membership, no `owner_count`. "No row → return" instead of refuse is accepted: no role holds DELETE on entity, and TRUNCATE is refused (S6). |
| F-5 no role exemption | met in the rule, **not proven by a test** | S2. |
| F-6 tombstone shape | changed, accepted | The founder id survives on a purged tombstone (§F POLY-114). Users are tombstoned, never deleted, and no runtime role can see a memberless entity. POLY-114 records the retention in SECURITY when the purge lands. |
| F-7 no transfer path | met | `entity_govern_lock` WITH CHECK (false) until POLY-112. |
| I-1 `issued_via` set once, every role | met | R5; T-R5a run as superuser and asserts the message. |
| I-2 `change_request_id` writable by apply_change only | moved to POLY-112, text incomplete | S3. |
| I-3 revoked rows refused under the lock | met | T-R5b/c. R7 step 2 re-reads in a new statement. A manual-revoke-vs-enrol race test is optional: READ COMMITTED re-checks `revoked_at` on the locked row. |
| V-1 one trigger, every writer | met; one change accepted | R6 exempts an unswitched superuser session. Accepted: superuser is no runtime role, the gate exempts it the same way, and §V forbids seating the second owner as superuser in T-R6. |
| V-2 ≥ 2, not = 2 | met | `n < 2 → return`. A one-statement 1 → 3 by poly_app is already refused by the gate on the second row (BEFORE row triggers see earlier rows of the same command). |
| V-3 lock then count; null never skips | met | Lock in the trigger itself; null → 42501. |
| V-4 entity before invitation, everywhere | met | R7 steps 1–3. T-R7a asserts no 40P01 and the loser's row revoked. I checked the other orders: the raise path takes the user row FOR SHARE (`_05_`), then the entity, then invitation rows. The seat path takes the user row (second_step_at), then the entity, then invitation rows. A manual revoke takes the invitation row only. No cycle. |
| V-5 scope of the revocation | met | Claimed, expired and any-role rows are included. Accepted and operator rows are excluded. Step 3 excludes the row being seated. |
| V-6 narrow privilege | met | poly_govern already holds UPDATE (revoked_at), since 0009. The new policy sits beside `invitation_bootstrap_revoke` and `invitation_govern_update`, and neither may change (S4). The audit and notification payloads carry no email. |
| V-7 effective owners only | met for today | POLY-91 is in §F. POLY-166 is missing (S3). |
| T-1 tombstone | met | R8 matches my position. L3's rewording is fine. |
| P-1 self-Person row | met; one change accepted | Invoker, not definer. Accepted because it fails closed: poly_app sees the entity as a member, and poly_govern holds SELECT (id, self_user_id) since 0014. Any other role gets a privilege error or `entity not available`, which refuses. The two-owner Person and the exact message rule out both wrong builds I named. |
| Standing condition (poly_govern, allowlist) | met | Two definers, both `execute: []`. owner_count's EXECUTE to poly_govern is a read. §V7 pins the definers.json diff to three entries. |

## Findings

- **S1 (medium; addendum) — A Person's founder is not pinned to its user.** Nothing in this loop can move a founder. But POLY-112's `transfer_founder` and the operator's `set-founder` will be able to. A Person whose founder is a co-owner lets that co-owner force-remove the Person's user from their own Person through `force_change`. R4 then blocks only the last step, and that only while R4 has no exemption. SECURITY §4.2.2 already says "for a Person entity that is its own user"; the schema does not say it. **Change:**
  - 0023 adds `CHECK (self_user_id IS NULL OR founding_owner_user_id = self_user_id)` after the backfill.
  - R3's backfill always takes `self_user_id` for a Person, and refuses when that user does not hold owner on it. That brings an existing F1 lockout row to light instead of filing it under another founder.
  - Test: superuser UPDATE of a Person's founder to its other owner → 23514 with the constraint name; positive: the same UPDATE on a Business commits at the statement.
- **S2 (low; addendum) — "no superuser exemption" on R2 and R4 is ruled but untested.** T-R2b's superuser case commits with or without an exemption, so a build that copies the gate's `rolsuper` branch passes every seam row. **Add:**
  - T-R2d: an unswitched superuser session deletes the founder's owner row on a two-owner entity → the COMMIT fails with `the founding owner must hold owner`.
  - T-R4b: the same session demotes A on A's two-owner Person → `a user keeps owner on their own Person` at the statement.
  - Add both to §V8's mutant list: "add a superuser exemption to R2 / R4" must turn each red.
- **S3 (low; §F text) — follow-ups missing two conditions.**
  - POLY-112: `change_request_id` is written only by `app.apply_change`, at insert. No login role holds INSERT or UPDATE on it, and it is set-once like `issued_via`. Otherwise a sole owner stamps pre-issued invitations with any request id, and they survive the transition.
  - POLY-166: if "effective owner" comes to exclude an unenrolled owner, the gate's count and R6's count stay one function.
- **S4 (low; seam) — pin the policies R6 sits beside.** §G already covers 09_poly_govern_grants. Add one pgTAP assertion that the qual and with_check of `invitation_govern_update` and `invitation_bootstrap_revoke` are unchanged, and that poly_govern's column grants on invitation are unchanged. The tempting fix when the revoke UPDATE fails at RLS is to loosen the existing policy.
- **S5 (note) — L1 is superseded.** The lead decided R-23 (DECISIONS 2026-11-27 @ 7f859387): a condition on POLY-129, not a POLY-1.0 issue blocking POLY-164. SECURITY R-23 is rewritten at d99b9013. Strike L1, so the record holds one answer.
- **S6 (note) — F-4's "no row → return" rests on entity rows never being deleted.** The verdict confirms that an existing assertion pins no DELETE on entity for every role (0003's grants say so). If none exists, 04_tenancy gains one.

## SECURITY in this loop

I update C-20 (the self-Person row), the founding-owner bullets (§4.2.2: a commit-time check for every role; a Person's founder is fixed, after S1) and C-28 (the revocation is a trigger on every owner-making write; entity row before invitation rows), at the build review against the real migrations, so the doc matches the code.

## Delta: addendum 1 (eca10ccc), read after the review above was written

The addendum landed while this review was in progress. Against my findings:
- **S1: closed.** `entity_person_founder_check`; the backfill takes `self_user_id` for a Person and refuses when that user holds no owner; T-R1c.
- **S2: closed.** T-R2d, T-R4's superuser case, R4 as a poly_authz definer. Add "add a superuser exemption to R2 / R4" to §V8's mutants at tests-red (qa).
- **S3: half open.** POLY-166 is noted. The POLY-112 condition on `change_request_id` (written only by `app.apply_change` at insert, no login-role grant, set once) is still missing from §F. Text only.
- **S4: open.** Pin `invitation_govern_update` and `invitation_bootstrap_revoke` unchanged, plus poly_govern's invitation column grants (qa, pgTAP). Seam only.
- **S5: closed** (L1 struck).
- **S6: moot.** R2 now raises on no row.
- **F-6 and V-1/V-3: now met as I wrote them.** The founder is null on a purged tombstone, there is no superuser exemption in R6, and `app.effective_owner_count` is not caller-relative. It is EXECUTE poly_govern only, a NOLOGIN role reached through allowlisted definers, so the condition from POLY-62 holds.

Nothing blocks the build. S3's text and S4's assertion can land with tests-red; they do not need another ruling round.

## Delta: addendum 2 (e5ba4b2d)

S3 and S4 are closed (the POLY-112 condition is in §F, and T-R6f pins the two policies and the grants). Every finding is now closed, and the design is cleared for tests-red.

## Standing-pin rulings (the build trips two pins that §G does not list)

- **P1: `06_operator_invitation.sql` #80, the functions that write `revoked_at`.** The list becomes exactly `['confirm_email_challenge', 'issue_operator_invitation', 'owner_transition']`, an equality and never a superset. The pin exists so that each new writer of `revoked_at` is reviewed. `owner_transition` is ruled in R6: EXECUTE to nobody, its UPDATE limited by the R6 predicate and by `invitation_govern_transition_revoke`. Update the assertion's description to name R6.
- **P2: `07_identity_marker.sql` #82, the readers of `app.tx_identity`.** The list becomes nineteen with `owner_transition` added, an equality. The read is accepted: own transaction's row only, a label only, and poly_govern holds no new grant. **One condition:** the actor expression in the hand-off is 0014's (`web`, `signup`, `auth`). The `audit_membership` in force is 0017's (`signup`, `auth`, `session` → `user`). Copied as it stands, a direct raise in a session-marked request writes `membership.role_changed` with actor `user` and `invitation.revoked` with actor `session` in the same transaction. **Change:** use 0017's expression verbatim. **Test (qa, in T-R6a):** on the poly_app raise path, the `invitation.revoked` row's `actor` and `actor_user_id` equal those of the `membership.role_changed` row written by the same transaction. Without that case, a stale copy passes every seam row.

Neither is an exemption: both pins stay exact and gain one reviewed entry each.

## Re-issued ruling (80607cfa): R7b and R7a's in-loop guard

**Accepted; nothing blocks.**
- **R7b closes the measured 40P01.** Before R7b, sign-up locked the invitation rows, then its viewer INSERT's foreign-key check took KEY SHARE on the entity. The raise locked the entity FOR UPDATE, then R6 tried to revoke the same invitation rows. Taking KEY SHARE on the entity first puts sign-up in the order every other path uses: entity, then invitations. KEY SHARE is the weakest lock that conflicts with the gate's and R6's FOR UPDATE, and sign-ups do not queue behind each other. Both interleavings are fail-safe:
  - In (i), the viewer row is accepted before R6 runs, so R6 leaves it alone.
  - In (ii), the step-2 re-read under FOR UPDATE drops the revoked row, and sign-up refuses with `invitation_required`.
- **Step 2's `entity_id = ANY(locked)` restriction is right.** A row issued between the two statements is never claimed without its entity lock. Operator and bootstrap rows (`entity_id IS NULL`) keep their path.
- **The privilege is unchanged.** The lock uses R6's existing poly_govern UPDATE column privilege and `entity_govern_lock` with WITH CHECK (false). No definer can write an entity row through it. Reach is unchanged too: claim and accept stay EXECUTE poly_auth only, and the token-less path needs an IdP-verified address with a live invitation. A held KEY SHARE delays owner changes on those entities for one sign-up transaction, under the definers' 5 s `lock_timeout`. That is negligible.
- **R7a's in-loop guard** (`UPDATE … SET accepted_at … WHERE revoked_at IS NULL`, no row → CONTINUE) stops a seat from accepting a row that its own earlier owner seat, in the same loop, just revoked. The set-once rule would otherwise allow `accepted_at` to be set on a revoked row.

Notes for the build review and qa, neither a ruling change:
- **The replaced `claim_invitations` and `accept_invitations` must be 0009's bodies with only R7b's two changes.** That keeps the bootstrap predicate, `SET lock_timeout = '5s'` and the single `invitation_required` refusal. I diff them against 0009 at the build review.
- **T-R7b (ii) holds the raise for under 5 s.** A longer hold makes sign-up fail with 55P03 (`lock_not_available`) instead of `invitation_required`. That still fails closed, but the case would no longer prove the re-read.
