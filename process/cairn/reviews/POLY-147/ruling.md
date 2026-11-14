# POLY-147 — gate 1 ruling (architect)

Scope: the issue file's criteria (K, J, I, the three guards, the measurement, no `app.session_id` reader, docs). The design is (e1), staged
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
- `pg_xact_status` returns NULL for an xid too old for the commit log; `IS DISTINCT FROM` makes that purgeable. xid8 never repeats.
- The owner, poly_owner, holds every privilege implicitly; the catalog test excludes the owner, as `01_roles.sql` does for functions.

**`app.current_user_id()`** — `CREATE OR REPLACE`, still `LANGUAGE sql STABLE`, invoker, no `SET` clause, grants unchanged:
`SELECT t.user_id FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned()`.
It never calls `pg_current_xact_id()`, so a transaction that wrote nothing has no xid and reads null. With a FROM clause the function is no
longer inlined (unmeasured cost; the measurement in R7 prices it).

**`app.current_session_id()`** — new, same shape, returns `t.session_id`. Invoker. EXECUTE poly_app only (POLY-89 grants its own).

**`app.audit_membership()`** — `CREATE OR REPLACE` as poly_govern. `withSystem` no longer sets `app.actor` (R3), so the actor is read
from the marker first: `v_actor := coalesce((SELECT CASE t.kind WHEN 'web' THEN 'user' WHEN 'signup' THEN 'user' ELSE t.kind END
FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned()), nullif(current_setting('app.actor', true), ''), 'none')`.
In a marked transaction a forged `app.actor` is ignored; it still labels the unmarked operator path, whose issuer writes its own literal.

**`app.job_targets(text)`** — REVOKE EXECUTE FROM poly_worker (as poly_authz). It stays the per-job extension point, called only by `enter_job`.

## R2 — The definers

