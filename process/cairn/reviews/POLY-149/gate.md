# POLY-149c — gate run (qa-engineer-149)

**FINAL: one run, one sha `9fc167f4`** (`feature/poly-149-stage-2-revocation-and-docs`, after Addenda 1 to 6; `git status` empty before and after; nobody else ran tests, load 3.8 to 5.9 throughout). The earlier run below is superseded and kept for its main control and history.

| Step | Files | Passed | Failed | Skipped | Total |
|---|---|---|---|---|---|
| `pnpm lint` | — | exit 0 | | | |
| `pnpm typecheck` (19 tasks) | — | exit 0 | | | |
| tests/db (parallel + serial) | 47 | 1057 | 0 | 0 | 1057 |
| e2e (Chromium, no harness revoke) | 8 | 57 | 0 | 0 | 57 |
| tests/ci | 20 | 542 | 0 | 0 | 542 |
| tests/layers (root run) | 8 | 545 | 0 | 0 | 545 |
| tests/infra | 4 | 184 | 0 | 0 | 184 |
| tests/config | 5 | 97 | 0 | 15 | 112 |
| packages/auth | 8 | 58 | 0 | 0 | 58 |
| packages/config | 6 | 334 | 0 | 0 | 334 |
| packages/tenancy | 2 | 6 | 0 | 0 | 6 |
| packages/db | 6 | 43 | 0 | 0 | 43 |
| apps/auth | 1 | 3 | 0 | 0 | 3 |
| apps/web unit | 9 | 97 | 0 | 0 | 97 |

Not run: `tests/infra/image` (Docker image build, POLY-143) and `tests/log`. tests/config's 15 skipped are POLY-152's.

**db time against the same-day main control (be41b202, 902 tests, 40 files, 76 s, load under 6): 1057 tests, 47 files, 96 s at load about 5 (+20 s, +26 %) for +155 tests and +7 files.** The earlier runs on this branch took 93 s and 96 s at the same load; two runs at load 13 to 26 took 1048 s with 60 s timeouts, so a reading needs the load beside it.

**Order and times (local, 2026-11-19).** One sequential run after the pull at 9fc167f4, nothing in parallel and no counts carried from another sha. Non-db suites (lint, typecheck, ci, infra, config, layers, the six package and app suites) and e2e ran in one chained command from 13:18 to 13:19; `pnpm typecheck` was turbo-cached; e2e took 22 s (13:18:44 to about 13:19:05). db ran 13:19:10 to 13:20:47 (96 s, from the saved `g8.json`). Only the db run saved a timestamped output file; the other suites' times are inferred from the `uptime` stamps either side. The e2e server leaked one container (`poly83-qa-1888499d`, created 13:18:44; POLY-143); it was removed after the run.

---

## Superseded run at `8d77a350`

One run, sha `8d77a350` (`feature/poly-149-stage-2-revocation-and-docs`: the build at 002cda1f, devops's gate check, and qa's last test commit 65876882 plus devops's 8d77a350; `git status` empty before and after). This file and the criteria ticks land after it, docs only.

## Results (passed + failed + skipped = total)

| Step | Files | Passed | Failed | Skipped | Total |
|---|---|---|---|---|---|
| `pnpm lint` | — | exit 0 | | | |
| `pnpm typecheck` (19 tasks) | — | exit 0, svelte-check 0 errors 0 warnings | | | |
| tests/db (parallel + serial) | 47 | 1039 | 0 | 0 | 1039 |
| e2e (Chromium, no harness revoke) | 8 | 57 | 0 | 0 | 57 |
| tests/ci | 20 | 542 | 0 | 0 | 542 |
| tests/layers (root run) | 8 | 546 | 0 | 0 | 546 |
| tests/infra | 4 | 184 | 0 | 0 | 184 |
| tests/config | 5 | 97 | 0 | 15 | 112 |
| packages/auth | 8 | 58 | 0 | 0 | 58 |
| packages/config | 6 | 334 | 0 | 0 | 334 |
| packages/tenancy | 2 | 6 | 0 | 0 | 6 |
| packages/db | 6 | 43 | 0 | 0 | 43 |
| apps/auth | 1 | 3 | 0 | 0 | 3 |
| apps/web unit | 9 | 97 | 0 | 0 | 97 |

tests/config's 15 skipped are POLY-152's and unchanged. Not run: `tests/infra/image` (Docker image build, POLY-143) and `tests/log`. The e2e suite runs on the migrated chain with no harness revoke (the R7.4 revoke is gone from `serve.ts`): 57/0/0, the same count as POLY-153's run under the harness revoke, which is the measurement that poly_app's ten functions and table list are enough for web.

## db time against a same-day control on main

| Run | Tests | Files | Wall time |
|---|---|---|---|
| `main` @ be41b202 (clean worktree, same machine, same day, after `svelte-kit sync`, load under 6) | 902 | 40 | 76 s |
| this branch @ 65876882 | 1039 | 46 | 93 s |
| this branch @ 8d77a350 | 1039 | 47 | 96 s |

**+17 to +20 s (+22 % to +26 %) for +137 tests and +6 to +7 files** (second-step-lock, sign-in-record, revocation, enter-session-slide, sign-in-controls-pins, gate-check and gate-check-membership; the lock test runs eight nine-lock sequences of real sign-ins, so it is the long one). One control and two tip runs; the lead's rule is to judge it against a same-day control, not one run. All new files join the `auth` DB_AREAS job; gate-check-membership is the one new SERIAL file. Note for the run itself: two runs of this suite at load 13 to 26 (other loops on the machine) took 1048 s and hit 60 s timeouts in four tests; both passed on a quiet machine, so a wall-time reading needs the load recorded beside it.

## Criteria, each with its proving test

See `test-plan.md` for the full mapping; the green tests are the ones named there. The two decisions the Principal closed (a) carry no tests.

## Plants (every catalog guard shown to fail), at the gate

`tests/db/sign-in-controls-pins.test.ts` runs 23 plants against pgTAP 11 and 12 in each file's own rolled-back transaction; both controls (no plant) report 0 `not ok`, and every plant reports at least one. All 25 tests in the file pass at the gate sha. `pgtap-membership.test.ts` (N2): the `GRANT poly_app TO poly_auth` plants still turn pgTAP 08 red.

## Findings fixed on the way (tests only)

- `serve.ts` loaded `tests/db/helpers/marker.ts`, which gained an extensionless import of `handle`; node's native ESM refused it. Fixed with `.ts` extensions (65876882).
- pgTAP 12's setting scan now reads schema `app` only and allows `role` (three trigger helpers read it; measured, not a clock); the ruling said "no `current_setting` but three names", which the code-read missed.
- T-L4 re-enrols as the fixture superuser: re-enrolment needs an email proof the test does not own.
