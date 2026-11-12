# POLY-141 gate 2: tests red (qa-141)

Commits on the feature branch: f4c43c0 (criterion 9, C14–C16, C18, C19, C17(a) audit), aae2a20 (addendum 1: C14 S3, C16 `-z`,
C20–C23), fe62c47 (C1–C6), 83e9457 (C7–C11, S7, S8), and the C13 commit that carries this file.

## Red per file (tests/ci, local, loaded machine): failed / total

| file | red | why it is red |
|---|---|---|
| anchor.test.ts | 56/60 | `infra/ci/anchor.mjs` absent; `changes.mjs --none` absent; ci.yml still holds the shell ancestry block. 4 pass: C23 guards (no symlink in tree, matcher control, vitest includes, run_tests roots) |
| aggregate.test.ts | 49/87 | C20: `evaluate()` accepts missing, `TRUE`, `yes`, `1`, empty keys and `db` ≠ OR of areas; no import from changes.mjs |
| changes.test.ts | 26/52 | stdin is split on newlines, not NUL (20 table rows moved to NUL input go red until the split changes; 6 new `-z` cases) |
| ci-workflow.test.ts | 18/43 | `changes`/`cairn` steps not rewired (anchor.mjs, `--no-renames -z`, `run=ledger`, permissions, GH_TOKEN scope); no area outputs; no preflight, `--db-select`, bash array, json report |
| db-areas.test.ts | 63/63 | `DB_AREAS`, `DB_SHARED`, `--db-select` and `SERIAL` absent |
| db-filter-imports.test.ts | 5/9 | per-area closure needs `DB_AREAS`/`DB_SHARED` |
| db-harness.test.ts | 14/17 | `bootstrap-lock.ts`, the wrapper in `freshDb`/`cloneMigrated`, globalSetup lock dir, config projects/`SERIAL` absent. 3 pass: setRolePasswords unwrapped, detector control, "no other file reads BOOTSTRAP" |
| report.test.ts | 3/21 | `budgets.json` db 180→100; the JSON reporter output is ignored. The "missing/broken JSON → only the job line" cases pass today (guards) |
| 12 other files | 0 | unchanged and green |

`tests/workflow/test_cairn_test_boundary.py`: 5 red (anchor from anchor.mjs, ancestry count 0, `run=false` once, every `git diff`
`--no-renames -z`). The full cairn suite otherwise stays green (2013 tests before the pin edits).
Nothing under `tests/db/*.test.ts` was changed.

## Pins changed (C18) and why

- `test_cairn_test_boundary.py` `CiAnchoredSkipTests`: removed the lookup-shape test and the PINNED-in-anchor-span test (the logic
  moved to anchor.mjs; `tests/ci/anchor.test.ts` tests it by behaviour); ancestry count 2→0; `run=false` 2→1; added the no-renames
  `-z` pin and "anchor comes from anchor.mjs".
- `changes.test.ts`: `run()` feeds NUL-separated input (C16/S1) and accepts the four area keys beside the five.
- `aggregate.test.ts`: `base()` emits all nine keys with `db` = OR of the areas (C20).
- `ci-workflow.test.ts`: the `changes` outputs are the nine keys.
- `report.test.ts`: `budgets.json` db 180→100 (C13).

## Held

- C17(b) guard in `test_cairn_test_boundary.py`: waits on the architect's ruling on the reader set (`ledger-audit.md`).
- S8 cost and S7 `[a-z0-9-]` filename shape are pinned; the 7-of-53 measurement is the architect's.

## No local test: build-green evidence (CI only)

- Criterion 1: five sequential dispatch runs, median ≤ 100 s, fastest three ≤ 90 s.
- Criterion 2, CI half: zero lock failures over those five runs; ten consecutive local parallel runs.
- Criterion 3 / C12: the vitest `Tests` total is 352, locally and on CI (the static halves are C7).
- Criterion 6: four area-only dispatch runs, auth ≤ 65 s, times recorded on the issue.
- Criterion 9 target: two bookkeeping pushes on the PR, with skipped lint/unit/db/image, cairn ≤ 25 s, summed ≤ 90 s.
- Criterion 8: INFRA text (devops-engineer); SECURITY C-81 text (seceng).
- C5's runtime half: the unlocked canary fails 2 of 3 runs (M4), so only the static halves are tests.
- Quality of the area map for a computed path string (R3 residual risk): reviewers.
