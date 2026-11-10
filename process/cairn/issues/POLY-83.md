---
id: POLY-83
title: DB roles, migrate, withTenant
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-76, POLY-82]
assignee: backend-lead
paths: [packages/db/**, tests/db/**, tests/layers/**, apps/migrate/**, apps/web/src/**, apps/worker/src/**, apps/*/package.json, pnpm-lock.yaml, pnpm-workspace.yaml, package.json, scripts/db/**, layers.json]
labels: [db, security]
priority: P1
pr: null
created: 2026-11-08
updated: 2026-11-09
---

packages/db: the migration chain (tool per POLY-76), the full Postgres role set, and the only connection path (ARCH §3.3). All roles are created here so role hygiene (C-10) and the definer allowlist (C-15) see the full set from the first migration; each definer function lands with its feature. Includes poly_backup with SECURITY C-79's attributes, and the migrate subcommands the deploy script calls (ARCH §8.1).

## Acceptance criteria

- [ ] Roles poly_owner, poly_migrator, poly_app, poly_worker, poly_authz, poly_purge, poly_rollup, poly_graph, poly_stake, poly_govern, poly_journal exist as ARCH §3.3 states (LOGIN/NOLOGIN, NOBYPASSRLS).
- [ ] poly_backup: LOGIN, REPLICATION, BYPASSRLS, member of pg_read_all_data, NOSUPERUSER NOCREATEDB NOCREATEROLE, CONNECTION LIMIT 3, default_transaction_read_only = on, no write grants (C-79), with its pgTAP.
- [ ] Migrations apply as poly_migrator via set role poly_owner; objects owned by poly_owner; tracking row written; poly_app has no CREATE on public.
- [ ] app.current_user_id() uses the nullif form (A-3); withTenant(userId, sessionId, fn) sets app.user_id and app.session_id with is_local = true.
- [ ] withSystem(job, target, fn) errors when no principal resolves; app.job_targets(job) is a definer executable by poly_worker only, on the allowlist.
- [ ] migrate check-config and migrate --plan behave per ARCH §8.1 (exit 0 / 3 / other; --plan takes no lock and writes nothing).
- [ ] web and worker refuse to start when the applied schema is behind the image.
- [ ] The migrate runner takes a Postgres advisory lock before applying, and refuses (non-zero, nothing applied) when the tracking rows are not a hash-for-hash prefix of the journal (POLY-76 ruling §4.4).
- [ ] CI refuses a migration journal whose `when` timestamps are not strictly increasing in journal order.
- [ ] Schema `drizzle` and its tracking table are owned by poly_owner; poly_migrator holds no CREATE on the database and migrate still succeeds; poly_app and poly_worker hold USAGE on `drizzle` and SELECT on the table only.
- [ ] A session-level SET appears only in the migrate module (the one layers.json exemption), and a file check fails any custom migration whose last SET ROLE is not poly_owner.
- [ ] The `db/auth` subpath exports BetterAuth's plain poly_app pool, withContextFreeTx, and a BetterAuth `fields` map derived from the Drizzle tables (no hand-written column names); only packages/auth imports it.
- [ ] withContextFreeTx, withTenant and withSystem refuse to nest inside one another (each pair is a fixture), and withContextFreeTx's first statement asserts app.user_id is empty (SECURITY C-84).
- [ ] pgTAP: poly_owner is NOLOGIN NOBYPASSRLS, and poly_migrator is its only member, granted WITH INHERIT FALSE, SET TRUE (also for the definer-owner roles). poly_migrator owns no object in pg_class, pg_proc, pg_namespace or pg_type (SECURITY C-85).
- [ ] The file check fails a custom migration containing SET SESSION AUTHORIZATION, RESET ROLE, or SET ROLE to a role outside poly_owner and the C-10 definer-owner set. A fixture migration ending on SET ROLE poly_authz fails its tracking insert and rolls back the whole run. The runner asserts current_user = 'poly_owner' when migrate() returns (ARCH v1.14.2 §6.2).
- [ ] The runner uses one pg client, never a pool, and closes it in finally. Two fixtures are refused with nothing applied: a migration with a timestamp older than the last applied, and an edited applied file (SECURITY T-91).
- [ ] pgTAP: every grant to poly_migrator has inherit_option false, set_option true, admin_option false; a fixture file ending on SET ROLE poly_authz (file check bypassed) rolls the whole run back.

## Comments

### @team-lead — 2026-11-09

Feature started. Branch: `feature/poly-83-db-roles-migrate-withtenant`.

### @architect — 2026-11-09

Ruling @ 98a52e3: process/cairn/reviews/POLY-83/ruling.md (R1–R8) is the build contract. Superuser bootstrap file creates the roles; closed SET ROLE list = poly_owner + the seven C-10 roles; only poly_authz owns a definer in M1 (app.job_targets, zero rows); runner/--plan predicates and exit codes (R6); apps/migrate + restricted db/migrate and db/startup subpaths (R7); migrations check in packages/db under pnpm lint (R8). ARCH v1.15.3 carries the doc-level parts. seceng to concur at review on reading C-10 'granted to none' as 'none but poly_migrator, INHERIT FALSE, SET TRUE' (R1).

### @architect — 2026-11-09

Architect verdict @ 37db02c: APPROVED. Conditions: qa's tests/db gate goes green on the final sha, and seceng concurs on the two readings at the end of this comment.

| axis | result | evidence |
|---|---|---|
| Roles (12; LOGIN/NOLOGIN, NOBYPASSRLS; poly_backup per C-79) | pass | packages/db/sql/roles.sql @ 37db02c |
| Ownership: poly_owner owns the DB, public, app, drizzle; poly_migrator holds nothing, members INHERIT FALSE SET TRUE no ADMIN, preflight exit 2 | pass | roles.sql; migrate.ts assertRoles |
| Definers: only app.job_targets, owned by poly_authz, poly_worker only, search_path '', zero rows; CREATE on app granted for the file only | pass | 0001_app_foundation.sql; sql/definers.json |
| Scope: no RLS policy, no tenant table (POLY-84 / POLY-62) | pass | migrations/ @ 37db02c |
| Runner: one client, lock, (hash, created_at) prefix, DB ahead = nothing pending, convergence + current_user asserts, exit 0/1/2/4 | pass | migrate.ts, journal.ts @ 37db02c (R4 fixed) |
| --plan: no lock, READ ONLY, exit 0/3/2/1 | pass | migrate.ts plan() |
| check-config: DATABASE_* only, run before every subcommand; no URL env, no URL string | pass | cli.ts, connection.ts @ 37db02c (R2, R3 fixed) |
| File check: closed SET ROLE list; quoted and unparseable targets fail closed; comments stripped string-aware | pass | migrations-check.ts + test, db unit tests 6/6 run @ 37db02c (R1, N1 fixed) |
| withTenant / withSystem / withContextFreeTx: AsyncLocalStorage non-nesting, set_config(…, true), principal resolved in the DB, C-84 first statement | pass | context.ts |
| db/auth: plain pool, withContextFreeTx, fields map derived from Drizzle | pass | auth.ts |
| Start-up guard: journal `when` is a prefix of created_at; web and worker exit non-zero | pass | startup.ts, apps/*/src/startup.ts |
| Layer map: db/migrate only for apps/migrate, db/startup for web/worker; one SET-exempt file | pass | layers.json; pnpm lint exit 0 @ 37db02c |
| uuid keys on BetterAuth tables (SECURITY (l)) | pass; BetterAuth accepting them is (unmeasured) | schema/auth.ts, 0000 @ 37db02c (R5); POLY-86 measures |
| Integration (tests/db) | not verified at this sha | qa gate |

URL env ruling: none survives POLY-83. Non-blocking: N3 (configure() on the db index; revisit with POLY-85).
For seceng: (1) C-10's "granted to none" read as "none but poly_migrator, INHERIT FALSE, SET TRUE"; (2) C-10/C-85's "role migrations" read as sql/roles.sql, run by a superuser outside the chain (ruling R1, Addendum 1).
