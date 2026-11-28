# POLY-90 — gate 3, build green (qa)

**Result: green** at 9e870dbb (build 43ac3376 plus one test-only commit). Ruling @ 80607cfa. seceng's build review @ 3f353291 passes.

## Runs

Local, macOS, with `apps/web/.svelte-kit`, `apps/web/build`, `node_modules/.vite` and `__pycache__` deleted first, then `pnpm install --frozen-lockfile`. Commands are `ci.yml`'s.

| Check (exit 0 unless noted) | Result |
|---|---|
| DB battery, `vitest run -c tests/db/vitest.config.ts`, after `svelte-kit sync` and the web build | at 43ac3376: 1531 passed, 1 skipped (twice). At 9e870dbb: 1532 passed, 1 skipped, 64 files |
| `auth-row.mjs db` | 43/43 and 40/40 |
| `eslint packages apps scripts/layers` (exit code read: 0). CI's separate drizzleAdapter lint row was not repeated locally: its files are inside this lint and the per-package tests | clean |
| `turbo run typecheck --force` | 20/20 |
| `layers/check.mjs`; `vitest run tests/layers` | pass; 568 |
| `vitest -c tests/ci` (includes generated freshness and db-areas) | 890 |
| `vitest -c tests/infra` | 703, 3 skipped |
| `turbo run test --force`; `vitest -c tests/config` | 19/19; 100, 15 skipped |
| `check-migrations`, dist freshness, `pnpm audit`, `check-pins`, `check-run-expr`, `cairn check`, gitleaks `origin/main..HEAD` | pass |
| `compose-policy.mjs` | **exit 1 here and on `main`'s exported tree** (the same 3 `render-error` lines; local Compose 5.7.0, pin 5.7.1). Passes in CI |
| `actionlint` | not installed locally; passes in CI |
| CI, dispatched, run 46071636627 on 43ac3376 | all 10 jobs success (`db`, `lint`, `unit`, `image`, `deploy-real` among them). It predates 9e870dbb |

**DB suite wall time, same day, same machine:** `main` a4ca9243 (exported tree, own install and web build) 264.8 s (61 files, 1477 passed); branch 274.6 s, 270.9 s, 270.6 s. **Delta +6 to +10 s (+2 to +4%)**; one control run, load average 5 to 10. In CI the `db` job took 5 min 28 s (no same-day CI control).

## §V

| §V | Evidence (green at 9e870dbb) | Holds |
|---|---|---|
| 1 Founder | T-R1, R1a–c, R2a–d, R3 (`founder.test.ts`, `migration-0022.test.ts`); pgTAP 13: default, both checks, the only grant on the column is poly_govern UPDATE, `WITH CHECK (false)` (also T-R6d, pgTAP 09) | yes |
| 2 `issued_via`, revoked | T-R5a (`founder`), R5b–d (`owner-transition`); pgTAP 13: no role holds UPDATE (issued_via); the column is also in tenancy's not-updatable battery | yes |
| 3 1 → 2 | T-R6a, R6b, R6c, R6e, R6d, R6f, R7a, R7b (i) and (ii), the lock probes for claim, accept and seat. Source read: 0023 takes the entity lock before any invitation lock or count in `owner_transition` (l.153), seat (l.204–208), claim (l.238–245), accept (l.282–289) | yes |
| 4 Tombstone | T-R8 | yes |
| 5 §3.1b tests in scope | map to §S; request flow, held raise, force stay with POLY-112 / 91 | yes |
| 6 F1 | T-R4, four refusals and two positive cases | yes |
| 7 Guards | pgTAP 04, 06, 07, 09, new 13; `tenancy.test.ts` (R9: three tests, plus two columns in the battery); `DB_AREAS` and its pins; `definers.json` diff is exactly four entries; 0022/0024 freshness in `tests/ci`. pgTAP 02 and 05 (named in §G) needed no change and pass | yes |
| 8 Mutations | below | yes, with one added test |

"T-R6 lock" is the probe for R6's own lock only, not evidence for a criterion. The R7b step 1 mutant is judged on T-R7b (i) and the lock probes (architect, POLY-90.md @ af72051a).

## Mutants

One edit per run on a scratch copy of `packages/db/migrations` (`POLY_DB_MIGRATIONS`); five files: founder, owner-transition, migration-0022, tenancy, pgtap. Controls with no edit: 150/150, and 151/151 after each test added. "13" = `pgtap/13_founder.sql`.

A first pass partly ran across a machine sleep. Every run with a Docker, hook or lock timeout from that, or with a broken edit (a PL/pgSQL alias clash, a GRANT as the wrong role, a rename that also changed deferral), was fixed and run again; the table holds only the re-runs for those. Some mutants still show `Test timed out`: a removed or added refusal leaves a two-connection test waiting.

