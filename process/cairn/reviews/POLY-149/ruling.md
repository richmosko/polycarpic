# POLY-149 — Stage 2 revocation and docs: ruling (architect)

**Basis.**
- Branch `feature/poly-149-stage-2-revocation-and-docs` @ 8aa8275e. better-auth and @better-auth/passkey 1.7.18; no pin changes.
- POLY-149's criteria and comments; POLY-153's ruling (R4, R7.4, R11) and verdict (N1, F3); POLY-152's ruling (R2, R8, R9) and seceng's review §4, §5.4 (F2), §8, §9; `process/cairn/reviews/POLY-145/pricing.md` §1 block D; `process/DECISIONS.md` 2026-11-16 (×2), 2026-11-17 (lock, record) and 2026-11-19.
- The tree as read today: migrations 0000–0015, `packages/db/sql/{roles.sql,definers.json}`, `packages/db/src/{context,session,index,auth}.ts`, `packages/auth/src/{session,routing-pool,handler}.ts`, `tests/db/helpers/{second-step,marker,tenancy}.ts`, `packages/tenancy/permission-matrix.json`, and better-auth 1.7.18's `plugins/two-factor/verify-two-factor.mjs:119-205` (`assertTwoFactorNotLocked`, `recordTwoFactorFailure`, `resetTwoFactorFailures`).
- seceng-149's pre-review checklist (`seceng-149/temp/2026-11-19-seceng-149-prep.md`, §A) and the lead's four must-settle points. This file replaces the ruling at `b31be909` whole.
- Criteria are named by block: **V** revocation, **L** growing lock, **S** sign-in record, **D** docs. N1 and F1 are the 2026-11-19 comment.

**Tags.** "(code-read)" means read, not run. "(unmeasured)" means qa's red test measures it first. Nothing below drops a control on an unmeasured claim; a red test that contradicts one reopens this ruling, re-issued whole.

## R0. What this loop is

The last PR of stage 2. It adds the two deploy-gate controls (the growing lock, the sign-in record), fixes N1, then revokes poly_app's reach into BetterAuth's tables and deletes the asserted-user entry. After it merges the deploy gate (DECISIONS 2026-11-16) lifts, subject to INFRA §7.1 step 16 passing.

## R1. The revocation (V)

**poly_app loses**, in `0017_revocation`:
- every privilege on `public."user"`, `public.session`, `public.account`, `public.verification`, `public.two_factor`, `public.passkey`: one `REVOKE ALL ON … FROM poly_app` (which also revokes the column grants from 0001 and 0005);
- `SELECT (id, purpose, created_at, expires_at, attempts, used_at)` on `app.email_challenge`, and the policy `email_challenge_own`, which names only poly_app. **Beyond the criterion:** web has no reader of it (code-read: the only callers are `packages/auth/src/anchor.ts`, through definers). The permission-matrix entry changes to "no login role holds any privilege".
- EXECUTE on `app.enter_asserted_user(uuid, uuid)`, by **dropping the function** (as poly_authz, its owner). A grant can then never bring it back.

