# POLY-90 — verdict (architect, gate 4)

**Verdict: pass.** Build 43ac3376 plus test-only 9e870dbb, against the ruling @ 80607cfa. Code read of 0022–0024, `definers.json`,
`schema/tenancy.ts` and the new tests at 43ac3376; gate record `gate.md` @ 8bced45c; seceng's build review @ 3f353291.

| Axis | Result | Evidence | Sha |
|---|---|---|---|
| §V1 Founder (R1–R3) | pass | 0022/0024 default + both checks, no NOT NULL; 0023 l.13–36 backfill and refusal; T-R1a–c, R2a–d, R3 green; pgTAP 13 | 43ac3376, gate 8bced45c |
| §V2 `issued_via`, revoked rows (R5) | pass | 0023 l.324–340; T-R5a–d green; T-R5b now asserts the refusal at the claim | 9e870dbb |
| §V3 1 → 2 and lock order (R6, R7a, R7b) | pass | source read: entity lock first in `owner_transition` l.153, seat l.204, claim l.238, accept l.282; count after lock via `effective_owner_count`; no role branch; T-R6a–f, R7a, R7b (i)/(ii) green | 43ac3376 |
| §V4 Tombstone (R8) | pass | T-R8 | 8bced45c |
| §V5 §3.1b tests in scope | pass | mapped in `gate.md` §V; request flow, held raise and force stay with POLY-112 / 91 | 8bced45c |
| §V6 Self-Person row (R4, F1) | pass | 0023 l.92–113 (poly_authz definer, at the statement); T-R4 refusals and positives | 43ac3376 |
| §V7 Standing guards | pass | `definers.json` diff exactly four entries; pgTAP 04/06/07/09/13; `DB_AREAS` (founder, owner-transition, migration-0022); R9's three tests; generated freshness in `tests/ci` (890) | 43ac3376 |
| §V8 Mutations | pass | every ruled mutant red; the `keep_an_owner`-lock survivor closed by a gate-exempt removal probe | 9e870dbb, gate 8bced45c |
| Security | pass | build review, one note for POLY-112 (`entity_govern_lock_read` reach) | 3f353291 |
| CI | pass | run 46071636627, 10/10 jobs, on 43ac3376; 9e870dbb is test-only and not yet run in CI | 43ac3376 |
| Suite time | +6 to +10 s (+2 to +4 %) | db suite against main a4ca9243, same day, one control run | 8bced45c |
| Architecture drift | none | ARCH 1.32.0 §3.1b matches 0023 (gate, founder, revocation trigger, lock order, own Person, `issued_via`) | e5ba4b2d |
| Staging backfill (lead's axis) | no ownerless live entity can come from the chain; check before deploy recommended | below | 43ac3376 |

**Staging backfill.** From the code, not measured on the box: `seat_creator` writes the owner row inside the entity's own insert and
refuses with no user; `keep_an_owner` refuses removing or demoting the last owner for every role; both landed with the tables in one
commit (ce293989); the web app has no route that writes membership outside sign-up, so no Person can gain a second owner and then lose
its own user. Only a hand-run bypass reaches an ownerless row: triggers off (`session_replication_role = replica`, `DISABLE TRIGGER`)
or a superuser moving an owner row with `UPDATE … SET entity_id`, which `keep_an_owner` does not see. If the refusal does fire, the
migrate rolls back whole. Before the deploy, run one read-only query as superuser on the box: live entities with no owner row, and
Persons whose own user holds no owner. Both must be empty.

**Accepted as built, no change owed.**
- 0024's tag reads `entity_founder_not_null` but sets no NOT NULL; renaming would rewrite the journal. Name only.
- 0023 also lifts and restores FORCE on `audit_event`, which the backfill reads; within R3's intent; pgTAP 02 pins FORCE afterwards.
- `SKIP LOCKED` in R6 is caught by pgTAP 13's source scan only; a static pin is the right guard for an absent clause.

**For the lead.** CI on the final head (9e870dbb or later) runs at finish. The §F follow-ups are filed (0b62498e).
