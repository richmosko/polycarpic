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

### @seceng — 2026-11-09

SecEng verdict @ 37db02c (no code changed through 5e28ba3): CONCUR on both readings; CONDITIONAL on M-1 and M-2. SECURITY v1.7 (this commit) now says what the build does: C-10, C-85, TB-3.

Readings. (1) C-10 "granted to none" now reads "to no role but poly_migrator, INHERIT FALSE, SET TRUE, no ADMIN". Concur. The DB enforces it: SET ROLE is checked against poly_migrator's memberships, so no file can reach a role outside the eight. (2) "Role migrations" now names sql/roles.sql: a superuser runs it outside the chain, it converges, and the runner preflights it (exit 2). Concur, with M-2.

TLS. connection.ts gives the same ClientConfig to migrate and to both pools: require = {rejectUnauthorized:false} (encrypted, nothing verified), verify-full = ssl:true (chain and host name checked against the system CAs). That is the libpq meaning. On the box, disable or require is acceptable: Postgres is on the internal compose network and never leaves the host. Anything off-host (Neon/Vercel, POLY-121) must be verify-full; TB-3 v1.7 now says so. A CA-file setting for a pinned CA is POLY-85's.

Must fix before merge:
- M-1 Fail-open sslmode. connectionFrom maps an unset or unknown DATABASE_SSLMODE (a typo such as verify_full) to ssl:false. Only migrate runs checkConfig, so web and worker connect in plaintext without a word. Fix: connectionFrom throws unless the mode is disable, require or verify-full. Add a unit fixture.
- M-2 Drift goes undetected on the live box. roles.sql only adds grants, and assertRoles checks only poly_migrator's side, so a stray GRANT poly_owner TO poly_app on prod passes every run (pgTAP covers CI only). Fix: the preflight also refuses (exit 2) when poly_owner or any of the seven has a member other than poly_migrator, or when poly_backup is a member of anything but pg_read_all_data. About 10 lines; C-10 v1.7 states it as a condition.

Non-blocking (fold into POLY-100):
- L-1 File-check lexer. stripComments does not track $tag$ bodies or "quoted identifiers". Measured: `SELECT $x$/*$x$;` followed by `SET ROLE poly_authz;` returns [] (block mode hides the rest of the file); the -- and "a--b" forms do too. The impact is bounded, because the DB refuses roles outside the eight and the tracking-insert backstop catches a file ending on another role. Fix: make the lexer aware of dollar quotes and identifiers.
- L-2 inTransaction: when ROLLBACK fails, call client.release(err) so a broken backend is destroyed, not pooled.

Pass: roles.sql matches C-79 exactly, and every role is NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS. Default EXECUTE is revoked; the DB and public are owned by poly_owner, with PUBLIC revoked. The file check fails closed on quoted, unparseable, GUC-form and set_config targets. withContextFreeTx's first statement asserts app.user_id is empty (C-84). The nesting guard uses ALS. withSystem needs rowCount = 1 and a non-null principal. The runner preflights, locks, checks the (hash, created_at) prefix and asserts convergence and current_user (T-91). job_targets has search_path '', is poly_worker only and is allowlisted. Auth keys are uuid (l). No URL, no password env, and no secret in any log line: errors name the variable or path, never the value.

### @seceng — 2026-11-09

SecEng @ 00f3e87: M-1 and M-2 conditions lifted. connectionFrom now refuses an unset or unknown sslmode (fixture included), and the preflight refuses stray members of poly_owner and the seven and any poly_backup membership other than pg_read_all_data. L-2 is done too; L-1 stays non-blocking for POLY-100. SecEng approves.
