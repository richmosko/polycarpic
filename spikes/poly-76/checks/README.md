# POLY-76 spike checks (contract)

Written before the spike (POLY-76a). Run: `node spikes/poly-76/checks/run.mjs [a b b-prime c e f]`.
Node scripts, no npm dependencies of their own; catalog assertions go through `docker exec psql`.
Exit 1 if any of (a) (b) (b') (c) (e) fails, or (f) cannot be measured. (f) reports; it never flips the tool. (d) is POLY-121.
A failing check against a finished spike is a valid result (ARCH 6.2), not a spike defect.

## What the harness does (you do not)
Starts Docker `postgres:17` (override `POLY76_PG_IMAGE`; at least 16; INFRA names no minor yet), container `poly76-checks-pg`, `127.0.0.1:55476`, and per run drops and recreates database `poly76_check` and these roles:

| role | attributes |
|---|---|
| `poly_owner`, `poly_authz`, `poly_purge`, `poly_govern` | NOLOGIN NOSUPERUSER NOBYPASSRLS |
| `poly_migrator` | LOGIN, password `qa-poly_migrator`, member of the four above (INHERIT, SET) |
| `poly_app` | LOGIN, password `qa-poly_app`, NOBYPASSRLS |

`poly_owner` owns the database; `poly_migrator` has CREATE on the database and on `public`; `poly_authz/purge/govern` have CREATE on `public` (so `SET ROLE` or `ALTER ... OWNER TO` both work). Roles are created by the harness, as in production (provision.sh), not by migrations. An event trigger logs every DDL statement's `session_user`.
URL shape: `postgres://<role>:qa-<role>@127.0.0.1:55476/poly76_check`.

## What the spike must provide (all under `spikes/poly-76/`)
- `bin/generate`: executable, no args, no database. Runs `drizzle-kit generate` over the Drizzle schema in `schema/**/*.ts`, writing to `drizzle/` (incl. `drizzle/meta/_journal.json`). Idempotent: on a tree in sync it writes nothing.
- `bin/migrate`: executable, no args. Applies `drizzle/` with the real runner using only `DATABASE_URL` (the `poly_migrator` URL; no superuser URL is in its environment). Tracking table `drizzle.__drizzle_migrations` (override `POLY76_TRACKING_TABLE`), one row per journal entry.
- `auth.mjs`: `export function createAuth(pool, opts)` returns a `betterAuth` instance on its Kysely path over `pool` (a `pg` Pool or the routing pool), `emailAndPassword` on, no email verification, secret from `BETTER_AUTH_SECRET`. `opts.userCreateAfter(user)`, if given, is installed as `databaseHooks.user.create.after`.
- `routing-pool.mjs`: `createRoutingPool(plainPool)`, `withContextFreeTx(plainPool, async (client) => ...)` (BEGIN, run, COMMIT; ROLLBACK if it throws), `currentClient()` (the AsyncLocalStorage transaction client or null). Inside `withContextFreeTx` the routing pool's `connect()` returns that client with BEGIN/COMMIT/ROLLBACK turned into SAVEPOINT/RELEASE/ROLLBACK TO and `release()` a no-op (ARCH 3.1c).
- `package.json` with `pg` (checks load it from here).
- `.qa-bak-*` and `schema/zz_qa_sentinel.ts` are temporary files check (a) creates and removes; do not use those names.

## Objects each check looks for (the migrations create them; names are exact)
| check | objects | asserted from |
|---|---|---|
| (a) | `public.spike_doc` with RLS enabled and policy `spike_doc_owner_select`, FOR SELECT TO `poly_app`. `generate`, `migrate`, `generate` leaves `drizzle/` byte-identical. Also: a table + `pgPolicy` the check adds to `schema/` must make `generate` emit `CREATE POLICY` (anti-stub), then it is removed. | `pg_policies`, `pg_class`, tree hash |
| (b) | `public."user"`, `session`, `account`, `verification` with BetterAuth's core columns (names compared ignoring case and underscores), owned by `poly_owner`, created by `poly_migrator` during `bin/migrate`; second `generate` clean | `pg_attribute`, `pg_class`, DDL log |
| (b') | As `poly_app`: BetterAuth `signUpEmail`, `signInEmail`, `getSession` work (so column names agree). Grants: `"user"` SELECT, INSERT, UPDATE except `id`; no DELETE or TRUNCATE; `session`, `account`, `verification` full DML, no TRUNCATE. DELETE, UPDATE of `id`, TRUNCATE are refused with 42501. | BetterAuth calls, `has_*_privilege`, SQLSTATE |
| (c) | `public.spike_note(id uuid pk, body text, touched_at timestamptz)`; `public.spike_note_touch()` returns trigger, SECURITY DEFINER, owner `poly_owner`; trigger `spike_note_touch_trg` BEFORE INSERT sets `touched_at`; table owned by `poly_owner`. All DDL in the migrate window has `session_user = poly_migrator`; tracking rows = journal entries. A hand-written (custom) SQL migration is expected. | `pg_proc`, `pg_trigger`, `pg_roles`, DDL log, tracking table |
| (e) | `public.spike_vault(id uuid pk, owner_id text, secret text)`, RLS enabled and FORCEd, owner `poly_owner`; policies `spike_vault_authz_select` (SELECT TO `poly_authz`, USING true) and `spike_vault_app_select` (SELECT TO `poly_app`, USING `owner_id = current_setting('app.user_id', true)`); `public.spike_authz_probe()` returns int = `count(*)` of `spike_vault`, SECURITY DEFINER, owner `poly_authz`; `GRANT SELECT` on the table to `poly_app` and `poly_authz`, `GRANT EXECUTE` on the function to `poly_app`. Behaviour: with `app.user_id='u1'` and rows u1,u1,u2, `poly_app` counts 2, the function returns 3, and `poly_owner` counts 0. FORCE RLS may come from custom SQL. Second `generate` clean. | `pg_class.relforcerowsecurity`, `pg_policies`, `pg_proc`, queries per role |
| (f) | Uses `auth.mjs` and `routing-pool.mjs` only; the check supplies the hook. It creates `public.qa_probe` itself. | row counts after throw and rollback |

(f) measures three things and prints them: (1) a throw in `user.create.after` on a plain pool: is the user row gone (hook in the insert's transaction) or left; (2) inside `withContextFreeTx`, sign-up whose hook writes a `qa_probe` row through `currentClient()`: commit leaves user and probe; a later throw in our transaction removes both; a throw in the hook removes both.

## Harness limits
(b') and (f) need the spike's BetterAuth and could not be exercised before it exists; they were written against the documented BetterAuth API (`auth.api.signUpEmail`, `signInEmail` with `returnHeaders`, `getSession`). (a), (b), (c), (e) were run green against a hand-built fake and red against a stub `generate`.
