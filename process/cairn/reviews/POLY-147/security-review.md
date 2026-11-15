# POLY-147 — security review (seceng)

## 1. Ruling review — `ruling.md` @ e2104584

Read as an attacker against the tree at `61da0e72` and the ruling's text. **Verdict: buildable once S1 and S2 are added to the test map.** Neither changes the design; both are tests that pin a premise guard (ii) relies on. Everything else is accepted or non-blocking.

Tags: **(B)** blocking, needed before tests-red; **(N)** non-blocking: a fix I want, but it does not gate the build. "Unmeasured" means I am reasoning from Postgres semantics, and the test named is what measures it.

### Findings

**S1 (B): a single statement can still end the transaction.** Guard (ii)'s claim is that one injected statement cannot leave the marked transaction. Extended mode stops `x; COMMIT; BEGIN; …`, but three one-statement routes remain:
- `PREPARE TRANSACTION 'p'` detaches the marked transaction from the session. Statements after it then run unmarked, autocommit, with no xid, so a second injection can call `enter_asserted_user` naming anyone. The routing pool refuses `PREPARE` (`routing-pool.ts` CONTROL); `tx.execute` does not. This is blocked only while `max_prepared_transactions = 0`, which is Postgres's default. Nothing in the tree asserts it, and an INFRA tuning change could raise it silently.
- `DO $$ BEGIN COMMIT; … END $$`, or `CALL` of a procedure that commits. Inside an explicit transaction block Postgres refuses this (`invalid transaction termination`; unmeasured).
- A bare `COMMIT` sent as one whole statement through `tx.execute(sql.raw(…))`. It is accepted. The rest of `fn` then runs unmarked and reads null (fail closed). A second whole-statement injection would be needed to gain anything.

**Fix required:** in `07_identity_marker.sql`, assert `current_setting('max_prepared_transactions') = '0'`. In `identity-marker.test.ts`, inside `withTenant`: `PREPARE TRANSACTION 'x'` is refused; `DO $$BEGIN COMMIT; END$$` is refused; and afterwards `current_user_id()` is still the user. **Red-if:** `max_prepared_transactions` is raised, or the wrapper stops opening a real `BEGIN`. For the bare-`COMMIT` case see S6.

**S2 (B): the catalog tests must state exact grantee sets, PUBLIC included, for every new object.** I1 covers `app.enter\_%` only. The same "exactly these grantees, PUBLIC absent" rule must also cover:
- `purge_tx_identity`: poly_worker alone.
- `current_session_id`: poly_app alone.
- `job_targets`: nobody.
- `tx_identity`'s relation ACL. K1 says "no UPDATE/TRUNCATE"; it must instead be the whole `aclexplode` set (SELECT for the nine listed roles, INSERT poly_authz, DELETE poly_purge, nothing else), so a stray `REFERENCES` or `TRIGGER` grant also fails.

The new definers must also be entered in `definers.json` with the same sets.

**Mechanism:** Postgres grants EXECUTE on a new function to PUBLIC. `roles.sql:60`'s default privileges cover objects created by the listed owner roles. Only an explicit exact-set test catches a function created under some other role, or a grant re-added later. **Red-if:** any new object gains a grantee.

**S3 (N): the session id in a `web` marker is web's word, not proof.** `enter_asserted_user` stores `p_session` unchecked, so in stage 1 `current_session_id()` is exactly as trustworthy as `app.session_id` was. Today its only reader is the Sessions list (it marks "current"). The danger is POLY-89, whose email-challenge and enrolment guards would read it. **Fix required (docs):** ARCH §3.3 says that until stage 2 the marker's `session_id` is asserted by web, and that no definer may treat it as proof that a session exists or is recent. SECURITY carries the same in R-2. POLY-89's ruling must cite this.

**S4 (N): a whole-statement `DO` on the plain pool can run several transactions.** On BetterAuth's unmarked plain pool (autocommit), a `DO` block may `COMMIT` and run any amount of plpgsql, including `enter_asserted_user(victim)` followed by tenancy reads and writes. This is inside R-2's accepted "injection on an unmarked path reaches any user", so the wording does not change. It needs the attacker to control a whole statement, not a fragment.
- **Stronger option:** in `roles.sql` (superuser bootstrap), `REVOKE USAGE ON LANGUAGE plpgsql FROM PUBLIC`, with USAGE granted to poly_owner and the definer owners. `DO` and temp plpgsql functions then fail for poly_app, poly_worker and poly_operator.
- **Cost:** about 0.1 loop-day, plus a check that nothing at runtime uses `DO`. I recommend it in this loop or in POLY-97's provisioning. The lead should offer it to the Principal.

