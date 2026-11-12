# Parallel db battery, local measurements on origin/main 719dc4f (M-a, M-b, M-c)

Machine: macOS arm64, 10 CPUs (hw.ncpu 10, Docker Desktop VM also reports 10). CI's ubuntu-latest has 4: so contention here is
LOWER than on CI; the wall times below are not CI predictions. Not restricted to 4 cores (unmeasured). Vitest 5.1.0.
Logs: /Users/mosko/Projects/polycarpic/.claude/worktrees/qa-136/temp/pardb/*.log, summary.txt, probe.ts (throwaway, not committed).
Group 1 = every file except runner and ops-status (17 files, 298 tests). Group 2 = runner + ops-status (54 tests, 2 expected-fail).
Group 1 ran with `--fileParallelism --maxWorkers=N`; control = the repo config (serial).

## M-a: wall seconds, 3 repeats

| run | repeat 1 | repeat 2 | repeat 3 | outcome |
|---|---|---|---|---|
| G1 serial (control) | 60.5 | 61.6 | 61.9 | 298 passed x3 |
| G1 parallel, 2 workers | 36.7 | 29.0 | 29.8 | repeat 1: 298 passed. Repeats 2 and 3: tenancy.test.ts failed in beforeAll, 42 tests skipped (their time is missing from the wall) |
| G1 parallel, 4 workers | 18.6 | 17.8 | 18.9 | all 3 failed: repeat 1 tenancy (42 skipped), repeat 2 tenancy + auth-routing-pool (82 skipped), repeat 3 auth-routing-pool (40 skipped) |
| G2 serial | 19.7 | 20.7 | 19.4 | 52 passed + 2 expected-fail x3 |

Failed runs are faster partly because skipped files do not run, so only the 298-passed runs are valid timings: serial 60.5-61.9 s; 2 workers 36.7 s (one valid sample).

Verbatim failure (every failed parallel run, in `freshDb()` / `cloneMigrated()` called from a file's beforeAll):

    Error: psql failed: psql:<stdin>:42: ERROR:  XX000: tuple concurrently updated
    CONTEXT:  SQL statement "ALTER ROLE poly_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
    PL/pgSQL function inline_code_block line 23 at EXECUTE
    LOCATION:  simple_heap_update, heapam.c:4470

Counts: 2 workers 2 of 3 runs hit it; 4 workers 3 of 3. No deadlock text anywhere. Cause: packages/db/sql/roles.sql is rerun in every
fresh database and its DO block ALTERs cluster-wide roles (pg_authid rows) every time, so two workers building databases at once
collide on the same role row. The failure is in test setup, not in a test body. The two runner/ops-status files (G2) were never run in parallel.
Untested options to remove it: take `pg_advisory_lock(<const>)` in the psql session around roles.sql, or make the ALTER ROLE
conditional on drift. Neither was tried; either changes the harness only, not the shipped roles.sql behaviour in production (unmeasured whether provision.sh needs the same).

## M-b: setup breakdown (local, node probe, 3 runs, ms)

| step | run 1 | run 2 | run 3 |
|---|---|---|---|
| startServer: image inspect + docker run + ready poll | 2806 | 2684 | 2514 |
| setRolePasswords (once, globalSetup) | 298 | 283 | 285 |
| freshDb() | 85 / 111 | 80 / 95 | 82 / 97 |
| first cloneMigrated() per file (template build + clone) | 734 | 626 | 658 |
| later cloneMigrated() | 89 | 86 | 83 |

Local global setup is about 3 s (image already cached). The template build costs about 0.55-0.65 s extra once per file that
calls cloneMigrated. CI is unmeasured for these (CI's image check may build the test image on a cold runner; the CI log
for the last run does not isolate it). The ~22.6 s gap between CI file-time sum (78.5 s) and vitest Duration (101.1 s) is
therefore not explained by these local numbers (3 s + files x ~0.6 s); remainder unmeasured.

## M-c: CPUs

10 locally (see top). CI: ubuntu-latest 4 vCPU per the request, not read from the run.

State after: my worktree is detached at 719dc4f for this measurement; no commit was made.
