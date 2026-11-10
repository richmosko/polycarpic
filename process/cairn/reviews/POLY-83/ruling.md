# POLY-83 ruling (architect, 2026-11-09)

Gating ruling for `packages/db` roles, the migrate runner and the connection paths. Inputs: POLY-83 criteria, POLY-76 ruling, ARCH v1.15.2 §2.1/§3.3/§6.2/§8.1, SECURITY v1.6 C-10/C-15/C-79/C-84/C-85/T-91/A-3. Every claim is **read** (docs or Postgres/drizzle behaviour as documented) or **(unmeasured)**; nothing here was run. ARCH v1.15.3 carries the doc-level parts; this file is the build contract.

## R1. Roles: created by a superuser bootstrap file, not by the chain

Roles are cluster objects, and `poly_backup` needs `REPLICATION` + `BYPASSRLS`, which only a superuser can grant. Giving `poly_owner` `CREATEROLE` would widen what the migrate login reaches. So:

- `packages/db/sql/roles.sql` (named so by addendum 1) — idempotent, run **as the superuser** before the first migrate: by `provision.sh` on the box (INFRA, devops), by the test harness and CI before the battery. No passwords in it (provision.sh sets them). It:
  - creates (if missing) and then `ALTER ROLE`s to the exact attributes, every run: `poly_owner` NOLOGIN NOBYPASSRLS; `poly_migrator`, `poly_app`, `poly_worker` LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION; the seven C-10 roles NOLOGIN NOBYPASSRLS; `poly_backup` per C-79 (LOGIN REPLICATION BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 3, member of `pg_read_all_data`, `ALTER ROLE … SET default_transaction_read_only = on`).
  - `GRANT poly_owner, poly_authz, poly_purge, poly_rollup, poly_graph, poly_stake, poly_govern, poly_journal TO poly_migrator WITH INHERIT FALSE, SET TRUE` (no ADMIN). Postgres ≥ 16; the local Homebrew psql is 14, so run against the PG 17 image.
  - `ALTER DATABASE <current_database()> OWNER TO poly_owner`; `REVOKE ALL ON DATABASE … FROM PUBLIC`; `GRANT CONNECT` to the four login roles (+ `poly_backup`). No TEMP for anyone (unmeasured: nothing we run needs temp tables).
  - `ALTER DEFAULT PRIVILEGES FOR ROLE poly_owner, <the seven> REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` — every function starts unexecutable; grants are explicit. (Needs superuser: `poly_owner` is not a member of the definer roles.)
- **C-10 reconciliation:** C-10 says the hygiene roles are "granted to none"; C-85 requires `poly_migrator` to hold them `SET TRUE`. Read C-10 as "granted to no role but `poly_migrator`, INHERIT FALSE, SET TRUE, no ADMIN". pgTAP asserts exactly that, plus: `poly_owner` is a member of nothing, the seven are members of nothing. **seceng to concur at review** (SECURITY text edit is theirs).

## R2. The closed `SET ROLE` list and which roles own definers now

