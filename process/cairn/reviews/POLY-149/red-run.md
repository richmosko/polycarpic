# POLY-149c — red run (qa-engineer-149)

Tree: `feature/poly-149-stage-2-revocation-and-docs` @ befc9600 (qa's tests on the architect's ruling tip; no implementation). Plan: `test-plan.md`. Commands: `pnpm vitest run -c <config> --exclude '.claude/**'` per suite (db `-c tests/db/vitest.config.ts`, ci `-c tests/ci/vitest.config.ts`, infra and config likewise; tests/layers under the root config; packages and apps from their own directory); `pnpm lint` and `pnpm typecheck` are green on this tree.

## Unmeasured claims (measured before the red run was trusted)

| Claim (ruling) | How measured | Result |
|---|---|---|
| R2: no other BetterAuth write sends the reset shape (count 0 and `locked_until` NULL on an unlocked row) outside a correct code | statement log with values, `second-step-lock.test.ts` › "unmeasured (R2)"; paths: held sign-in, correct TOTP, correct backup code, enrolment (first verify included), regenerate backup codes (200), disable (200); a fresh step-up was stamped first, since both answer 403 without it | **holds.** Only a correct TOTP and a correct backup code send `UPDATE two_factor SET failed_verification_count=$1, locked_until=$2 WHERE id=$3` with `[0, null, id]`; every other path sent no statement listing either column. Passkey sign-in sends none either (the passkey path never reaches the check). |
| R1: poly_app's ten functions and its table list are enough for web | a scratch `0016` (not committed, run through `POLY_DB_MIGRATIONS` against a copy of the chain): `REVOKE ALL` on the six tables, the `email_challenge` column grant and policy, `DROP FUNCTION enter_asserted_user`; then the whole tests/db suite | **no test needed a grant beyond the list.** The first run broke 229 tests; after the fixtures moved (below) the only failures that came from the revocation were five that asserted the old state, each rewritten (user INSERT as poly_app, first-write check by a user UPDATE, the `email_challenge` column read, the N1 EXECUTE pin, two races that shared one session). The remaining scratch failures were the scratch's own (journal and `definers.json` listing the dropped function). |
| R1: nothing reaches poly_app through PUBLIC | pgTAP 11 reads effective privileges over every relation, sequence and function; plant: a new `app` function granted to PUBLIC | pgTAP 11's plant turns it red once 11 is clean (control shown at build-green) |
| R3/R6: `template-clone` resets by clone, not TRUNCATE | grep of `tests/db` | no harness TRUNCATE of an `app` table; the only TRUNCATEs are the refusal tests |

## Counts (passed + failed + skipped = total)

| Suite | Files | Passed | Failed | Skipped | Total |
|---|---|---|---|---|---|
| tests/db (parallel + serial) | 45 | 877 | 67 | 0 | 944 |
| tests/ci | 21 | 547 | 0 | 0 | 547 |
| tests/layers (root run) | 8 | 565 | 8 | 0 | 573 |
| tests/infra | 4 | 184 | 0 | 0 | 184 |
| tests/config | 5 | 97 | 0 | 15 | 112 |
| packages/auth | 8 | 58 | 0 | 0 | 58 |
| packages/config | 6 | 334 | 0 | 0 | 334 |
| packages/tenancy | 2 | 6 | 0 | 0 | 6 |
| packages/db | 6 | 43 | 0 | 0 | 43 |
| apps/auth | 1 | 3 | 0 | 0 | 3 |
| apps/web unit | 9 | 97 | 0 | 0 | 97 |

Not run: e2e (Chromium; the harness revoke still lives in `serve.ts` until the build removes it), `tests/infra/image` (Docker image build, POLY-143) and `tests/log`. The 67 db failures are 67 of this loop's tests; every other db test is green on the unrevoked chain.

## Why each file is red (first failing assertion)

