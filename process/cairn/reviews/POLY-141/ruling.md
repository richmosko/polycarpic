# POLY-141 gate-1 ruling (architect)

Base fb9cb9b. The criteria stand; this settles what the issue left open. Local measurements: macOS arm64, 10 cores, Docker 29.9.3,
vitest 5.1.0, prototype edits to `tests/db/` reverted. Nothing is committed but this file.

## Measured this session

- **M1 One invocation works.** `test.projects` with `db-parallel` (`sequence.groupOrder: 0`, `fileParallelism: true`) and `db-serial`
  (`groupOrder: 1`, `fileParallelism: false`), a file lock around the bootstrap, `maxWorkers: 3`: 352 tests, 352 passed. That is the
  base count. In every run the serial project's first file started after the parallel project's last file ended (JSON reporter times).
- **M2 globalSetup.** Listed per project, it runs once per project (two containers, +2.7 s). Listed at the root, it runs once.
- **M3 Wall time** (first file start to last file end; every locked run passed): 3 workers with the serial four, 39.8 and 40.6 s;
  3 workers with ops-status in the parallel group, 36.8 to 37.7 s over 7 runs; 2 workers, 44.3 s (1 run); 4 workers, 33.3 and 41.4 s.
  qa-136's serial baseline is 72 s.
- **M4 Lock removed.** Same config, 3 workers: 2 of 3 runs fail, each with `tuple concurrently updated` on `ALTER ROLE poly_owner`
  in `roles.sql`, and auth-routing-pool's 40 tests skip. The failure is probabilistic, so a runtime canary cannot be a reliable red.
- **M5 ops-status.** No `pg_locks`, `pg_stat_activity` or role write in `ops-status.test.ts` or `apps/web/src/ops/*` (grep). Ran
  5 of 5 green in the parallel group. `runner.test.ts` does read `pg_locks` across all databases (lines 249 and 264).
- **M6 template-clone.** Ran 3 of 3 green in the parallel group and saved about 1.5 s. Not taken (R2).
- **M7 Cluster writes, by file** (grep for CREATE/ALTER/DROP ROLE, role-membership GRANT/REVOKE, PASSWORD, `pg_locks`): only runner
  (membership GRANT/REVOKE, `pg_locks`, `pg_terminate_backend`) and the harness's `setRolePasswords` (globalSetup, which runs
  before any worker). The one `ALTER ROLE … IN DATABASE` is in `wrappers.test.ts`, not tenancy.
- **M8 Connections.** Peak sampled client backends on the run's own container: 20 at 3 workers, 16 at 4. Sampling was every
  0.45 s, so these are lower bounds. `max_connections` is 100.
- **M9 Area-only run.** The 7 auth files through both projects (the serial project is empty, which vitest accepts): 137 tests,
  12.1 s wall against 37 s for the full run.
- **M10 Ledger readers** (grep of `tests/workflow` and `scripts/cairn/tests` for paths built from the real repo root):
  `test_state_releases_bound.py` reads `process/STATE.md`. `test_ruling_archive_records.py` runs `git grep` over the whole tree
  except `process/cairn/reviews` and POLY-57, so it reads STATE.md, DECISIONS.md and every tracker record, plus the five
  pinned rulings. Every other hit builds its paths in a temp fixture. The two files together take 0.46 s locally
  (`run_tests.py -p … -p …`). A grep cannot prove nothing else reads them; C17 covers that.
- **M11 Renames hide paths.** With git's default rename detection, `git diff --name-only` lists only a rename's destination: in a
  scratch repo, `packages/db/x.ts → process/cairn/issues/x.md` listed only the issue file. With `--no-renames` both paths appear.
  Today's `changes` diff and both cairn diffs have this hole.

## R1 Bootstrap serialisation (criterion 2): a harness file lock

- **Where.** A new module, `tests/db/helpers/bootstrap-lock.ts`, exports `withBootstrapLock(fn)`. globalSetup creates a per-run
  directory with `mkdtemp` and exports `POLY_TEST_LOCK_DIR` before any worker starts; workers inherit it the same way they inherit
  `POLY_TEST_SERVER`.
- **How it locks.** Acquire is `mkdirSync(<dir>/bootstrap.lock)`, which is atomic across processes. On EEXIST it waits 10 ms
  (`Atomics.wait`) and retries. After 120 s it throws `bootstrap lock timeout`; it never runs unlocked. Release is `rmdirSync` in
  `finally`. If `POLY_TEST_LOCK_DIR` is unset, it throws.
