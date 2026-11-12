# POLY-141 gate 4: verdict (qa-141)

**Verdict: pass.** All nine criteria are met on code 5c37510 (b203b91 differs only in tracker files, checked by diff); no criterion
is unmet. Items that are untested or unmeasured are listed at the end and none blocks a criterion.

## Suites, my runs at the feature tip (code = 5c37510)

| suite | result |
|---|---|
| tests/ci | 19 files, 528 of 528 |
| tests/infra | 3 files, 142 of 142 |
| tests/config | 5 files, 92 passed, 15 skipped (107) |
| tests/layers | 5 files, 452 of 452 |
| `pnpm lint` | exit 0 |
| `pnpm test` (turbo) | exit 0 |
| cairn Python suite (`run_tests.py --gate verdict`) | 2017 tests, 118 files, OK (skipped=4) |
| db battery, ten consecutive local runs (criterion 2) | 10 of 10 exit 0, each 350 passed + 2 expected fail = 352 |

The ten db runs took 41–61 s; runs 1–5 overlapped my other suites and runs 6–10 the cairn suite, so those times are loaded and are
not evidence for criterion 1. The 17 stale containers were gone before these runs.

## CI figures, checked against `gh run view` (jobs and logs), not copied

- Criterion 1, dispatch runs on 5c37510: db job 95, 85, 82, 86, 88 s (43294745993, 43295358871, 43296120938, 43296867300,
  43297562146), all `workflow_dispatch`, all green. Median 86 s; fastest three (82, 85, 86) average 84.3 s. Logs of the first and last
  show 19 files, 350 passed + 2 expected fail (352), `pgtap image build: rc=0` after 9 and 10 s of waiting.
- Criterion 6, dispatch with base on scratch branches: auth 48 s (43312152200, 137 passed, 7 files), tenancy 53 s (43312506787, 85),
  migrate 65 s (43312849525, 93 + 2 expected fail), ops 54 s (43313139798, 35). Only that area's job ran; lint, unit, image skipped.
  137 + 85 + 93 + 35 = 350.
- Criterion 9, PR runs: 43298446115 (7445dc6) log says `anchor: ledger-only since 5c37510…` in both the cairn and changes jobs;
  guard 23 + cairn 12 + changes 12 + app 7 = 54 s, db/lint/unit/image skipped. 43311984181 (3b3242a): cairn 15 + changes 10 +
  guard 13 + app 5 = 43 s, heavy jobs skipped. (A third bookkeeping run, 43313667534 on b203b91: 11 + 14 + 12 + 14 = 51 s.)
  The cairn job runs `cairn check` (log of 43298446115).
- First fully green PR run on the complete build: 43293920356 (5c37510): lint, unit, db 96 s, image, cairn, app green.
- Criterion 7: artifact `ci-test-runs-db` of 43297562146 holds one `ci:db` line and 19 `ci:db:file` lines (file, project, area,
  seconds, ok). The job line says 79 s against the job's 88 s because the clock starts after checkout (existing behaviour).

## Criteria

| # | proven by |
|---|---|
| 1 | ci.yml/vitest projects: db-harness C6; CI runs above (median 86 ≤ 100, fastest three 84.3 ≤ 90; base was 124 s) |
| 2 | db-harness C1–C4 (lock excludes, fails loudly, static wrap, lock dir); ten local runs 10/10 and five CI runs, zero failures; mutation at verdict: removing the wrapper from `freshDb`/`cloneMigrated` turns two C3 tests red (reverted) |
| 3 | db-areas C7 (every file in one area and one project); 352 tests locally (10 runs) and on CI (350 + 2 expected fail); `git diff origin/main HEAD -- tests/db/*.test.ts` is empty |
| 4 | db-areas C8, C10; ci-workflow "db areas" (outputs, printf, `db` condition unchanged); aggregate C20 |
| 5 | db-filter-imports per-area closure (four areas) with its failing fixture; checked also against the ruling's table before build |
| 6 | the four dispatch runs above, auth 48 s ≤ 65 s |
| 7 | report.test C13 (per-file lines, missing/broken JSON → job line only, budget stays a warning); artifact above |
| 8 | INFRA 1.3.8 read against the code (below); no test |
| 9 | anchor.test (decide fail-closed cases, real-repo CLI, hostile names, symlink/gitlink), ci-workflow anchor wiring, py boundary pins; CI runs 54 s and 43 s |

## Conditions

