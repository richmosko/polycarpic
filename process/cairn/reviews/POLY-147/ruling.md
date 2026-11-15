# POLY-147 — gate 1 ruling (architect)

Scope: the issue file's criteria (K, J, I, the three guards, the measurement, no `app.session_id` reader, docs), plus the plpgsql revoke (R10) and the SQL-string built-ins revoke (R11). The design is (e1), staged
(`process/DECISIONS.md`, 2026-11-13); this ruling only makes it buildable. Measured = read from the tree at `61da0e72` or from the installed
package source (`pg@8.23.1`, `pg-pool@3.14.0`, `drizzle-orm@0.45.4`); anything else is tagged `(unmeasured)`. Open questions are in §OQ and
are the lead's; the ruling proceeds on the stated recommendation unless the issue file says otherwise.

## R1 — Migration `0011_identity_marker.sql` (the marker, K)

`drizzle-kit generate --custom`; journal and snapshot by the tool. Runs as poly_migrator with `SET ROLE poly_owner`; ends on poly_owner.
No earlier migration is edited.

```sql
CREATE TABLE app.tx_identity (
  xid        pg_catalog.xid8 PRIMARY KEY,
  user_id    uuid NOT NULL,
  session_id uuid,
  kind       text NOT NULL CHECK (kind IN ('web', 'signup') OR kind ~ '^system:[a-z][a-z0-9_]{0,62}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE app.tx_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tx_identity FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.tx_identity FROM PUBLIC;
GRANT SELECT ON app.tx_identity TO poly_app, poly_worker, poly_authz, poly_purge, poly_rollup, poly_graph, poly_stake, poly_govern, poly_journal;
GRANT INSERT ON app.tx_identity TO poly_authz;
GRANT DELETE ON app.tx_identity TO poly_purge;
CREATE POLICY tx_identity_own ON app.tx_identity FOR SELECT
  TO poly_app, poly_worker, poly_authz, poly_purge, poly_rollup, poly_graph, poly_stake, poly_govern, poly_journal
  USING (xid = pg_catalog.pg_current_xact_id_if_assigned());
CREATE POLICY tx_identity_enter ON app.tx_identity FOR INSERT TO poly_authz
  WITH CHECK (xid = pg_catalog.pg_current_xact_id());
-- DELETE with a WHERE needs the rows to pass a SELECT policy too, so the purge role sees every row; it is NOLOGIN, reached only by its definer.
CREATE POLICY tx_identity_purge_read ON app.tx_identity FOR SELECT TO poly_purge USING (true);
CREATE POLICY tx_identity_purge ON app.tx_identity FOR DELETE TO poly_purge
  USING (created_at < pg_catalog.now() - interval '1 hour'
         AND pg_catalog.pg_xact_status(xid) IS DISTINCT FROM 'in progress');
```

- The SELECT grant list is every role that calls `app.current_user_id()` today (`0001:21`): the function is invoker, so its caller needs
  SELECT and reads under `tx_identity_own`. A caller without the grant gets `42501` — loud, not open.
- No FK to `public."user"`: an FK takes a `FOR KEY SHARE` lock on the user row every request (WAL and contention). An asserted id that
  names no user reaches no rows. `user_id` is not checked against `user` in stage 1.
- No index beyond the PK. The purge scans; the table holds about one hour of committed markers (unmeasured).
- **NULL status counts as finished.** `pg_xact_status` returns NULL for an xid older than the retained commit log. The commit log is
  truncated only below the oldest xid any database still needs, which is older than every running transaction, so a NULL xid cannot be
  in progress. Hence `IS DISTINCT FROM 'in progress'`, never `<>` (with `<>` such rows are never purged). xid8 never repeats.
- The owner, poly_owner, holds every privilege implicitly; the catalog test excludes the owner, as `01_roles.sql` does for functions.
  For everyone else it asserts the exact ACL: SELECT for the nine roles above, INSERT poly_authz, DELETE poly_purge, and nothing else
  (no UPDATE, TRUNCATE, REFERENCES, TRIGGER), with PUBLIC, poly_operator and poly_backup listed explicitly. poly_backup still reads
  every row through `pg_read_all_data` + BYPASSRLS, as it reads every table; that is the backup's job and the catalog test names it.
- No runtime role can shadow a relation through `pg_temp`: `roles.sql` revokes ALL on the database from PUBLIC and grants CONNECT
  only, so none holds TEMP. The catalog test asserts it (`has_database_privilege(r, current_database(), 'TEMP')` false for poly_app,
  poly_worker, poly_operator). Every relation in every new or replaced body is schema-qualified anyway.
- `max_prepared_transactions` stays 0 (the default; nothing in `infra/` sets it). The catalog test asserts it on the test server, so a
  marked transaction cannot be parked in the prepared state.
- `withTenant` never opens `BEGIN READ ONLY`: the marker is a write.

**`app.current_user_id()`** — `CREATE OR REPLACE`, still `LANGUAGE sql STABLE`, invoker, no `SET` clause, grants unchanged:
`SELECT t.user_id FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned()`.
It never calls `pg_current_xact_id()`, so a transaction that wrote nothing has no xid and reads null. With a FROM clause the function is no
longer inlined (unmeasured cost; the measurement in R7 prices it).

**`app.current_session_id()`** — new, same shape, returns `t.session_id`. Invoker. EXECUTE poly_app only (POLY-89 grants its own).

**`app.audit_membership()`** — `CREATE OR REPLACE` as poly_govern. `withSystem` no longer sets `app.actor` (R3), so the actor is read
from the marker first: `v_actor := coalesce((SELECT CASE t.kind WHEN 'web' THEN 'user' WHEN 'signup' THEN 'user' ELSE t.kind END
FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned()), nullif(current_setting('app.actor', true), ''), 'none')`.
In a marked transaction a forged `app.actor` is ignored; it still labels the unmarked operator path, whose issuer writes its own literal.

