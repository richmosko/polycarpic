# POLY-152c — red run (qa-engineer)

Tree: `feature/poly-152-sign-in-service` + qa's test changes, no implementation. Plan: `test-plan.md`. Commands: `pnpm vitest run -c <config> --exclude '.claude/**'` (db: `-c tests/db/vitest.config.ts`, JSON reporter). `svelte-kit sync` run first.

## Counts (passed + failed + skipped = total)

| Suite | Files | Passed | Failed | Skipped | Total |
|---|---|---|---|---|---|
| tests/db (parallel + serial) | 33 | 588 | 147 | 0 | 735 |
| tests/ci | 19 | 535 | 1 | 0 | 536 |
| tests/infra/auth-service.test.ts | 1 | 0 | 17 | 0 | 17 |
| tests/config/auth-bind.test.ts | 1 | 0 | 12 | 0 | 12 |
| packages/config (own run) | 9 | 99 | 8 | 0 | 107 |
| packages/auth (own run) | 7 | 33 | 10 | 0 | 43 |
| tests/layers (root run, incl. structure.test.ts) | 6 | 308 | 9 | 0 | 317 |
| apps/web unit | 2 | 41 | 12 | 0 | 53 |

The db and tests/ci rows are the per-config full runs. The unit rows below them are the numbers each command printed (tests/layers ran under the root config and also swept other root projects; apps/web ran 2 files, not its 5). They show red, not a gate count; the gate-1 counts are re-taken per config at build-green. An earlier db run (before the suite imports were made per-call) showed 31 skipped in `auth-internal-session` (24) and `auth-refresh` (7) because `beforeAll` imported `apps/auth`; that was a failed setup, not a result. Fixed: those files now fail test by test (0 skipped above). tests/ci's one failure is `db-areas` "apps/auth turns db_auth on" (red, intended). Not run in this record: `apps/web/tests/e2e` (needs the service and a browser; gate 3), `tests/infra/image` (Docker image build; POLY-143 noise), `tests/log`.

## Why each new file is red (first failing assertion)

| File | Red because |
|---|---|
| `tests/db/pgtap/08_poly_auth_grants.sql`, 01, 03 | role poly_auth does not exist (`pgtap.test.ts` 3 failed) |
| `auth-enter-session` (21) | `app.enter_auth_session` does not exist (42883) / no poly_auth login |
| `auth-provision-person` (8) | `app.provision_person` does not exist |
| `auth-service-grants` (7 of 9) | 0014 absent: poly_app still holds the twelve; stamp names poly_app; no allowlist entries; poly_auth role absent |
| `auth-internal-session` (24) | `apps/auth/src/internal.ts` and `public.ts` do not exist |
| `auth-signin-tx` (5 of 11) | no `withSignInTx`: a failure after the session INSERT leaves the row (`/sign-in/email`, passkey, held TOTP, held backup code) |
| `auth-refresh` (5 of 7) | session cookie is 7 days (Max-Age 604800, measured 1,987,200 s short of 30 days); the cap's clearing cookie hardcodes `Path=/` |
| `second-step-gates` (35), `second-step-challenge` (19), `identity-marker` (2), `auth-new-user-step` (16), `auth-fields` (1), `auth-session` (1) | retargeted to the real role: `password authentication failed for user "poly_auth"` / role absent / poly_app pool |
| tests/infra, tests/config, tests/layers, packages/{auth,config}, apps/web unit | no `auth` service in compose/Caddy/pg_hba/registry; `apps/auth`, `web.ts`, `cookie-lifetime.ts` absent; web still holds BetterAuth and the `setCookie` relay |

## Tests that pass today, on purpose (regression pins, must stay green)

- `auth-signin-tx`: `/magic-link/verify` and `/callback/:id` already commit as one transaction (`withContextFreeTx`, R9: kept); the four §6.1 refusal tests (hold row, write set, five-try lock, 5xx rollback) and the held-sign-in test pass: the existing behaviour already satisfies them and the move to `withSignInTx` must not break it.
- `auth-refresh`: `rememberMe:false` sets no Max-Age; nothing sets a session cookie on `/get-session` or `/sign-in/magic-link`.
- `auth-service-grants`: poly_app keeps `second_step_required`, `has_role`, `visible_entities`, `owner_count`, `enter_asserted_user` (a control against over-removal).
- The other 340-odd existing db tests are unchanged and pass.

## Assumed names (reconcile in `tests/db/helpers/auth-service.ts` and the unit files only)

`configure({ auth })` · `apps/auth/src/{internal,public,bind}.ts` exporting `handleInternal(req, auth)`, `handlePublic(req, auth)`, `internalBind(env)` (env `AUTH_INTERNAL_HOST|SOCKET|PORT`, `AUTH_PUBLIC_PORT`) · `packages/auth/src/web.ts` `loadSessionFromService(req, {origin, fetch})` · `packages/auth/src/cookie-lifetime.ts` `cookieLifetime()` with plugin id `cookie-lifetime` · `withAuthSession` / `withSignInTx` on `@poly/db/auth` · layers keys `auth-app`, reserved literals `enter_auth_session` (`packages/db/src/context.ts`) and `provision_person` (`packages/tenancy/src/index.ts`).

## What is not covered yet (said, not hidden)

- **D2** (secret and token never in the service's log): not written; needs the service entry. Written at green, against `tests/log/canary.ts`.
- **Passkey and held-TOTP path** of the forced-failure test run through BetterAuth's real flows; the OAuth path stubs only the network edge.
- **R7 day-10 rotation Max-Age**: unmeasured by the ruling; `auth-refresh` asserts the fresh-row case and does not guess the rotation value.
- **poly_app positives in `second-step-gates`**: the refusal loops still run both roles (right), but I did not audit every positive step in the 595-line file for a poly_app call that loses EXECUTE. The green run will show any; a failing poly_app positive there is a test to move to poly_auth, not a ruling issue.
- A live probe from the Caddy container (R6.2): waits for POLY-97.

## Addendum (after backend-lead-152 contract names and the architect's layer condition)

- Internal handler is `handleSessionRequest` from the `@poly/auth` root; public is `handleAuthRequest`. `startAuthService(env)` and `internalBind(env)` (`{host}|{path}`) are exercised by the new `tests/db/auth-service-main.test.ts` (listeners, path limits, three startup refusals, secret not in logs = D2) and `tests/config/auth-bind.test.ts`.
- `tests/layers/auth-service.test.ts` now walks imports transitively from web entry points and `packages/auth/src/web.ts`; it is shown to fail on 7 planted imports (direct, `@better-auth/*`, two-hop relative chain to the root, `@poly/db/auth` through tenancy, a non-`web*` auth file, dynamic import, `.svelte` script) before it counts, with a clean control. The 8 plant tests pass today by design; the 7 repo checks in that file are red.
- Passes today on purpose, one more: `auth-internal-session` day-8 idle through the direct `/api/auth` door (handleAuthRequest already refuses an expired row).
- Open for the build: `loadSession` leaves the `@poly/auth` root, so the `auth-session.test.ts` `load()` calls (12) and `helpers/auth.ts` need retargeting to `handleSessionRequest` (first-load provisioning and the gate move to web). I retarget them when the build lands, so the new shape is not guessed.

### Real-tree plant, two hops down (removed after)

`packages/auth/src/web.ts` -> `web/a.ts` -> `web/b.ts` importing `better-auth` and `@poly/db/auth`. The repo check failed and named the plant: `better-auth imported by packages/auth/src/web/b.ts`. (`@poly/db/auth` was already reported once via the existing web chain; each file is visited once.) The plant files are deleted; `git status` clean of them.

## Build milestone 1 (6fb0d4be, 0014 + roles.sql) — rulings on backend-lead-152's test objections, at ruling 646e35ed

Counts: 4 accepted, 0 refused (backend-lead's four items) + 2 accepted (devops's stale infra items).

| # | Item | Decision | Reason (ruling section) |
|---|---|---|---|
| 1 | `auth-enter-session` asserted `markers() === '0'` | **Accept** | R5 writes kind `auth`; committed fixtures (`f.user`, `f.session`) leave kind `web` rows, which say nothing about the attempt. The count is now `kind = 'auth'` only, so a stray marker from a refused entry still fails. |
| 2 | `auth-provision-person` commit lacked `accept_invitations` | **Accept** | R3 + the sign-up order of 0007 (commit-time `signup_stamp_cleared`): a sign-up ends by accepting its invitation. The test now seeds an invitation and runs claim, insert, enter, provision, accept, commit. |
| 3a | pgTAP 08 effective checks counted pgTAP's own objects | **Accept** | R2 scopes the pin to what the roles.sql owners create in public/app/drizzle; extension members (pgTAP lives in `public`) are not ours. seceng §5.3's PUBLIC condition is kept: the new 'planted grant' tests in `pgtap.test.ts` show the file fails on 8 planted grants (table SELECT, column SELECT outside the set, SELECT through PUBLIC, TRUNCATE on an allowed table, `recent_auth_at` UPDATE, `enter_asserted_user` EXECUTE, a PUBLIC-executable function, a sequence) and passes the control. The membership plant (`GRANT poly_app TO poly_auth`) is NOT in that list: `tests/ci/db-harness` forbids role-membership statements in a parallel file. Membership stays pinned by 08's `pg_auth_members` check but is not shown to bite. |
| 3b | `role_column_grants` lists table-level grants per column | **Accept** | R2's table lists table-level grants on account, verification, two_factor, passkey, tx_identity, `__drizzle_migrations`; the check now allows column rows for exactly those tables and `user`/`session`. Extras are still caught by the effective column check. |
| 4 | identity-marker, pgTAP 05, 07 test 8, 03 test 8 not retargeted | **Accept** | R8 moves the three sign-up definers to poly_auth; R2 adds poly_auth to `tx_identity` SELECT and the readers (`current_session_id`); R2 makes it a sixth login role. identity-marker uses a superuser connection that switches between `poly_auth` and `poly_app`; pgTAP 07 also expects `enter_auth_session` and (R3) `provision_person` among the marker readers. |
| 5 | stale `tests/infra/baseline.ts` (web mounts `auth_secret`, `resend_api_key`) | **Accept** | R1.3: `AUTH_SECRET_FILE` and the OAuth secrets are auth's alone, and `RESEND_API_KEY_FILE` moves web→auth (the worker keeps it; `plaid_secret` stays on web). The fixture gains the `auth` service, the internal `web-auth` network and poly_auth's hba lines; the mutation fixtures that used `auth_secret__web` use `plaid_secret__web`. |
| 6 | `lint.test.ts:265` asserts web has `auth_secret` | **Accept** | Contradicts R1.3 and seceng #17. Now: web and the worker mount no auth secret; auth does. |

Also changed by me, each under the ruling named: `second-step-gates` tenancy refusals assert the guard's message for poly_app and a bare 42501 for poly_auth (R2: no tenancy privilege, so poly_auth is refused by permission first); forge (b) is refused at entry and (c) cannot be built, because the marker takes its user from the row (R5, R8); poly_app's marked-helper positives became refusals with the row unchanged (R8); N1's pin is the 0013 set minus exactly the twelve; challenge's "marker with no session" is an entry refusal. The extra `SELECT (id, name, signup_txid)` on `user` for poly_govern: no test of mine admits or forbids it (the pin is about poly_auth); not touched.

### Counts at this tree

| Suite | Files | Passed | Failed | Skipped | Total |
|---|---|---|---|---|---|
| tests/db | 34 | 594 | 148 | 0 | 742 |
| tests/ci | 19 | 536 | 0 | 0 | 536 |
| tests/infra | 4 | 180 | 0 | 0 | 180 |

All 148 db failures are in files whose handler path is still the poly_app pool, i.e. milestone 2 (`configure({auth})`, `withAuthSession`/`withSignInTx`, `apps/auth`): auth-client-ip (4), auth-fields (3), auth-internal-session (23), auth-new-user-step (2: `enterNewUser` through the app pool), auth-refresh (6), auth-route-policy (20), auth-second-step (10), auth-service-main (8), auth-session (14), auth-signin-tx (8), auth-signup-invite (17), auth-signup-wrap (3), operator-invite (12), second-step-flow (18). All of pgTAP (01 to 08), identity-marker, auth-enter-session, auth-provision-person, auth-service-grants, second-step-gates, second-step-challenge, second-step-reset and matrix are green.

## Build at bafd87e3..10c7b21e — rulings on backend-lead-152's items 1-12 (build-findings), at ruling 646e35ed and architect f16e92d1

| # | Item | Decision | Reason |
|---|---|---|---|
| 1 | `options.test` plugin list lacks `cookie-lifetime` | **Accept** | R7: the plugin is last in `plugins[]`. The test now pins the five ids and that `cookie-lifetime` is last. |
| 2 | `pg-seam-scan` pins 3 pools | **Accept** | R2 / contract point 1: a fourth, poly_auth-only pool. Pinned at 4, every one on `ExtendedClient`. |
| 3 | routing-pool test expects `poly_app` outside a transaction | **Accept** | R8: the routing pool is poly_auth's. `cu` is `poly_auth`. |
| 4 | `loadSession` returns no `setCookie` | **Accept** | R7: web relays no cookie. The test asserts the key is absent. |
| 5 | C7 test keeps the `__Host-` prefix | **Accept** | better-call forces `Path=/` on any `__Host-` name; R7 says the scope changes in POLY-153 with the prefix. The test sets a non-`__Host-` prefix and `Path=/api/auth`, and still asserts the clearing cookie carries the path it was set with. |
| 6 | lockout is 10, not 5 | **Held, then accepted in principle** (architect f16e92d1: keep 10) | The two `auth-signin-tx` lockout tests still assert five and stay red until the lead confirms seceng accepted 10; then they become 9 refusals (count 9, `locked_until` NULL), the 10th locks, an 11th try with the right code is refused and makes no session, same for backup codes, lock duration recorded not asserted. |
| 7 | web hook tests mock the old `@poly/auth` | **Accept** | R1.6, R6.2, R7. Rewritten to mock `@poly/auth/web`: the whole `/api/auth` tree is 404 with no lookup; a 503 from the service is a 503 page, never a redirect; no cookie is relayed; the gate redirect sets none. |
| 8 | config tests treat the auth secret, OAuth files and `RESEND_API_KEY_FILE` as web's | **Accept** | R1.3. Secret-bearing cases run as service `auth` (poly_auth); web refuses `AUTH_SECRET_FILE` as forbidden. |
| 9 | layer checker demands the base for a subpath allow | **Accept (architect f16e92d1, 1)** | `tests/layers/check.test.ts` gains the two subpath-only cases and a still-refused unknown subpath; green on the build (10c7b21e). |
| 9b | web may not import `@poly/auth` once its list says `auth/web` | **RED, build finding** | New lint fixtures `34-web-auth-subpath`: `import '@poly/auth/web'` from web passes; `import '@poly/auth'` from web is NOT refused (0 errors). Cause: `scripts/layers/generate.mjs:37` builds the boundaries allow list from `a.split('/')[0]`, so `auth/web` grants the `auth` index. Fails `lint.test.ts`, the only red in tests/layers. |
| 10 | ARCH §2.2 | done by the architect (b7f5440c); `check.test.ts` "passes on the unmodified file" is green. |
| 11 | package name collision | **Accept (architect f16e92d1, 2)** | `relative-structure` now compares every `package.json` name with the name layers.json gives its dir, unique, `@poly/` prefixed; `apps/auth` is `@poly/auth-app`. |
| 12 | `structure.test` "tests run alone" | green after 1, 2, 7, 8. |

Also, found running the whole db suite on the build, each under the ruling named: the context-free kind is poly_auth (R2), so tests that used it as a tenant-table or `has_role` reader moved: `battery` grants its throwaway canary tables to poly_auth (the question is still "what does RLS show a role with a grant and no identity") and its same-backend precondition now covers the tenant pool only; `tenancy` asks `has_role`, `visible_entities` and `owner_count` of poly_app with no marker; `wrappers` sets the session-level setting on poly_auth; `identity-marker` also accepts `permission denied for function enter_asserted_user` for the plain pool; `ops-hardening` starts web without `AUTH_SECRET_FILE` (forbidden) and with `AUTH_INTERNAL_URL`; `auth-signup-wrap` grants its trigger table to poly_auth; `auth-signup-invite` calls `provisionOwnPerson` (R3) and probes tenant visibility as a refused read; `auth-session` grants its sequence to poly_auth.

### Counts at 10c7b21e + this commit

| Suite | Files | Passed | Failed | Skipped | Total |
|---|---|---|---|---|---|
| tests/db | 34 | 749 | 2 | 0 | 751 |
| tests/ci | 19 | 536 | 0 | 0 | 536 |
| tests/infra | 4 | 180 | 0 | 0 | 180 |
| tests/layers | 6 | 550 | 1 | 0 | 551 |
| tests/config | 6 | 107 | 0 | 15 | 122 |
| packages/auth | 7 | 43 | 0 | 0 | 43 |
| packages/config | 6 | 327 | 0 | 0 | 327 |
| packages/db | 6 | 43 | 0 | 0 | 43 |
| packages/tenancy | 1 | 3 | 0 | 0 | 3 |
| apps/web | 9 | 89 | 0 | 0 | 89 |

The 15 skipped in tests/config are `tests/image` cases gated on `POLY_IMAGE_BUILD=1` (the image build; not run here). The three red tests: the two lockout tests (held for seceng) and the `@poly/auth` lint fixture (9b, a build fix).