| cond | proven by |
|---|---|
| C1–C4 | db-harness.test.ts: lock excludes (two processes), fails loudly (unset dir, timeout), static wrap in `freshDb`/`cloneMigrated`, lock dir via `ensureBootstrapLockDir` in globalSetup |
| C5 | db-harness C5 (cluster-write detector over every file outside SERIAL, with controls). Runtime half (unlocked canary fails ~2 in 3) is not a test; measured by the architect |
| C6 | db-harness C6 (projects, groupOrder, fileParallelism, root globalSetup, maxWorkers 3, SERIAL) |
| C7–C8 | db-areas C7, C8 (incl. S8 root-config paths) |
| C9 | db-filter-imports per-area closure and its fixture |
| C10–C11 | db-areas C10 (`--db-select`, invalid map on a scratch tree); ci-workflow "db areas" (preflight before battery, env values, bash array, S7 line check, no passWithNoTests) |
| C12 | 352 tests: ten local runs and CI runs above |
| C13 | report.test (jsonl lines, budget 100) + CI artifact |
| C14 | anchor.test decide() cases (25+), CLI cases (fake gh, real repo), S3 source pins |
| C15 | anchor.test `--none`; ci-workflow anchor wiring (exact comparison) |
| C16 | anchor.test NUL/rename/hostile-name cases; changes.test NUL cases; ci-workflow and py: every filter diff `--no-renames -z` |
| C17 | (a) ledger-audit.md @ f4c43c0; (b) py LedgerReaderGuardTests with the ruled PASS_THROUGH |
| C18 | ci-workflow cairn step (run=ledger, run=true unchanged, run=false once); py pins moved |
| C19 | anchor.test constants (no `merge-base --is-ancestor` in ci.yml; LEDGER and PINNED_RULINGS equal the ci.yml literals) |
| C20 | aggregate.test "validated" block (missing, TRUE/yes/1/empty, db ≠ OR) |
| C21 | ci-workflow permissions and GH_TOKEN step-env tests |
| C22 | anchor.test symlink/gitlink (decide and real git); tightening: modes must be exactly two per path (empty, 1x, 3 for 2, 5 for 2 red); real tree holds none |
| C23 | anchor.test C23 (vitest includes, run_tests roots, workspace globs) |
| C24 | ci-workflow C24; CI log shows `cairn check` on the ledger leg |
| C25 | db-areas C25 (own files select all four; other infra/ci files do not; parsed from the db job) |
| C26 | changes.test C26. **anchor.mjs's diff parsing has no test seam: its input is `git -z` output it spawns itself, so the "follows the same rule" half is untested, not covered** |
| T1 | db-harness T1 (pg.ts imports IMAGE, PG_BASE, buildArgv; helper owns them); tests/infra/wiring pin moved |
| T2–T3 | ci-workflow T4 tests (background step before Set up Node, bounded wait, no `|| true`); CI logs `rc=0 after 9–10 s`. The never-act-on-the-code rule is read from the workflow text, no failing-build run was made (unmeasured) |
| T4 | ci-workflow and db-harness tests above |
| E1–E2 | changes.test e2e rows, aggregate REQUIRED e2e→unit, ci-workflow unit `if`/E2E_FORCE/printf, db-filter-imports e2e closure; the e2e step ran green in 43293920356 (48 s) |
| S1–S8 | covered by C14, C16, C20–C23, C10/C11, C8 above; seceng's own build check is theirs |

## The five checks

1. `tests/db/*.test.ts` differs from main: no (empty diff).
2. INFRA 1.3.8 and SECURITY 1.9.12: versions, and their last edits, are in the same commits as their PDFs (5c37510 and 254e2e8); every
   added index.html line of both appears in the PDF text (pdftotext probes, 8 INFRA and 2 SECURITY lines, none missing); the text
   was read against the code (SERIAL group, 3 workers, 120 s lock timeout, 300 s wait, 100 s budget, e2e key, per-job `actions: read`).
3. Config suite skipped count: 15 here. A main run was not available from CI (the unit job skipped on the recent main-bound runs), so this
   is by identical inputs: `tests/config`, `packages/` and `apps/` (bar `serve.ts`) have no diff against main. Not a measured main run.
4. anchor.mjs diff parsing: untested (C26 above).
5. My red-gate note said 12 other files were green. The lead's 11 of 19 is right: 8 files were red (aggregate, anchor, changes,
   ci-workflow, db-areas, db-filter-imports, db-harness, report), so 11 were green. I miscounted; `red-gate.md` is corrected to 11.

## Unmeasured or not proven

- C5 runtime canary, T3 behaviour under a failing background build, criterion 1 on a four-vCPU runner other than the five runs.
- The CI half of criterion 2 is five green runs; zero concurrency failures in them, but nothing re-tests the unlocked failure on CI.
- The 15-skipped comparison with main (above).
- Local timings are loaded; none is used as evidence.