**S5 (N): the read-side cost is evaluated per row (flag for the architect).** `current_user_id()` is now a non-inlined STABLE function with a FROM clause, called inside policy quals. Postgres may evaluate it once per candidate row. The R7 bench seeds 20 entities and will under-read this on ledger-sized tables. Not a security finding, but if the 1,000-row case is slow, the issue's fallback (`(SELECT app.current_user_id())` initplans) is the remedy, and the 18 policies would change.

**S6 (N): check before COMMIT that the transaction is still the one that was marked.** Make `enter_asserted_user` and `enter_job` return `pg_current_xact_id()::text`. Just before its COMMIT, `inTransaction` checks `pg_current_xact_id_if_assigned()` against that value, and throws (rolls back) if they differ or the result is null. This turns S1's bare-`COMMIT` case from a silent run of unmarked statements into a failed request. **Cost:** a few lines plus one db test.

### The lead's specific questions

| Question | Ruling | Mechanism |
|---|---|---|
| OQ-1: rewrite the POLY-87 tests to the marker form; O2 split | **Accept** | The old assertions test the setting, which no longer carries identity, so keeping them verbatim would prove nothing. Condition: each rewritten assertion keeps a stated red-if mutation, none is deleted, and O2's two halves are "a forged setting does not block the issuer" and "a real marker (superuser-planted, R6) does". |
| OQ-2: poly_operator's K2 case is 42501, no new grant | **Accept** | poly_operator cannot call `current_user_id()` and holds no SELECT on tenancy or `tx_identity`. 42501 on both is stronger than "null and zero rows". The issuer's check (as poly_govern, which reads the marker) stays the real guard. Add: catalog asserts poly_operator holds no privilege on `tx_identity` (S2). |
| OQ-3: sign-up rollback tested for "any user that exists outside this transaction" | **Accept** | After `ROLLBACK TO ba_n`, the only user the transaction can enter is one it inserts afresh: the stamp trigger sets `signup_txid` on insert alone, and poly_app has no UPDATE on it. That user has no Person, no membership, and cannot commit without a live invitation (`user_90_stamp_cleared`). Its reach is a new sign-up, which poly_app can already do. |
| OQ-4: purge testable only against its own transaction | **Accept** | Under MVCC, another session's uncommitted marker is invisible to the purge's DELETE scan at any age, so it can never be removed. The status predicate only matters for the purge's own transaction, which the K4 test covers. |
| R3: drop `withOperatorTx`'s no-user check | **Accept** | poly_operator cannot write a marker: it holds EXECUTE on no `enter_*` (I1 asserts this). The one identity-sensitive definer it can call, the issuer, checks `current_user_id() IS NULL` as poly_govern itself. A TS check that cannot run (42501) adds nothing. |
| R1: `tx_identity_purge_read USING (true)` for poly_purge | **Accept** | poly_purge is NOLOGIN. Only poly_migrator (trusted at deploy, and already able to become poly_owner) can `SET ROLE` to it, and its one definer takes no argument. A row holds a user id, a session *row* id (not the token) and a kind: low value. Guarded by R8's "only the marker functions read `tx_identity`" prosrc test, which must also fail if any other poly_purge-owned function appears. Calling `current_user_id()` inside a poly_purge definer stays correct, because the function filters `xid = if_assigned()` explicitly. |
| R1: no FK on `user_id` | **Accept** | In stage 1 an FK proves only that some user exists, not that the caller is that user. Web asserts the id either way. An id naming no user matches no membership, so it reaches nothing. The lock cost is real. Revisit in stage 2, where `enter_session` derives the id from a session row. |
| My "exact own call" tightening of `enter_asserted_user` | **Withdrawn, not required** | It would stop an injected fragment on the unmarked plain pool from calling the definer. But on that same path poly_app's direct grants on BetterAuth's tables already reach any user (plant a magic link, read session rows; R-2), and only stage 2 removes those. It narrows nothing R-2 states, and it adds a `track_activities` dependency. S4 is the cheaper hardening of the same path. |

### Questions I pressed with no finding

