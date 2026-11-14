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