| File | Red | Because |
|---|---|---|
| `second-step-lock.test.ts` | 21/23 | the second lock is 15 minutes, not 30 (BetterAuth's 900 s write; no guard); then no `app.second_step_streak`; the right code during a lock passes the library check. Green on purpose: the passkey-during-lock pin and the statement-log measurement |
| `sign-in-record.test.ts` | 14/14 | no `app.sign_in_record` (42P01) |
| `revocation.test.ts` | 8/8 | poly_app still reads `session`, writes `verification`, updates `two_factor`; `enter_asserted_user` exists; a `web` marker is accepted; `audit_membership` names `web` |
| `enter-session-slide.test.ts` | 2/3 | xmin moves at the cap, twice (N1); the control that a slide below the cap writes is green |
| `sign-in-controls-pins.test.ts` | 16/25 | the control (no plant) is red for both files (11: 12 `not ok`; 12: 29 `not ok`), so every plant would pass vacuously here; the 14 plants that name an object that does not exist yet give 0 `not ok` lines because psql stops at the first error, and fail on that. Each plant is shown against a clean control at build-green |
| `pgtap` › 11, 12, 07 | 3/54 | 11: poly_app holds the six tables and the old EXECUTE set; 12: no table, trigger or function; 07: `enter_asserted_user` still exists (it now asserts the function absent) |
| `second-step-gates` | 2/56 | `email_challenge`: poly_app still reads `attempts`; the N1 EXECUTE pin lists eleven functions where ten are ruled |
| `auth-service-grants` | 1/9 | a user INSERT as poly_app is not refused yet |
| `tests/layers/revoked-names.test.ts` | 8/8 | the names survive in `apps/`, `packages/` and `tests/`; `layers.json` and the subpath; fixture dirs 12, 13, 31; the tsc probe; the harness revoke and `e2e-revoke-scope.test.ts`; no 0016/0017; `definers.json` lacks the new definers |

## Fixtures moved (green now, and stay green)

- `helpers/handle.ts`: `handleFor(db, userId, sid?)` (a live handle, the user row made if absent; a named session keeps its id only for its own user) and `tenantBy(m, db, sid?)`, the stand-in for the removed tenant wrapper.
- `helpers/second-step.ts`: `enterAs` for poly_app enters by `enter_session`; `ROLES` is `['poly_auth']`; a fixture user starts with no session (the entry made one).
- `helpers/marker.ts`: `asUserSql(uid, db)` enters by handle; new `asAuthSql(uid, db)`. `helpers/invitation.ts` follows.
- Callers moved: tenancy, battery, wrappers, identity-marker, auth-routing-pool, auth-signup-wrap, auth-signup-invite, auth-new-user-step, auth-fields, auth-provision-person, auth-service-grants, session-handle-definers, session-handle-pins, second-step-gates, second-step-challenge, the marker bench, pgTAP 07 and `pgtap.test.ts`'s plant. Tests that wrote BetterAuth tables as poly_app now run as poly_auth (`auth-fields`, the S14 email move in `auth-signup-invite`) or assert the refusal.
- identity-marker's asserted-user call shapes (second item, subselect, literal, DO block) are dropped: `session-handle-enter.test.ts` pins `enter_session`'s shapes.
- **Left for the build (source, not tests):** `e2e-revoke-scope.test.ts`, `revoke-target.ts` and serve.ts's revoke; `packages/db/marked-of.test.ts`, `layers/structure.test.ts`, `tests/layers/tsc/*` and the eslint fixtures for the removed names; the comment references in `packages/**`. `revoked-names.test.ts` fails until they go.

## Passing today, on purpose

- passkey sign-in passes during a lock (`second-step-lock.test.ts`); the statement-log measurement; the "slide below the cap still writes" and "settles at the cap" controls.
- `pgtap-membership.test.ts` (N2): poly_auth's membership plant, unchanged.

## Findings for the lead and the architect

1. **Answered in ruling Addendum 1 (44ef4ed4)**: T-L3 is one outcome (42501, row and streak unchanged; the test is tightened), and `guard_second_step_lock_delete` is an invoker outside `definers.json` (pgTAP 12 pins both invokers).
2. (merged into 1)
3. **Shared-session fixtures serialise.** `enter_session` slides the session row, so two concurrent transactions entering on one session id block each other until the first commits (the two C-b races hung on it). Those two races use one session each. A later race test that shares a session will hang the same way.
4. **The fixture `user()` and the record.** Any fixture that enters as poly_app inserts a session, which writes a record row that nothing can delete (append-only). The record tests use `plainUser()` and count by kind and session id for that reason.
