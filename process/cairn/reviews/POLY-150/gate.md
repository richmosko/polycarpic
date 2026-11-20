# POLY-150 — gate run (qa-engineer-150)

**FINAL: one run on `3607aa34` plus two docs-only commits (the measured HEAD was `9c594fce`; `git diff 3607aa34..HEAD` touches only `process/cairn/**`)** (`feature/poly-150-second-step-screens`; `git status` empty before and after; nobody else ran tests: no test process and no container at start, load 4.1 to 8.2 during the run, 12.9 for the four seconds of the parallel package run). `3607aa34` is devops's fix for the auth container's healthcheck (it sent no client address and so got 503); it changed `infra/compose/prod.yml`, `staging.yml` and `tests/infra/auth-service.test.ts` only. Two earlier runs are below and superseded: at `dc48d669` (all green, before the healthcheck fix) and at `de01a9a4` (four db failures, fixed in `dc48d669`).

| Step | Files | Passed | Failed | Skipped | Total |
|---|---|---|---|---|---|
| `pnpm lint` | — | exit 0 | | | |
| `turbo run typecheck --force` (cache bypassed, 19 tasks, 0 cached) | — | exit 0 | | | |
| tests/db (parallel + serial) | 53 | 1192 | 0 | 0 | 1192 |
| e2e (Chromium, 80 tests, limiter paced) | 11 | 80 | 0 | 0 | 80 |
| tests/ci | 20 | 542 | 0 | 0 | 542 |
| tests/layers | 8 | 545 | 0 | 0 | 545 |
| tests/infra | 4 | 187 | 0 | 0 | 187 |
| tests/config | 5 | 97 | 0 | 15 | 112 |
| `turbo run test --force` (18 package and app tasks, 0 cached) | | | | | |
| &nbsp;&nbsp;apps/web unit | 14 | 142 | 0 | 0 | 142 |
| &nbsp;&nbsp;packages/auth | 8 | 58 | 0 | 0 | 58 |
| &nbsp;&nbsp;packages/config | 6 | 334 | 0 | 0 | 334 |
| &nbsp;&nbsp;packages/db | 6 | 43 | 0 | 0 | 43 |
| &nbsp;&nbsp;packages/tenancy | 2 | 6 | 0 | 0 | 6 |
| &nbsp;&nbsp;apps/auth | 2 | 10 | 0 | 0 | 10 |
| &nbsp;&nbsp;the other 12 workspace packages (one placeholder test each) | 12 | 12 | 0 | 0 | 12 |

**Not run:** `tests/infra/image` (Docker image build, POLY-143), `tests/log`, `tests/workflow` and the cairn Python tests (`scripts/cairn/run_tests.py`): none is in this loop's paths. tests/config's 15 skipped are POLY-152's. No test was skipped or disabled by this loop.

**Order and times (local, 2026-11-19), one sequential script, a saved log, rc and start/end stamp with the load per suite** (`temp/gate/timeline.txt`, one `<suite>.log` each, `db.json`; `temp/` is gitignored, so the stamps are copied here): lint 19:10:16-19:10:18; typecheck 19:10:18-19:10:24; ci 19:10:24-19:10:33; layers 19:10:33-19:10:43; infra 19:10:43-19:10:53; config 19:10:53-19:11:01; packages 19:11:01-19:11:05; e2e 19:11:05-19:13:46 (161 s); db 19:13:46-19:15:47 (121 s wall, 119.1 s by vitest). All rc 0. Nothing in parallel, no count carried from another sha. The e2e server leaked one container (`poly83-qa-52ce773d`, POLY-143); the script removed it by name before the db run, and none remain.

## db time against a same-day control on main

| | Tests | Files | Time | Load (start → end) |
|---|---|---|---|---|
| main `6d78cd91`, same day, same quiet machine (run 19:16:17-19:18:00) | 1059 (2 expected fail) | 48 | 100.4 s | 4.6 → 5.3 |
| this branch, final run | 1192 | 53 | 119.1 s | 3.5 → 5.9 |

**+18.7 s (+19 %) for +133 tests and +5 files** (the second-step, step-up, audit, lock-band and last-method suites). (The earlier control the same afternoon was 97.0 s and the branch 115.6 s at `dc48d669`: +18.6 s, +19 %.) The suites with real cost are the ones that enrol through the real handler (`step-up-reauth`, `method-audit`); each file is in its `DB_AREAS` area, so CI's db job selects them by path. (A first control run in a fresh worktree had 33 failures in `ops-status` and `ops-hardening`: `svelte-kit sync` had not been run there; after it the control is 48/48. Both control runs are saved.)

## e2e wall time and the limiter

The browser suite (80 tests, Chromium, Playwright default workers) takes **161 s (2.7 minutes)**, against 24 s for the 57 specs this loop started from. The sign-in service's limit (5 a minute per path from the one address every request shares) is real in e2e and was never raised, forged or reset. `support.ts` `slot()` mirrors BetterAuth's quiet-period window in one ledger shared by the workers, and a spec takes a slot before the click that sends a limited call. In this run: **9 waits, 531.5 s summed across workers (they overlap), the longest 67.9 s**; the previous run at `dc48d669` had the same. Limited calls the run made: 15 `/sign-in/email`, 11 `/second-step/reauth/begin`, 8 `/two-factor/verify-totp`, 3 each of `/second-step/confirm-code`, `/second-step/send-code` and `/two-factor/verify-backup-code`, 2 `/second-step/reauth`, 1 each of `/second-step/reauth/passkey` and `/passkey/verify-authentication`. The slot margin is 68 s (60 s plus 8: the slot is taken before the click and the request leaves later). CI's unit job carries these 2.7 minutes.

## The flake that is not understood