- **What it covers.** The whole psql session in `freshDb()` and the clone session in `cloneMigrated()` (CREATE DATABASE plus
  `roles.sql`), which is what was measured. `setRolePasswords` runs once, in globalSetup, and is not wrapped. `roles.sql` is
  unchanged, so `packages/db/sql/**` stays out of the paths.
- **Not once in globalSetup.** The database half of `roles.sql` (owner, CONNECT grants, default privileges, schema `public`) has to
  run in every database. Running only that half would mean the harness runs text that `provision.sh` never runs.
- **Not `pg_advisory_lock`.** An advisory lock is keyed by database, and the session `\connect`s into the new database, so holding
  the lock would need a second long-lived session per call.
- **Stale locks.** The directory is per run, so no stale lock carries into the next run. A worker that dies holding the lock
  already fails the run, and the 120 s timeout bounds the wait.
- **Why `wrappers`' `ALTER ROLE poly_app IN DATABASE <db>` is safe unlocked.** It writes the `pg_db_role_setting` row keyed by
  (its own database, poly_app). `roles.sql`'s only write to that catalog is the row (database 0, poly_backup), and its other cluster
  writes are `pg_authid` role rows. `tuple concurrently updated` needs two updates of the same tuple; these are different tuples.
  13 locked runs here and 6 by architect-136 had no failures. C5 keeps it that way: outside the serial project, no test writes a
  cluster-wide row.
- **Canary.** C1 to C3 are static and deterministic; the unlocked runtime failure is 2 in 3 (M4).

## R2 Projects and workers (criterion 1)

- **One invocation.** `tests/db/vitest.config.ts` declares the two projects as in M1, with `globalSetup` at the root only. Two
  invocations would cost a second container start and buy nothing.
- **Workers.** `maxWorkers: 3`, pinned at the root: 4 vCPU less one for Postgres. Pinning also makes local runs use the CI shape.
- **Groups.** The serial project is runner, template-clone and ops-hardening, exported as `SERIAL` from the config. The parallel
  project is `include` minus `SERIAL`.
  - ops-status leaves the serial group (M5).
  - template-clone stays serial: what it checks is cluster-wide role state, and 1.5 s does not justify widening C5.
  - ops-hardening stays serial: its 4.8 s production timeout has not been measured under contention on 4 vCPU.
- **`max_connections`** 100 against a sampled peak of at least 20: no change.
- **If criterion 1 misses at 3 workers,** run one more five-run set at 4. Sharding comes only after that.
- **CI projection (unmeasured).** Parallel group is about 56 s of CI file time spread over 3 workers, plus contention; serial group
  22.5 s. That puts vitest at 55 to 70 s and the job at 75 to 90 s.

## R3 Area map (criteria 3–5)

The single source is `infra/ci/changes.mjs`. It exports `DB_SHARED` (regexes) and
`DB_AREAS = { auth|tenancy|migrate|ops: { tests: [exact files], paths: [regexes] } }`. Each area's paths include its own test
files, matched exactly. The table below covers all 19 files.

| area | parallel project | serial project | paths beyond its test files |
|---|---|---|---|
| auth | auth-client-ip, auth-fields, auth-route-policy, auth-routing-pool, auth-second-step, auth-session, auth-signup-wrap | | `packages/auth/`, `packages/tenancy/` |
| tenancy | tenancy, matrix, wrappers, battery, pgtap | | `packages/tenancy/`, `tests/db/pgtap/` |
| migrate | checks, connection, migrate-run-helper | runner, template-clone | |
| ops | ops-status | ops-hardening | `apps/web/src/ops/`, `apps/web/src/main.ts`, `apps/web/src/startup.ts`, `tests/log/` |

- **`DB_SHARED`:** `packages/db/` (src, migrations, sql), `apps/migrate/`, `packages/config/`, `tests/db/helpers/`,
  `tests/db/global-setup.ts`, `tests/db/vitest.config.ts`, `tests/db/docker/`, `infra/postgres/Dockerfile`, `infra/postgres-major`,
  `pnpm-lock.yaml`.
  - Why these: every test file reaches `packages/db/src/{connection,journal,migrate}`, `apps/migrate` and `packages/config` through
    `helpers/api.ts` (measured closure), and every `cloneMigrated()` reads the migrations and `roles.sql` as data.
  - The helpers count as shared as a whole. Narrowing the helpers that only one area uses (sql/auth for auth; matrix, cross-tenant,
    tenancy and definers for tenancy) can come later.
- **Classify.** The `db` key keeps its existing rule (`TABLE.db`). For each changed path that sets `db`:
  - a shared path turns on all four areas;
  - otherwise, every area whose paths match turns on;
  - if none match, all four turn on (fail closed).
  - Invariant: `db` equals the OR of the four area keys.
  - A dispatch run with no base sets every key true.
