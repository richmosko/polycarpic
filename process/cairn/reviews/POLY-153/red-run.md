# POLY-153c — red run (qa-engineer-153)

Tree: `feature/poly-153-web-enters-by-handle` @ 83c856a3 plus qa's test changes only; no implementation. Plan: `test-plan.md` (As built at its foot). Commands: `pnpm vitest run -c <config> --exclude '.claude/**'` per suite (db `-c tests/db/vitest.config.ts`, ci `-c tests/ci/vitest.config.ts`; tests/layers under the root config; packages and apps from their own directory), JSON reporter; `pnpm typecheck` and `pnpm lint` are green on this tree.

## The three unmeasured claims (measured before the red run was trusted; none contradicted)

| Claim | How measured | Result |
|---|---|---|
| 1. A session delete removes its handle with no privilege of the deleter on `app.session_handle` | scratch prototype of the ruling's R1 table (FK `ON DELETE CASCADE`, RLS forced, SELECT and INSERT for poly_authz only) on a migrated clone; DELETE as poly_auth (no grant on the table) and as poly_authz | the handle row is gone after each; **holds** |
| 2. The deferred check passes when a held sign-in creates and deletes its session in one transaction | same prototype plus R5.2's constraint trigger (`DEFERRABLE INITIALLY DEFERRED`, AFTER INSERT, SECURITY DEFINER by poly_authz); poly_auth INSERT then DELETE, plain and with the INSERT under a released savepoint; controls: insert with no handle, and the same as superuser | both held shapes commit; the handle-less insert fails 23514 at commit, superuser included; **holds** |
| 3. Every caller of the service-side step-up check runs inside a session transaction | code-read: `requireRecentAuth` has one caller, the route-policy before-hook (`route-policy.ts:203`), reached only after `getSessionFromCtx` found a session; `handleAuthRequest` runs any request that has a session in `withAuthSession`. Test written: `session-handle-pins.test.ts` (outside a transaction it must refuse) | **holds**, by code-read; the test measures it at green |

The prototype was a scratch test, not committed. Claims 1 and 2 are re-measured by `session-handle-attach.test.ts` against the real 0015 at green.

## Counts (passed + failed + skipped = total)

| Suite | Files | Passed | Failed | Skipped | Total |
|---|---|---|---|---|---|
| tests/db (parallel + serial) | 40 | 641 | 260 | 0 | 901 |
| tests/ci | 21 | 544 | 1 | 0 | 545 |
| tests/layers (root run) | 7 | 551 | 14 | 0 | 565 |
| tests/infra | 4 | 178 | 6 | 0 | 184 |
| tests/config | 5 | 97 | 0 | 15 | 112 |
| packages/auth | 8 | 39 | 19 | 0 | 58 |
| packages/config | 6 | 328 | 6 | 0 | 334 |
| packages/tenancy | 2 | 4 | 2 | 0 | 6 |
| apps/auth | 1 | 1 | 2 | 0 | 3 |
| apps/web unit | 9 | 82 | 12 | 0 | 94 |
| apps/web e2e | — | — | — | — | the webServer refuses to start (below) |

tests/config's 15 skipped are POLY-152's and unchanged. The unchanged files were green at the branch tip (POLY-152's gate); they were not re-run for a baseline here. Not run: `tests/infra/image` (Docker image build, POLY-143 noise) and `tests/log`.

## Why each new or changed file is red (first failing assertion)

| File | Red because |
|---|---|
| `tests/db/session-handle-enter` (31/31) | `app.session_handle` does not exist (42P01); the fixture inserts the handle row |
| `session-handle-attach` (40/41) | `app.attach_session_handle` does not exist; no table, no trigger |
| `session-handle-definers` (31/31) | no table (fixtures), no `my_sessions`, `recent_auth_ok`, `revoke_my_session` |
| `session-handle-signin` (13/13) | the plant needs `app.session_handle` (42P01) |
| `session-handle-paths` (18/19) | no handle cookie is set; BetterAuth's cookies are `__Host-` at `Path=/` |
| `session-handle-pins` (14/15) | no 0015 and no allowlist entries; `requireRecentAuth` reads the row itself; `withSession` and `NoLiveSession` are not exported |
| `pgtap.test.ts` (19/51) | pgTAP 08 and 10 fail on absent objects; every pgTAP-10 plant test also asserts the unplanted file is clean, so none passes vacuously |
| `pgtap-membership` (1/3) | the control: 08 has `not ok` lines on the red tree (the plants themselves are shown below) |
| the fixture files: `auth-enter-session` (17/21), `auth-new-user-step` (1/28), `auth-provision-person` (1/8), `auth-route-policy` (6/39), `auth-service-grants` (2/9), `second-step-challenge` (22/23), `second-step-gates` (30/78), `second-step-reset` (7/10) | their session inserts now add the handle row in the same statement (`withHandle`) or attach it (`attach`); the table is absent |
| `auth-refresh` (1/7), `auth-second-step` (1/14) | the cookie is `__Host-better-auth.*` at `Path=/`; R8 wants `__Secure-` at `/api/auth` |
| `auth-service-main` (5/8) | the service still requires `AUTH_INTERNAL_HOST` and runs an internal listener |
| `tests/ci/e2e-revoke-scope` (1/3) | no migration `0015` exists |
| `packages/auth/src/session-handle` (11/12), `cookie-lifetime` (1/6), `options` (1/16) | one after-hook, not two; prefix `__Host-better-auth`; no `session-handle.ts` |
| `packages/auth/src/web` (6/6) | `loadSession`, `loadSessionFromService`, `completeSession`, `setAuthInternalOrigin` still exported |
| `packages/config/src/auth-service` (6/26) | `AUTH_INTERNAL_*` still accepted |
| `packages/tenancy/src/provision-person` (2/3) | it reads `public."user"` and ignores the name |
| `apps/auth/src/bind` (2/3) | `internalBind` still exported |
| `apps/web/src/hooks.server.{auth,gate,authtree}` (9/59, 2/2, 1/16) | web loads by BetterAuth's cookie and answers 503 |
| `tests/layers/lint` (6/384), `web-no-betterauth-sql` (4/6), `structure` (4/46) | no eslint rules for the removed names or `better-auth`; `sessions.ts` and `tenancy` query BetterAuth's tables; `structure` re-runs the package suites and inherits their reds |
| `tests/infra/auth-service` (6/21) | the `web-auth` network, auth's fixed address and the second port exist |
| e2e (`handle-cookie.spec.ts` and every other spec) | `serve.ts` refuses to start: the seeded sign-in sets no `__Host-poly_handle` (stops its container first) |

The forced handle-INSERT failure (`session-handle-signin`) and the forgery cases (`session-handle-enter`: stored hash as bytea, `\x…`, bare hex, base64url) are red on the missing table; they go red-for-behaviour only once 0015 exists, and the builder must then see them pass.

## Passing today, on purpose (pins that must stay green)

- `session-handle-pins`: poly_app keeps `enter_asserted_user` and its BetterAuth grants (R0).
- `session-handle-attach`: the held-sign-in create-and-delete commit (claim 2) passes now because nothing checks yet; it must still pass with the deferred check.
- `session-handle-paths`: a TOTP hold sets no handle cookie (also trivially true now; the paired verify test is red).
- `tests/ci/e2e-revoke-scope` conditions 1 and 1b: the revoke is in `serve.ts` and nowhere else.

## Guards shown to fail

- **N2** (`GRANT poly_app TO poly_auth` and `WITH INHERIT FALSE, SET TRUE`): run against 08 as it stood at the branch tip, with only the membership assertions added: control 0 `not ok`; the plain plant 7; the SET-only plant 1. Run today, from the new files, the control is red (08 now also asserts POLY-153's objects); the plants are shown at green.
- **pgTAP 10 plants** (trigger dropped, trigger disabled, made not-deferred, extra grants, a hash-taking overload): they bite only once 10 passes unplanted, so they are shown at build-green; each test asserts the unplanted file is clean first, which keeps it from passing vacuously on the red tree.
- **Boundary scanner** (`web-no-betterauth-sql`): its first test feeds it planted text per table spelling and per name, and it flags each.

## Judgment calls and open points

- **Hooks contract (the ruling is silent).** `withSession(handle, fn)` hands `fn(tx, row)` the flat camelCase enter_session row; hooks builds `locals.session` as `{ user: { id, name, image }, expiresAt }` from it. The ruling says both "`shell.name`" and "`locals.session = shell`"; the tests pin the flat row.
- **Bytea forgery case.** A raw 32-byte Buffer parameter bound to a text argument may be refused by the driver or the encoding check before the definer; the test asserts refusal and no marker, not the `no live session` text, for that one shape. The three text shapes assert the one message.
- **`serve.ts` finds the reserved definer in the catalog** (`proname LIKE 'enter_asserted%'`), not by name: `poly/reserved-literal` refuses the name outside `packages/db/src/context.ts`.
- **A new SERIAL file** (`pgtap-membership`) for N2: role-membership GRANTs are cluster-wide state and `db-harness` C5 refuses them in a parallel file.
- **Deleted:** `tests/db/auth-internal-session.test.ts` (the listener it tested is removed by R9); `DB_AREAS` and `db-areas.test.ts` follow.

## Test fixes after the builder's 0015 report (nine defects; qa-engineer-153)

Items 1–6 were test mechanics and are fixed without weakening: (1) the attach call is the exact text `SELECT app.attach_session_handle($1, $2)`, no alias (plugin unit test too); (2) `search_path` is matched by `'search_path=""' = ANY (proconfig)`; (3) the trailing-clause shape replaces the syntax-error one; (4) the second-marker test uses a savepoint; (5) and every marker count in `session-handle-enter` now compares before and after; (6) `::regprocedure`.

**Expectations changed in pgTAP, for seceng's build review (each checked against the ruling):**

| # | File | Was | Now | Ruling basis |
|---|---|---|---|---|
| 7 | `10_session_handle.sql` | no login role incl. poly_backup holds any privilege on `app.session_handle` | the four runtime roles and poly_migrator hold none; **poly_backup may SELECT (pg_read_all_data), holds no write** | R1 names poly_app, poly_auth, poly_worker, poly_operator; R12 "a backup reader holds hashes". Not loosened for anyone else. |
| 8 | `10_session_handle.sql` | poly_authz holds nothing on the tenant tables | no write privilege on the five tables, no SELECT on entity, invitation, audit_event, notification; SELECT on `membership` allowed | `membership` SELECT is from 0003, not from this loop; R2 lists tenant tables as "gains none". Builder to confirm no new grant of 0015 reaches them. |
| 9a | `04_tenancy.sql` #18 | BEFORE TRUNCATE trigger on 9 tables | 10 (adds `app.session_handle`) | R1 truncate trigger |
| 9b | `07_identity_marker.sql` current_session_id EXECUTE | poly_app, poly_auth, poly_govern | adds poly_authz | R2 |
| 9c | `07` enter_* set | four functions | adds `enter_session=>poly_app` | R2, R4 |
| 9d | `07` marker readers | nine functions | thirteen: adds enter_session, my_sessions, recent_auth_ok, revoke_my_session (the ones reading tx_identity; `session_needs_handle` is not listed) | R4, R6 |

Items 7, 8, 9 were set from the ruling before 0015 was pushed; they are re-run against the real migration and any difference is reported, not adjusted to fit.