| §V8 / seceng mutant | Red (count) | The tests that name it |
|---|---|---|
| drop both founder triggers | 9 | T-R2a ×4, R2d, founder move, R8; pgTAP 04, 13 |
| drop F1 trigger | 6 | T-R4 ×4; 04, 13 |
| drop `issued_via` check | 1 | T-R5a (superuser) |
| drop R6's lock | 2 | T-R6 lock; 13 |
| drop R7a step 1 | 4 | T-R7a rounds ×3, seat lock probe |
| swap R7a step 3 | 7 | T-R6b, T-R7a ×4, R7a step 3, R5c |
| drop R7a's revoked guard | 1 | R7a step 3 |
| drop R7b step 1 (both) | 3 | claim and accept probes, T-R7b (i). Claim only: probe + (i). Accept only: probe |
| drop `keep_an_owner`'s entity lock | **0, then 1** | **survived the tests-red set**: the gate locks the same row first for poly_app. Added a probe on a gate-exempt (superuser) removal; red with "waits and is then refused by keep_an_owner". Dropping both locks also turns the R9 race red |
| superuser exemption on R2 / R4 | 5 / 4 | T-R2a superuser, R2d, founder move / T-R4 superuser ×2 (plus 12, 13) |
| superuser exemption on R6 / R5 | 4 / 1 | T-R6e, R6 lock (12, 13) / T-R5a |

| Other mutants | Red |
|---|---|
| only the membership founder trigger / only the entity one | 8 / 2 (founder move) |
| no default; INSERT grant; UPDATE grant on the founder | 50 (every entity insert fails); 5 (T-R1a); 6 (T-R1b) |
| no Person check; no tombstone check | T-R1c; the both-directions test |
| founder check not deferred; initially immediate; invoker; no purged skip | 11; 8 (T-R2b); 12 (T-R2a role switches); 2 |
| entity trigger sorted before the creator seat | T-R2c; 13 |
| F1 refuses every owner change; F1 on UPDATE only | T-R4 positives; T-R4 delete ×2 |
| DELETE on entity granted; the gate refuses all on multi-owner | "no role may delete"; the R9 remove-and-lower test |
| backfill: no self rule; no audit; any audit role; not still owner; tie reversed; under FORCE | T-R3 success case each (no self rule also the Person refusal) |
| backfill: no refusal; FORCE not restored | the four refusals; T-R3 + 02, 04 |
| claim / accept / seat take revoked rows | T-R5b claim + R7b (ii); T-R5b accept; T-R5c, R5d and others (seat needs both its filter and its guard removed; either alone holds) |
| UPDATE (issued_via) granted | T-R5a poly_app; 02, 06, 11, 13 |
| R6: dropped; unclaimed only; unexpired only; every entity; `n <> 2`; caller-relative count | 14; 7; T-R6a; T-R6a + 2 tenancy; T-R6e; T-R6e + 04, 13 |
| R6: SKIP LOCKED | **pgTAP 13 only** (source scan); no behaviour test turns red |
| R6: no role test; fires on every write | two-sign-ups test; both "revokes nothing" positives + 6 |
| R6: 0014's actor expression; no notification; extra payload key | T-R6a, R6c; 8; 8 |
| lock policy `WITH CHECK (true)`; `invitation_govern_update` loosened | 09, 13; 06, 13 |

**Tests never seen red at tests-red** were each turned red above, except one: "a raising transaction that rolls back revokes nothing" cannot be broken by any edit inside the database (a trigger cannot write outside its transaction); the in-transaction evidence is T-R6a.

**Found by the mutants and fixed in 9e870dbb:** the `keep_an_owner` survivor above; T-R5b's claim case stayed green when `claim_invitations` took revoked rows (accept refused later), so it now asserts the refusal at the claim.

## Ruled items in the tree

| Item | Where |
|---|---|
| R1 | 0022, 0024, `schema/tenancy.ts`; no NOT NULL; grants in 0023 l.43–44 |
| R2 | `founder_holds_owner`, two deferred triggers; no row raises; no role branch (`rolsuper` count in 0023: 0) |
| R3 | 0023 §1 and the DO block. 0023 also lifts and restores FORCE on `audit_event`, which the backfill reads (beyond the ruling's two tables) |
| R4, R5, R6 | `keep_own_person_owner`, `invitation_set_once`, `owner_transition`, `effective_owner_count`, four policies; `owner_count` has no new grantee (04) |
| R7a, R7b | seat, claim, accept as cited in §V3; no SKIP LOCKED or NOWAIT |
| R8, R9 | T-R8; the three tenancy tests |
| Addendum 1, addendum 2 | folded into the re-issue @ 80607cfa: tombstone and Person checks, definer F1, no superuser step in R6, `{invitation_id, entity_id, reason}`, T-R1c/R2d/R5d, four definers |
| S3 | §F text for POLY-112 (`change_request_id`) and POLY-166 |
| S4 | pgTAP 13, T-R6f |
| seceng P1, P2 | 06#80 three functions; 07#82 nineteen; actor expression is 0017's; the actor-equality case in T-R6a |
| Docs | ARCH 1.32.0 §3.1b; SECURITY 1.21.8 |

## Open, none blocks this gate

- §F follow-up comments: POLY-91, 112 and 129 mention POLY-90; POLY-114, 115, 116 and 166 do not yet (the lead files).
- The third migration is tagged `0024_entity_founder_not_null` but sets no NOT NULL (the ruling names it `0024_entity_founder_checks`). Name only; renaming changes the journal.
- Whether staging holds an entity the backfill refuses is measured only by the staging migrate.
