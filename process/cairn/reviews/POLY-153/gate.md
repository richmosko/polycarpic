# POLY-153c — gate run (qa-engineer-153)

**One run, one clean tree, one sha: `13af0fad`** (`feature/poly-153-web-enters-by-handle`; backend-lead's 60c2a0bf plus qa's last test commit; `git status` empty before and after). This file and the criteria ticks in POLY-153.md are docs-only and land after it.

## Results (passed + failed + skipped = total)

| Step | Files | Passed | Failed | Skipped | Total |
|---|---|---|---|---|---|
| `pnpm lint` | — | exit 0 | | | |
| `pnpm typecheck` (19 tasks) | — | exit 0, svelte-check 0 errors 0 warnings | | | |
| tests/db (parallel + serial) | 40 | 902 | 0 | 0 | 902 |
| e2e (Chromium, under the R7.4 revoke) | 8 | 57 | 0 | 0 | 57 |
| tests/ci | 21 | 547 | 0 | 0 | 547 |
| tests/layers (root run) | 7 | 565 | 0 | 0 | 565 |
| tests/infra | 4 | 184 | 0 | 0 | 184 |
| tests/config | 5 | 97 | 0 | 15 | 112 |
| packages/auth | 8 | 58 | 0 | 0 | 58 |
| packages/config | 6 | 334 | 0 | 0 | 334 |
| packages/tenancy | 2 | 6 | 0 | 0 | 6 |
| apps/auth | 1 | 3 | 0 | 0 | 3 |
| apps/web unit | 9 | 97 | 0 | 0 | 97 |

tests/config's 15 skipped are POLY-152's and unchanged. Not run: `tests/infra/image` (Docker image build, POLY-143) and `tests/log`.

## db time against a same-day control on main

| Run | Tests | Files | Wall time |
|---|---|---|---|
| `main` @ e9974ef5 (clean worktree, same machine, same day, after `svelte-kit sync`) | 753 | 34 | 69 s |
| this branch @ 13af0fad, run 1 | 902 | 40 | 76 s |
| this branch @ 13af0fad, run 2 | 902 | 40 | 76 s |

**+7 s (+10 %) for +149 tests and +6 files** (the six `session-handle-*` and `pgtap-membership` files added; `auth-internal-session` removed). One control run and two tip runs, so the delta is a reading, not a distribution; the lead's rule is to judge it against a same-day control and not one run. The new files join the existing `auth` DB_AREAS job; the one new SERIAL file (`pgtap-membership`) adds a second `freshDb` plus migrate to the serial project.

## Plants (every guard shown to fail), at 13af0fad

Each pgTAP plant is run inside the file's own rolled-back transaction on a migrated database; the control (no plant) reports 0 `not ok`, so each count below is the plant's.

### pgTAP 08: control (no plant): 0 not ok
- a table SELECT outside the allowed set: 6 not ok; first: not ok 11 - effective: poly_auth holds no table privilege outside the list (tenant tables, email_challenge and enrolment_grant included)
- a column SELECT on a table outside the allowed set: 2 not ok; first: not ok 13 - effective: poly_auth holds no column privilege outside the list
- a SELECT through PUBLIC: 4 not ok; first: not ok 11 - effective: poly_auth holds no table privilege outside the list (tenant tables, email_challenge and enrolment_grant included)
- an extra privilege on an allowed table: 3 not ok; first: not ok 11 - effective: poly_auth holds no table privilege outside the list (tenant tables, email_challenge and enrolment_grant included)
- UPDATE on session.recent_auth_at: 2 not ok; first: not ok 13 - effective: poly_auth holds no column privilege outside the list
- EXECUTE on enter_asserted_user: 3 not ok; first: not ok 19 - effective: poly_auth executes no function outside the seventeen (PUBLIC included)
- a function with EXECUTE granted through PUBLIC: 1 not ok; first: not ok 19 - effective: poly_auth executes no function outside the seventeen (PUBLIC included)
- a sequence privilege: 1 not ok; first: not ok 18 - effective: poly_auth holds no sequence privilege in public, app, drizzle
- a privilege on app.session_handle: 7 not ok; first: not ok 11 - effective: poly_auth holds no table privilege outside the list (tenant tables, email_challenge and enrolment_grant included)
- EXECUTE on enter_session: 3 not ok; first: not ok 19 - effective: poly_auth executes no function outside the seventeen (PUBLIC included)
- UPDATE (user_id) on session: 1 not ok; first: not ok 13 - effective: poly_auth holds no column privilege outside the list
- membership in poly_app: 9 not ok; first: not ok 3 - poly_auth is a member of no role
- membership in poly_app INHERIT FALSE, SET TRUE: 2 not ok; first: not ok 3 - poly_auth is a member of no role
### pgTAP 10: control (no plant): 0 not ok
- the deferred check dropped: 6 not ok; first: not ok 34 - session_needs_handle exists on public.session
- the deferred check disabled: 1 not ok; first: not ok 37 - session_needs_handle is enabled (tgenabled = O, fires in every session_replication_role origin)
- the deferred check made immediate-only (not deferred): 1 not ok; first: not ok 36 - session_needs_handle is DEFERRABLE INITIALLY DEFERRED
- the check function executable by poly_app: 3 not ok; first: not ok 19 - effective: no login role executes a new function it is not listed for (PUBLIC included)
- a SELECT on session_handle for poly_app: 3 not ok; first: not ok 10 - effective: no runtime login role holds any privilege on app.session_handle (R1)
- a SELECT on session_handle through PUBLIC: 3 not ok; first: not ok 10 - effective: no runtime login role holds any privilege on app.session_handle (R1)
- a DELETE on session_handle for poly_authz: 2 not ok; first: not ok 14 - poly_authz holds no UPDATE, DELETE or TRUNCATE on session_handle
- attach_session_handle executable by poly_app: 1 not ok; first: not ok 19 - effective: no login role executes a new function it is not listed for (PUBLIC included)
- enter_session executable by poly_worker: 1 not ok; first: not ok 19 - effective: no login role executes a new function it is not listed for (PUBLIC included)
- a missing grant: enter_session revoked from poly_app: 1 not ok; first: not ok 20 - effective: every listed EXECUTE is held
- UPDATE (id) on session for poly_auth: 1 not ok; first: not ok 32 - pinned absent: poly_auth UPDATE (id) and UPDATE (user_id) on session
- recent_auth_at writable by poly_authz: 1 not ok; first: not ok 28 - poly_authz may UPDATE nothing else on session (recent_auth_at in particular)
- a second SET clause on a definer (proconfig has two entries): 1 not ok; first: not ok 23 - the six are SECURITY DEFINER, owned by poly_authz, search_path = '' and no other SET clause (proconfig has exactly one entry)
- a second overload of enter_session taking a hash: 3 not ok; first: not ok 21 - enter_session has one overload only (no function takes a hash)