- **Selection.** `node infra/ci/changes.mjs --db-select` reads `DB_AUTH`, `DB_TENANCY`, `DB_MIGRATE` and `DB_OPS` from the
  environment.
  - It prints `all` when every area is on; otherwise it prints the selected files, one per line.
  - It exits 1 when the map is wrong against the disk (a `tests/db/*.test.ts` in no area or in two, or a listed file that does not
    exist), when no area is on, or when a value is not exactly `true` or `false`.
  - On `all`, the battery step runs with no file filter, so even a stray file still runs.
- **Preflight in the `db` job, before Docker:**
  `pnpm exec vitest run -c tests/ci/vitest.config.ts tests/ci/db-filter-imports.test.ts tests/ci/db-areas.test.ts tests/ci/db-harness.test.ts`.
  - Today these proofs run only when `ci` changes (the lint job), so a PR that adds an import from one area's tests into another
    area's code would not run them.
  - Any edit to an import line is itself a `db`-filter path, so with the preflight the proof runs on the very PR that could break it.

## R4 Anchor rule (criterion 9): `infra/ci/anchor.mjs`

Node built-ins only, like `changes.mjs`, so it runs on the runner's own node without setup-node (the `changes` job already relies on
this). The pure core is `decide(io)`: `io` supplies `lookup()`, `hasCommit(sha)`, `isAncestor(a, b)` and `diff(a, b)`, so tests can
inject fakes. The CLI wraps those with `spawnSync`, prints exactly one line, `ledger_only=true` or `ledger_only=false`, writes the
reason to stderr, and exits 0. It exits non-zero only on an internal crash, which turns the step red. The calling shell compares the
output with `= "ledger_only=true"`; any other output counts as false.

**Algorithm:**

1. `EVENT_NAME` is not `pull_request` → false.
2. `gh api "repos/$REPO/actions/workflows/ci.yml/runs?event=pull_request&status=success&branch=$HEAD_REF&per_page=1"`, with a
   30 s timeout.
   - Non-zero exit, timeout, unparseable JSON or no run → false.
   - `workflow_runs[0]` must have `conclusion` success, `event` pull_request, `head_branch === HEAD_REF`,
     `head_repository.full_name === REPO` (no fork runs) and `head_sha` matching `^[0-9a-f]{40}$`; otherwise false.
3. `git cat-file -e <A>^{commit}` fails → false.
4. `git merge-base --is-ancestor A PR_HEAD` and `git merge-base --is-ancestor PR_BASE A`: either non-zero → false.
5. `git diff --no-renames --name-only A PR_HEAD`: non-zero exit → false; empty output → false.
6. True only if every path matches `LEDGER` and none matches `PINNED_RULINGS`.

**Constants:**

- `LEDGER` = `^process/cairn/(issues|milestones|majors|archive|reviews)/`, `^process/STATE\.md$`, `^process/DECISIONS\.md$`.
- `PINNED_RULINGS` = today's regex, unchanged.
- `LEDGER_TESTS` = `test_state_releases_bound.py`, `test_ruling_archive_records.py`.

**`changes` job:**

- On `ledger_only=true` it runs `node infra/ci/changes.mjs --none`, which prints every key false: `TABLE`'s keys plus the four area
  keys.
- Otherwise it keeps today's path, with `--no-renames` added.
- The job gains `actions: read`, plus `GH_TOKEN`, `REPO`, `HEAD_REF` and `PR_HEAD` in the environment.

**`cairn` job:** the shell anchor block (from `rc=0; ANCHOR=` to the first `SKIP=true`) is replaced by the `anchor.mjs` call. The
output becomes `run=true|ledger|false`:

- `ledger_only=true` → `ledger`.
- Otherwise the job looks at BASE..HEAD (now with `--no-renames`): a PATTERN or PINNED hit → `true`; else any path in `LEDGER` →
  `ledger`; else `false`.
  - The `ledger` result on BASE..HEAD is new. Today a PR that touches only STATE.md or a tracker record runs no cairn test, although
    both ledger tests read those files (M10). That is a skip that can let a red change merge; closing it costs about 15 s per such
    PR (unmeasured).
- On `ledger`: Set up Python, then `python3 scripts/cairn/run_tests.py` with one `-p <name>` for each line of
  `node infra/ci/anchor.mjs --ledger-tests` (a bash array). No Node setup, no JS suite.
  - `scripts/cairn/run_tests.py` is unchanged: `-p` is repeatable and searches both roots.
  - Cairn target estimate: about 7 s checkout, Python setup, and under 1 s of tests (unmeasured on CI).