- **Who can write, change, remove or outlive a marker.**
  - INSERT: poly_authz only, under `WITH CHECK xid = pg_current_xact_id()`.
  - UPDATE: no grant exists.
  - DELETE: poly_purge only, never an in-progress transaction.
  - FORCE RLS binds the owner. `xid8` is 64-bit with its epoch, so an id never recurs and wraparound cannot revive an old marker.
  - A subtransaction marker carries the top-level xid, and `ROLLBACK TO` removes it. That case is covered by guard (ii) and the sign-up test.
  - Every definer uses `search_path = ''` and schema-qualifies its names. That closes the `pg_temp` shadowing of unqualified relations; keep it that way at build check.
- **The read side.** `current_user_id()` uses only `pg_current_xact_id_if_assigned()`. An unmarked transaction, including `BEGIN READ ONLY`, reads null; the K1 read-only test would fail if the read side assigned an xid.
- **Guards.** (i) A single `ExtendedClient` on all three pools, plus a refusal of Submittables, covers the wrappers, the routing-pool handle and the plain pool; the source scan is noted under build check. (ii) Nothing runs between `BEGIN` and setup. (iii) Every definer refuses a second marker, and the PK is the backstop. The interim definer's refusal of an assigned xid is tested after a real insert.
- **Worker reach.** `enter_job` alone, `job_targets` reachable only through it, `kind` validated in SQL and by the CHECK constraint. Today `job_targets` is empty, so the reach is nil. With rows, the worker can act as the principal of any `(entity, connection)` the function returns, and no wider. That matches seceng #10.
- **Settings readers.** After R5, nothing steerable remains: `app.session_id` has no reader and `app.user_id` is inert, both enforced by lint and prosrc. `app.actor` is read only as the fallback label in unmarked transactions. No membership write can happen there, since those policies need a non-null user.
- **Conditions #4–#11.** Each has a test in R8 that fails if its hole opens, given S1 and S2. #12 (the HMAC fallback key) applies only if R7's threshold fails; if so, the re-issued ruling must carry its pgTAP check.

### For build check (job 2)

- **The R4 source scan matches `new pg.Pool(` and `new pg.Client(` literally.** It misses `import { Pool, Client } from 'pg'` and `pg.native` inside `packages/db`. The scan must refuse any binding of `Pool`, `Client` or `native` from `pg` outside `pool.ts`, `migrate.ts` and `extended-client.ts`.
- **`startup.ts` and any other runtime client.** Confirm they come from the ExtendedClient pools.
- **The migration text.** Read `0011` against R1 and R2 line by line: schema-qualified names, REVOKE FROM PUBLIC on every function, the CREATE-on-`app` grant revoked at the end, and the policy role lists.

## 2. Delta review — `ruling.md` e2104584 → 60bfbb6e

**Verdict: buildable.** S1 is covered and S2 is nearly covered. One line is still required (D2). The exact-call check is sound and I recommend keeping it; my withdrawal in §1 was wrong (D1).

### D1 — the exact-call check (R2): keep it

**What it stops that nothing else stops in stage 1.** SQL injection can no longer call an identity definer in any form, on any path:
- The canonical text carries placeholders (`$1, $2`). An injected string cannot bind parameters, so:
  - a fragment inside a larger statement is refused;
  - a whole injected statement with literals is refused;
  - a `DO` block that calls the definer is refused, because `current_query()` is the `DO` text (this closes S4 for identity);
  - a `COMMIT` followed by a fresh call is refused.
