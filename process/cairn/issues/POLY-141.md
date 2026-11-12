---
id: POLY-141
title: CI test-time cuts
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
paths: [process/cairn/issues/POLY-141.md, process/cairn/reviews/POLY-141/**, .github/workflows/ci.yml, infra/ci/changes.mjs, infra/ci/anchor.mjs, infra/ci/job-report.mjs, infra/ci/budgets.json, tests/db/vitest.config.ts, tests/db/global-setup.ts, tests/db/helpers/**, tests/ci/**, tests/workflow/test_cairn_test_boundary.py, docs/INFRA/**]
labels: [ci, tooling]
priority: null
pr: null
created: 2026-11-11
updated: 2026-11-12
---

The `db` job is the only test job that grows with every feature, and it runs in full on any change under its filter. Two levers keep it flat as suites join it. First, run the battery's files in parallel. Four files stay in a serial group that runs after the parallel group: `runner` (cluster-role GRANT/REVOKE and `pg_locks`), `ops-status` (reads `pg_locks` cluster-wide), `template-clone` (asserts the login roles' stored password hashes) and `ops-hardening` (a 4.8 s production timeout that is timing-sensitive under contention). For parallelism to be safe, the harness must serialise the cluster-wide `roles.sql` step that every fresh or cloned database reruns; unserialised, it fails with `tuple concurrently updated` on every parallel run. Second, split the battery into area sub-batteries (auth, tenancy/RLS, migrate, ops), so that on a pull request each one runs only when a path its tests execute or import changes. A path every area shares (migrations, `packages/db/sql`, the harness, the Postgres image, the lockfile) runs all of them, and a full dispatch run always runs all of them. Both levers stay inside the existing `db` job; no new top-level job. A failing per-file budget ratchet comes later, once the per-file numbers this issue starts recording have settled. PR/nightly tiering is out of scope, and sharding across runners is the fallback only if parallelism inside one runner falls short of criterion 1. Third, a push whose changes since the last green run on the branch are tracker and ledger files only reruns no heavy suite. Today the `changes` job diffs the whole PR (BASE..HEAD) on every push. The cairn job's anchor skip requires every anchor-diff path to be in EXCLUDE, and `process/STATE.md` is not, so the `/finish-feature` and `/merge-pr` bookkeeping commits rerun everything.

## Acceptance criteria

- [ ] 1. **Parallel group.** Every `db` test file outside the serial four runs with file parallelism inside the `db` job (vitest projects, the serial project after the parallel one). Full-run `db` job median ≤ 100 s over five sequential dispatch runs, with the fastest three averaging ≤ 90 s, against 124 s on 66ed997.
- [ ] 2. **Bootstrap serialised, no concurrency flake.** The harness serialises the `roles.sql` run inside `freshDb()`/`cloneMigrated()` across workers. The serialisation is a test-harness lock, or the cluster-wide part runs once in globalSetup, with `roles.sql` itself unchanged. Ten consecutive local parallel runs and the five CI runs from criterion 1 show zero failures. A static or canary test is red when the lock is removed (the unlocked parallel run fails, measured below).
- [ ] 3. **Same tests.** A full run executes the same number of `db` tests as the base commit, counted as the vitest `Tests` total (352 at 66ed997: 350 passed plus 2 `it.fails`). Each `tests/db/*.test.ts` belongs to exactly one area and exactly one of the parallel and serial projects (static test; red when a file is in none or in two).
- [ ] 4. **Area filter.** `infra/ci/changes.mjs` emits one key per area (`db_auth`, `db_tenancy`, `db_migrate`, `db_ops`) plus a shared set that turns all of them on. `db` stays true when any area is true, so `REQUIRED` and the aggregate are unchanged. The `db` job runs only the selected areas' files. A `db`-filter path in no area map runs every area (fail closed), and a full dispatch run sets every key.
- [ ] 5. **Area maps proven by import closure.** `tests/ci/db-filter-imports.test.ts` is extended: for each area, the transitive import closure of its test files and spawned entrypoints lies inside that area's paths or the shared set. Red when an area's test imports a file that only another area's paths cover.
- [ ] 6. **Area-only runs measured.** One scratch pull request per area that touches only that area's paths (not merged) shows the `db` job running only that area. Each one's `db` job time is recorded on the issue, with auth, the largest area, at ≤ 65 s.
- [ ] 7. **Per-file numbers recorded.** `infra/ci/job-report.mjs` writes per-file seconds for the `db` battery into the existing timing artifact (`ci-test-runs-db`), so the later ratchet has data. The budget stays a warning; no failing ratchet in this issue.
- [ ] 8. **INFRA states it.** The INFRA CI section describes the parallel and serial groups, the bootstrap serialisation, the area map and the fail-closed rule, replacing its "split the battery into a second parallel job" lever, and the anchor skip in criterion 9 (present tense, no history).
- [ ] 9. **Bookkeeping pushes skip the heavy suites.** One anchor rule, in a tested script under `infra/ci/` and used by both the `changes` job and the cairn job. The anchor is the head of the last successful `pull_request` run of ci.yml on this branch. It counts only if it exists in the clone, is an ancestor of HEAD, and has the PR base as its ancestor, so a merge from `main` or a rebase disqualifies it.
  - Ledger-only set: `process/cairn/(issues|milestones|majors|archive|reviews)/` (minus the pinned rulings, as today), `process/STATE.md`, `process/DECISIONS.md`.
  - When every anchor..HEAD path is in that set, `changes` emits all five keys false, so lint, unit, db and image skip and `app` is green on changes plus guard.
  - The cairn job runs only the tests that read a ledger file (today `tests/workflow/test_state_releases_bound.py` reads STATE.md), not the full suite.
  - Fail closed: an API error, an empty or missing anchor, a failed ancestry check, a diff error, or any path outside the set gives today's BASE..HEAD behaviour. The merge still needs green `app` and `cairn` on the head that merges.
  - Tests in `tests/ci` (lint job): each disqualifying case gives the full run, and the ledger-only case gives all-false; red when a failed lookup adds a skip.
  - Target, measured on a scratch PR with two bookkeeping commits after a green run: each such push has lint, unit, db and image skipped, a cairn job ≤ 25 s, and the run's summed job time ≤ 90 s, against about 450 s each on PR 119 (cairn 120 and 119 s, db 113 and 107 s, plus unit and lint).

## Proposed paths

`process/cairn/issues/<ID>.md`, `process/cairn/reviews/<ID>/**`, `.github/workflows/ci.yml`, `infra/ci/changes.mjs`, `infra/ci/anchor.mjs` (new), `infra/ci/job-report.mjs`, `scripts/cairn/run_tests.py` (only if a ledger-subset flag is needed; template-owned, so mirror it upstream), `infra/ci/budgets.json`, `tests/db/vitest.config.ts`, `tests/db/global-setup.ts`, `tests/db/helpers/**`, `tests/ci/**`, `docs/INFRA/**`. Add `packages/db/sql/**` only if criterion 2 is solved by splitting `roles.sql`, which is production SQL and needs seceng.

## Measured

- Final POLY-136 head 66ed997, CI run 43126411997: `db` job 124 s, vitest 101.1 s, 78.5 s in test files, so about 22.6 s of setup inside vitest and 16 s of job steps outside it (qa-engineer-136).
- Per-area CI file seconds on that run: auth 25.3, migrate 23.8, tenancy/RLS 17.6, ops 11.8. The serial four take 28.4 s of CI file time and the other 15 files 50.1 s (qa-engineer-136, /Users/mosko/Projects/polycarpic/.claude/worktrees/qa-136/temp/2026-11-12-qa-136-db-parallel-split-measurements.md).
- Parallel trial, local (10 cores), origin/main 719dc4f, the 15 parallel files, `--fileParallelism` (architect):
  - Harness unchanged: 6 of 6 runs fail (at 4 workers and at 2), each with `psql:<stdin>:42: ERROR: XX000: tuple concurrently updated` from `roles.sql` in a different file each time, and whole files skipped.
  - With a throwaway file lock around the two `roles.sql` psql sessions in tests/db/helpers/api.ts (reverted, not committed): 6 of 6 runs pass, all 290 tests. Wall time is 18–21 s at 4 workers and 28–30 s at 2, against 53 s serial for the same set. The serial four take 28 s locally on their own.
- `tenancy`'s `ALTER ROLE … IN DATABASE` writes a shared catalog too; it did not collide in the six locked runs.
- qa-engineer-136's independent trial, harness unchanged (/Users/mosko/Projects/polycarpic/.claude/worktrees/qa-136/temp/2026-11-12-qa-136-parallel-db-measurements.md): `tuple concurrently updated` on `ALTER ROLE poly_owner` in `roles.sql` in 2 of 3 runs at 2 workers and 3 of 3 at 4; the one clean 2-worker run took 36.7 s against 60.5–61.9 s serial; runner and ops-status serial 19.4–20.7 s; local setup about 3 s plus about 0.6 s of template build per file.
- Bookkeeping pushes on PR 119 (team-lead): 1df9617 and a436506, with no code change since 66ed997, each reran cairn (120 s, 119 s) and db (113 s, 107 s) plus unit and lint. The cairn anchor logic is in ci.yml lines 80–103 and EXCLUDE is on line 68; the `changes` job diffs BASE..HEAD (line 192). `process/STATE.md` is read by `tests/workflow/test_state_releases_bound.py`, which the cairn suite runs, so STATE.md cannot be skipped outright for that job.

## Unmeasured

- Criterion 9's cairn time with only the ledger-reading tests. The 25 s target assumes about 10 s of checkout and setup (the skipped-job runs above) plus Python setup and one test file.
- Whether any other cairn-suite test reads `process/DECISIONS.md` or a tracker record at run time. `tests/workflow/test_cairn_test_boundary.py` names both as strings only; the builder confirms by grep before fixing the ledger set.

- Any CI parallel run. ubuntu-latest has 4 vCPU shared with the Postgres container, so the 2-worker local figure is the conservative guide. Projection: vitest about 101 → 60–75 s and the job about 80–100 s, which is where criterion 1's 100 s comes from.
- `max_connections` of the test container under 4 workers (auth-routing-pool holds pooled connections).
- Whether ops-status's `pg_locks` query filters by database. If it does, ops-status can leave the serial group.
- How the roughly 22.6 s of vitest setup splits between container start (paid once) and per-file template builds (paid per worker in parallel).
- Area-only job time. Criterion 6's 65 s is an estimate: about 38 s of fixed setup plus auth's 25.3 s at parallel speed.
- Whether vitest 5's project ordering (`sequence.groupOrder`) runs parallel-then-serial in one invocation, or two invocations are needed (two costs one more container start).

## Not in this issue: the cairn job

The cairn job's about 120 s is its Python suite (110 s in run 43126411997; checkout 7 s, Node 4 s). Its runner, `scripts/cairn/run_tests.py`, is already file-parallel (PT-93), and the cairn engine is template-owned, so a faster runner is a project_template issue, ported back on the next template sync. Its filter is already correct: on pull requests that touch no cairn path it skips in about 10 s (runs 43115782276 and 43063276351). It runs in full on every `workflow_dispatch` (`run=true`), so timing campaigns like POLY-136's pay 110 s per run. If that matters, letting a dispatch with a `base` input run the filter is a one-line ci.yml change that fits a small separate ci issue, not this one.

## Comments

### @team-lead — 2026-11-11

Scoped by architect-136 with qa-engineer-136's measurements after POLY-136 merged (2026-11-12); direction set by the Principal: parallel group plus area split now, a failing per-file ratchet later, no PR/nightly tiering, sharding as the fallback only. Criterion 9 (bookkeeping pushes) was added at the Principal's direction: on PR #119 the "in review" and "done" commits each reran cairn (120 s, 119 s) and db (113 s, 107 s) with no code change since 66ed997. The source measurements were throwaway local runs and are summarised in the Measured section; nothing from them is committed.

### @team-lead — 2026-11-11

qa-engineer-136's two source files are kept beside this issue: `process/cairn/reviews/POLY-141/qa-split-measurements.md` (per-file CI and local seconds, cluster-global flags, the four-area split) and `qa-parallel-measurements.md` (the unlocked parallel failure and the valid timings). Local machine had 10 CPUs; nothing in them was run on CI in parallel.

### @team-lead — 2026-11-12

Feature started. Branch: `feature/poly-141-ci-test-time-cuts`. Retitled from "db battery parallel and area-split" (architect-136's suggestion; the scope also covers the bookkeeping-push skip). Carried in from POLY-140: qa saw `tests/infra/image/postgres.test.ts` fail and `caddy.test.ts` flake under local parallel load, unmeasured on `main`; worth one measurement in this loop, not a fix.

### @team-lead — 2026-11-12

Gate 1: ruling at a38584a (`process/cairn/reviews/POLY-141/ruling.md`, conditions C1–C19). Paths: `tests/workflow/test_cairn_test_boundary.py` added (it pins the anchor shell text the ruling moves); `scripts/cairn/run_tests.py` removed, since the ruling leaves it unchanged. seceng reviews R4 and C14–C19 before build green.
