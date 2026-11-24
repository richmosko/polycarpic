# POLY-162 gate (qa-162)

Tip `a975ba56` (tests, wiring), on a machine the lead declared quiet (nobody else ran anything locally). Output with timestamps: `gate-output/` (UTC, ANSI stripped). T-real ran in the privileged Ubuntu 24.04 container (Docker 29.1.3, Compose 5.7.1, Node 26.12.0, app image built from the tip tree).

## Suites

| Suite (CI's exact command) | Result | Time (UTC window) | Output |
|---|---|---|---|
| T-real, `vitest run -c tests/infra/vitest.deploy-real.config.ts` in the container, `CI=true` | 3 files, **17/17**, 0 skipped; rollback case included; hostile `.env` start included | 23:10:58 to 23:16:01 (302 s; part 1 103 s, rollback 199 s) | `gate-output/treal.txt` |
| `tests/ci` (`-c tests/ci/vitest.config.ts`) | 24 files, **715/715** | 23:16:05 to 23:16:16 | `ci.txt` |
| `tests/infra` (`-c tests/infra/vitest.config.ts`) | 21 files + 1 skipped, **640 pass**, 3 skipped (the skipped file and cases are the ones skipped on `main`) | 23:16:19 to 23:16:42 | `infra.txt` |
| Compose-policy lint, with CI's env | rc 0 | 23:16:48 | `lint.txt` (the `rc=1` at the top of `infra.txt` is my run without `POLY_POSTGRES_IMAGE` and `POLY_BIND_ADDR`, which CI sets; not a finding) |
| `node scripts/layers/check.mjs`, `vitest run tests/layers` | rc 0; 9 files, **556/556** | 23:16:48 to 23:17:06 | `lint.txt` |
| `turbo run test typecheck` (web unit and every package), `eslint packages apps scripts/layers`, `check-migrations` | 39/39 tasks, 0 errors, eslint rc 0 | 23:17:06 to 23:17:19 | `node.txt` |
| `python3 -m unittest discover -s tests/infra/ops -t tests/infra/ops` | run by the lead in `poly97-box:test` on the tree at 78888010: **555 tests, OK, 1 skipped** (the hook refused my own un-tiered run; I ran `test_deploy_guard` alone, OK) | | |

`tests/infra` failures: **none** on a quiet machine. devops-162's 163 failures under load are therefore load, not real (nothing to list).

## Verdict table: what I hold (B-list), and where

| # | Where it is held |
|---|---|
| B1 | `tests/ci/deploy-key.test.ts` (`CI` and the summary path pass through sudo; each part throws in CI instead of skipping) |
| B2, B3, B4, B6 | `tests/infra/deploy-real/1-first-deploy.test.ts`, `2-rollback.test.ts`; shown red on faulted real-Linux runs: `faulted-runs.md` |
| B5 | `tests/infra/lint.test.ts` (generated per service per key), `tests/infra/ops/test_deploy_guard.py` |
| B8 | `tests/ci/deploy-key.test.ts` (workflow and job env) |
| B9 (my half) | `tests/ci/deploy-real-sweep.test.ts` (51, mutants red), `deploy-key.test.ts` (sweep before the undo, upload tied to the sweep's outcome, separate logs, `tee -a`) |
| B10 | `deploy-key.test.ts` ROWS |
| B7 | left for POLY-161 (lead's ruling) |
| F2 | registry pinned by digest in the harness |
| F4, F5 | lint rows for every service and key; guard cases for the staging services (prod's backup and uploader are not in a staging bundle, so only the lint holds them); `RestartCount` and `Cmd` in part 1 |

Open, said plainly:
- B6's lower bound (poll ≥ 120 s) has no red of its own: cutting the tool's window to 3 s fails on `rollback-unhealthy` first. A crash-at-start candidate takes the whole window, so that case is not missed.
- The S42 clause "flushed before the close" is not caught by the G15 test (a small loopback body flushes before a destroy); mutant "destroy before the flush" survives.
- `compose_guard` is not exercised for prod's backup/uploader (the tool deploys staging only).

## Time (limit 17 of 20 minutes for `image`, now moot: T-real is its own job)

| Run | What | Value |
|---|---|---|
| 45500690283 (aac58b1d) | T-real as the last `image` step | step 295 s; `image` job 963 s (668 s without T-real); over the architect's rule (737 + 295 = 1032 s) |
| 45504649884 (bb8ce326) | `deploy-real` as its own job | T-real passed 17/17; job 7.5 min, tests 294 s (lead's reading) |
| 45507656076 (a975ba56), whole run green | `deploy-real` job: T-real step 290 s (23:12:52 to 23:17:42), 3 files, 17 passed in the log, 0 skipped; job 419 s (23:10:50 to 23:17:49) of its 15 min | measured |
| same run | `image` job without T-real: 602 s (23:10:50 to 23:20:52), well under 17 min (1020 s) and under the 626 to 737 s of earlier runs | measured |

Reading: T-real's own job is 7.0 min and `image` is back to 10.0 min; both far inside their limits, and they run side by side, so the longest job of the run is `image` (the run took 10.2 min, 23:10:34 to 23:21:00).
