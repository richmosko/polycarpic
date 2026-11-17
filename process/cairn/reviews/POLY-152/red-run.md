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