- Without the check, on an unmarked path (BetterAuth's plain pool, or the sign-up transaction before its user insert), a `DO` block or a fragment inside an open BetterAuth transaction could name any user directly in Postgres.

What stays open: poly_app's direct grants on BetterAuth's tables (plant a magic link, read session rows; R-2), a stolen poly_app password, and code execution in web. R-2's "injection on an unmarked path reaches any user" therefore stays true. The route, though, becomes an account takeover through sign-in. That leaves an auth event, a new session in the victim's Sessions list, and needs the attacker to complete a sign-in, instead of a silent query. My §1 withdrawal compared only the end reach and missed this.

**What it costs.** At run time, a string compare per request (nothing measurable). In tests:
- psql helpers move to `\bind`, which needs psql ≥ 16 in the test image (confirm the image's version at build).
- pgTAP can no longer assert the specific refusals, so those move to vitest db. That is a little more `db` suite time, which goes in the loop's suite-time report.
- Build: about 0.25 loop-day.

**Ways it could fail open or break sign-in:**
- **`track_activities` off: no effect. The ruling's mechanism is mis-sourced.** `current_query()` returns the backend's `debug_query_string`, the text the client sent. It does not read `pg_stat_activity`, so `track_activities` and `track_activity_query_size` do not affect it (unmeasured; source reading). In the extended protocol, `exec_bind_message` and `exec_execute_message` set it to the prepared statement's source text. The architect should correct R2's sentence so ARCH does not repeat it.
- **The one real fail-open is how the comparison is written.** `IF current_query() <> canonical THEN RAISE` passes on NULL. It must be `IS DISTINCT FROM` (or `NOT coalesce(… = …, false)`). **Blocking at build check: I will read every `enter_*` body for this.** A client statement never has a NULL `debug_query_string`, so a test cannot reach the NULL case. Code reading is the check.
- **Pipelining.** Each Execute reports its own portal's text, so a pipelined batch is checked per statement. node-postgres does not pipeline anyway.
- **pgbouncer or Neon in transaction mode.** The backend sees the same Parse text, so the check is unchanged. Unnamed statements are fine.
- **Drizzle.** Not on the path: each wrapper's setup and `new-user.ts` call `client.query` with literal canonical text. **Build-check item:** the three caller strings must match R2's canonical texts byte for byte (`($1, $2)` with one space).
  - A drizzle template `sql\`SELECT app.enter_asserted_user(${a}, ${b})\`` would render the canonical text and pass. That is a code bug, not an injection, and the reserved-literal lint already confines the definer names to `context.ts`.
- **Sign-in and sign-up.** No break. BetterAuth never calls a definer. `enter_new_user` is sent by `enterNewUserOn` on the request's own client, as one statement. A trailing newline or a changed space only refuses, which is fail-closed and caught by the existing sign-up tests.

**Recommendation to the Principal: keep it.** For about a quarter of a loop-day, no SQL-injection bug on any path can name a user to Postgres directly. The remaining injection route is a visible account takeover until stage 2. Dropping it saves the test churn and nothing else.

### D2 — S1, S2 and S6 against the re-issue

| Finding | Status @ 60bfbb6e | Still required |
|---|---|---|
| S1 one-statement exits | **Covered.** `max_prepared_transactions = 0` asserted in `07` (that is what refuses `PREPARE TRANSACTION`); TEMP absence asserted; the `COMMIT; BEGIN` string is in (i). | My `DO $$BEGIN COMMIT; END$$`-inside-`withTenant` test drops to **(N)**. With the exact-call check, a transaction ended early cannot be marked again, and later statements read null. |
| S2 exact grantee sets | **Mostly covered:** the `tx_identity` ACL names PUBLIC, poly_operator and poly_backup; the four definers have exact EXECUTE sets. | **(B), one line in `07`:** exact EXECUTE sets for `app.current_session_id()` (poly_app alone) and `app.job_targets(text)` (nobody but its owner), PUBLIC absent. J1's "poly_worker's grant gone" does not catch a grant to poly_app, which would tell web which users link which connections. |
| S6 check the xid before COMMIT | Not adopted. | **Withdrawn.** With the exact-call check, an early `COMMIT` leaves the rest of `fn` unmarked, reading null and refused on writes, and nothing can mark it again. |

### Other points in the delta

- **R9's SECURITY phrases: accepted as written.** I will use them verbatim. Any substitution will be listed here first.
- **R1's `job_targets` revoke (my note 14 rejected):** agreed. The architect's reason is the better one.
- **Live-session check rejected:** agreed; stage 2's `enter_session` makes the real check.
- **Still open from §1:** S3 (ARCH phrase in R9: covered), S4 (identity half closed by D1; revoking plpgsql still removes `DO` for other multi-transaction mischief: (N), optional), S5 (the architect's).

## 3. Delta review — `ruling.md` 60bfbb6e → 4d50ce17

**Verdict: cleared for tests-red.** Nothing in this delta blocks. S1, S2 and S6 are covered by tests in R8 that fail if their holes open. The build-check item for the exact-call comparison (`IS DISTINCT FROM` in every `enter_*` body) stands for job 2.

### E1 — the `query_to_xml` family against the exact-call check

**(1) Sufficient: yes.** The family matters only if a fragment can plant a marker inside the same statement. Every way to write a marker is one of the three `enter_*` definers; INSERT is poly_authz's alone. Every definer refuses before any write unless `current_query()` is its own canonical text. A statement that also calls `query_to_xml` (or anything else) is never that text, so the definer refuses, no marker exists, and the fresh snapshot reads null. The check works on the definer, not on what the statement does, so it covers the whole family without naming it.

**Is it tested?** Indirectly, yes. The R8 exact-call row sends `SELECT app.enter_asserted_user($1, $2), 1`, which is the same refusal. That test fails if the check is removed or weakened to a prefix match. Optional, **(N)**: one more row in `identity-marker`. In an *unmarked* poly_app transaction, send `SELECT app.enter_asserted_user($1, $2), pg_catalog.query_to_xml('SELECT count(*) FROM public.entity', false, false, '')` with a seeded owner's id. Expect `42501` and no marker. This pins the ruling's attack exactly and costs a few lines.

**(2) Revoke EXECUTE on the family from PUBLIC: an option for the Principal, (N).**
- **What it adds after the exact-call check:** defence in depth only. It removes the one primitive that defeats the snapshot reasoning, in case a future definer ever writes identity-bearing state and forgets the check. Today nothing else plants a marker.
- **The family is wider than three.** Every built-in that runs a caller-supplied SQL string through SPI belongs in it:
  - `query_to_xml`, `query_to_xmlschema`, `query_to_xml_and_xmlschema`;
  - `table_to_xml*`, `cursor_to_xml*`, `schema_to_xml*`, `database_to_xml*`;
  - `ts_stat(text)`, `ts_stat(text, text)` and `ts_rewrite(tsquery, text)`, which also execute a query string (unmeasured; read from Postgres's documented signatures).
  
  If it is done, the catalog test should list every `pg_catalog` function whose name matches those patterns and assert PUBLIC absent.
- **Cost:** about 0.1 loop-day: two REVOKE lines in `roles.sql` beside R10 (superuser, per database, idempotent), and one `07` assertion. pg_dump keeps changed ACLs on `pg_catalog` functions (`pg_init_privs`, since 9.6), so a restore keeps the revoke (unmeasured). A grep finds no use of these functions in our code, BetterAuth, drizzle or kysely; the builder confirms with the same grep as R10.
- **My recommendation:** take it, with R10, in this loop. It is cheap, it is the same kind of change as R10, and the Principal puts security first. It is not required; the exact-call check already closes the attack.

### E2 — R10's test design

**(3) Sound.** `CREATE FUNCTION` checks CREATE on the target schema before USAGE on the language. A role with no schema would get the schema error and prove nothing about the language. Granting CREATE on a throwaway `qa_lang` inside a rolled-back superuser transaction makes the language check the one that answers. `DO` checks only the language, so it needs no schema.
- The exact `lanacl` set (eight roles, PUBLIC absent) already catches poly_backup and poly_migrator regaining USAGE. Extending the `DO` assertion to them is optional.
- `laninline <> 0 AND lanname <> 'plpgsql'` = 0 rightly guards against a second inline language (for example `plperl`) arriving later with PUBLIC USAGE.
- `poly_migrator` → `SET ROLE poly_owner` → `DO` still works. That is accepted: the migrator is the deploy credential and can already do everything as poly_owner.

### E3 — S1, S2, S6

| Finding | Status @ 4d50ce17 |
|---|---|
| S1 | **Covered.** The PREPARE, `DO … COMMIT` and `max_prepared_transactions` rows are in R8, each with a red-if. The PREPARE test asserts the right outcome: a failed `PREPARE TRANSACTION` becomes a rollback, later reads are null, and `withTenant` rejects. |
| S2 / D2 | **Covered.** The R8 row "R2 signatures and EXECUTE" gives exact `aclexplode` sets, PUBLIC included, for the four definers, `current_session_id` {poly_app} and `job_targets` {}. `definers.json` follows. |
| S6 | **Covered (kept by the lead).** The commit check needs no definer call, so it cannot trip the exact-call check. Its test (`COMMIT` via `tx.execute`, then an INSERT refused by RLS, then `IdentityMarkerLost`) fails if the check is removed. Build-check item: the TS comparison must treat a null `x` as a mismatch, as R3 says. |

### E4 — other points in the delta

- **R2 now states `current_query()` as `debug_query_string`,** and R9 bars `track_activities` from ARCH. Correct.
- **The R7 case L (2,000 rows) answers S5.** Closed on my side.
- **The `global-setup.ts` psql ≥ 16 check** fails loudly rather than skipping. Good.