**`app.job_targets(text)`** — REVOKE EXECUTE FROM poly_worker (as poly_authz). It stays the per-job extension point, called only by
`enter_job`. (seceng's note 14 says the grant may stay; it is revoked because `enter_job` is now its only caller, and a worker that can
list job targets learns which users link which connections.)

**Addendum to R1 and R8: TRUNCATE guard and per-reason exemption (seceng §4, adopted by the lead).** Migration `0011` adds
`CREATE TRIGGER tx_identity_no_truncate BEFORE TRUNCATE ON app.tx_identity FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();`.
That reuses `0003`'s invoker function, so the marker sits under the same rule as the six tenancy tables, and a TRUNCATE gives `42501`
even for a superuser.
- **The purge is unaffected:** it uses DELETE. No TRUNCATE trigger fires on DELETE.
- **The bench is unaffected:** each run migrates a fresh database and never truncates.
- **No test helper is affected:** none truncates the marker. The R6 pgTAP helper clears it with DELETE, and `07`'s TRUNCATE assertions
  run as runtime roles, which are refused for privilege first.
- **R10 is unaffected:** firing a plpgsql trigger function needs no USAGE on the language.

In R8, `02_rls_catalog.sql` keeps its 7-entry table-exemption list, with `app.tx_identity` not on it, so all ten `battery_gaps` checks
run on the marker. A separate per-reason list, `pg_temp.reason_exemptions()`, holds exactly `app.tx_identity:pk_not_uuid`. The xid8
key is by design. A row is dropped only when its `rel:reason` pair is listed, every entry must resolve with `to_regclass`, and the
list's cardinality is 1. Its canaries show that a reason exemption hides only its own check:
- a uuid-keyed canary listed for `pk_not_uuid`, with RLS disabled, still reports `rls_disabled`;
- `ALTER TABLE app.tx_identity DISABLE ROW LEVEL SECURITY` in the rolled-back transaction makes the real chain report
  `app.tx_identity:rls_disabled`.
- **Red-if:** the reason filter compares by table alone, or `app.tx_identity` rejoins the table list.

## R2 — The definers