- Allowed `SET ROLE` targets in any migration file: `poly_owner`, `poly_authz`, `poly_purge`, `poly_rollup`, `poly_graph`, `poly_stake`, `poly_govern`, `poly_journal` — a constant in the checker. Adding one is an ARCH + SECURITY change.
- In POLY-83 exactly **one** definer exists: `app.job_targets`, owned by **`poly_authz`** (choosing a job's principal is an authorization decision). The other six own nothing until their features.
- Creating an object as a definer role needs CREATE on its schema. Pattern, inside the one file (read; unmeasured until the fixture runs): `GRANT CREATE ON SCHEMA app TO poly_authz; SET ROLE poly_authz; CREATE [OR REPLACE] FUNCTION …; REVOKE EXECUTE … FROM PUBLIC; GRANT EXECUTE … ; SET ROLE poly_owner; REVOKE CREATE ON SCHEMA app FROM poly_authz;` pgTAP: at rest, no C-10 role holds CREATE on any schema.

## R3. First migration (`0000`) contents

Schema `app` (owner `poly_owner`; USAGE to `poly_app`, `poly_worker`, the seven; nothing to PUBLIC). `REVOKE CREATE ON SCHEMA public FROM PUBLIC`. On `drizzle` (created by migrate() as `poly_owner` before 0000 runs): USAGE + SELECT on `__drizzle_migrations` to `poly_app`, `poly_worker`; nothing else to anyone. `app.current_user_id()`: `LANGUAGE sql STABLE`, invoker, body `select nullif(pg_catalog.current_setting('app.user_id', true), '')::uuid`, fully qualified, no `SET` clause (keeps it inlinable); EXECUTE to `poly_app`, `poly_worker`, the seven. `app.job_targets` per R4. No tenant table, no RLS policy (POLY-84 / POLY-62).

## R4. `app.job_targets(job text)` and `withSystem`

- Signature: `RETURNS TABLE (entity_id uuid, principal_user_id uuid, connection_id uuid)`, `STABLE SECURITY DEFINER`, `SET search_path = ''`, owner `poly_authz`, EXECUTE to `poly_worker` only.
- M1 body returns **zero rows for every job** (the tables it reads don't exist yet). Each job's feature extends it by `CREATE OR REPLACE` under the R2 pattern.
- Allowlist entry, in `packages/db/sql/definers.json` (the C-15 allowlist; pgTAP compares `prosecdef` functions to it, plus owner, `proconfig` and EXECUTE ACL): `{ "function": "app.job_targets(text)", "owner": "poly_authz", "execute": ["poly_worker"] }`.
- `withSystem(job, target: { entityId, connectionId | null }, fn)`: the caller never supplies a principal. Inside its transaction it selects from `app.job_targets(job)` matching the target (`connection_id IS NOT DISTINCT FROM`); zero rows, more than one, or a null principal → throw, roll back, `fn` never runs. Then `set_config('app.user_id', principal, true)` and `set_config('app.actor', 'system:' || job, true)`. `job` matches `^[a-z][a-z0-9_]{0,62}$`. In M1 every call errors — that is the criterion; the positive path lands with the first job.

## R5. `withTenant` / `withContextFreeTx` / nesting

- `withTenant(userId: SessionUserId, sessionId: string, fn)` — three arguments (ARCH said two; v1.15.3 fixes it). Both settings via `set_config(…, true)` before `fn`.
- Nesting guard: one `AsyncLocalStorage` shared by the three functions; entry while the store is set throws. Not a counter (concurrent requests). Fixtures: all 9 ordered pairs, self-nesting included.
- `withContextFreeTx`: first statement reads `current_setting('app.user_id', true)`; anything but null or `''` throws and rolls back.

## R6. The runner (`packages/db/src/migrate.ts`, the one SET-exempt file)

1. One `pg.Client` as `poly_migrator`; `try … finally client.end()`.
2. `SET ROLE poly_owner`; `SET lock_timeout = '10min'` (value unmeasured); `select pg_advisory_lock(hashtextextended('polycarpic.migrate', 0))`. Timeout → exit 4, nothing applied.
3. Read files with drizzle's own `readMigrationFiles` (its hash = what migrate() writes). Journal `when` must strictly increase → else exit 2.
4. Read tracking rows `(hash, created_at)` by `id` (missing table = empty). Let k = min(|J|, |T|). Any mismatch in the first k → **exit 2**, nothing applied. If |T| ≥ |J| → nothing pending, exit 0 **without calling migrate()** (DB ahead is legal: rollback to the previous image).
5. `migrate()`; then assert `current_user = 'poly_owner'` and re-read T: T must equal J hash-for-hash (catches drizzle's silent timestamp skip). Failure → exit 1, loud.
- `--plan`: same client shape, **no lock**, `BEGIN READ ONLY; SET LOCAL ROLE poly_owner` (poly_migrator inherits nothing, so it cannot read the table as itself); steps 3–4; exit 0 none pending, 3 pending (lists tags), 2 divergence, 1 other error.
- The runner does **not** run the role-switch scan (R8), so the privilege backstop (tracking insert fails, run rolls back) stays testable on its own.

## R7. Where the entry point lives: new `apps/migrate`, and two new `db` subpaths

- `apps/migrate` (L6) is the `migrate` entrypoint: `check-config`, `--plan`, apply. Allow-list `config`, `db`, `db/migrate`. The migrate module is exported on the restricted subpath **`db/migrate`**, importable by `apps/migrate` only — so "web and worker never import it" is a lint fact, not a convention.
- `check-config` in POLY-83: the migrator secret file is present and non-empty, connection settings present; exit 0 / 1 naming each fault, no connection. The TLS_MODE / PLAID_ENV / other-secret checks come with `packages/config` (POLY-85 — lead to note on that issue).
- Startup guard on restricted subpath **`db/startup`**, allow-listed for `web` and `worker`: `assertSchemaNotBehind()`. Expected version = the image's bundled `migrations/meta/_journal.json` (imported as JSON, so it ships in every bundle, Vercel included). Predicate: the journal's `when` list is a prefix of the tracking rows' `created_at` list by `id` → start; anything else (missing table, shorter, mismatch) → refuse, process exits non-zero naming the first mismatch. Hash comparison stays in the runner. Read-only transaction, no context set. web calls it from the SvelteKit `init` hook, worker before scheduling.
- I land `layers.json`, the `db` export entries + stubs, the `apps/migrate` skeleton and ARCH §2.2 in one commit so `pnpm lint` stays green.

## R8. Journal order + role-switch file check: in `packages/db`, under `pnpm lint`

Pure functions in `packages/db/src/migrations-check.ts` (journal order; role-switch scan), a CLI `packages/db` script `check-migrations`, and root `lint` gains `pnpm --filter @poly/db check-migrations`. CI wiring is POLY-96. Migrations folder: `packages/db/migrations`. The scan runs over **every** file, comments stripped, dollar-quoted bodies **not** exempt (fail closed). Refused: `SET SESSION AUTHORIZATION`, `RESET ROLE`, `RESET ALL`, `SET ROLE NONE`/`DEFAULT`, any `SET LOCAL ROLE`, `SET [SESSION] ROLE` to a target outside R2, `set_config('role'…)`, a function `SET role` clause; a file containing any `SET ROLE` must end on `SET ROLE poly_owner`.

## Addendum 1 (2026-11-09): roles file, owner story, check-config inputs

- **File name** `packages/db/sql/roles.sql` (backend-lead-2's name; same content as R1). Allowed `SET ROLE` targets and `poly_migrator`'s memberships: `poly_owner` **plus** the seven. backend-lead-2's list omitted `poly_owner`, so it is added here.
- **Owner story.** Postgres roles have no owner; `roles.sql` is their definition of record, reviewed like a migration, and it converges on every run (create if missing, then `ALTER` to the exact attributes and grants). The runner preflights, before the lock: all 12 roles exist, and `poly_migrator`'s memberships in `pg_auth_members` are exactly R1's. Otherwise exit 2, nothing applied. pgTAP proves the rest. On Neon there is no superuser, so the file cannot run as written; that is POLY-121's problem. C-10 and C-85 say "role migrations"; read that as `roles.sql`. seceng concurs at review.
- **check-config: option (a)**, the DB side only, with no connection. In POLY-83 it reads exactly `DATABASE_HOST`, `DATABASE_PORT` (integer, default 5432), `DATABASE_NAME`, `DATABASE_USER` (must be `poly_migrator`), `DATABASE_SSLMODE` (`disable` \| `require` \| `verify-full`, required, no default) and `DATABASE_PASSWORD_FILE` (on the box `/run/secrets/db_password_migrator`; the file must exist, be non-empty and hold one line). It also refuses when `DATABASE_PASSWORD` or `DATABASE_URL` is set. Exit 0 when all pass; otherwise exit 1 with one line per fault, naming the variable. web and worker use the same names with their own user (`poly_app`, `poly_worker`) and secret file.
- **Not in POLY-83:** `host.env`, `TLS_MODE`, `PLAID_ENV`, the other secrets, any environment selector. qa drops `POLY_SECRETS_DIR`, `POLY_HOST_ENV` and `POLY_ENV`. POLY-85 moves the parsing into `packages/config` under these names and extends check-config. The reader lives in `apps/migrate` until then.

## Open (not gating)

- Reference-data jobs (EOD prices, CPI) have no tenant principal, and `withSystem` refuses without one. Their connection path is undecided; it is decided when refdata lands, not here.
