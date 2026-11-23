# POLY-99 build-green gate (qa-99)

**Final tip:** build `a780368f` (devops-99's last build commit: F8 on top of F5, F6, F7, DR8 and the split `# T17` markers) with my tests on top of it (the commit that carries this file). Passes on earlier tips (`7e4b95d2`, `4a75ade1`) are kept below. `git diff 4a75ade1..a780368f -- infra tests` touches only `infra/drill.sh` and `tests/infra/backup/drill.test.ts`, so the provision container config, image config, `tests/infra`, `tests/ci` and `tests/layers` numbers measured on `4a75ade1` carry over unchanged; the backup suite and the ops unit tests were re-run on the final tip. Machine: this Mac, Docker 29.9.3 (Docker Desktop, arm64), Python 3.15, one suite at a time. Plan and pins: `test-plan.md`; the red run: `red-run.md`.

## Counts per suite (each over what it says)

| Suite (command) | Tests | Pass | Red | Note |
|---|---|---|---|---|
| backup container suite (`vitest run -c tests/infra/vitest.backup.config.ts`) | 112 | 112 | 0 | seven files; 384 s wall (6:24), 340 s in the files, on `a780368f`; the F8 case first asserted a SKIP line where the verdict prints a FAIL line (my assertion), fixed, drill file 11/11 |
| provision container config (`-c tests/infra/vitest.provision.config.ts`) | 171 | 171 | 0 | checks-db 20, create 42, host 68, ops 23, poly99 18; first run 76 s wall |
| image container config (`-c tests/infra/vitest.image.config.ts`) | 90 | 88 | 2 | the two POLY-95 secret-mode cases, which cannot fail on Docker Desktop and fail the same on a clean `origin/main` (test-plan.md, control run) |
| `tests/infra` non-container (`-c tests/infra/vitest.config.ts`) | 390 | 390 | 0 | lint, lint-poly99, backup-wiring, ops and provision wiring |
| `tests/ci` (`-c tests/ci/vitest.config.ts`) | 587 | 587 | 0 | 21 files; the 10-key change set (`backup`). devops-99's 614 was `vitest run tests/ci tests/infra/backup-wiring.test.ts`: these 587 plus the 27 cases of `backup-wiring.test.ts`, reported as one figure |
| `tests/layers` | 556 | 556 | 0 | |
| ops unit tests (`unittest`, one file at a time) | backup 25, cli 11, ctx_getpass 7, dispatcher 19, gate_check 5, install 9, lint 8, list_secrets 7, provision 20, restart 9, set_secret 31, status 50, upload 21 | all | 0 | 222 in total, under 5 s of test time |

## Per-file times, tests/infra/backup (s), final tip

drill 146, uploader 59, backup 54, restore 45, roundtrip 17, slice0 13, fake-b2 6 (sum 340; 384 s wall including the globalSetup: images, one stack with the migration chain and a planted session, three real backups, WAL). Target ≤ 420 s: **met, 36 s to spare**. The figure rose from 277 s (before F1-F5) through 301, 354, 369 to 384 s as the verdict-read cases landed.

Real scratch restores: roundtrip 3, restore.test.ts 1, drill seven runs of two (happy, all-faults, F6 BASE-skip, the three DR8 mutants, F8) = 18. The architect accepted 16 (ruling Guards correction @ `450ba87c`) and said another real restore needs a ruling; F8 needs a real run because a skip after a failure is fallout (asked of the architect, the architect accepted 18 in the Guards correction @ `40eee5f4`: cap 18, projected about 391 s, measured 384 s).

## Suite-time delta against a same-day control on `origin/main` (clean worktree, same machine)

| Config | main | this branch | Delta |
|---|---|---|---|
| image | 92 s, 90 tests (3 red on this Mac) | 96 s, 90 tests (2 red on this Mac) | +4 s |
| provision | 67 s, 153 tests | 76 s, 171 tests | +9 s (18 new cases) |
| tests/infra non-container | 13 s, 332 | not timed alone, 390 tests | +58 tests, lint fixtures dominate |
| tests/ci | 10 s, 579 (573 pass; the 6 red are `generated-freshness.test.ts` "db-migrations through the real drizzle-kit (V1)": "generator ./node_modules/.bin/drizzle-kit is not available" because the control worktree has no pnpm install; environment, not `main` red) | 587 pass | +8 tests |
| backup (new) | none | 301 s | new, runs only when the `backup` change key is true |

CI figures are unmeasured (this is a Mac); devops-99 reports the CI image-job figure.

## What the gate found and where it went

- The provision container config had never run against the built `provision.sh`. It showed five groups of **test** defects (mine, now fixed in `a0938f6b`, `e77312c9`): the POLY-97 host cases still expected `rwx` ACLs and 10005-owned state files (R10, R9 change them); the DB-check helper did not copy the unit files that H16 compares; the install-box fixture repo lacked `infra/backup` and the three executables; one new case had a wrong denial count. No build fault came out of it.
- F5 shown red on the tree before its fix: with `infra/backup/restore-lib.sh` and `infra/drill.sh` at `e7c7cc6b^`, the drill fault run fails on `4_zfake_` in stdout (the case that reads stdout and stderr apart is `drill.test.ts :: every planted fault at once`; restore cases read both streams merged and cannot see F5).
- F4's removal is shown on real Docker: kill the scratch's PID 1, then no labelled container and an unchanged `docker volume ls -q` set (`restore.test.ts :: T10 + C7′`).
- F1-F4 were shown red on `5501a740` (11 cases) and green on the fixed build (test-plan.md pin 44).

## Red on the tree before each fix, green on `a780368f` (seceng's list, build-review.md @ f38ae493)

Each run puts the named files back to the commit before the fix, runs the named cases, then restores the tip (`git restore --source=HEAD`).

| Cases | Files reverted to | Red result |
|---|---|---|
| `17f99c51` F1-F4 (stray objects, `--accept-version`, redacted report, `--rm`/`--hours`/`--cleanup`/WARN) | restore.sh, restore-lib.sh, b2read.py, drill.sh @ `5501a740` | 11 cases red (restore 5, roundtrip 4, drill 2) |
| `c94a4bf6` F5 stdout/stderr split | restore-lib.sh, drill.sh @ `e7c7cc6b^` | the fault run fails on `4_zfake_` in stdout |
| `c94a4bf6` F4 real Docker (kill the scratch, no labelled container, no new volume) | restore.sh, restore-lib.sh, drill.sh @ `314b2dcf^` | red: a labelled scratch container is left (`polycarpic-restore-…`) after the kill; the three F4 argv/`--cleanup`/WARN cases red too |
| `4cfca88f` F6, F7, INCOMPLETE verdict | drill.sh @ `4a75ade1^` | 5 cases red: the happy run's last line, the fault run's DR6 (BASE passes, the dump instance's missing role unseen), the DR10-deleted mutant (no FAIL line), the BASE-skip mutant (exit 3, not 1), and F8 |
| `4cfca88f` T17b, T17p | restore.sh, restore-lib.sh @ `a937f9a5^` (before the markers were split) | both red: the mutant cannot be built (`mutant did not change …`); on the tip each mutant reaches the scratch |
| `4cfca88f` DR2 for a WAL segment | the mutant on the `if [ "$(sha256f …)" != … ]; then` line | real run exits 4 with the sibling message and no scratch; the mutant reaches the scratch (a harness-level red, no revert needed) |
| `ac615b11` F8 | drill.sh @ `4a75ade1` | red: the mutant's SKIP stays a SKIP (`DRILL INCOMPLETE`, exit 3) |

A leftover scratch container from the F4 red run was removed by hand afterwards.

## Shared state a test changes that another file relies on (audit after the Linux CI failures)

Two real cases, both found by CI on Linux and fixed; the rest checked and kept.

| State | Who changes it | Verdict |
|---|---|---|
| the shared fake-b2's networks (its published port) | `uploader.test.ts` T3 attached and detached it | **fixed**: T3 uses a throwaway listener; `attachFake` checks host reachability and fails setup with facts. Reproduced on a Linux daemon (docker:dind): reachable, then unreachable after `network connect`, still unreachable after `disconnect -f` |
| Python `sys.path` and `sys.modules` | `backup_base.mutant_dispatcher` loaded a mutant copy of `infra/ops` from `/tmp`; the copy's `lib` stayed in `sys.modules` after the copy was deleted | **fixed**: both are restored in the test's cleanup. Reproduced in the CI image (poly97-box, Python 3.12): 132 errors in every file after `test_backup` before, 222/222 after |
| fake-b2 store, mode, apiUrl | most container files | kept: every file resets it in `beforeEach` and the files that set a mode reset it in `afterAll` |
| the canary table | `roundtrip.test.ts` inserts a row after the base | kept: deleted in its `afterAll` |
| the spool and the WAL volume | backup, uploader, roundtrip | kept: cleared at the start of each test or in `afterAll`; WAL keeps accumulating, harmless |
| the host recipients file | `backup.test.ts` rewrites it per case | kept: restored in a `finally`; a fresh container per file because Docker Desktop shows a stale view |
| labelled scratch containers | restore, roundtrip, drill | **tightened**: an `afterEach` removes any labelled scratch, so a failed case cannot make the next file's WARN check fail |
| `docker volume ls` and `docker ps` sets | the F4 real-Docker case and the WARN case | kept, but they assume nothing else touches the daemon during the run: one suite at a time (CI runs the steps in sequence) |

## Every test commit since the red run (`1cd28a70`)

Marked **stricter**, **corrected** (the test was wrong or the spec moved) or **loosened**, with one line of why. Nothing is loosened without a ruling, and the two that are marked loosened say which (`738c8e87` was accepted by the architect at `3f635dc3`).

| Commit | Mark | Why |
|---|---|---|
| `77e5628c` age-failure case | corrected | no longer relies on bind-mount modes (Docker Desktop does not enforce them); R3 names, data-dir cwd and gunzip |
| `28c80b1d` DR10 probe | corrected | architect's ruling: runs on a probe object, overwrite means in-place change |
| `8b403ef8` Runner.inherit, N1 path | corrected | harness (fn on inherit; four `..` reach the victim) |
| `738c8e87` suite restructure | **loosened (two observations)**, otherwise stricter | ruling Guards: the T10 and T17 mutants are now seen by the scratch start in the fake docker log, not by the restored canary; every refusal also asserts no scratch started (stricter) |
| `e2c7974d`, `5a60fadc`, `708ad7cf` wiring and key | stricter | `backup` key, config, gated step, full path list |
| `49fff8d9` fake-b2 S3 on native, roles.sql copy | corrected | contract gap found by the builder |
| `cd3763aa` T16 two guards, `no-test-vars` | stricter | seceng B-1, B-2 |
| `df60865c` ssh shim `--` | corrected | shim defect |
| `4fa2ce9e` T10 mutant with sibling | corrected | the mutant could not reach the poison |
| `1ebe9044` log reset, one-arg command, data-only scope | corrected; **loosened** (dropped the `-a` pattern) | the `-a` pattern matched `ssh -a`; restored stricter in the next row |
| `b81227e7` data-only check | stricter | `pg_restore` lines only, `--data-only`, `-a` and clusters, shown red on fixtures |
| `d54e5f18`, `74bc9d00` T16 canary | corrected | canary left between cases; names carried a space |
| `91c3c466`, `a70d290a` recipients | corrected | stale bind-mount view of an edited file; a fresh container per file |
| `17f99c51`, `6f60320b` F1-F4 | stricter | new cases, red on the pre-fix tree |
| `c94a4bf6` F5, F4 real Docker | stricter | new cases; F5 shown red on `e7c7cc6b^` |
| `a0938f6b` provision suites | corrected | R10 `r-x` ACLs and R9 root-written state replace the POLY-97 expectations; M1 now asserts read-only for 10005 (stricter on what 10005 may not do); H16 bundle copy; install bundle |
| `e77312c9` ops.conf wrapper case | corrected | the fake provision.sh kept overwriting the bucket line |
| `aa4fdd79` control run | record | main control for the Docker Desktop cases |
| `5ad60203` F2 messages, DR1/DR2 independent, DR8 real tables | stricter | the unknown `--accept-version` case asserts its message (red on the pre-F2 files); the fault run separates DR1 and DR2 with a mutant each; the stack applies the migration chain and plants a session, DR8 has three mutants |
| `4cfca88f` T17b, T17p, WAL DR2, F6, F7 | stricter | new cases with their mutants; the happy drill's last line is now `DRILL INCOMPLETE: not checked: DR9` (a skipped check is not a pass); a role missing from the dump globals must fail DR6 |
| `37445c1f` DR10-deleted mutant | corrected | the verdict prints its own `FAIL DR10 … did not run` line; the case asserted no line at all |
| F8 case (`ac615b11`, assertion fixed in the final commit) | stricter | a `res SKIP DR10` mutant on a clean real run must end `DRILL FAILED: DR10`; red on `4a75ade1` (the mutant's SKIP stayed a SKIP), green on `a780368f` |

## Not measured here

CI step time; real Backblaze (ETag/MD5 on a single-part PUT, the box key's DELETE refusal, the sibling flag); the drill against a ledger schema (DR9 SKIPs today, DR7 and DR8 have no tables); restore on a non-macOS laptop; the two POLY-95 secret-mode cases (need Linux CI); D1 `--from-box` cross-check cases (the Principal has not chosen; not written).
