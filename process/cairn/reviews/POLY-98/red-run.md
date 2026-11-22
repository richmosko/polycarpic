# POLY-98 red run (qa-98)

Run 2026-11-22 on the tip `56a3b464` plus this commit, from a worktree. Plan: `test-plan.md` (pins 1–14, 64 rows). Nothing under `infra/ops/` exists yet.

| Suite | Command (abridged) | Cases | Red | Green now, and why |
|---|---|---|---|---|
| U: dispatcher / lint / install | `unittest discover -s tests/infra/ops -p test_<file>.py` | 17 / 5 / 9 | 31 | none |
| U: provision / set_secret / list_secrets | same | 16 / 26 / 6 | 48 | none |
| U: gate_check / restart / cli / status | same | 5 / 9 / 11 / 40 | 65 | none |
| B: `tests/infra/operator/test_b2_rclone_output.py` | `unittest … test_b2_rclone_output` | 8 | 6 | `without the flag prints no block`, `verbosity flags never added`: positive twins that hold on today's tool |
| W: `tests/infra/ops-wiring.test.ts` | `vitest run -c tests/infra/vitest.config.ts` | 5 | 3 | job-set/budget and file-placement pins hold today |
| W: `tests/ci/changes.test.ts` (6 new rows) | `vitest run tests/ci/changes.test.ts` | 6 | 3 | the container-test row, the `tests/infra/ops-wiring.test.ts` row and the `infra/opsx/` boundary row are positive twins |
| C: `tests/infra/provision/ops.test.ts` | `vitest run -c tests/infra/vitest.provision.config.ts ops.test` | 17 | 14 | three H6 regressions (equal content under two names, a generated name copied across services, staging equal to prod) pass on today's `provision-check.sh` and must stay green after K6's relaxation |

Totals: 144 unit + 8 + 5 + 6 + 17 = 180 cases; 170 red (144 + 6 + 3 + 3 + 14), 10 green positive twins or regression guards. Counts are cases, not files.

## What each red is over

- **U: all 144.** The first line of every case is the harness guard `infra/ops/lib/ctx.py does not exist` (or `polycarpic-ops`, `install.sh`, `install_box.py`, `commands/`). That is one reason repeated; it is the missing build. The assertions that tell the cases apart (exact lines, exit codes, argv) only run once the guard passes, so before the build the red does not discriminate between a right and a wrong implementation of a case. I did not write a reference implementation to prove each assertion can pass; devops's first green run per file is that proof, and a case that fails for a test defect goes back to me, not around it.
- **B:** `--show-rclone-output` hits today's tool's generic usage line, not the ruled message; the other four fail on the missing block.
- **W:** no `ops` unittest step, no `infra/ops/install.sh` in the shellcheck line; `infra/ops/**` and `tests/infra/ops/**` land in `image` (and `provision` is not a key `changes.test.ts` reads, so those rows assert the true set is empty).
- **C:** 9 of the 14 fail with `rc=127`/`cp: cannot stat` (no `install.sh`, `install_box.py`, `polycarpic-ops`); the install harness itself ran (laptop checkout built, fake ssh, git present in the box). H6 `one value in auth and worker` and `ops.conf` fail on today's duplicate-content and world-readable rules; both D3 cases fail on the absent `jobs.log` line.

## Edits to existing tests

One: `tests/infra/provision-wiring.test.ts` lists the operator test files; it gains `test_b2_rclone_output.py`. `tests/infra/provision/Dockerfile` gains `git` (box image rebuilds once).

## Open pins routed to architect-98

Pins 3 (`trusted_uid`), 5 (message wordings), 8 (fix-line position) and rows 49, 44 in `test-plan.md`.