## Merge gate

A job skips only when nothing it reads has changed since a state in which it was green.

- **Area skip.**
  - Each area runs on every path in its import closure (C9) and on the shared set; a `db` path in no area runs all four (C8).
  - The proof runs on every `db` run, through the preflight. An edit that widens a closure is therefore checked on the same PR.
  - Runtime data reads are shared by rule (`packages/db/` as a whole), and string-literal paths are followed as edges (C9).
  - Residual risk: a file read through a computed path string. Reviewers watch for one.
- **Anchor skip.**
  - The anchor is a commit whose whole workflow passed on this branch, contains the current base, and is contained in the head.
  - Only `LEDGER` files differ from it. No job reads those except the ledger tests (C17), and those run.
  - Every lookup or git failure gives today's behaviour (C14). A merge from `main` or a rebase disqualifies the anchor (step 4).
  - `--no-renames` stops a rename from hiding a path (C16). That hole exists in today's filters and is fixed here.
- **What never changes.** `guard` (gitleaks, pins) never skips, `app`'s REQUIRED is unchanged, and under the strict check the head
  that merges has its own run.
- **seceng** should review R4 and C14 to C19 before build green, because they change what the required checks verify on a given head.
  That review does not hold up the start of the build.

## Build order and CI-only measurements

1. Criterion 9, plus C16 (`--no-renames`). Files: `anchor.mjs`, `tests/ci/anchor.test.ts`, the ci.yml `cairn` and `changes` steps,
   `changes.mjs --none`, `test_cairn_test_boundary.py`. This shares `ci.yml` (other jobs) and `changes.mjs` (a CLI flag, not the
   table) with the harness work only textually, so build it first and push it. This loop's own bookkeeping pushes then use it.
2. The lock (C1 to C4), the projects and `SERIAL` (C5, C6, C12).
3. The area map, `--db-select` and the preflight (C7 to C11).
4. Per-file timing (C13).
5. INFRA (criterion 8, devops-engineer).

Only CI runs can judge these:

- **Criterion 1, and the CI half of criterion 2:** five sequential full dispatch runs (base empty) on the final head.
- **Criterion 6:** four dispatch runs, each with `base` set to the feature head sha, on a scratch branch made of the feature head
  plus one commit that touches only that area's paths (for example, a comment in `tests/db/auth-session.test.ts`). None of them
  merges. These go through the same filter code as a PR (`changes.mjs` on base..HEAD), and I rule that they satisfy "one scratch
  pull request per area".
- **Criterion 9 target:** this needs `pull_request` events. Use this issue's own PR: once it is green, the in-review commit and one
  more ledger-only commit (an issue comment) are the two bookkeeping pushes. No scratch PR is needed.

## Conditions

1. **C1 Lock excludes.** Two processes contend for the lock; the second acquires only after the first releases (timestamps).
   Lives in `tests/ci/db-harness.test.ts`, no Docker. Red if the lock is a no-op.
2. **C2 Lock fails loudly.** It throws when `POLY_TEST_LOCK_DIR` is unset. Held past the timeout (injectable via
   `POLY_TEST_LOCK_TIMEOUT_MS`), it throws `bootstrap lock timeout`. `fn` never runs unlocked.
3. **C3 Static wrap.** In `tests/db/**`, every psql call that sends `BOOTSTRAP` text is inside `withBootstrapLock`, except
   `setRolePasswords`, and no other file reads `roles.sql` or `BOOTSTRAP`. Red if the wrapper is removed from `freshDb` or
   `cloneMigrated`.
4. **C4 Lock directory.** globalSetup creates `POLY_TEST_LOCK_DIR` with `mkdtemp` and exports it before workers start.
5. **C5 No cluster writes in parallel.** No parallel-project file contains CREATE ROLE, DROP ROLE, ALTER ROLE not followed by
   `<name> IN DATABASE`, a GRANT or REVOKE without `ON` (role membership), ALTER SYSTEM, `pg_locks`, `pg_stat_activity` or
   `pg_terminate_backend`. Red if runner moves to the parallel project.
6. **C6 Config shape.** Projects `db-parallel` (groupOrder 0, fileParallelism true) and `db-serial` (groupOrder 1, fileParallelism
   false); `globalSetup` at the root only; `maxWorkers: 3`; `SERIAL` exported and equal to exactly
   `[runner, template-clone, ops-hardening]`.
