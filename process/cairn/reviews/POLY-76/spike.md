# POLY-76 spike record (backend-lead)

## Versions
Node v26.12.0 · Postgres image `postgres:17` (17.10) · drizzle-orm 0.45.4 · drizzle-kit 0.31.11 · better-auth 1.7.18 · @better-auth/cli (npx, latest 1.4.21, used once to emit the schema) · pg 8.23.1 · kysely 0.29.8 (BetterAuth's own dependency path; pinned for the record) · tsx 4.23.15. npm lockfile committed.
Line chosen: drizzle-kit/orm **stable** (`latest`). A `1.0.0-rc.5` line exists; not chased. The stable line is what the project would ship on today, and every result below is on it.

## Commands
- `spikes/poly-76/bin/generate` = `npx drizzle-kit generate` (config `drizzle.config.ts`, schema `./schema`, out `./drizzle`).
- `spikes/poly-76/bin/migrate` = drizzle-orm `migrate()` (node-postgres) over one `pg.Client` logged in as `poly_migrator` (only `DATABASE_URL`), then `SET ROLE poly_owner`. Tracking table `drizzle.__drizzle_migrations`.
- Custom migration created once with `npx drizzle-kit generate --custom --name=spike_custom`, then hand-edited.
- BetterAuth schema: `npx @better-auth/cli generate --config <auth.ts using drizzleAdapter pg> --output auth-schema.ts -y`, copied to `schema/auth.ts` with only a header comment added.
- Checks: `node spikes/poly-76/checks/run.mjs` (unmodified).

## Results
| item | result | evidence |
|---|---|---|
| (a) | **PASS** | `generate` -> `migrate` -> `generate`: tree identical ("No schema changes"); `pg_policies` has `spike_doc_owner_select` SELECT TO poly_app, RLS on; anti-stub sentinel produced `CREATE POLICY "qa_sentinel_p"` |
| (b) | **PASS** | user/session/account/verification created by `poly_migrator` (DDL event-trigger log), owned `poly_owner`, second generate clean |
| (b') | **PASS on behaviour, check FAILS on two assertions that look wrong** | As poly_app: signUpEmail, signInEmail, getSession all succeed; 3.1c grants all hold; DELETE / UPDATE id / TRUNCATE refused 42501. The only failures: check-b-prime.mjs counts rows with `"providerId"` / `"userId"` (quoted camelCase) in raw SQL, but the generated columns are snake_case (`provider_id`, `user_id`) -> `42703 column "providerId" does not exist`. See below. |
| (c) | **PASS** | custom SQL (trigger + SECURITY DEFINER fn) applied through the real runner; all DDL `session_user = poly_migrator`; 2 tracking rows = 2 journal entries; trigger fires |
| (e) | **PASS** | FORCE RLS via custom SQL, `to:` policies via `pgPolicy`, definer fn owned by poly_authz; poly_app sees 2, fn returns 3, poly_owner sees 0; second generate clean |
| (f) | **observed** | see below |

### (b') detail: the column-name finding
`@better-auth/cli generate` emits **snake_case** columns (`email_verified`, `user_id`, ...). BetterAuth's Kysely path looks up camelCase field names, so unmodified it fails with `Database schema mismatch: Missing columns user.emailVerified ...` (observed). Fix used, **a workaround that the real package can also use**: BetterAuth's documented `fields` option per model (`auth.mjs`: a camel->snake map). The alternative (rename the Drizzle columns to camelCase) also works in principle (not run); then the check's raw SQL is right. Either way, this is a real coupling: schema column names and BetterAuth config must agree, and BetterAuth detects the drift at startup (it logs the mismatch and refuses), which is a useful guard.
Check defect for qa-engineer: `check-b-prime.mjs` lines using `"providerId"` and `"userId"` assume camelCase columns, while check (b) deliberately ignores case/underscores. One of the two is inconsistent; the spike did not bend to it.

### (f) OQ-16 observations (BetterAuth 1.7.18, Kysely path over a pg Pool)
1. Hook throws on a plain pool: sign-up rejected, **user row remains** (1). `user.create.after` runs **outside** the user insert's transaction. Shares transaction: **NO**.
2. Inside our `withContextFreeTx` (routing pool, BEGIN/COMMIT rewritten to savepoints): commit -> user 1 + provisioning 1; our rollback after sign-up -> 0 + 0; hook throws -> 0 + 0. Atomic: **YES**.
So atomic provisioning needs our own context-free transaction around sign-up; BetterAuth alone does not give it. My `routing-pool.mjs` is a ~50-line spike, not production (no nested-tx depth guard beyond a counter).

## Copy / do not copy for packages/db
Copy:
- **Ownership by `SET ROLE poly_owner` after connecting as poly_migrator** (session_user stays the login, so audit shows who ran it). Works with Drizzle's runner because the migrator just uses the client it is given. No ALTER OWNER needed.
- Objects owned by another role (poly_authz function): `SET ROLE poly_authz; CREATE FUNCTION ...; SET ROLE poly_owner;` inside the custom `.sql` (each separated by `--> statement-breakpoint`). poly_authz needs a table grant on what it reads.
- **FORCE RLS: Drizzle Kit has no schema-level way to express it** (no occurrence of FORCE ROW LEVEL SECURITY in drizzle-kit 0.31.11 or the pg-core table API). It lives in a custom migration; the generator neither sees nor undoes it, so `generate` stays clean. Cost: nothing detects a missing FORCE later; needs a catalog test (as check e does).
- Triggers, functions, grants (incl. column-level `GRANT UPDATE (...)`) are all custom SQL; same story.
- Tracking table is `drizzle.__drizzle_migrations` (needs CREATE on the database for the `drizzle` schema; granted to poly_migrator). The runner runs all pending migrations in one transaction.
- Custom migrations are created with `generate --custom` so snapshot/journal stay consistent.
Do not copy:
- The unmodified CLI schema's `timestamp` columns are `timestamp without time zone`; the spike kept them as generated. Real package should decide (`withTimezone`).
- The camel->snake `fields` map in auth.mjs is spike-grade; derive it or rename columns, per the finding above.
- `GRANT SELECT ON spike_*` and the `spike_` objects are throwaway.
