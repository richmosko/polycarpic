# POLY-137: tests red (gate 2)

Ruling pinned: `a5e9ce4f3332901fc0763e86b709943704493326`. Run on the worktree at the red commit's parent (`85255223`) plus this commit's tests; no product file is changed. Each module was run alone (no full db run). Commands are run from the repo root:

```
packages/mail            vitest run --root . packages/mail/src/mail.test.ts
packages/auth            vitest run --root packages/auth src/{dist-enumeration,options-137,routing-pool-config,web/sessions}.test.ts
packages/config          vitest run --root packages/config src/mail-137.test.ts
apps/web, apps/auth      vitest run --root apps/web src/auth-pages-137.test.ts ; --root apps/auth src/raw-path-137.test.ts
apps/worker              vitest run --root apps/worker src/jobs/jobs.test.ts
tests/layers, tests/ci   vitest run tests/layers/mail-137.test.ts ; --config tests/ci/vitest.config.ts tests/ci/e2e-stamp.test.ts
tests/db (one file each) vitest run --config tests/db/vitest.config.ts tests/db/<file>.test.ts   (auth-notice-triggers, auth-method-hold, auth-mail-flows, worker-mail-jobs, gate-check)
```

## Result

| Module | Red | Green on arrival | Total |
|---|---|---|---|
| `packages/mail/src/mail.test.ts` | 12 | 0 | 12 |
| `packages/auth/src/dist-enumeration.test.ts` | 3 | 12 | 15 |
| `packages/auth/src/options-137.test.ts` | 10 | 7 | 17 |
| `packages/auth/src/routing-pool-config.test.ts` | 20 | 4 | 24 |
| `packages/auth/src/web/sessions.test.ts` | 8 | 2 | 10 |
| `packages/config/src/mail-137.test.ts` | 34 | 12 | 46 |
| `apps/web/src/auth-pages-137.test.ts` | 9 | 5 | 14 |
| `apps/auth/src/raw-path-137.test.ts` | 0 | 5 | 5 |
| `apps/worker/src/jobs/jobs.test.ts` | 22 | 0 | 22 |
| `tests/layers/mail-137.test.ts` | 6 | 1 | 7 |
| `tests/ci/e2e-stamp.test.ts` | 3 | 0 | 3 |
| `tests/db/auth-notice-triggers.test.ts` | 10 | 0 | 10 |
| `tests/db/auth-method-hold.test.ts` | 25 | 1 | 26 |
| `tests/db/auth-mail-flows.test.ts` | 24 | 3 | 27 |
| `tests/db/worker-mail-jobs.test.ts` | 8 | 0 | 8 |
| `tests/db/gate-check.test.ts` | 137 (all new): 7 where the gate passes a fault it must fail, 130 where the planted object is not in the schema yet (`psql failed: 42P01/42883`) | 0 new; the 124 existing plants and passes stay green | 261 |
| **Total new reds** | **194 outside gate-check, 331 with it** | | |

`tests/ci/db-areas.test.ts`, `db-filter-imports.test.ts` and `changes.test.ts` pass with the four new db files in the `auth` area (167 green); `infra/ci/changes.mjs` gains the four files in `DB_AREAS.auth.tests`, and `apps/worker/src/jobs/` and `packages/mail/` in the auth area's paths and in `TABLE.db`.

## Why each group is red (the stated reason, not an import or a typo)

- **The feature is absent from the schema (db files, gate-check plants):** `42P01 relation "app.method_hold" / "app.mail_outbox" does not exist`, `42883 function app.method_held / cancel_method_hold / claim_mail / arm_hold_cancel / mail_sent / mail_failed / purge_mail_outbox / note_* does not exist`. The 0020/0021 migrations are the build. Those assertions cannot reach a behaviour check until the objects exist.
- **The behaviour is absent where the old code runs (the strongest reds):**
  - a held passkey signs in: `expected [200, undefined] to deeply equal [400, 'AUTHENTICATION_FAILED']`; Confirm it's you with a planted passkey: `[200, undefined]` for `[403, 'method_on_hold']`;
  - an unmarked `UPDATE two_factor SET backup_codes = <longer list>` succeeds (`expected null not to be null`); a poly_auth `UPDATE "user" SET email` succeeds; `SHOW idle_in_transaction_session_timeout` as poly_auth answers `0`;
  - `/change-password` without the flag answers 200; `/reset-password`, `/second-step/cancel-hold` and `/callback/google` answer a sixth request from one address without 429 (`400,…,400`, `404,…,404`, `302,…,302`);
  - `{text:'COMMIT'}` at savepoint depth 1 returns `{rows: []}`: it reached the server as a COMMIT instead of throwing `UnsupportedTransactionControl`;
  - a non-uuid revoke id reaches SQL (`expected undefined to be an instance of HttpError`);
  - the 11th send-code answers `[200, undefined]` for `[429, 'mail_capped']`; the 11th magic link, reset and cap tests find no mail on the new `mailer` (it is ignored), and `/request-password-reset` answers 400 `RESET_PASSWORD_DISABLED` because no sender is wired.