All `LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''`, every reference schema-qualified, REVOKE EXECUTE FROM PUBLIC, and each entered
in `packages/db/sql/definers.json`. Every refusal is `ERRCODE = '42501'` with the exact message below unless stated; tests match code and
message. The marker check reads `app.tx_identity` through `tx_identity_own` (owner's own transaction) and runs before any write; the PK is
the backstop (`23505`).

**The exact-call check (Principal, 2026-11-14; seceng D1).** Each `enter_*` definer refuses unless the client's statement is exactly its
own call: `IF regexp_replace(btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM '<canonical text>' THEN RAISE …`, giving
`42501` `an identity definer must be called on its own`. The comparison must be `IS DISTINCT FROM`: a plain `<>` passes on NULL, and
no test can reach that case, so seceng reads every `enter_*` body for it at build check. Canonical texts:
`SELECT app.enter_asserted_user($1, $2)`, `SELECT app.enter_job($1, $2, $3)`, `SELECT app.enter_new_user($1)`. The three callers
(`withTenant`'s and `withSystem`'s setup, `new-user.ts`) send these strings byte for byte, with one space after each comma and no
`AS` alias. The wrappers read the result column by its default name.
`current_query()` returns the backend's `debug_query_string`, the text the client sent. In the extended protocol that is the prepared
statement's source text, set at Bind and Execute. It does not read `pg_stat_activity` and does not depend on `track_activities`.
(Unmeasured; read from the Postgres source. The R8 test measures it.)
- **What it stops:** injected text cannot bind parameters. So no fragment, no whole injected statement with literals, no `DO` block
  and no statement after an injected `COMMIT` can call an identity definer, on any path.
- **Why the check exists:** the built-in `query_to_xml` family (`query_to_xml`, `query_to_xml_and_xmlschema`, `cursor_to_xml`,
  `table_to_xml`, `schema_to_xml`, `database_to_xml`) is VOLATILE and executable by PUBLIC. It runs SQL with a fresh snapshot, so it
  sees a marker planted earlier in the same statement. Without the check, one fragment on an unmarked path (BetterAuth's plain pool,
  or sign-up before its user insert) could call `enter_asserted_user(<victim>, …)` and then `query_to_xml('SELECT … FROM
  public.entity', …)`, and read the victim's tenant rows in a single statement. The read side's STABLE snapshot does not prevent it
  (unmeasured; Postgres semantics).
- **Revoking the family from PUBLIC:** adopted as R11 (Principal, 2026-11-15, on seceng's E1(2)), as a second layer under the check.
- **What stays open:** poly_app's direct grants on BetterAuth's tables, a stolen poly_app password and code execution in web. Until
  stage 2 the injection route to another user is an account takeover through sign-in (visible, leaves a session), not a silent query.
- **A second statement in an open unmarked transaction** reads as the victim only if it is itself injected, and the check refuses it.
- The definer does not check a live session row: poly_app reads every session row, so the check would pass for any user with a
  session, and stage 2's `enter_session` makes the real check.

Full signatures, as `pg_get_function_identity_arguments` prints them (the catalog test pins these strings):

| Definer | Owner | EXECUTE | Checks, in order (SQLSTATE, exact message) | Writes |
|---|---|---|---|---|
| `app.enter_asserted_user(p_user uuid, p_session uuid) RETURNS text` | poly_authz | poly_app | 1. not the exact call → `42501` `an identity definer must be called on its own`. 2. either argument null → `22004` `identity is required`. 3. a marker exists for `pg_current_xact_id_if_assigned()` → `42501` `this transaction already has an identity`. 4. `pg_current_xact_id_if_assigned() IS NOT NULL` → `42501` `the identity marker must be the first write of its transaction`. | `(pg_current_xact_id(), p_user, p_session, 'web')`; returns `pg_current_xact_id()::text` |
| `app.enter_job(p_job text, p_entity uuid, p_connection uuid) RETURNS text` | poly_authz | poly_worker | 1. exact call → as above. 2. `p_job IS NULL OR p_job !~ '^[a-z][a-z0-9_]{0,62}$'` → `22023` `invalid job name`. 3. marker exists → as above. 4. xid assigned → as above. 5. `SELECT principal_user_id FROM app.job_targets(p_job) WHERE entity_id = p_entity AND connection_id IS NOT DISTINCT FROM p_connection`: unless exactly one row with a non-null principal → `P0002` `job <p_job> resolved no single principal`. | `(…, principal, NULL, 'system:' \|\| p_job)`; returns `pg_current_xact_id()::text` |
| `app.enter_new_user(uuid) RETURNS void` (`CREATE OR REPLACE`, unnamed argument kept) | poly_authz | poly_app | 1. exact call → as above. 2. marker exists → `42501` `a user is already in context` (message kept for POLY-87). 3. and 4. unchanged: `42501` `not a user created by this transaction`, `42501` `the user already has a Person`. No xid check: it must run after the user insert. | `(…, $1, NULL, 'signup')`, replacing `set_config` |
| `app.purge_tx_identity() RETURNS integer` | poly_purge | poly_worker | none; no argument, so the caller cannot choose the age | `DELETE FROM app.tx_identity WHERE created_at < pg_catalog.now() - interval '1 hour' AND pg_catalog.pg_xact_status(xid) IS DISTINCT FROM 'in progress'`; returns the row count. No row is skipped for its kind or contents. |

The `kind` comes only from the definer body; no definer takes it as an argument.

**What the TypeScript caller sees.** Definer refusals come out of `withTenant`, `withSystem` and the `enterNewUser` handle as node-pg's
`DatabaseError`, with `.code` the SQLSTATE above and `.message` the exact text, and the transaction rolled back. The one exception is
`withSystem`: it rethrows `P0002` as `NoPrincipalError(job)`. The only new error classes are R4's `ExtendedModeRequired` and R3's `IdentityMarkerLost`.

**The savepoint cases, each with its outcome:**
- Marker, then any later savepoint rolled back (routing pool `ROLLBACK` → `ROLLBACK TO SAVEPOINT ba_n`, or a drizzle `tx.transaction`
  that throws): the marker was written before the savepoint, so it stays and `current_user_id()` is unchanged.
- Sign-up: `SAVEPOINT ba_n`, user insert, `enter_new_user`, `ROLLBACK TO ba_n`. The marker and user row go. Then `enter_new_user(<that
  id>)` and `enter_new_user(<any pre-existing id>)` give `42501` `not a user created by this transaction`. `enter_asserted_user(<any>)`
  gives `42501` `the identity marker must be the first write of its transaction`. `current_user_id()` is NULL.
- Sign-up with `RELEASE` instead: the marker stays; a second `enter_new_user` gives `42501` `a user is already in context`, and
  `enter_asserted_user` gives `42501` `this transaction already has an identity`.

- Owner CREATE on `app` is granted to poly_authz and poly_purge for the file only, then revoked, as in `0001`/`0007`.
- The age is a constant in the body and in the policy; the caller passes nothing. The schedule lands with the worker's first job loop.
- A marker written inside a savepoint (`enter_new_user`) carries the top-level xid: `pg_current_xact_id[_if_assigned]` return the
  top-level id inside a subtransaction (`0007:128` relies on this already).

## R3 — The wrappers (`packages/db/src/context.ts`)

- `inTransaction` sends nothing between `BEGIN` and `setup(client)`; that stays true and gets a comment. Each wrapper's setup is its whole
  identity step, so **the marker is the first statement after the real BEGIN**, before `fn` can open a savepoint (drizzle `tx.transaction`
  or the routing pool's `SAVEPOINT ba_n`).
- `withTenant(userId, sessionId, fn)`: UUID check on both, then setup = `SELECT app.enter_asserted_user($1, $2)` (the canonical text,
  byte for byte); the store keeps the returned xid text as `marked`. No `set_config`.
- `withSystem(job, target, fn)`: TS regex check kept; setup = `SELECT app.enter_job($1, $2, $3)` (canonical), the result
  stored as `marked`. A `P0002`
  from the definer is rethrown as `NoPrincipalError(job)`. No `set_config`, no `app.actor`.
- **The commit check (seceng S6; kept by the lead after seceng withdrew it).** It does not conflict with the exact-call check:
  the check below is the wrapper's own statement, and it calls no definer. For a store with `marked` set, `inTransaction` sends
  `SELECT pg_catalog.pg_current_xact_id_if_assigned()::text AS x` after `fn` returns and immediately before `COMMIT`. If `x` is null or
  differs from `marked`, it throws `IdentityMarkerLost` (new, exported from `@poly/db`; message `IdentityMarkerLost: the transaction
  that carried the identity marker has ended`), and the existing catch sends `ROLLBACK`. This turns a whole-statement `COMMIT` sent
  through `tx.execute` from a silent run of unmarked statements into a failed request. Statements that ran after such a `COMMIT` ran
  in autocommit with no marker, so they read null and could write nothing under RLS. `withContextFreeTx` and `withOperatorTx` have no
  `marked` value and skip the check.
- `withContextFreeTx`: setup = `SELECT app.current_user_id() IS NULL AS ok`, which reads the marker. If it is not true, the wrapper
  throws `ContextNotEmptyError`. No `current_setting`. At the top of a fresh transaction it is always true, so the check is a
  seatbelt, not a boundary.
- `withOperatorTx`: drops its `current_setting('app.user_id')` check and does not replace it. poly_operator holds no EXECUTE on
  `current_user_id()` and no SELECT on `tx_identity`. It also has no way to write a marker (no `enter_*` grant, no INSERT), so a
  marker on the operator pool is impossible. The boundary is the issuer's own check, `app.current_user_id() IS NOT NULL` → `42501`,
  which runs as poly_govern. `set_config('app.actor', 'operator:cli', true)` stays.
- `new-user.ts` unchanged (`SELECT app.enter_new_user($1)`).

**Sign-up savepoint (guard ii, sign-up).** `enter_new_user` runs inside BetterAuth's `SAVEPOINT ba_n`, after the user insert, so the marker
can be rolled back with it. The outcomes are listed in R2. They hold because the stamp check finds no row, and because a subtransaction
write assigns the parent's xid first, so the xid stays assigned after the rollback. See OQ-3 for "any user".

## R4 — Extended mode on every poly_app / poly_worker query (guard i)

- **The seam is one class, not a lint rule:** `packages/db/src/extended-client.ts` exports `class ExtendedClient extends pg.Client` and
  `class ExtendedModeRequired extends Error`. `pg@8.23.1` has no pool- or client-level mode; `queryMode` is read per query
  (`lib/query.js:19,36`), which is why the backend-lead found no option. The class therefore overrides `query(config, values, cb)` on
  every client the pool creates. It turns a string into `{ text: config }`, keeps every other field, sets `queryMode: 'extended'`
  (overwriting any caller value), and calls `super.query(next, values, cb)`. It throws `ExtendedModeRequired` (message
  `ExtendedModeRequired: a query must be sent in extended mode`) on a Submittable, meaning any object with a `submit` function, such
  as `pg-cursor` or `pg-query-stream`, which bypasses the `Query` config. `lib/query.js:35-37` prepares whenever `queryMode ===
  'extended'`, and Postgres refuses a prepared string holding two commands (`42601`, `cannot insert multiple commands into a prepared
  statement`). A multi-statement string surfaces as that `DatabaseError`.
- `pool.ts`: all three `new pg.Pool({...})` pass `Client: ExtendedClient`. `pg-pool` `index.js:95` builds each client with
  `this.options.Client`, and `index.js:241` calls `new this.Client(this.options)`. So every client the pool creates is an
  `ExtendedClient`, and nothing patches a checked-out client afterwards. This covers the three paths: the wrappers (clients from
  `appPool`/`workerPool`/`operatorPool`); BetterAuth's routing-pool handle (`store.handle.query` calls `store.client.query`, an
  `appPool` client); and BetterAuth's plain pool (`authPool` is `appPool`, both `pool.query` and `connect()`).
- seceng's note 13 holds: the routing pool's `rewrite` inspects only a query's leading keyword. A string like `SELECT 1; COMMIT; BEGIN; …`
  passes `rewrite`, so on that path the refusal rests wholly on extended mode. The (i) tests send that exact string through the handle.
- `migrate.ts`'s two `new pg.Client` stay simple-protocol (poly_migrator runs multi-statement migration files; out of scope).
- **Bypass check:** a vitest unit test `packages/db/src/extended-client.test.ts`. It asserts each pool's `options.Client === ExtendedClient`
  and the Submittable refusal, and runs a source scan over every `.ts`/`.js`/`.mjs`/`.cjs`/`.svelte` file under `packages/` and `apps/`
  (excluding `node_modules`, `.claude`, `*.test.ts`). The scan enforces three rules:
  - a value import of `pg` (`import pg from 'pg'`, `import { … } from 'pg'`, `import * as … from 'pg'`, `require('pg')`, `import('pg')`)
    appears only in `pool.ts`, `migrate.ts` and `extended-client.ts`; `import type … from 'pg'` is allowed anywhere in `packages/db/src`.
  - the tokens `new pg.Pool(`, `new Pool(` and `pg.Pool(` appear only in `pool.ts`; `new pg.Client(` and `new Client(` appear only in
    `migrate.ts`; `extends pg.Client` appears only in `extended-client.ts`.
  - `.native` on a `pg` binding, and the module `pg-native`, appear nowhere.

  Today the tree has value imports only in `pool.ts` and `migrate.ts`, and type imports in `context.ts`, `connection.ts` and
  `new-user.ts`. `startup.ts` builds no client of its own. Importing `pg` outside `packages/db` is already refused by lint
  (`tests/layers/fixtures/08-postgres-driver/fail-pg*.ts`).

## R5 — `app.session_id` readers move to the marker

- `packages/auth/src/session.ts` (three reads, `listSessions` and `revokeSession`): `coalesce(pg_catalog.current_setting('app.session_id',
  true), '')` becomes `coalesce(app.current_session_id()::text, '')`.
- `layers.json` `reservedLiterals` gains `"app.session_id": []` and `"app.user_id": []`: no production source may name either setting.
  (`app.user_id` is now inert; naming it in production code is a bug.) Add `"enter_asserted_user"` and `"enter_job"` with
  `["packages/db/src/context.ts"]`, and `"purge_tx_identity": []`.
- The routing-pool header comment ("holds no GUC") is reworded by the builder; no behaviour changes there.

## R6 — Tests that encode the old mechanism

Helpers that impersonate a user with `set_config('app.user_id', …)` move to the marker: psql/vitest helpers
(`tests/db/helpers/invitation.ts`, and any `BEGIN; SELECT set_config('app.user_id'…)` string) send the definer's exact call as the first
statement after `BEGIN`, bound with psql's `\bind`: `SELECT app.enter_asserted_user($1, $2) \bind '<uid>' '<sid>' \g`. A call with
literals is refused by the exact-call check, and so is one inside a multi-statement `-c` string. The same applies to `enter_new_user`
in `auth-new-user-step`'s `step()` helper. `helpers/pg.ts` already feeds psql with `-f -`, which sends each statement on its own.
`\bind` needs psql ≥ 16. The harness runs either the container's psql (`docker exec`, image `tests/db/docker/Dockerfile` on
Postgres 17) or the host's (with `POLY_TEST_PG_URL`). So `tests/db/global-setup.ts` checks the psql it will use: it runs
`psql --version`, and below major 16 it fails the run with `psql >= 16 is required for \bind`. pgTAP files run in one transaction whose xid is assigned by the fixtures, so there
`pg_temp.run_as` sets identity as superuser: `DELETE FROM app.tx_identity WHERE xid = pg_current_xact_id(); INSERT … (pg_current_xact_id(),
uid, NULL, 'web')` (or only the DELETE for `''`). Superuser bypasses grants and RLS; no production role can do this, which pgTAP also
asserts. Definer success paths that need a fresh xid are therefore vitest db tests, never pgTAP. In pgTAP, any `enter_*` called through
`run_as` sits inside a larger top-level statement, so the exact-call check refuses it first. A pgTAP assertion about an `enter_*`
refusal therefore expects `an identity definer must be called on its own`. The specific refusals (marker exists, xid assigned, stamp,
Person) are asserted in vitest db, where the exact call can be sent. The extra `db` time goes in the loop's suite-time report.

## R7 — Measurement harness

- Runner: qa-147.
- Files: `tests/db/bench/vitest.config.ts` (own config, same `globalSetup`; not matched by `tests/db/**/*.test.ts`, so the suite never runs
  it) and `tests/db/bench/marker-measure.bench.ts`. It uses only surfaces present on `main` today: `configure`, `withTenant`, `sql` from
  `@poly/db`, `freshDb`/`migrateCli` from `helpers/api`, `psql` from `helpers/pg`.
- Setup per run: a fresh database migrated by that tree; seed as superuser with `session_replication_role = replica`: 1 user, 20 entities,
  20 owner memberships (case **S**), and in a second database 2,000 entities with 2,000 owner memberships (case **L**, seceng S5:
  ledger-sized, so a per-row evaluation of the policies' `current_user_id()` shows). `configure({ app, max: 1 })`. Body per transaction: `withTenant(uid, sid, tx => tx.execute(sql\`SELECT count(*)
  FROM public.entity\`))`. 50 warm-up transactions discarded; `CHECKPOINT` (superuser); read `pg_current_wal_lsn()`; 1,000 sequential
  timed transactions (`performance.now()` around each `withTenant`); read the LSN again. Emits one JSON line per case: `{ tree, sha,
  case, p50_ms, p95_ms, wal_bytes_per_tx }`. The thresholds apply to each case separately. If L fails and S passes, the cost is
  per-row evaluation. The fallback is then ruled on before merge, as the issue requires; its policy half, rewriting the 18 policies to
  `(SELECT app.current_user_id())`, targets exactly that cost.
- Control: same day, a `git worktree` of `origin/main` with `tests/db/bench/` copied in, run against the **same** server
  (`POLY_TEST_PG_URL` set for both). Six runs alternating control/branch; the record reports all six and the median of each side.
- Expectation (unmeasured): a marker turns a read-only transaction into a writing one, so each commit now flushes WAL. That flush, not the
  lookup, is the likely cost.
- qa-147 runs it after build-green and commits `process/cairn/reviews/POLY-147/marker-measure.md` (host, Postgres image,
  both shas, the six lines, medians, deltas). Thresholds per the issue: Δp95 ≤ 5 ms and ΔWAL ≤ 1 KB per transaction, both on medians.

## R8 — Test map

Kinds: **pgTAP** = `tests/db/pgtap/*.sql`; **db** = vitest under `tests/db/`; **unit** = vitest beside the source; **lint** = a fixture
under `tests/layers/fixtures/`. New pgTAP file: `07_identity_marker.sql`. New db file: `tests/db/identity-marker.test.ts`.

| Criterion | Test | Kind |
|---|---|---|
| K1 table shape, the exact ACL of R1 (PUBLIC, poly_operator, poly_backup named), RLS enabled and forced, the four policies | `07` catalog: `information_schema.columns`, `aclexplode(relacl)` minus owner, `pg_policy` quals | pgTAP |
| R1 hardening: no TEMP for poly_app/poly_worker/poly_operator; `max_prepared_transactions` = 0 | `07` | pgTAP |
| R2 signatures and EXECUTE (seceng S2) | `07`: for each of the four definers, `pg_get_function_identity_arguments` = R2's string, owner, `prosecdef`, `proconfig` = `{search_path=""}`. The full EXECUTE grantee set minus owner (`aclexplode`, PUBLIC as grantee 0 included) is exactly: `enter_asserted_user` {poly_app}; `enter_job` {poly_worker}; `enter_new_user` {poly_app}; `purge_tx_identity` {poly_worker}; `current_session_id` {poly_app}; `job_targets` {} (the `01_roles.sql` assertion is rewritten from {poly_worker}); `current_user_id` unchanged. `packages/db/sql/definers.json` gains the four definers with these sets and `job_targets` becomes `[]` (the existing allowlist test) | pgTAP |
| R2 exact-call check | `identity-marker`: as poly_app, through `withTenant`'s client in extended mode, `SELECT app.enter_asserted_user($1, $2), 1`, `SELECT * FROM (SELECT app.enter_asserted_user($1, $2)) s`, the literal form `SELECT app.enter_asserted_user('<uid>', '<sid>')`, and, as superuser, `DO $$BEGIN SET LOCAL ROLE poly_app; PERFORM app.enter_asserted_user(<uid>, <sid>); END$$` inside `BEGIN` (the superuser holds the language; `current_query()` is the DO text) → each `42501` `an identity definer must be called on its own`, and no marker. The same for `enter_job` (poly_worker) and `enter_new_user` (poly_app). The canonical text succeeds. `global-setup.ts` psql ≥ 16 check. | db |
| R2 the `query_to_xml` route | `identity-marker`: outside any transaction, through `createRoutingPool().query` (BetterAuth's plain pool, poly_app, extended mode), `SELECT 1 WHERE app.enter_asserted_user('<victim uid>', '<sid>') IS NOT NULL AND query_to_xml('SELECT count(*) FROM public.entity', true, false, '') IS NOT NULL` → `42501` `an identity definer must be called on its own`, and no marker results. The same fragment inside a `withContextFreeTx` before any insert gives the same refusal. **Red-if:** the exact-call check is missing (the `<>` form is caught by seceng reading the code, not by this test). | db |
| S6 commit check | `identity-marker`: inside `withTenant`, `tx.execute(sql.raw('COMMIT'))`, then an INSERT into `entity`, then return. `withTenant` rejects with `IdentityMarkerLost`; the INSERT was refused by RLS (no marker in autocommit); `current_user_id()` read after the `COMMIT` is null. The same for `withSystem` (seeded `qa_job`). On the happy path `marked` equals the pre-commit read. | db |
| S1 one statement cannot leave the transaction | `identity-marker`, inside `withTenant`: (a) `DO $$BEGIN COMMIT; END$$` inside a drizzle `tx.transaction` is refused with `42501` (R10: poly_app has no plpgsql; without R10 it would be `2D000`, invalid transaction termination); after the savepoint rolls back, `current_user_id()` is still the user. (b) `PREPARE TRANSACTION 'x'` is refused (`55000`, prepared transactions are disabled; unmeasured). Postgres turns a failed PREPARE into a rollback of the whole transaction, so the test asserts: `pg_prepared_xacts` is empty, `withTenant` rejects, and any read `fn` makes afterwards gets null, never another user. qa records the observed codes in the test. `07`: `current_setting('max_prepared_transactions') = '0'`. **Red-if:** the setting is raised, or the wrapper stops opening a real BEGIN. | db + pgTAP |
| R3 `withContextFreeTx` reads the marker | `wrappers.test.ts`: with a session-level `set_config('app.user_id', <uuid>, false)` left on the backend, `withContextFreeTx` proceeds and `current_user_id()` inside it is NULL. The old "refuses when the setting is set" assertion is inverted (OQ-1). | db |
| R3 `withOperatorTx` | `operator-invite.test.ts`: with a forged session-level `app.user_id`, the invite still succeeds (the setting means nothing). Its source sends no `current_setting('app.user_id')` (covered by the reserved-literal lint). | db + lint |
| K1 readers see only their transaction's row | `identity-marker`: commit a marker in tx A; in tx B (marked and unmarked) as poly_app and poly_worker, `SELECT count(*) FROM app.tx_identity` = own rows only | db |
| K1 read side never assigns an xid | `identity-marker`: `BEGIN READ ONLY`; forged `set_config`; `current_user_id()` IS NULL; `pg_current_xact_id_if_assigned()` IS NULL afterwards; no error | db |
| K2 body pinned | `01_roles.sql:86` rewritten: body matches `FROM app.tx_identity` and `pg_current_xact_id_if_assigned()`, contains neither `current_setting` nor `pg_current_xact_id()` | pgTAP |
| K2 forged setting grants nothing | `07`: as poly_app and poly_worker, marker cleared, `set_config('app.user_id', <owner uuid>, true)` → `current_user_id()` null and `count(*)` 0 on all six tenancy tables; poly_operator per OQ-2 | pgTAP |
| K3 `enter_new_user` writes the marker | `auth-new-user-step`, `auth-signup-invite`, pgTAP `05` pass, rewritten per R6/OQ-1; plus a marker row with kind `signup` after the step | db + pgTAP |
| K4 purge | `identity-marker`: committed marker backdated by superuser → purged; committed recent → kept; own in-progress transaction with a backdated marker calls purge as poly_worker → kept, then `enter_new_user`/`enter_job`/`enter_asserted_user` → 42501; `07` catalog: EXECUTE poly_worker alone | db + pgTAP |
| J1 `enter_job` | `wrappers.test.ts` (seeded `qa_job`): marker kind `system:qa_job`, principal from `job_targets`; zero or two rows → `NoPrincipalError`; poly_worker EXECUTE on `job_targets` gone | db + pgTAP |
| J2 worker reach | doc criterion; no test beyond J1 (today `job_targets` is empty) | — |
| J3 each definer writes its own kind | `identity-marker`: call each, read `kind`: `web`, `system:qa_job`, `signup`; no definer takes a kind argument (`07`: `pg_get_function_arguments`) | db + pgTAP |
| I1 EXECUTE per `enter_*` | `07`: for every `app.enter\_%` function, grantees minus owner = exactly {asserted_user: poly_app; job: poly_worker; new_user: poly_app}; an unlisted `enter_*` fails | pgTAP |
| (i) extended mode, three paths | `identity-marker`: `'SELECT 1; SELECT 2'` and `'SELECT 1; COMMIT; BEGIN; SELECT 1'` refused `42601` through (a) `tx.execute(sql.raw(…))` in `withTenant` and a `workerPool()` / `operatorPool()` query, (b) `createRoutingPool()` inside `withTenant`, (c) `createRoutingPool()` outside any transaction, via `query` and via `connect()`; after (b) the marker is still in place | db |
| (i) bypass refused | `packages/db/src/extended-client.test.ts` per R4: each pool's `options.Client === ExtendedClient`; a caller-supplied `queryMode` is overwritten; a Submittable throws `ExtendedModeRequired`; the source scan | unit |
| (ii) marker survives savepoints | `identity-marker`: in `withTenant`, routing-pool `BEGIN`/`ROLLBACK` and a drizzle `tx.transaction` that throws, then `current_user_id()` = the user | db |
| (ii, sign-up) | `identity-marker`: as poly_app `BEGIN; SAVEPOINT ba_1; insert user; enter_new_user; ROLLBACK TO ba_1;` then `enter_new_user` for that id and for an existing id → 42501, `enter_asserted_user` → 42501, `current_user_id()` null | db |
| (iii) second marker refused | `identity-marker`: each `enter_*` after a marker → 42501 `this transaction already has an identity` (new_user: `a user is already in context`); UPDATE/DELETE/INSERT on `tx_identity` as poly_app and poly_worker → 42501 | db |
| interim refuses an assigned xid | `identity-marker`: `BEGIN; INSERT` a row poly_app may write; `enter_asserted_user` → 42501 `…first write…` | db |
| Measurement | R7 | bench |
| No `app.session_id` reader | `07`: no `pg_proc.prosrc` in `app`/`public` and no `pg_policy` qual mentions `app.session_id`; lint `31-reserved-literal/fail-app-session-id.ts` and `fail-app-user-id.ts` | pgTAP + lint |
| Only the marker functions read `tx_identity` | `07`: `prosrc ILIKE '%tx_identity%'` only for `current_user_id`, `current_session_id`, `audit_membership` and the four definers | pgTAP |
| R10 plpgsql | `07`: the `aclexplode(lanacl)` grantee set for plpgsql is exactly the eight roles of R10, with PUBLIC absent. No other language with an inline handler exists: `count(*) FROM pg_language WHERE laninline <> 0 AND lanname <> 'plpgsql'` = 0. `identity-marker`: as poly_app, poly_worker and poly_operator, `DO $$BEGIN END$$` → `42501` `permission denied for language plpgsql`. For each of the three, a superuser first grants CREATE on a throwaway schema `qa_lang` inside a rolled-back transaction, so the schema check cannot answer first; `CREATE FUNCTION qa_lang.f() RETURNS int LANGUAGE plpgsql AS $$BEGIN RETURN 1; END$$` then gives the same error. **Red-if:** the REVOKE is missing, or a runtime role regains USAGE. | pgTAP + db |
| Docs | R9 phrases, checked by grep over the text of `docs/ARCH/index.html` and `docs/SECURITY/index.html` (tags stripped) | grep (qa, at verdict) |

## R9 — Doc phrases (grep-checkable)

The checks run on the HTML with tags stripped and whitespace collapsed, and are case-sensitive. ARCH is the architect's; SECURITY is
seceng-147's, who may substitute an equivalent phrase at review by amending this list in their review file. Each **must** phrase is
required verbatim. Each **must not** phrase must be absent.

- **ARCH §3.3** must contain: `app.tx_identity`; `pg_current_xact_id_if_assigned()`; `catches earlier writes, not earlier reads`;
  `the marker's session_id is web's word, not proof`; `no definer may treat it as proof of a session`; `an identity definer must be
  called on its own`. It must not contain `track_activities`, `set_config('app.user_id'` or `only the email-challenge definers and enrolment guards read`.
- **ARCH §3.1** must contain: `queryMode: 'extended'`; `the marker is the first statement after the real BEGIN`. It must not contain
  `about 30 lines`.
- **SECURITY R-2** must contain: `narrowed`; `the linking user of any existing connection, with that user's full read reach`; `job_targets
  returns no rows`. It must not contain `which any role can set` or `R-2 is closed`.
- **SECURITY T-18** must contain `app.tx_identity`. It must not contain `sets app.user_id to anyone`.
- **SECURITY C-84** must contain `app.tx_identity` and `enter_new_user`.

## R10 — No plpgsql for the runtime roles (seceng S4; Principal, 2026-11-14)

- **Where:** `packages/db/sql/roles.sql`, the superuser bootstrap, after the role loop. The language is owned by the bootstrap
  superuser, so neither poly_migrator nor poly_owner could change it. `pg_language` is per database, and `roles.sql` already runs per
  database (in provisioning, and in the harness's `freshDb`). Both statements are idempotent:
  `REVOKE USAGE ON LANGUAGE plpgsql FROM PUBLIC;`
  `GRANT USAGE ON LANGUAGE plpgsql TO poly_owner, poly_authz, poly_purge, poly_rollup, poly_graph, poly_stake, poly_govern, poly_journal;`
- **What it does:** `DO` and `CREATE FUNCTION … LANGUAGE plpgsql` fail for poly_app, poly_worker, poly_operator, poly_backup and
  poly_migrator with `42501`. Calling an existing plpgsql function needs no USAGE on the language, so every definer and trigger runs as
  before.
- **No runtime use (confirmed):** a grep of `packages/*/src`, `apps/*/src`, `better-auth@1.7.18` (with `@better-auth/core` and
  `@better-auth/passkey`), `drizzle-orm@0.45.4` (`node-postgres`, `pg-core`) and `kysely@0.29.8` finds no `DO` block and no function
  creation. It agrees with the lead's search.
- **The migrator keeps working:** migrations create plpgsql functions only after `SET ROLE` to poly_owner or a definer owner
  (`0003`, `0007`, `0009`), and Postgres checks language USAGE against the current role, so those roles keep USAGE. No migration and no
  statement in `migrate.ts` runs `DO` or creates a function as poly_migrator itself. That is a static read; the suite's full
  migration run measures it.
- **The harness keeps working:** every test `DO` and `CREATE FUNCTION` (`helpers/api.ts:33`, and the `qa_*` trigger functions in
  `auth-*`, `operator-invite`, `wrappers`) runs through `must`/`psql` as superuser, which bypasses language ACLs. pgTAP's `pg_temp`
  helpers also run as superuser. `checks.test.ts` only lints migration text; it does not execute it.
- **Cost:** about 0.1 loop-day (a guess). devops notes the bootstrap change in INFRA's provisioning text at the docs criterion.

## R11 — No "run a SQL string" built-ins for PUBLIC (addendum; Principal, 2026-11-15; seceng E1(2))

- **The list, by signature, read from the test image (`polycarpic-pgtap:7958605b474b`, built from the pinned digest, which reports
  `PostgreSQL 17.12`):** `query_to_xml(text,boolean,boolean,text)`, `query_to_xmlschema(text,boolean,boolean,text)`,
  `query_to_xml_and_xmlschema(text,boolean,boolean,text)`, `table_to_xml(regclass,boolean,boolean,text)`,
  `table_to_xmlschema(regclass,boolean,boolean,text)`, `table_to_xml_and_xmlschema(regclass,boolean,boolean,text)`,
  `cursor_to_xml(refcursor,integer,boolean,boolean,text)`, `cursor_to_xmlschema(refcursor,boolean,boolean,text)`,
  `schema_to_xml(name,boolean,boolean,text)`, `schema_to_xmlschema(name,boolean,boolean,text)`,
  `schema_to_xml_and_xmlschema(name,boolean,boolean,text)`, `database_to_xml(boolean,boolean,text)`,
  `database_to_xmlschema(boolean,boolean,text)`, `database_to_xml_and_xmlschema(boolean,boolean,text)`, `ts_stat(text)`,
  `ts_stat(text,text)`, `ts_rewrite(tsquery,text)`. That is 17 functions. `ts_rewrite(tsquery,tsquery,tsquery)` is IMMUTABLE and runs
  no SQL, so it is not on the list.
- **Where:** `packages/db/sql/roles.sql`, right after R10's two statements. It holds one
  `REVOKE EXECUTE ON FUNCTION pg_catalog.<name>(<args>) FROM PUBLIC;` per signature above. That is idempotent, and only the bootstrap
  superuser (the functions' owner) can run it.
- **EXECUTE back:** nobody. A grep of `packages/*/src`, `apps/*/src`, `packages/db/migrations`, `tests/db`, better-auth, drizzle-orm and
  kysely finds no use of any of them. A superuser bypasses the ACL, so the test harness is unaffected.
- **Tests:**
  - `07` catalog: for every `pg_catalog` function whose name matches `^(query|table|cursor|schema|database)_to_xml` or is `ts_stat`, plus
    `ts_rewrite(tsquery,text)`, `aclexplode(proacl)` has no grantee but the owner (PUBLIC absent), and
    `has_function_privilege(r, oid, 'EXECUTE')` is false for poly_app, poly_worker and poly_operator. The match is by pattern, so a
    function a later Postgres adds under these names fails the test until it is listed. The test also asserts the count is 17.
  - `identity-marker` db: as poly_app, `SELECT query_to_xml('SELECT 1', true, false, '')` → `42501`
    `permission denied for function query_to_xml`.
- **Interaction with R8's `query_to_xml` row:** with R11 in place, that fragment may be refused for the function's EXECUTE before
  the exact-call check runs. The row asserts `42501` with either message, and no marker. Its exact-call coverage stands on the R2
  exact-call rows, which use no built-in.
- **Restore and major upgrade:** these ACLs live in the database's own `pg_proc`. `pg_dump` (and so `pg_upgrade`) carries changes
  from the initdb privileges (unmeasured). Whatever happens, `roles.sql` is re-run after any restore or major upgrade, and it re-applies
  the revoke. devops states that in INFRA's provisioning and restore runbooks at the docs criterion. The `07` test fails if the
  bootstrap ever loses the lines. It runs on fresh test databases, not on a live instance.

## seceng's prep notes — disposition

| Note | Disposition |
|---|---|
| 1 REVOKE FROM PUBLIC; catalog covers PUBLIC and every login role | Adopted (R2, R8 "R2 signatures and EXECUTE") |
| 2 xid8; owner; FORCE RLS; INSERT WITH CHECK; no TRUNCATE/REFERENCES/TRIGGER; purge owner holds DELETE only | Adopted (R1) |
| 3 NULL status; caller cannot pick the age | Adopted (R1, R2: no argument) |
| 4 `max_prepared_transactions` = 0 asserted | Adopted (R1, R8) |
| 5 `pg_temp` shadowing; TEMP to PUBLIC | Adopted: TEMP is already revoked (`roles.sql` REVOKE ALL ON DATABASE FROM PUBLIC); the catalog test asserts it; bodies qualified |
| 6 a marker written mid-statement | Closed by the exact-call check; the snapshot argument alone fails (`query_to_xml`; R2) |
| 7 exact-call check | Kept by the Principal (2026-11-14, seceng D1). The live-session check was rejected (R2) |
| 8 sign-up savepoint | Adopted (R2 cases, OQ-3) |
| 9 the two "no user yet" checks read the marker | `withContextFreeTx` adopted. `withOperatorTx` drops the check, because the operator has no way to write a marker (R3) |
| 10 `app.actor`; kind from the marker | Adopted (`audit_membership`, R1) |
| 11 session_id is web's word | Adopted (R5, R9 ARCH phrase) |
| 12 per-query mode; Submittables | Adopted (R4) |
| 13 routing pool checks the first word only | Adopted (R4, R8 test string) |
| 14 `job_targets` EXECUTE may stay | Rejected; the reason is in R1 |
| 15 no READ ONLY `withTenant` | Adopted (R1) |

## OQ — for the lead (each with the recommendation the build proceeds on)

1. **"Every POLY-87 test still passes" cannot hold verbatim.** Tests that set or read `app.user_id` assert the old mechanism and invert under
   the marker: `auth-new-user-step` conditions 5 (reads `current_setting('app.user_id')` after the step), the forged-setting refusal
   (`:73-77`; a forged setting no longer counts, so the step succeeds) and the claim-with-setting refusal (`:219-232`); pgTAP `05` C17, C30
   and its `run_as`; pgTAP `06` O2 (`:28,30`, forged setting → issuer refused); the `ContextNotEmptyError` cases in `wrappers.test.ts`;
   and every psql string that calls an `enter_*` with literals (R2's exact-call check). **Recommendation:** read the criterion as "every POLY-87
   property still holds". Each such assertion is rewritten in the red gate to the marker form (a real marker in place of the setting, the
   reading via `current_user_id()`), keeping its red-if mutation; none is deleted. O2 becomes two: a forged setting no longer blocks the
   issuer, and a marker does.
2. **poly_operator in K2.** poly_operator holds EXECUTE on neither `current_user_id()` nor SELECT on tenancy tables, so "null and zero rows"
   cannot be observed as worded. **Recommendation:** no new grant; its K2 case is: forged setting → both calls `42501`, and the issuer
   still treats the transaction as having no user.
3. **Sign-up rollback, "for any user".** After the rollback, poly_app can insert a fresh user and enter it: that is a new sign-up, with no
   Person and no membership, which cannot commit without a live invitation (`user_90_stamp_cleared`). Nothing in Postgres remembers a
   rolled-back marker. **Recommendation:** test "any user that exists outside this transaction"; ARCH says this.
4. **Purge, "a transaction left open past the cut-off".** Another session's uncommitted marker is invisible to the purge's snapshot at any
   age, so only the purge's own transaction can be tested with a backdated marker (K4 row). **Recommendation:** accept; the status check
   guards the own-transaction case and the policy repeats it.