Kit's passkey re-check spec (`second-step-reauth.spec.ts`) failed once in a full run on frontend-lead's machine at `4de71e05` and passed alone. **The cause is unproven**: I could not reproduce it. At the tip, four full runs in a row were 80/80 (the margin at 61 s once, then at 68 s three times), and an 8-worker stress run at the old margin was 80/80. Kit's data is single-use (the spec removes his app), so the spec cannot be repeated alone. The likeliest cause is the limiter margin (a real 429, "Too many attempts", which I saw once on Kit before the margin was raised), so the margin went from 61 s to 68 s in `de01a9a4`. If it fails again, read its `error-context.md`: a 429 alert confirms this cause, anything else is another.

## The healthcheck delta, `dc48d669` → `3607aa34`

Messages crossed: the lead asked for a partial re-run at the tip while the full final gate above was already running at `3607aa34`, so the table at the top is a **full gate at the tip** and no partial argument is needed. For the record, `git diff --stat dc48d669 3607aa34` is `infra/compose/prod.yml` and `infra/compose/staging.yml` (one line each: the auth container's healthcheck sends `x-forwarded-for: 127.0.0.1`), `tests/infra/auth-service.test.ts` (the new pin) and a docs file under `process/cairn/`; only `tests/infra` and `tests/ci` read the compose files. Re-run at the tip with the rest: tests/infra 187/187 (was 185 at `dc48d669`), tests/ci 542/542, lint exit 0, and everything else. `tests/infra/image` is not run locally.

**The new pin fails with the header removed** (a plant, restored after): with `,{headers:{'x-forwarded-for':'127.0.0.1'}}` deleted from `infra/compose/prod.yml`'s healthcheck, `tests/infra/auth-service.test.ts` › "fetches /api/auth/ok with a valid x-forwarded-for entry and treats a 5xx as unhealthy" fails with `the healthcheck sends no x-forwarded-for: expected null not to be null` (1 failed, 22 passed); the file was restored from a copy and `git status` is clean.

## The run at `dc48d669` (superseded)

All green and identical to the final run except tests/infra at 185 (devops added two pins in `3607aa34`); db 1192/1192 in 115.6 s against a 97.0 s control; e2e 80/80 in 161 s. The saved logs are in `temp/gate-2/`.

## The first run, at `de01a9a4`

Green: lint, typecheck (`--force`), ci 542, layers 545, infra 185, config 97 + 15 skipped, packages, e2e 80/80 (2.7 min). **db: 4 failed of 1191, in three files, each a pin this loop moved and no code fault:**

| Test | Why | Fix in `dc48d669` |
|---|---|---|
| `matrix.test.ts` reverse coverage and its canary | `app.step_up_challenge`, `step_up_totp` and `step_up_pending` were in no matrix row, no unlisted entry and not exempt | the three tables are listed in `permission-matrix.json` with their no-privilege cover, a new test in `step-up-reauth.test.ts` (no privilege for any login role, table and column, all five roles); the matrix test names it |
| `migration-0017.test.ts` | it assumed 0017 is the last migration | it compares the journals up to 0016 and up to 0017 |
| `auth-service-main.test.ts` | `/api/auth/ok` now needs the client address in every `APP_ENV` (R8) | the two requests send `x-forwarded-for` |

These did not show in the earlier partial runs, which ran only the loop's own files. They are the reason the gate runs everything once.

## Criteria

POLY-150 (`POLY-150.md`):
- Screens built in web, replacing the placeholder: `second-step.spec.ts` spec 1 and spec 2 (the dialog, from the gate and from Entities), `second-step-misc.spec.ts` (Settings panel), `web-boundary.test.ts`, `second-step-rc.test.ts`, `hooks.server.gate.test.ts`.
- An enrolled user is held at `/sign-in` until the second step passes, in a browser: `second-step-held.spec.ts` specs 3, 4 and 5 (code, backup code, passkey only); `second-step-locked.spec.ts` for the locked state.
- A browser test enrols a user end to end against the real handler: `second-step.spec.ts` spec 1 (app, ten codes, Make new codes, the later held sign-in) and spec 2 (passkey, virtual authenticator).
- The two DESIGN criteria (the set-up flow; the held page and Confirm it's you) are DESIGN's, `docs/DESIGN/`, reviewed by the Principal; no test proves a document.

POLY-151 (`POLY-151.md`):
- A passed re-check writes `recent_auth_at` through a definer, and poly_app gets no new grant on BetterAuth's tables: `step-up-reauth.test.ts` T3 and T4 (the four definers, the single writer, `UPDATE (recent_auth_at)` for poly_govern only), pgTAP 08 and 11.
- An enrolled user can add and remove a method after the 5-minute window, through the real handler: `step-up-reauth.test.ts` C3 and the success cases, `method-audit.test.ts` ("a later factor added after a re-check"), `last-method-guard.test.ts`, and the browser specs `second-step-reauth.spec.ts` (Rex by code, Kit by passkey).
- A failed or replayed re-check leaves `recent_auth_at` unchanged: `step-up-reauth.test.ts` T1 (replay), T2 (a TOTP code spent once), the error-table rows, the lock cases and the reuse rollback.
- The ruling criterion (a ruling names the route, its rate limit and class, reviewed by seceng) is Addenda 3 to 5 of `ruling.md`, accepted by seceng; it is the lead's to tick.

## Notes for the verdict

- Confirm it's you is built with the backup-code path (D7 (b), accepted residual H.1).
- The audit event (`second_step.method_added` and `method_removed`) is tested in `method-audit.test.ts`; the deploy-gate rows are tested by `gate-check.test.ts` (backend-lead's plants).
- Every refusal on the method tables and the lock guard asserts its SQLSTATE and message (`refusedUnchanged` takes both), after the 42703 bug that hid behind "it fails" from POLY-89.