- **The module does not exist yet (`@poly/mail`, the worker's `jobs/` modules, `dist-sites.json`, `SIGN_IN_TX`, three pages):** every case loads its module inside the test, so each reports on its own ("Cannot find module …/packages/mail/src/index.ts", "…/jobs/schedule.ts", `dist-sites.json` ENOENT, `SIGN_IN_TX` undefined, `expected null not to be null` for a page file). This is the one place the red is "absent module"; a new package cannot be red any other way.
- **Config:** `expected [] to deeply equal ['MAIL_FROM', 'RESEND_API_KEY_FILE']` in staging and production for auth and worker; the grammar cases accept `a@b.test, c@d.test` and `a@b.test\nBcc: x@y.test` today.

## Green on arrival, and the mutation that turns each red

| Test | Why it is green | Mutation run now (applied, red, reverted: `git status` shows only the test and CI files changed) |
|---|---|---|
| `raw-path-137` (apps/auth), 4 cases | the ruling says no code change: `handlePublic` already tests the raw pathname | `public.ts`: `new URL(request.url).pathname.toLowerCase()` → **4 failed**, 1 passed |
| `auth-pages-137` R8 (web), 4 cases | same | `hooks.server.ts`: `isPublic` also accepts `p.toLowerCase().startsWith('/api/auth')` → **4 failed**, 1 passed |
| `options-137` accountLockout | `options.ts` leaves it at the library default | `options.ts`: `accountLockout: { enabled: false }` in `twoFactor({…})` → **1 failed**: "the method hold (POLY-137 R3.4) needs accountLockout: expected false to be true"; reverted, 1 passed |
| `dist-enumeration` B: lockfile and pins | one version of each today | a second `@simplewebauthn/server@13.4.0` key under `packages:` → **1 failed**; section A runs the same condition on synthetic input |
| `dist-enumeration` A (8 cases) | pure functions in the test file; each is a construction that must fail (R6.5) | by construction: each case asserts the fault string for its mutated input |
| `routing-pool-config`: `SET TRANSACTION …` (2 cases), `SELECT $1::int` and `BEGIN` string rewrite | the existing grammar already refuses or passes them | positive and characterization cases |
| `sessions`: valid uuid; P0002 and step_up mappings | positive cases | positive cases |
| `mail-137` config: "both set" and dev "neither" (12) | positive cases | positive cases |
| `auth-method-hold`: rename of a held passkey passes | positive case beside the refusal | positive case |
| `auth-mail-flows`: `/magic-link/verify` limiter | the magic-link plugin ships its own 5-a-minute rule (measured: `302 ×5, 429, 429`); the new `customRules` key is red in `options-137` | pinned in `options-137` |
| `auth-mail-flows`: `RESET_PASSWORD_DISABLED` with no mailer; a failing mailer leaves the magic-link answer unchanged | today's behaviour, which the ruling keeps | characterization; the failing-mailer case turns red if the sender is awaited, which cannot be shown before the build |
| `layers`: no package allows `mail/fake` | nothing allows it yet | characterization |
| `gate-check` 124 existing | unchanged plants and passes | n/a |

## Not run

- No full db run (the lead's go was not sought; module runs only).
- e2e (Playwright): none of the new tests; `e2e-stamp.test.ts` is static. The 6-minute one-off for the e2e stamp is a green-gate item.
- `tsc` and the repo lint on the new files: eslint passes on the new test files except `packages/mail/src/mail.test.ts` (ignored by the config until `packages/mail` has its own `package.json` and tsconfig entry; the builder adds it). The `typecheck` of the new test files depends on modules that do not exist and is a green-gate item.
