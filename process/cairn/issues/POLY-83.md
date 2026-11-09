---
id: POLY-83
title: DB roles, migrate, withTenant
status: todo
milestone: POLY-M1
parent: null
blocked_by: [POLY-76, POLY-82]
assignee: backend-lead
paths: [packages/db/**]
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