**What goes with `enter_asserted_user`:**
- `app.tx_identity`'s kind CHECK becomes `kind IN ('signup', 'auth', 'session') OR kind LIKE 'system:%'`. The migration first deletes every `web` marker, so the new CHECK can be added; markers are transaction-scoped and nothing is deployed.
- `app.audit_membership()` loses its `web` branch.
- `packages/db`: `withTenant`, the `'withTenant'` kind, `src/session.ts` (`SessionUserId`, `sessionUserId`) and the `@poly/db/session` subpath are deleted. `layers.json` loses the `enter_asserted_user` reserved literal and the `db/session` layer. The eslint rules and fixtures that exist only for those names (fixture dirs 12, 13, 31, the session-cast cases in 14, and the `withTenant`/`sessionUserId` cases in 35) go. `tests/layers/tsc/db-index.ts` asserts that `@poly/db` exports neither name.
- `loadSession` already left web and `packages/auth` in POLY-153 (verdict C6). This loop removes the remaining comment references in `packages/auth/src/{session,routing-pool}.ts` and `packages/db/src/auth.ts`. A grep test pins `withTenant`, `enter_asserted_user`, `sessionUserId` and `loadSession` absent from `apps/`, `packages/` (migrations 0011, 0014 and 0017 excepted) and `tests/` (this loop's absence tests excepted).
- **The R7.4 e2e harness revoke goes**: `apps/web/tests/e2e/revoke-target.ts`, its lines in `serve.ts`, and `tests/ci/e2e-revoke-scope.test.ts`. The migrated chain now carries the revocation, so the e2e suite runs on the real schema.

**poly_app's complete EXECUTE set on `app` functions after 0017** (seceng F2), effective and granted:

| Function | Why web needs it |
|---|---|
| `app.current_user_id()`, `app.current_session_id()` | RLS policies and the marker readers |
| `app.has_role(uuid, text)`, `app.visible_entities()`, `app.owner_count(uuid)` | tenant RLS policies (invoker) |
| `app.second_step_required()` | the sign-in gate |
| `app.enter_session(text)` | the only entry |
| `app.my_sessions()`, `app.recent_auth_ok()`, `app.revoke_my_session(uuid)` | Settings → Sessions, step-up |

Ten functions, nothing else in `app` (code-read from the grants in 0001–0015; that nothing reaches poly_app through PUBLIC is (unmeasured) and the effective half of the test measures it).

**poly_app's table privileges after 0017** are its tenant grants from 0003, 0007 and 0009 and `SELECT` on `app.tx_identity`, unchanged.

**Tests (V):**
- pgTAP `11_poly_app_grants.sql`: poly_app's privileges compared with the lists above, both ways (a missing or an extra one fails), read twice as pgTAP 08 does: granted (`role_table_grants`, `role_column_grants`, `routine_privileges`, `pg_policies.roles`, `pg_auth_members`) and effective (`has_table_privilege`, `has_column_privilege`, `has_sequence_privilege`, `has_function_privilege` over every relation, sequence and function in `public`, `app`, `drizzle`). Plants, each shown to fail it: `GRANT SELECT ON public.session TO poly_app`; `GRANT EXECUTE ON FUNCTION app.enter_auth_session(text) TO poly_app`; a new function in `app` created by poly_owner with `GRANT EXECUTE … TO PUBLIC`.
- `enter_asserted_user` does not exist (`to_regprocedure` is NULL); an insert of a `web` marker as poly_authz fails the CHECK.
- Behaviour, as poly_app: `SELECT token FROM public.session`, an INSERT into `public.verification`, an UPDATE of `public.two_factor` each give 42501 and change nothing.
- **A build that finds a list short does not add the grant**: it reports the failing statement to me and the ruling is re-issued whole (POLY-152 R2's rule). The measurement that web needs nothing else exists: POLY-153's e2e ran 57/0/0 under the R7.4 harness revoke of the same grants (`process/cairn/reviews/POLY-153/gate.md`). It is repeated here on the migrated chain with no harness revoke.

**Test fixtures that ran as poly_app.**
- Every `tests/db` caller of `withTenant` or `enter_asserted_user` (about 70 call sites in 20 files, `tests/db/helpers/{marker,tenancy,matrix,cross-tenant,second-step}.ts` central; code-read count) enters by `app.enter_session` with a handle from POLY-153's `sessionWithHandle`. `identity-marker.test.ts`'s asserted-user cases are replaced by the absence test above; pgTAP 07's `enter_asserted_user` rows go.
- `tests/db/helpers/second-step.ts`: `ROLES` becomes `['poly_auth']`. The poly_app refusal half is replaced by the catalog pin (poly_app holds nothing on the factor tables).
- **The poly_auth fixture is already the real role** (POLY-152 R8; `second-step.ts:21`). pgTAP 08's N2 plant (`GRANT poly_app TO poly_auth`) pins that it stays so. Nothing to build; the criterion is met by the pin.
- **How qa finds a test that no longer tests anything:** every test that writes a BetterAuth table through a poly_app pool now fails 42501 at the red run. Each one either moves to poly_auth or becomes a refusal that also asserts the row is unchanged. None is kept passing as poly_app.
- The test harness must not truncate `app.sign_in_record` between tests (R3 refuses it); qa checks `template-clone` resets by clone, not by TRUNCATE.

## R2. The growing second-step lock (L)

**What BetterAuth 1.7.18 writes** (code-read, `verify-two-factor.mjs`), all on `public.two_factor`, as poly_auth in R9's sign-in transaction:
- **check:** if `locked_until > Date.now()` (Node's clock) refuse `ACCOUNT_TEMPORARILY_LOCKED`; else **lazy clear**: `SET failed_verification_count = 0, locked_until = NULL WHERE id = $1 AND locked_until <= $now`;
- **failure:** `SET failed_verification_count = failed_verification_count + 1`; at ≥ 10, **lock**: `SET locked_until = $now + 900 s WHERE id = $1 AND failed_verification_count >= 10`;
- **success:** `SET failed_verification_count = 0, locked_until = NULL WHERE id = $1`, unconditional.

**State.** `app.second_step_streak (user_id uuid PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE, locks integer NOT NULL DEFAULT 0 CHECK (locks >= 0), updated_at timestamptz NOT NULL DEFAULT now())`.
- Owner poly_owner. RLS enabled and forced; `REVOKE ALL … FROM PUBLIC`. **poly_govern only**: SELECT, INSERT, UPDATE, DELETE, with policies `second_step_streak_govern FOR ALL TO poly_govern USING (true) WITH CHECK (true)`. **No login role holds any privilege on it.** `BEFORE TRUNCATE … app.refuse_truncate()`.
- **Keyed by user, not by `two_factor.id`.** poly_auth holds DELETE and INSERT on `two_factor` (0014:17), so a per-row count would reset on delete and re-insert. A user has one TOTP row, which carries the backup codes too, so one streak counts both paths. Disabling and re-enrolling TOTP does not reset it.
- **The cascade from `user` is safe:** no login role holds DELETE on `public."user"` (code-read, 0000–0015: no DELETE grant on it to anyone but the owner). pgTAP 12 pins that, so a later grant fails CI before deleting a user can become a way to reset the doubling.
- In the database, so a restart of `auth` leaves it unchanged.

**The guard.** `app.guard_second_step_lock()`, owner poly_govern, SECURITY DEFINER, `SET search_path = ''`, EXECUTE for no login role. Trigger `two_factor_15_lock BEFORE UPDATE OF failed_verification_count, locked_until ON public.two_factor FOR EACH ROW`. It fires after `two_factor_10_guard` (name order), which already limits an unmarked write to a verified row's counters and codes. **No role is exempt**, superuser included. With `t = clock_timestamp()` (not `now()`: the transaction began before BetterAuth read Node's clock, and on one host `clock_timestamp()` is never behind it), in this order:
1. **Lock in force** (`OLD.locked_until > t`): if `NEW.locked_until IS DISTINCT FROM OLD.locked_until`, or `NEW.failed_verification_count < OLD.failed_verification_count` → 42501 `second_step_locked`. Nothing shortens, clears, extends or replaces a lock while it runs, and nothing lowers its count. BetterAuth never writes during a lock except in a race (two wrong codes read the row before either locks it); the loser's request then fails with 500 and rolls back, so it fails closed.
2. **Lazy clear** (`OLD.locked_until IS NOT NULL`, `NEW.locked_until IS NULL`): allowed. The streak is unchanged.
3. **A new lock** (`NEW.locked_until IS NOT NULL` and distinct from OLD): `n := locks` for the user (row locked `FOR UPDATE`, 0 if absent); `len := least(15 * 2^least(n, 7), 1440)` minutes; **`NEW.locked_until := t + len`**, whatever BetterAuth sent; upsert `locks = n + 1`; append a `second_step_lock` record row with `lock_minutes = len` (R3). So locks run 15, 30, 60, 120, 240, 480, 960, then 1440 for every later one.
4. **The correct-code reset** (`OLD.locked_until IS NULL`, `NEW.locked_until IS NULL`, `NEW.failed_verification_count = 0`, and the statement listed one of the two columns, which the `UPDATE OF` trigger guarantees): set `locks = 0`. This is the shape of `resetTwoFactorFailures` only: the lazy clear always has a non-NULL `OLD.locked_until`, and a failure never writes 0.
5. **A counted failure** (`NEW.failed_verification_count > coalesce(OLD.failed_verification_count, 0)`): append one `second_step_failure` record row (R3).
- Steps 3–5 can combine in one row update only if a caller sends them together; BetterAuth never does. Each applies on its own.
- That no other BetterAuth write on any path (enrolment, first verify, disable, backup-code regeneration, password reset, passkey) lists either column with 0 and NULL on an unlocked row is (unmeasured). qa runs every R5 path of POLY-153 and the enrolment routes with statement logging and fails on any such statement outside a correct code.

**Deleting the factor during a lock.** A second trigger, `two_factor_16_lock_delete BEFORE DELETE ON public.two_factor FOR EACH ROW`, runs `app.guard_second_step_lock_delete()`: owner poly_govern, an **invoker** (so `current_user` is the deleting role), EXECUTE for no login role. If `OLD.locked_until > clock_timestamp()` and `current_user <> 'poly_govern'` → 42501 `second_step_locked`. So poly_auth cannot delete a locked row and re-insert a fresh one, and only `reset-mfa` removes a locked factor. The cost: the real user cannot disable TOTP while it is locked; they wait for the lock or ask for `reset-mfa`. A cascade from deleting the user during a lock is refused as well; no login role can delete a user (above).

**`reset-mfa`.** It runs as poly_operator, through `app.reset_second_step(text)`, a poly_govern definer, and it is the only path that clears the doubling. `app.reset_second_step(text)` (poly_govern, CREATE OR REPLACE) also `DELETE`s the user's streak row. It already deletes the `two_factor` row, so the guard is not involved; it works on a locked user.

**The correct-code reset is the sign-in service's word, stated for SECURITY.** The database cannot check a TOTP or backup code: the secret is encrypted with the auth secret. It recognises the reset only by the shape of BetterAuth's write. **So SQL as poly_auth can reset the doubling whenever no lock is in force**, by sending that shape. What limits it:
- during a lock it can neither shorten, clear nor lower the lock (step 1), nor delete the factor row (the delete guard);
- the streak survives deleting and re-enrolling the factor (keyed by user);
- it gains nothing over what it already holds: the same SQL can insert a session for the user outright, and R3 records that;
- the lazy clear at a lapse never resets the doubling (step 2).
The guard's real targets are a BetterAuth upgrade or bug that shortens or clears a lock, a lock in force, and anyone working through the web pages. A superuser can bypass the guard with `session_replication_role = replica`, which is the database-server control the Principal already accepted as out of reach.

**No clock a role can change.** The guard reads only `clock_timestamp()`; no function in the chain reads a clock from a setting or a table. pgTAP 12 pins it: no function in `app` calls `current_setting` except for the names `app.actor`, `poly.client_ip` and `poly.user_agent`, and no function in `app` calls `set_config`, `set_config` being what a clock override would need. A plant (a function reading `current_setting('app.now')`) fails it. The two `poly.*` settings carry an address and a browser string only (R3), never a time.

**The clock in tests.** Postgres' clock cannot be faked, so "a fake clock" means row facts moved by a superuser helper, as `auth-refresh.test.ts` does. `lapseLock(userId)` in `tests/db/helpers/second-step.ts`, as superuser, in its own transaction with `SET LOCAL session_replication_role = replica`: `UPDATE public.two_factor SET locked_until = clock_timestamp() - interval '1 second'`. Node's `Date` is not faked for lock tests. The existing direct lapse at `auth-signin-tx.test.ts:156` and the unmarked lock write at `second-step-gates.test.ts:399` change to the helper and to the guard's lengths.

**Tests (L), on both the TOTP path and the backup-code path, through `handleAuthRequest` as poly_auth:**
- 8 consecutive locks, each reached by 10 counted wrong codes across holds: `locked_until - clock_timestamp()` is 15, 30, 60, 120, 240, 480, 960, 1440 minutes ±1, then a 9th is 1440.
- After a correct code, the next lock is 15 minutes. After a lapse, a passkey sign-in, a password reset, or a new session by email or magic link, the next lock continues the doubling.
- At each lock length, the right code is refused and no `session` row is created.
- A restart between two locks: a fresh `createAuth` and pool, then the next lock is the doubled one.
- BetterAuth's own 900 s write loses: the 2nd lock is 30 minutes, not 15.
- As poly_auth during a lock: `UPDATE two_factor SET locked_until = NULL`, `SET locked_until = now()`, `SET failed_verification_count = 0`, the lazy-clear statement, and `DELETE FROM two_factor` each → 42501, and **the row is read back unchanged** (42501 alone is not proof, POLY-152 review §5.2). Any statement on `app.second_step_streak` as each login role → permission denied.
- A passkey sign-in passes during a lock; `polycarpic cli user reset-mfa` works on a locked user and deletes the streak row.
- pgTAP `12_sign_in_controls.sql`: no login role holds any privilege on the streak table (granted and effective); `two_factor_15_lock` exists, `tgenabled = 'O'`, fires BEFORE UPDATE OF the two columns; its function is owned by poly_govern and executable by no login role. Plants: the trigger dropped; disabled; a grant of UPDATE on the streak to poly_auth; `two_factor_16_lock_delete` dropped; `GRANT DELETE ON public."user" TO poly_auth`.
- Each red against the chain at 8aa8275e.

## R3. The sign-in record (S, F1)

**Table.** `app.sign_in_record`:
```
id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
kind          text NOT NULL CHECK (kind IN ('session', 'second_step_failure', 'second_step_lock')),
user_id       uuid NOT NULL,             -- no FK: a row outlives its account until the purge
session_id    uuid,                      -- set for kind 'session' only; no FK
created_at    timestamptz NOT NULL DEFAULT now(),
ip_address    text,
user_agent    text,
lock_minutes  integer CHECK ((kind = 'second_step_lock') = (lock_minutes IS NOT NULL)),
CHECK ((kind = 'session') = (session_id IS NOT NULL))
```
- Index on `(user_id, created_at)` and on `(created_at)`.
- Owner poly_owner; RLS enabled and forced; `REVOKE ALL … FROM PUBLIC`.
- Grants: **poly_govern** INSERT with policy `sign_in_record_append FOR INSERT TO poly_govern WITH CHECK (true)`; **poly_purge** SELECT `(user_id, created_at)` and DELETE, with policies `sign_in_record_purge_read FOR SELECT TO poly_purge USING (true)` and `sign_in_record_purge FOR DELETE TO poly_purge USING (true)`. poly_purge also gains SELECT `(id)` on `public."user"`.
- **No login role holds any privilege on it**: not poly_app, poly_auth, poly_worker, poly_operator, poly_migrator.
- **No FK to `user`, so no cascade.** Deleting a user leaves its rows until the purge removes them; deleting a user can never erase the record. poly_backup reads it through `pg_read_all_data`, as it reads every table; see Decision 1.

**Written by the database, from NEW only.**
- `app.record_session_sign_in()`, owner poly_govern, SECURITY DEFINER, `SET search_path = ''`, EXECUTE for no login role. Trigger `session_80_sign_in_record AFTER INSERT ON public.session FOR EACH ROW`. It inserts `('session', NEW.user_id, NEW.id, now(), NEW.ip_address, left(NEW.user_agent, 512))`. No caller passes a value, and `created_at` is the database clock, not BetterAuth's `NEW.created_at`.
- It covers every path that inserts a session: sign-in, sign-up, the four rotations, and a held sign-in's temporary session (which then shows that the first step passed). A rolled-back insert leaves no row.
- **Why on `public.session` and not on `app.session_handle` (F1):** both are database-written. The session trigger sees every session, including a hold's, which never gets a handle; and the handle's deferred check already forces every committed session to have one. So nothing escapes.
- The second-step rows come from R2's guard (same owner): `('second_step_failure' | 'second_step_lock', NEW.user_id, NULL, now(), <address>, <browser>, lock_minutes)`.

**The address on second-step rows.** The `two_factor` row has none and the hold's session is gone. The service sets it: `withSignInTx`, `withAuthSession` and `withContextFreeTx` take `{ ip, userAgent }` from `handleAuthRequest` (the address it already resolves for `requireClientIp`) and send, as their first statement, `SELECT pg_catalog.set_config('poly.client_ip', $1, true), pg_catalog.set_config('poly.user_agent', $2, true)`. It is not a write, so `enter_auth_session`'s first-write check is unaffected. The guard reads both with `current_setting(…, true)`, keeps the address only if it casts to `inet`, and cuts the browser to 512 characters. **The address and browser are the service's word on every row**, as `session.ip_address` already is BetterAuth's. What the database guarantees is that the row exists, its kind, its user, its time and its lock length.

**Append-only.**
- `app.sign_in_record_immutable()`, owner poly_owner, an invoker (so `current_user` is the deleting role). Trigger `sign_in_record_10_immutable BEFORE UPDATE OR DELETE … FOR EACH ROW`. UPDATE always raises 42501. DELETE raises 42501 unless `current_user = 'poly_purge'` and the row is purgeable (`created_at < now() - interval '400 days'`, or no `public."user"` row has its `user_id`). It binds the owner and superuser too.
- `sign_in_record_no_truncate BEFORE TRUNCATE … app.refuse_truncate()`.
- poly_owner (and so poly_migrator by SET ROLE) can still drop the triggers: schema changes are the migration's authority, as on every table.

**Purge.** `app.purge_sign_in_record() RETURNS integer`, owner poly_purge, SECURITY DEFINER, `SET search_path = ''`, EXECUTE poly_worker only, no argument. It deletes exactly the purgeable rows above and returns the count. It is the only delete path. **No job calls it yet**, and none calls `purge_tx_identity` either (code-read: no caller in `apps/`). The scheduled run for both is a follow-up (Bubble-up 2); 400 days gives it time.

**Typed codes never stored.** No column takes anything from the request body: session rows take only `NEW`, the second-step rows only `NEW.user_id` and the two settings.

**Tests (S):**
- As poly_auth: insert a session (with its handle), delete it, commit → one `session` row remains with the session's id, address and browser and a `created_at` within 5 s of `now()`. A rolled-back insert leaves none. Each of POLY-153's 13 paths adds exactly one row per session it inserts.
- Each login role (poly_app, poly_auth, poly_worker, poly_operator, poly_migrator, poly_backup): no INSERT, UPDATE, DELETE or TRUNCATE on the record, granted and effective, both ways; the five runtime roles (poly_app, poly_auth, poly_worker, poly_operator, poly_migrator) have no SELECT either, effective, with a plant (`GRANT SELECT ON app.sign_in_record TO poly_worker`) shown to fail it.
- As the owner and as superuser: UPDATE and a DELETE of a fresh row → 42501; TRUNCATE → refused.
- Purge, as poly_worker: rows planted by superuser at 401 days and a deleted user's rows go; a 399-day row and a live user's row stay. `SET ROLE poly_purge` then a DELETE of a fresh row → 42501.
- Each counted wrong code (TOTP and backup code) adds one `second_step_failure` row with the settings' address and browser; each lock one `second_step_lock` row with R2's length. No cookie, a dead hold's 6th try, and an unknown hold add none.
- A test types a known 6-digit code and a known backup code, then scans every column of every row for both: no match.
- pgTAP `12_sign_in_controls.sql`: the table, its RLS, the two triggers enabled, `session_80_sign_in_record` enabled AFTER INSERT on `public.session`, the function owners and their EXECUTE lists. Plants: the session trigger dropped; disabled; `GRANT DELETE ON app.sign_in_record TO poly_auth`.
- The permission matrix gains both tables as "no login role holds any privilege".

## R4. N1: the slide writes only when the expiry moves forward

`app.enter_session` (poly_authz, CREATE OR REPLACE in 0016; grants kept): inside the existing `IF v_expires <= now() + interval '6 days'`, compute `v_new := least(now() + interval '7 days', v_created + interval '30 days')` and run the UPDATE, then set `v_expires := v_new`, **only if `v_new > v_expires`**. **Test:** a session whose `expires_at = created_at + 30 days` and is within 6 days of it: two `enter_session` calls leave `xmin` and `updated_at` unchanged. A slide below the cap still writes.

## R5. INFRA §7.1 step 16: the objects to check

The deploy-gate check (devops, in this loop) exits non-zero and prints each failing line unless every line holds on the target database. Each line is shown to fail by a plant on a scratch database; a check that prints a count and exits 0 does not gate.

| Object | Must be |
|---|---|
| `app.second_step_streak`, `app.sign_in_record` | exist, RLS enabled and forced |
| triggers `two_factor_15_lock` and `two_factor_16_lock_delete` on `public.two_factor`, `session_80_sign_in_record` on `public.session`, `sign_in_record_05_refuse`, `sign_in_record_10_immutable` and `sign_in_record_no_truncate` on `app.sign_in_record` | exist, `tgenabled = 'O'` |
| `app.guard_second_step_lock()`, `app.record_session_sign_in()` | owner poly_govern, SECURITY DEFINER, no login role can execute |
| `app.purge_sign_in_record()` | owner poly_purge, executable by poly_worker only |
| both tables | no login role has INSERT, UPDATE, DELETE or TRUNCATE (`has_table_privilege`, effective) |
| `app.sign_in_record` | poly_app, poly_auth, poly_worker, poly_operator and poly_migrator have no SELECT (`has_table_privilege`, effective). poly_backup's read through `pg_read_all_data` is the one exception, pending Decision 1 |
| `app.enter_asserted_user` | absent |
| poly_app | no privilege on the six BetterAuth tables, `app.session_handle`, `app.sign_in_record` or `app.second_step_streak` (effective); its EXECUTE set on `app` is exactly R1's ten |
| `public."user"` | no login role has DELETE (effective) |

## R6. Migration order

1. **`0016_sign_in_controls`** (custom), as poly_owner:
   1. `app.sign_in_record`, its indexes, RLS, policies and grants; poly_purge's `SELECT (id)` on `public."user"`;
   2. `app.sign_in_record_immutable()` and the two record triggers;
   3. `app.second_step_streak`, RLS, policies, grants, its truncate trigger;
   4. `SET ROLE poly_govern`: `record_session_sign_in`, `guard_second_step_lock`, `guard_second_step_lock_delete`, `reset_second_step` (replaced). REVOKE FROM PUBLIC; a temporary EXECUTE to poly_owner on the three trigger functions for CREATE TRIGGER (as 0015 did);
   5. `SET ROLE poly_purge`: `purge_sign_in_record`, EXECUTE poly_worker;
   6. `SET ROLE poly_authz`: `enter_session` (R4);
   7. `SET ROLE poly_owner`: triggers `session_80_sign_in_record`, `two_factor_15_lock` and `two_factor_16_lock_delete`; revoke the temporary EXECUTEs.
2. **`0017_revocation`** (custom), as poly_owner: the REVOKEs and the policy drop (R1); `SET ROLE poly_authz`: `DROP FUNCTION app.enter_asserted_user(uuid, uuid)`; `SET ROLE poly_owner`: delete `web` markers, the kind CHECK; `SET ROLE poly_govern`: `audit_membership`; ends on poly_owner.
3. `definers.json`: adds `record_session_sign_in`, `guard_second_step_lock`, `purge_sign_in_record` (the two invokers are pinned in pgTAP 12 instead, Addendum 1); drops `enter_asserted_user`.
4. Nothing is deployed, so no data moves. Two files so the controls stand alone if the loop is cut (R9).
5. R9 of POLY-152 (what a refused code commits) now also commits trigger writes to `app.sign_in_record` and `app.second_step_streak`. The statement-log test is unaffected: those writes are not statements the service sends.

## R7. Running cost (D)

devops measures the `auth` process's RSS (`ps -o rss`, once a second): idle for 60 s after `/api/auth/ok`, and the peak during the e2e suite, which runs against it. Recorded in ARCH §7.3 as two numbers with the date and the image digest.

## R8. Docs (D)

At the verdict: ARCH §2.2, §3.1, §3.1c, §3.3, §7 (architect). SECURITY R-2 (to its residual, never retired; the backup-code item removed; names the sign-in service's write access to factor rows and R2's reset limit), T-18, A-31, A-39, C-84 and the secrets table (seceng). INFRA §2.2, §7.1 step 16, §7.5 (devops). Current state only.

## R9. One PR or two

| Part | Contents | Cost (guess) |
|---|---|---|
| A: controls | R2, R3, R4, R5's check, 0016 | $18–25, 2.5–3.5 h |
| B: revocation | R1, 0017, ~70 fixture call sites, lint and layers cleanup | $14–20, 2–3 h |
| C: docs and cost | R7, R8 | $6–10, 1–1.5 h |
| Loop overhead | ruling, two reviews, gate runs, verdict | $8–10, 1.5 h |
| **One PR** | A + B + C + one overhead | **$46–65, 7–9.5 h** |
| **Split** (A; then B + C) | two overheads | **$54–75, 8.5–11 h** |

All guesses, scaled from POLY-153 ($27, about 3.5 h, one new mechanism); this loop has two new mechanisms and a wide fixture change.

**Recommendation: one PR.** The deploy gate lifts only when all of it has merged, so splitting buys no earlier release; it costs one more overhead (about $8–10 and 1.5 h) and a second docs pass. The migrations are already two files, so if the red run shows B's fixture change is larger than guessed, the lead can cut B into its own loop at the build without re-ruling.

## Decisions for the lead (the Principal's where marked)

1. **(Principal, recommend a)** The criterion says no login role reads the record. poly_backup reads every table through `pg_read_all_data`, this one included. (a) Accept: the backup must hold the record, or a restore loses it, and a backup reader already holds every session and factor row. Cost nil. (b) Replace `pg_read_all_data` with per-table grants that skip the record: the backup then cannot restore it. About $5, 45 min (guess), and the record no longer survives a restore.
2. **(Principal, recommend a)** "Only a correct code resets the doubling" holds against anyone using the web pages; the sign-in service's own SQL can zero the streak whenever no lock is in force (R2, with what limits it). (a) Accept and state it in SECURITY: that SQL can already create a session for the user, and R3 records it. (b) Also require a new session for that user in the same transaction before a reset counts, so every reset leaves a record row. About $3, 20 min (guess), and it needs a measurement that every correct-code path creates a session; a path that does not would leave the doubling unreset after a correct code.
3. **(lead)** R1 also revokes poly_app's read of `app.email_challenge`, beyond the criterion. Web has no reader.
4. **(lead)** File a follow-up: schedule `purge_sign_in_record` and `purge_tx_identity` in the worker, logging each run's count (seceng A3.6). Neither has a caller.
5. **(lead)** POLY-89's guards keep treating `current_session_id()` as narrowing only. With kind `web` gone every marker's session comes from a live row, so a later issue may rely on it; not in this loop.

## Addendum 1 (qa's test plan at d3e72812, open points)

1. **T-L3: step 1 holds.** During a lock, `UPDATE two_factor SET failed_verification_count = 0` (or any lower count) as poly_auth → 42501 `second_step_locked`, and the row reads back unchanged: count, `locked_until`, and the streak. That is one outcome, and the test pins it. seceng's own checklist asked for the same refusal (prep §A2.3: "any lowering of `failed_verification_count`" during a lock), so this changes nothing seceng accepted at 3725d22e. Outside a lock a lower count is allowed, and only the step-4 shape (count 0, both `locked_until` NULL) resets the streak.
2. **`guard_second_step_lock_delete` is an invoker, so it leaves `definers.json`.** It must see the deleting role in `current_user` (poly_govern inside `reset_second_step`, poly_auth otherwise), and inside a definer `current_user` is always the owner. `definerGaps` lists `prosecdef` functions only, so listing it would fail with "on the allowlist, not in the catalog". R6.3 now adds three entries: `record_session_sign_in`, `guard_second_step_lock` and `purge_sign_in_record`. `sign_in_record_immutable` is an invoker for the same reason and was never listed. Instead, pgTAP 12 pins both invokers: owner poly_govern (delete guard) or poly_owner (immutable), `prosecdef = false`, search_path pinned to `''`, and no login role can execute them (granted and effective). This corrects a list; it does not change what seceng accepted.

## Addendum 2 (qa's red run at 3086301f, finding 3: entries on one session serialise)

**When it happens.** Only when `enter_session`'s slide runs its UPDATE, since that statement is the one that takes the session row's lock. The UPDATE runs only when `expires_at <= now() + 6 days`:
- on the chain at 8aa8275e: once a day per session (the first entry more than a day after the last slide), and on **every** entry in the last 6 days before the 30-day cap. That second case is N1;
- after R4 (N1): once a day per session, and never at the cap.

The red run's races hung because their fixture sessions were due a slide on every entry (code-read: an `expires_at` within 6 days). An entry that does not slide takes no row lock (`SELECT` only) and blocks nobody.

**What a page sees today, and after R4 alone.** On the one entry a day that slides, parallel requests on the same session (a page load and its `fetch`es) queue on the row lock until the first transaction commits. That costs each waiting request the length of the first transaction: milliseconds for a normal load, but a slow request (an export, a long report) holds the others for its whole duration. Then each waiter slides the row again, because it compares against the expiry it read before waiting. Nothing is refused, nothing is wrong, and no lock can deadlock (one row each).

**Changed in this loop (part of R4, same function, same migration).** The slide becomes non-blocking and writes at most once:
```
UPDATE public.session s SET expires_at = v_new, updated_at = pg_catalog.now()
 WHERE s.id = (SELECT s2.id FROM public.session s2
                WHERE s2.id = v_session AND s2.expires_at < v_new
                FOR UPDATE SKIP LOCKED);
```
- If another transaction is sliding the row, this one skips its slide and goes on. It returns the expiry it read, which is at most a day stale and is only shown.
- If that other transaction rolls back, the slide is lost until the next entry, which slides it then. A session can only end sooner than it would have, never later, so it fails closed.
- `s2.expires_at < v_new` in the locked row replaces R4's `v_new > v_expires` test, so the cap case (N1) still writes nothing.
- poly_authz already holds `UPDATE (expires_at, updated_at)`, which is enough for `FOR UPDATE` (code-read; the build measures it).

**Tests (qa):**
- Two transactions enter on one slide-due session. The second enters while the first is still open, and returns within `statement_timeout = 2s` instead of waiting. After both commit, `expires_at` has moved once.
- The N1 cap test as ruled.
- The two C-b race fixtures need no change once this lands. Until then, give each its own session, or set `expires_at = now() + 7 days` so no slide is due.

**seceng:** a short look is enough. This is a change to a definer's write, not to what it checks. The refusals, the marker and the cap are unchanged. The only new behaviour is that a slide can be skipped, which shortens a session and never lengthens it.

## Addendum 3 (the build at 002cda1f, backend-lead's three judgment calls)

1. **`sign_in_record_05_refuse` stays and is part of R3.** RLS is forced and no policy names poly_owner, so an UPDATE or DELETE by the owner sees no rows, and a row trigger never fires. R3's "refused for the owner" therefore needs a statement-level trigger. As built, `BEFORE UPDATE OR DELETE … FOR EACH STATEMENT`, with the same function branching on `TG_LEVEL`. It refuses every UPDATE statement, and every DELETE statement unless `current_user = 'poly_purge'`. The row trigger still checks that each purged row is purgeable. Two reasons it is the right layer:
   - It refuses the statement even when it would match nothing, so the refusal no longer depends on what RLS lets the owner see. A later policy that showed rows to the owner would not open a gap.
   - A superuser, who bypasses RLS, meets both triggers.
   
   R5's deploy-gate table now lists it (enabled `'O'`). pgTAP 12 pins it, with a plant that drops it. The test: as poly_owner (`SET ROLE`), `UPDATE app.sign_in_record SET kind = kind` and `DELETE FROM app.sign_in_record` each give 42501.
2. **Drop `poly/no-session-user-id-cast`, together with its pin in `relative-structure.test.ts`.** The brand type no longer exists, so the rule guards nothing, and R1 already rules that the rules existing only for those names go. A dead rule invites a later reader to think the brand still exists. Whoever edits the test (qa or backend-lead) removes both in one commit; the layers suite is the check.
3. **The fixture move to `36-reserved-literal` is accepted.** Dir 31 covered the other reserved literals too. Deleting only the three `enter_asserted` fixtures keeps that coverage. The ruling's "fixture dir 31 goes" meant its `enter_asserted_user` cases.

## Addendum 4 (seceng: role membership in the deploy gate; the address cap)

1. **R5 gains a role-membership row.** `has_*_privilege` sees only what a role can use without switching. A role granted `poly_govern` or `poly_owner` with `INHERIT FALSE, SET TRUE` passes every privilege line, yet it can `SET ROLE` to that role and drop the record's triggers or delete its rows. The deploy-gate check therefore compares `pg_auth_members` with this set, both ways. That covers every row whose member or granted role is a `poly_*` role, and every row whose member is a login role:

   | Member | Granted role | inherit / set / admin |
   |---|---|---|
   | poly_migrator | poly_owner, poly_authz, poly_purge, poly_rollup, poly_graph, poly_stake, poly_govern, poly_journal (8 rows) | false / true / false |
   | poly_backup | pg_read_all_data | as `roles.sql` grants it; admin false |

   Nothing else. No grant to poly_app, poly_auth, poly_worker or poly_operator of any role, `pg_*` predefined roles included, and no member of any `poly_*` role but poly_migrator. This is pgTAP 01's predicates (lines 43–56) plus the login-role half, so the check and pgTAP read one list. This section is that list; `roles.sql` is its source.
   - **Plants, each shown to fail it:** `GRANT poly_govern TO poly_auth WITH INHERIT FALSE, SET TRUE`; `GRANT pg_write_all_data TO poly_worker`; poly_migrator's grant of `poly_purge` re-made `WITH ADMIN TRUE`.
   - **Accepted, as R3 states:** poly_migrator itself can `SET ROLE poly_owner` and drop the triggers. Changing the schema is the migration's authority. It runs only in the migrate step, with a password the runtime services never mount.
2. **`sign_in_record_05_refuse` (seceng's acceptance).** The owner test asserts the error, not the row count. As poly_owner, `UPDATE app.sign_in_record SET kind = kind` and `DELETE FROM app.sign_in_record` each raise 42501. A result of `UPDATE 0` or `DELETE 0` fails the test. Addendum 3 already names this test; this makes the assertion exact.
3. **The address: one rule for every kind, the inet check.** `record_session_sign_in` treats `NEW.ip_address` as the guard treats `poly.client_ip`. It stores the value when `pg_catalog.pg_input_is_valid(v, 'inet')` (Postgres 16+; the chain runs 17), and otherwise stores NULL. The value is stored as given, which an inet is at most 45 characters for IPv6 without a zone. Both writers share one helper, `app.sign_in_address(text) RETURNS text` (owner poly_govern, invoker, IMMUTABLE, `SET search_path = ''`, no login-role EXECUTE; pinned like the other invokers in pgTAP 12). Why not a length cap:
   - A cap keeps garbage that is not an address.
   - The inet check bounds the length and the content together.
   - A value that is not an address loses nothing a cap would have kept. The session row still holds it while it lives, and the record's job is the existence of the row.

   **Tests:** a session inserted with `ip_address` of 10 000 characters, and one with `'not-an-ip'`, each leave a record row with a NULL address; `'::1'` and `'203.0.113.7'` are stored as given. The same four values as `poly.client_ip` behave the same on a second-step failure row.

## Addendum 5 (qa's relaxed setting pin, pgTAP 12 at c507afd3)

1. **`role` is a legitimate fourth setting.** `current_setting('role')` returns the name set by `SET ROLE`, or `none`. It is not a time, and no role can use it to move a clock. Three POLY-89 commit-time trigger functions read it (0013:360, 391, 420), all to tell a superuser login with no `SET ROLE` from one that switched to a runtime role (ARCH §3.1c, "They test for a superuser by `session_user`"):
   - `app.two_factor_consistent()`;
   - `app.require_second_step_for_role()`;
   - `app.require_enrolled_inviter()`.
   
   The allowed set is therefore `app.actor`, `poly.client_ip`, `poly.user_agent` and `role`.
2. **Tighter on the lock's own path.** The four-name allowance is for the schema-wide scan. The functions the lock and the record run, `app.guard_second_step_lock()`, `app.guard_second_step_lock_delete()`, `app.record_session_sign_in()` and `app.sign_in_address(text)`, may read **only** `poly.client_ip` and `poly.user_agent`. Of those, only the guard reads them. pgTAP 12 pins this per function, and a plant that adds `current_setting('role')` to the guard must fail it.
3. **Scanning `app` only is not enough. Scan every schema a migration can create a function in.** That is every function in `pg_proc` outside `pg_catalog` and `information_schema`, excluding only extension members (`pg_depend.deptype = 'e'`, so pgTAP's own functions do not count). Today every definer and trigger function is in `app` (code-read: all 185 `SECURITY DEFINER` definitions in 0000–0017 are `app.*`). But the lock guard's safety cannot depend on where a later helper is put: a function in `public` that the guard came to call would be outside an `app`-only scan. The existing pins (literal names only; no `set_config`) apply over the same scope.
4. **Two more ways to read a setting, pinned over the same scope:** no function reads `pg_settings` or `pg_show_all_settings`. And the four lock and record functions contain no dynamic `EXECUTE` (`prosrc !~* '\mexecute\M'`), because a string run that way escapes every text scan.

seceng reviews this addendum; the pin guards the lock.

## Addendum 6 (seceng, ruling-review §14 at 1e7c220d)

**The rule: no function in Addendum 5 item 3's scope contains dynamic `EXECUTE`.** That scope is every function outside `pg_catalog` and `information_schema`, extension members excluded. A plant, a `public` function that runs `EXECUTE 'SELECT 1'`, must fail the pin. No function body in 0000–0017 uses it (code-read by seceng and by me). No planned definer needs dynamic SQL either. One that ever does is a ruling change, not a pin exemption.

## Addendum 7 (seceng's build review §4 and ruling-review §2.4; verdict N1)

1. **0017's delete of `web` markers runs under a policy that exists only for that statement.** As built, it runs as poly_owner under FORCE RLS, and no policy names poly_owner, so it deletes nothing. Running it as poly_purge is not enough either: `tx_identity_purge` deletes only markers older than an hour, so a fresh one would still fail the new CHECK. In 0017, as poly_owner, replacing the single DELETE:
   ```
   LOCK TABLE app.tx_identity IN SHARE ROW EXCLUSIVE MODE;
   CREATE POLICY tx_identity_drop_web ON app.tx_identity FOR DELETE TO poly_owner USING (kind = 'web');
   DELETE FROM app.tx_identity WHERE kind = 'web';
   DROP POLICY tx_identity_drop_web ON app.tx_identity;
   ```
   then the CHECK, as now.
   - **Why the lock comes first:** it waits for any transaction that holds an uncommitted marker, and it blocks new markers until the migration commits. So the DELETE sees every `web` marker, and none arrives before the CHECK.
   - **The policy never outlives the file:** it is created and dropped in the same migration transaction.
   - **Why not `NOT VALID`:** it would leave a CHECK that the catalog marks unvalidated, and rows it does not hold, indefinitely.
   - **Tests (qa):**
     - Migrate a fresh database to 0016, then as superuser commit a `web` marker created now (under an hour old). Run 0017: it succeeds, no `web` row remains, and `tx_identity_kind_check` is validated (`convalidated`).
     - A pgTAP line in 07: no policy on `app.tx_identity` names poly_owner.
     - Red at `9fc167f4`: the CHECK refuses the migration (23514).
2. **`app.sign_in_address` is declared `STABLE`.** It calls `pg_input_is_valid`, so it may claim no more than that function does. No index or generated column uses it, so nothing depends on `IMMUTABLE`. pgTAP 12's pin changes to `provolatile = 's'`.

Both go in one code commit and one re-gate. Editing 0017 is safe because it has not merged. A dev database that already applied it from this branch is rebuilt (`check-migrations` flags the changed hash).