7. **C7 One area, one project.** Every `tests/db/*.test.ts` on disk is in exactly one `DB_AREAS[*].tests` and in exactly one project,
   and every listed file exists. Red for a file in none, in two, or missing.
8. **C8 Classify.** Area-only cases select only that area. Shared paths select all four. A `db` path in no area (a new
   `tests/db/new.test.ts`, `tests/db/x.sql`) selects all four. A non-`db` path selects none. `db` equals the OR of the areas over the
   fixtures. A dispatch with no base sets every key true (the ci.yml printf).
9. **C9 Closure per area** (criterion 5). Walk relative, `@poly/*` and `join(ROOT, '<literal>')` edges. Red with a fixture in which an
   auth test imports a file covered only by ops paths.
10. **C10 `--db-select`.** Prints `all` if and only if all four areas are on; otherwise the union of the selected areas' tests. Exits 1
    on an invalid map, on no area on, or on a value that is not `true`/`false`.
11. **C11 `db` job.** The preflight runs the three `tests/ci` files before Docker; the battery step uses `--db-select`; the area
    values arrive through `env:`, with no `${{ }}` in `run:` (check-run-expr).
12. **C12 Same tests.** A full run executes 352 tests, the base count, locally and on CI (build-green evidence).
13. **C13 Per-file timing.** With `VITEST_JSON` set, `job-report.mjs` writes one jsonl line per file
    (`runner: 'ci:db:file'`, file, project, area, seconds, ok) alongside the job line. If the JSON is missing or unreadable it writes
    only the job line and exits 0. The `budgets.json` `db` budget becomes 100 and stays a warning.
14. **C14 Anchor fails closed.** `decide()` returns false for each of: a non-PR event, a lookup error, a timeout, bad JSON, no run, a
    fork run, a branch mismatch, a malformed sha, a missing commit, either ancestry check failing, a diff error, an empty diff, a path
    outside `LEDGER`, a pinned ruling. A ledger-only diff returns true. Red if any failure branch returns true.
15. **C15 `changes` step.** Ledger-only gives every key false through `--none`, with the keys equal to `TABLE`'s plus the areas;
    otherwise the path is unchanged; the comparison is exact (`ci-workflow.test.ts`).
16. **C16 No renames.** Every diff that feeds a filter (the `changes` job, and the cairn job's BASE..HEAD and anchor diffs) passes
    `--no-renames`. Covered by a text test and a rename fixture.
17. **C17 Ledger readers.**
    - (a) At tests-red, qa runs the full cairn suite once under a Python audit hook (`sitecustomize` on `PYTHONPATH`) that logs opens
      of real-repo `LEDGER` paths and subprocess argv containing `git grep` or `ls-files`. The set of readers must equal
      `LEDGER_TESTS`. Record the result in `reviews/POLY-141/`.
    - (b) A permanent guard in `test_cairn_test_boundary.py`: any file under `tests/workflow` or `scripts/cairn/tests` that joins a
      repo-root constant with STATE.md, DECISIONS.md or a tracker directory name, or that runs `git grep` or `ls-files`, must be in
      `LEDGER_TESTS` (read from `anchor.mjs`).
18. **C18 Cairn step.**
    - `run=ledger` runs exactly `LEDGER_TESTS`, with Node setup and the JS suite skipped. `run=true` is unchanged. A BASE..HEAD with
      only ledger paths gives `ledger`.
    - The pins in `test_cairn_test_boundary.py` change with it: the anchor shape checks move to `tests/ci/anchor.test.ts`, and
      `run=false` is written once.
19. **C19 One anchor implementation.** `ci.yml` contains no `merge-base --is-ancestor`. In `anchor.mjs`, `PINNED_RULINGS` and the
    tracker leg of `LEDGER` equal ci.yml's `PINNED_RULINGS` and `EXCLUDE` literals (a `tests/ci` text test).

## Paths

- **Added:** `tests/workflow/test_cairn_test_boundary.py`. It pins the anchor shell text this ruling moves (C17b, C18). Because
  `tests/workflow/` is in PATTERN, this PR runs the full cairn job.
- **Not needed:** `scripts/cairn/run_tests.py` and `packages/db/sql/**` stay untouched.

## Not affected

`tests/infra/image/postgres.test.ts` and `caddy.test.ts` run in the `image` job on their own runner, and nothing here touches that job
or those files. Locally the battery now keeps 3 workers plus Postgres busy instead of 1, so running the db and image suites at the
same time adds CPU load and may make the Caddy flake more likely (unmeasured). Separately, five stale `poly83-qa-*` containers
(image `polycarpic-pg17-pgtap:test`, not from this session) were running on this machine during the measurements.