### Plants in other files (each fails its assertion; the passing run proves the guard bites)

| Guard | Plant | Failing evidence |
|---|---|---|
| deferred check, behaviour | handle-INSERT raises (BEFORE INSERT trigger), on email, magic-link, callback, passkey, sign-up | `session-handle-signin.test.ts`: 5xx, no Set-Cookie of either cookie, no session row |
| deferred check, silent skip | the same trigger returns NULL (no insert) | commit fails 23514, no session row stays (same file) |
| no superuser exemption | superuser INSERT of a handle-less session | `needs its handle` (session-handle-attach) |
| handle forgery (H1) | stored `handle_hash` as bytea, `\x…`, bare hex, base64url; token; id | one `no live session` 42501, marker count unchanged (session-handle-enter) |
| kind proof (H7, T3) | marker of kind web (real `enter_asserted_user`) and kind auth (planted by superuser) | the three definers refuse 42501, rows unchanged (session-handle-definers) |
| proconfig pin | `ALTER FUNCTION app.my_sessions() SET statement_timeout` | query reads `2` entries; pgTAP 10 `not ok 23` above |
| harness revoke target | zero rows, two rows, a second function, a wrong signature | `revokeTarget` throws `found 0` / `found 2` / `not the (uuid, uuid)…` (tests/ci/e2e-revoke-scope) |
| harness revoke scope | the REVOKE text in a migration, `roles.sql`, tests/db, tests/ci, infra or `.github` | `e2e-revoke-scope` condition 1 fails on any file that carries it |
| boundary scanner | planted `public.session`, `public."user"`, `app.session_handle` text | `web-no-betterauth-sql.test.ts` first test flags each spelling |
| hold clears an earlier handle | A signed in, B's hold in the same jar | red at 210bb094 (`handleSetCookie(held)` undefined); green at 60c2a0bf |
| eslint refusals | `@poly/db/session`, `withTenant`, `sessionUserId`, `better-auth`, `@better-auth/*` in web and `@poly/auth/web` | fixtures `35-web-handle-entry/fail-*` each report `no-restricted-imports` |
| N2 | `GRANT poly_app TO poly_auth` (plain, and `WITH INHERIT FALSE, SET TRUE`) | 9 and 2 `not ok` above, from `pgtap-membership.test.ts` (SERIAL) |

## Expectations changed in pgTAP and the matrix (for seceng; basis in `red-run.md`)

poly_backup may SELECT `app.session_handle` (R1, R12); poly_authz keeps `membership` SELECT (0003); 04 truncate triggers 9→10; 07 current_session_id adds poly_authz, `enter_*` set adds `enter_session`, marker readers 9→13; `second-step-gates` N1 poly_app +4 EXECUTE (R2); `permission-matrix.json` unlisted adds `app.session_handle` (R1).

## Open

- `app.session_handle`'s plants and the e2e revoke prove the ruling's pins at the tip; the real-domain TLS path and a Caddy probe are POLY-97, as before.
- The three unmeasured claims in the ruling are measured (`red-run.md`): cascade and deferred check by the db tests at green, step-up callers by the pins test.