All `LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''`, every reference schema-qualified, REVOKE EXECUTE FROM PUBLIC, and each entered
in `packages/db/sql/definers.json`. Every refusal is `ERRCODE = '42501'` with the exact message below unless stated; tests match code and
message. The marker check reads `app.tx_identity` through `tx_identity_own` (owner's own transaction) and runs before any write; the PK is
the backstop (`23505`).

| Definer | Owner | EXECUTE | Checks, in order | Writes |
|---|---|---|---|---|
| `app.enter_asserted_user(p_user uuid, p_session uuid) RETURNS void` | poly_authz | poly_app | 1. either arg null → `22004` `identity is required`. 2. a marker exists for `pg_current_xact_id_if_assigned()` → `this transaction already has an identity`. 3. `pg_current_xact_id_if_assigned() IS NOT NULL` → `the identity marker must be the first write of its transaction`. | `(pg_current_xact_id(), p_user, p_session, 'web')` |
| `app.enter_job(p_job text, p_entity uuid, p_connection uuid) RETURNS uuid` | poly_authz | poly_worker | 1. `p_job !~ '^[a-z][a-z0-9_]{0,62}$'` → `22023` `invalid job name`. 2. marker exists → as above. 3. xid assigned → as above. 4. `SELECT principal_user_id FROM app.job_targets(p_job) WHERE entity_id = p_entity AND connection_id IS NOT DISTINCT FROM p_connection`: unless exactly one row with a non-null principal → `P0002` `job <p_job> resolved no single principal`. | `(…, principal, NULL, 'system:' \|\| p_job)`; returns the principal |
| `app.enter_new_user(uuid) RETURNS void` (`CREATE OR REPLACE`) | poly_authz | poly_app | 1. marker exists → `a user is already in context` (message kept: POLY-87 tests). 2. and 3. unchanged (stamp, no Person). No xid check: it must run after the user insert. | `(…, $1, NULL, 'signup')` replacing `set_config` |
| `app.purge_tx_identity() RETURNS integer` | poly_purge | poly_worker | none | `DELETE … WHERE created_at < now() - interval '1 hour' AND pg_xact_status(xid) IS DISTINCT FROM 'in progress'`; returns the row count |

- Owner CREATE on `app` is granted to poly_authz and poly_purge for the file only, then revoked, as in `0001`/`0007`.
- The age is a constant in the body and in the policy; the caller passes nothing. The schedule lands with the worker's first job loop.
- A marker written inside a savepoint (`enter_new_user`) carries the top-level xid: `pg_current_xact_id[_if_assigned]` return the
  top-level id inside a subtransaction (`0007:128` relies on this already).

## R3 — The wrappers (`packages/db/src/context.ts`)

- `inTransaction` sends nothing between `BEGIN` and `setup(client)`; that stays true and gets a comment. Each wrapper's setup is its whole
  identity step, so **the marker is the first statement after the real BEGIN**, before `fn` can open a savepoint (drizzle `tx.transaction`
  or the routing pool's `SAVEPOINT ba_n`).
- `withTenant(userId, sessionId, fn)`: UUID check on both, then setup = `SELECT app.enter_asserted_user($1, $2)`. No `set_config`.
- `withSystem(job, target, fn)`: TS regex check kept; setup = `SELECT app.enter_job($1, $2, $3)`. A `P0002` from the definer is rethrown
  as `NoPrincipalError(job)`. No `set_config`, no `app.actor`.
- `withContextFreeTx`: setup = `SELECT app.current_user_id() IS NULL AS ok`; `ContextNotEmptyError` if not. No `current_setting`.
- `withOperatorTx`: drops its `current_setting('app.user_id')` check (poly_operator cannot execute `current_user_id()`; the issuer's own
  check is the guard). `set_config('app.actor', 'operator:cli', true)` stays.
- `new-user.ts` unchanged (`SELECT app.enter_new_user($1)`).

**Sign-up savepoint (guard ii, sign-up).** `enter_new_user` runs inside BetterAuth's `SAVEPOINT ba_n`, after the user insert, so the marker
can be rolled back with it. After `ROLLBACK TO ba_n`: the user row is gone, so `enter_new_user` refuses every existing id (stamp check);
the xid stays assigned (a subtransaction write assigns the parent's xid first), so `enter_asserted_user` refuses every id; and the
transaction reads null from then on. See OQ-3 for "any user".

## R4 — Extended mode on every poly_app / poly_worker query (guard i)

- One seam: `packages/db/src/extended-client.ts` exports `class ExtendedClient extends pg.Client` whose `query(config, values, cb)`:
  turns a string into `{ text }`, throws `ExtendedModeRequired` on a Submittable (an object with `submit`, e.g. a cursor), and calls
  `super.query({ ...config, queryMode: 'extended' }, values, cb)`. `pg@8.23.1` `lib/query.js:35-37` prepares whenever
  `queryMode === 'extended'`, and Postgres refuses a prepared string holding two commands (`42601`).
- `pool.ts`: all three `new pg.Pool({...})` pass `Client: ExtendedClient` (`pg-pool` `index.js:95` honours `options.Client`). This one
  change covers the three paths: the wrappers (clients from `appPool`/`workerPool`/`operatorPool`), BetterAuth's routing-pool handle
  (`store.client` is an `appPool` client), and BetterAuth's plain pool (`authPool` is `appPool`; both `pool.query` and `connect()`).
- `migrate.ts`'s two `new pg.Client` stay simple-protocol (poly_migrator runs multi-statement migration files; out of scope).
- **Bypass check:** a vitest unit test `packages/db/src/extended-client.test.ts` asserting each pool's `options.Client === ExtendedClient`
  and the Submittable refusal, plus a source scan in the same file: under `packages/` and `apps/` (excluding `node_modules`, `.claude`),
  `new pg.Pool(` occurs only in `pool.ts`, `new pg.Client(` only in `migrate.ts`, and `extends pg.Client` only in `extended-client.ts`.
  Importing `pg` outside `packages/db` is already refused by lint (`tests/layers/fixtures/08-postgres-driver/fail-pg*.ts`).

## R5 — `app.session_id` readers move to the marker

- `packages/auth/src/session.ts` (three reads, `listSessions` and `revokeSession`): `coalesce(pg_catalog.current_setting('app.session_id',
  true), '')` becomes `coalesce(app.current_session_id()::text, '')`.
- `layers.json` `reservedLiterals` gains `"app.session_id": []` and `"app.user_id": []`: no production source may name either setting.
  (`app.user_id` is now inert; naming it in production code is a bug.) Add `"enter_asserted_user"` and `"enter_job"` with
  `["packages/db/src/context.ts"]`, and `"purge_tx_identity": []`.
- The routing-pool header comment ("holds no GUC") is reworded by the builder; no behaviour changes there.

## R6 — Tests that encode the old mechanism

Helpers that impersonate a user with `set_config('app.user_id', …)` move to the marker: psql/vitest helpers
(`tests/db/helpers/invitation.ts`, and any `BEGIN; SELECT set_config('app.user_id'…)` string) send `SELECT app.enter_asserted_user('<uid>',
'<sid>')` as the first statement after `BEGIN`. pgTAP files run in one transaction whose xid is assigned by the fixtures, so there
`pg_temp.run_as` sets identity as superuser: `DELETE FROM app.tx_identity WHERE xid = pg_current_xact_id(); INSERT … (pg_current_xact_id(),
uid, NULL, 'web')` (or only the DELETE for `''`). Superuser bypasses grants and RLS; no production role can do this, which pgTAP also
asserts. Definer success paths that need a fresh xid are therefore vitest db tests, never pgTAP.

## R7 — Measurement harness

- Files: `tests/db/bench/vitest.config.ts` (own config, same `globalSetup`; not matched by `tests/db/**/*.test.ts`, so the suite never runs
  it) and `tests/db/bench/marker-measure.bench.ts`. It uses only surfaces present on `main` today: `configure`, `withTenant`, `sql` from
  `@poly/db`, `freshDb`/`migrateCli` from `helpers/api`, `psql` from `helpers/pg`.
- Setup per run: a fresh database migrated by that tree; seed as superuser with `session_replication_role = replica`: 1 user, 20 entities,
  20 owner memberships. `configure({ app, max: 1 })`. Body per transaction: `withTenant(uid, sid, tx => tx.execute(sql\`SELECT count(*)
  FROM public.entity\`))`. 50 warm-up transactions discarded; `CHECKPOINT` (superuser); read `pg_current_wal_lsn()`; 1,000 sequential
  timed transactions (`performance.now()` around each `withTenant`); read the LSN again. Emits one JSON line: `{ tree, sha, p50_ms,
  p95_ms, wal_bytes_per_tx }`.
- Control: same day, a `git worktree` of `origin/main` with `tests/db/bench/` copied in, run against the **same** server
  (`POLY_TEST_PG_URL` set for both). Six runs alternating control/branch; the record reports all six and the median of each side.
- Expectation (unmeasured): a marker turns a read-only transaction into a writing one, so each commit now flushes WAL. That flush, not the
  lookup, is the likely cost.
- The implementation lead runs it after build-green and commits `process/cairn/reviews/POLY-147/marker-measure.md` (host, Postgres image,
  both shas, the six lines, medians, deltas). Thresholds per the issue: Δp95 ≤ 5 ms and ΔWAL ≤ 1 KB per transaction, both on medians.

## R8 — Test map

Kinds: **pgTAP** = `tests/db/pgtap/*.sql`; **db** = vitest under `tests/db/`; **unit** = vitest beside the source; **lint** = a fixture
under `tests/layers/fixtures/`. New pgTAP file: `07_identity_marker.sql`. New db file: `tests/db/identity-marker.test.ts`.

| Criterion | Test | Kind |
|---|---|---|
| K1 table shape, grants (no UPDATE/TRUNCATE for anyone but owner; DELETE poly_purge alone; INSERT poly_authz alone), RLS forced, the four policies | `07` catalog: `information_schema.columns`, `aclexplode(relacl)` minus owner, `pg_policy` quals | pgTAP |
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
| (i) extended mode, three paths | `identity-marker`: `'SELECT 1; SELECT 2'` refused `42601` through (a) `tx.execute(sql.raw(…))` in `withTenant` and a `workerPool()` query, (b) `createRoutingPool()` inside `withTenant`, (c) `createRoutingPool()` outside any transaction, via `query` and via `connect()` | db |
| (i) bypass refused | `packages/db/src/extended-client.test.ts` per R4 | unit |
| (ii) marker survives savepoints | `identity-marker`: in `withTenant`, routing-pool `BEGIN`/`ROLLBACK` and a drizzle `tx.transaction` that throws, then `current_user_id()` = the user | db |
| (ii, sign-up) | `identity-marker`: as poly_app `BEGIN; SAVEPOINT ba_1; insert user; enter_new_user; ROLLBACK TO ba_1;` then `enter_new_user` for that id and for an existing id → 42501, `enter_asserted_user` → 42501, `current_user_id()` null | db |
| (iii) second marker refused | `identity-marker`: each `enter_*` after a marker → 42501 `this transaction already has an identity` (new_user: `a user is already in context`); UPDATE/DELETE/INSERT on `tx_identity` as poly_app and poly_worker → 42501 | db |
| interim refuses an assigned xid | `identity-marker`: `BEGIN; INSERT` a row poly_app may write; `enter_asserted_user` → 42501 `…first write…` | db |
| Measurement | R7 | bench |
| No `app.session_id` reader | `07`: no `pg_proc.prosrc` in `app`/`public` and no `pg_policy` qual mentions `app.session_id`; lint `31-reserved-literal/fail-app-session-id.ts` and `fail-app-user-id.ts` | pgTAP + lint |
| Only the marker functions read `tx_identity` | `07`: `prosrc ILIKE '%tx_identity%'` only for `current_user_id`, `current_session_id`, `audit_membership` and the four definers | pgTAP |
| Docs | architect (ARCH) and seceng (SECURITY) at their dispatch | — |

## OQ — for the lead (each with the recommendation the build proceeds on)

1. **"Every POLY-87 test still passes" cannot hold verbatim.** Tests that set or read `app.user_id` assert the old mechanism and invert under
   the marker: `auth-new-user-step` conditions 5 (reads `current_setting('app.user_id')` after the step), the forged-setting refusal
   (`:73-77`; a forged setting no longer counts, so the step succeeds) and the claim-with-setting refusal (`:219-232`); pgTAP `05` C17, C30
   and its `run_as`; pgTAP `06` O2 (`:28,30`, forged setting → issuer refused). **Recommendation:** read the criterion as "every POLY-87
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
