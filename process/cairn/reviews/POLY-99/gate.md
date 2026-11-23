# POLY-99 build-green gate (qa-99)

**Final tip:** build `4a75ade1` (devops-99's last build commit: F5, F6, F7, DR8, the split `# T17` markers) with my tests at `37445c1f`. An earlier pass of this gate ran on `7e4b95d2` with tests `e77312c9` (kept below as "first pass"). Machine: this Mac, Docker 29.9.3 (Docker Desktop, arm64), Python 3.15, one suite at a time. Plan and pins: `test-plan.md`; the red run: `red-run.md`.

## Counts per suite (each over what it says)

| Suite (command) | Tests | Pass | Red | Note |
|---|---|---|---|---|
| backup container suite (`vitest run -c tests/infra/vitest.backup.config.ts`) | 111 | 111 | 0 | seven files; 369 s wall (6:09), 326 s in the files; one earlier red in this run, the DR10-deleted mutant, was my assertion and is fixed and green (drill file 10/10) |
| provision container config (`-c tests/infra/vitest.provision.config.ts`) | 171 | 171 | 0 | checks-db 20, create 42, host 68, ops 23, poly99 18; first run 76 s wall |
| image container config (`-c tests/infra/vitest.image.config.ts`) | 90 | 88 | 2 | the two POLY-95 secret-mode cases, which cannot fail on Docker Desktop and fail the same on a clean `origin/main` (test-plan.md, control run) |
| `tests/infra` non-container (`-c tests/infra/vitest.config.ts`) | 390 | 390 | 0 | lint, lint-poly99, backup-wiring, ops and provision wiring |
| `tests/ci` (`-c tests/ci/vitest.config.ts`) | 587 | 587 | 0 | 21 files; the 10-key change set (`backup`). devops-99's 614 was `vitest run tests/ci tests/infra/backup-wiring.test.ts`: these 587 plus the 27 cases of `backup-wiring.test.ts`, reported as one figure |
| `tests/layers` | 556 | 556 | 0 | |
| ops unit tests (`unittest`, one file at a time) | backup 25, cli 11, ctx_getpass 7, dispatcher 19, gate_check 5, install 9, lint 8, list_secrets 7, provision 20, restart 9, set_secret 31, status 50, upload 21 | all | 0 | 222 in total, under 5 s of test time |

## Per-file times, tests/infra/backup (s), final tip

backup 54, drill 133, uploader 59, restore 44, roundtrip 17, slice0 13, fake-b2 6 (sum 326; 369 s wall including the globalSetup: images, one stack with the migration chain and a planted session, three real backups, WAL). Target ≤ 420 s: **met, with 51 s to spare**. The figure rose from 277 s (before F1-F5) to 301, 354 and 369 s as the architect's and seceng's verdict-read cases landed.

**The ruling's cap of 9 real scratch restores is exceeded.** The drill file now has six real drill runs (happy, the all-faults run, the BASE-skip mutant, and the three DR8 mutants), each with two scratch restores, plus roundtrip 3 and restore.test.ts 1: 16 in all. Each extra run is a mutant the architect or seceng required (DR8 data-only, deleted handle, dropped tables; F6 BASE-skip). The time target still holds; the cap does not. Ruling needed from the architect whether to consolidate the three DR8 mutants into one run or accept the count.

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

## Not measured here

CI step time; real Backblaze (ETag/MD5 on a single-part PUT, the box key's DELETE refusal, the sibling flag); the drill against a ledger schema (DR9 SKIPs today, DR7 and DR8 have no tables); restore on a non-macOS laptop; the two POLY-95 secret-mode cases (need Linux CI); D1 `--from-box` cross-check cases (the Principal has not chosen; not written).
