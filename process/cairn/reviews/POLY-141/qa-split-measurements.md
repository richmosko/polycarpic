# db battery: per-file cost, parallel groups, area split (measurements for the CI test-time issue)

Sources: CI = run 43126411997 (final head 66ed997, `db` job 124 s, vitest Duration 101.1 s, 352 tests in 19 files);
local = JSON reporter run at 8d2173e, 72.4 s wall (file end minus start; the earlier baseline is in
temp/2026-11-11-qa-136-db-baseline.md). Config today: `fileParallelism: false`, one globalSetup that starts one container and
calls `setRolePasswords()` once. Classification below is from reading and grepping the files, not from running them in parallel.

## 1. Per file (seconds; CI | local; tests)

| file | CI | local | tests | state it touches |
|---|---|---|---|---|
| runner | 12.5 | 10.0 | 23 | CLUSTER: `pg_locks`/`pg_stat_activity` polls, role GRANT/REVOKE on cluster roles, ACL-drift cases, spawned CLI; 20 fresh DBs |
| tenancy | 9.9 | 7.2 | 42 | own DB (+ `vi.resetModules`); `ALTER ROLE poly_app IN DATABASE` is per-DB |
| auth-routing-pool | 7.9 | 6.3 | 40 | own DB; real 5 s wait (S5) |
| checks | 7.2 | 6.6 | 58 | own DBs; `vi.resetModules` + `vi.stubEnv` (process-global, per worker) |
| ops-hardening | 5.9 | 5.6 | 4 | own DB; `resetModules` + env; 4.8 s hard-timeout case |
| ops-status | 5.9 | 4.1 | 31 | `pg_locks` read (unfiltered by db, see 2), `resetModules` + env |
| auth-route-policy | 4.4 | 2.6 | 33 | own DB |
| template-clone | 4.1 | 3.2 | 4 | CLUSTER read: asserts login roles' stored password hashes are unchanged by `freshDb()` |
| auth-session | 3.9 | 2.0 | 15 | own DB |
| auth-client-ip | 3.3 | 1.5 | 10 | own DB |
| matrix | 3.1 | 2.0 | 6 | own DB |
| auth-fields | 2.0 | 0.4 | 12 | own DB |
| auth-signup-wrap | 2.0 | 0.6 | 13 | own DB |
| pgtap | 1.9 | 0.9 | 10 | own DB (extension lives in the template, per-DB) |
| auth-second-step | 1.8 | 0.5 | 14 | own DB |
| wrappers | 1.5 | 0.4 | 19 | own DB; `resetModules` |
| battery | 1.2 | 0.1 | 8 | own DB; `resetModules` |
| connection | 0.0 | 0.0 | 9 | none |
| migrate-run-helper | 0.0 | 0.0 | 1 | none (mocked `run`) |

Sum of CI file times 78.5 s against 101.1 s vitest Duration: the other ~22.6 s is container start, `setRolePasswords`, and
imports (split unmeasured). Outside the battery step the job costs 16 s (checkout, node, pnpm, install, cache; measured in the run).

## 2. Which could share a parallel group

Postgres roles are cluster-wide, databases are not. Every file gets its own database from `freshDb()` or the clone, so
database-scoped state does not collide. What collides is cluster-wide state and process-wide state.

- Parallel-safe as they stand (own DB only, no env stubbing, no global-state asserts): auth-route-policy, auth-session,
  auth-client-ip, auth-fields, auth-signup-wrap, auth-second-step, auth-routing-pool, matrix, pgtap, battery, wrappers,
  connection, migrate-run-helper (CI 33.0 s for the lot). Caveat (unmeasured): `max_connections` of
  the container and CPU count on the runner; auth-routing-pool holds pooled connections.
- Parallel-safe if each file runs in its own vitest worker (`resetModules` and `stubEnv` mutate process state, so these
  need a worker per file, which vitest's default file parallelism gives): tenancy, checks, ops-hardening.
- Blocked, keep serial:
  - runner: cluster-global role GRANT/REVOKE and ACL drift (POLY-102 profile), unfiltered `pg_locks`/`pg_stat_activity`.
  - ops-status: reads `pg_locks` cluster-wide (a lock held by another file's runner case would change its result; unmeasured whether
    the query filters by database, check before moving it).
  - template-clone: asserts role password hashes are untouched; any file that ALTERs a login role's password would break it.
  - ops-hardening: the 4.8 s case is a production timeout and CPU-timing sensitive under contention (unmeasured).
- Mechanism (unmeasured): vitest `projects`, one serial project (runner, ops-status, template-clone, ops-hardening) and one
  parallel project (the rest). Serial project CI cost 28.4 s; the parallel set sums to 50.1 s of file time, so its wall time is
  bounded by the slowest file (tenancy 9.9 s) plus contention. Estimated best case ~40 s total, unmeasured; contention on a 4-vCPU
  runner could double the parallel part.

## 3. Area split (CI file seconds; each sub-battery job also pays ~16 s job overhead plus container start, unmeasured)

| area | files | CI s | local s |
|---|---|---|---|
| migrate | runner, checks, template-clone, connection, migrate-run-helper | 23.8 | 19.8 |
| auth | auth-routing-pool, route-policy, session, client-ip, fields, signup-wrap, second-step | 25.3 | 13.9 |
| tenancy/RLS | tenancy, matrix, wrappers, battery, pgtap | 17.6 | 10.6 |
| ops | ops-hardening, ops-status | 11.8 | 9.7 |

Triggers today: the single `db` filter in infra/ci/changes.mjs matches packages/db, tests/db, packages/config, packages/tenancy,
packages/auth, apps/migrate and the postgres image paths. A split needs one filter output per area, `REQUIRED` rows and the
drift test from item 2 extended per job, and a shared fallback so a change to packages/db, tests/db/helpers or the
postgres image runs all four. Cost of the split on a full run: four jobs each paying ~16 s overhead (parallel on separate
runners, so wall time is the slowest job ≈ 16 s + ~25 s + container start; billed time grows by ~48 s). Gain is on
partial runs only: an auth-only change would run 25 s of tests instead of 78 s.
Not measured: container start time alone, runner CPU count, `max_connections`, and any run of files in parallel.
