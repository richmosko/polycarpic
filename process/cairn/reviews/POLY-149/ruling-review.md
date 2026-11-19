# POLY-149 — Stage 2 revocation and docs: security review of the ruling at `3725d22e` (seceng-149)

**Reviewed:** `process/cairn/reviews/POLY-149/ruling.md` at `b31be909` (R0–R9, decisions 1–5). I read it against POLY-149's criteria (V, L, S, D) and its 2026-11-19 comments (F1, N1). I also read migrations 0000–0015 (grep), `packages/db/sql/roles.sql`, `infra/postgres/pg_hba.prod.conf` and the callers of `email_challenge`. I have not read better-auth's source myself; for it I rely on the ruling's code-read of `verify-two-factor.mjs`. Nothing was run: this is a design, and each item below is a test that qa writes red before the build.

**Verdict: ACCEPT `3725d22e` (the tip; it replaces `b31be909` whole), with one line still owed in R5 (§7: the four other runtime roles hold no SELECT on the record).** §1–§6 were written against `b31be909`; §7 states what changed and what each item now reads at `3725d22e`. §3 lists the test conditions, §4 answers the two Principal decisions and §5 the lead's two questions. One residual has to be stated in SECURITY (§2.2). It needs no new decision from the Principal.

## 1. Criteria against the ruling

| Criterion | Ruled in | Result |
|---|---|---|
| V: no grant on BetterAuth tables, no `enter_*` but `enter_session`, complete EXECUTE set pinned (F2) | R1: `REVOKE ALL` on the six tables (this also removes the column grants); the function is dropped, not revoked; ten functions pinned, granted and effective, both ways, with three plants (a direct grant, a definer grant, a PUBLIC grant) | **Holds.** The drop is stronger than a revoke: no later GRANT can bring the function back. Kind `web` goes with it, so every marker's session id now comes from a live row. |
| V: the harness revoke and the fixtures | R1: the harness revoke is deleted; about 70 call sites move to `enter_session`; poly_auth's fixture is already the real role, pinned by pgTAP 08's N2 plant | **Holds.** A build that finds the list short reports it and never re-grants. |
| L: lengths, reset rules, refusal during a lock, restart, the write guard, passkey and `reset-mfa`, red first | R2: the streak is keyed by user, no login role holds it, and the guard computes `locked_until` itself from `clock_timestamp()`. Its order: a lock in force refuses any change to `locked_until`; then the lazy clear; then a new lock; then the reset by its shape; then a failure | **Holds**, with the residual in §4.2 and the conditions in §3. Keying the streak by user closes the delete-and-re-insert reset I raised in my preparation. The guard sets the length itself, so a BetterAuth upgrade that changes the 900 s default cannot shorten a lock. |
| L: no fake clock in production | R2: superuser helpers move row facts; no setting-based clock | **Holds.** No function reads a clock from a setting. T-L5 pins it. |
| S: a database-written, append-only record covering every session; purge only; rows for counted failures and locks; no typed code stored; no login role writes it | R3: AFTER INSERT on `public.session`; NOLOGIN owners; invoker immutability trigger that binds the owner and superuser; truncate refused; `purge_sign_in_record` with no argument, executable by poly_worker only; no FK to `user` | **Holds.** Putting the trigger on `public.session` rather than `app.session_handle` (F1) is the superset, accepted: it also records a hold's temporary session and an `enter_auth_session`-only session. Because there is no FK, deleting a user cannot cascade into the record. No login role holds DELETE on `user` today (grep of 0000–0015, code-read); T-S3 pins that. |
| S: no login role reads it | R3 and decision 1 | poly_backup reads it. I recommend accepting that (§4.1). |
| S: the address and browser on second-step rows | R3: transaction-local `poly.client_ip` and `poly.user_agent`, cast to `inet` and cut to 512 characters, stated as the service's word | **Holds.** It is labelled honestly. The row's existence, kind, user, time and lock length are the database's word. |
| F1 | R3, the session trigger | **Holds** (above). |
| N1 | R4: write only when `v_new > v_expires`; the test checks `xmin` and `updated_at` | **Holds.** |
| INFRA step 16 | R5 names the objects | **Required change (§2.1).** |
| D | R7, R8 | Holds. My SECURITY edits are listed in §6. |

## 2. Findings

### 2.1 Required: R5 must say how each refusal of the deploy-gate check is shown to fail
- **The problem.** R5 lists what must be true, but not that the check exits non-zero, nor that each line is shown to refuse. A gate that prints a count and exits 0, or that no test has ever seen fail, gates nothing. The Principal's rule is that a runbook check guarding a decision must be shown to fail.
- **The change (three lines in R5):**
  1. The check exits non-zero and names each failed line.
  2. devops shows each line failing on a scratch database migrated to 0017, by one plant per line, then restores it:
     - drop the table, or turn off its forced RLS;
     - drop or disable each of the four triggers;
     - change a guard function's owner, or grant EXECUTE on it to poly_auth;
     - grant EXECUTE on `purge_sign_in_record` to poly_app;
     - grant INSERT on the record to poly_auth;
     - recreate `app.enter_asserted_user`;
     - grant SELECT on `public.session` to poly_app.
  3. Add one row: the five runtime roles (poly_app, poly_auth, poly_worker, poly_operator, poly_migrator) hold no SELECT on `app.sign_in_record`, by effective privilege. Then the gate also holds "no login role reads it, except the backup" (§4.1).
- **What an attacker reaches meanwhile:** nothing. This is about whether the gate proves anything.

### 2.2 Not blocking: the migration credential can erase the record. SECURITY says so.
- **How it works (code-read).** poly_migrator is a LOGIN role (`roles.sql:13`), admitted from the app subnet (`pg_hba.prod.conf:8`), and holds `SET TRUE` on poly_owner, poly_purge and poly_govern (`roles.sql:75-76`). As poly_owner it can drop the immutability trigger and delete rows. R3 says so ("schema changes are the migration's authority").
- **Why the tests still pass.** Its memberships are `INHERIT FALSE`, so `has_table_privilege('poly_migrator', …)` reads false, and both R3's test and R5's gate pass. That is correct, because the test is about direct privilege. But "no login role can change or delete it" is then true only of privileges, not of reach.
- **Who can use it and what they reach.** Whoever holds the migration password, which only the `migrate` service mounts (SECURITY §6.1). As poly_owner it already reaches every table and every RLS policy. In practice that is full control of the app's database, so it is the limit the Principal already accepted ("someone with full control of the database server can still erase the record"), named more precisely.
- **Stronger option.** Give the record's table to an owner poly_migrator cannot SET ROLE to, so that only the operator's superuser can alter it. Cost: about half a day (a guess), and every later change to the table then needs the superuser by hand. It still does not stop the superuser. The real cure is option (c) from the 2026-11-17 decision, the off-site copy.
- **Recommendation:** no change in this loop. SECURITY's residual says "the database server, or the migration credential", which is accurate.

### 2.3 Not blocking: deleting a factor row during a lock removes the lock
R2's guard is `BEFORE UPDATE`, so a `DELETE` of a locked `two_factor` row is not refused by it. C-03 still requires the user's own marker for that delete.
- **Through the web pages.** The only route is the user's own signed-in session, after step-up (for example by passkey), when they turn the authenticator off. Someone stuck at the second step has no session, so they cannot use it.
- **Through SQL as poly_auth.** It gains nothing it does not already have.
- **The streak survives either way**, so the next lock on a re-enrolled factor continues the doubling.

The criterion's exception list names `reset-mfa`. A user removing their own factor is the same kind of act, so I accept it. qa pins it with test T-L4, and SECURITY states it.

### 2.4 Build note (not security)
0017 deletes `web` markers "as poly_owner". `app.tx_identity` has FORCE RLS, and only poly_purge has a DELETE policy, so that delete matches 0 rows. On a database that still holds a `web` marker less than an hour old, the new CHECK then fails. That failure is closed, and CI's fresh template holds no such marker. Developers' local databases might. Either run the delete as poly_purge or drop the line; the architect's choice.

## 3. Test conditions (qa maps each to a named test; none is a ruling change)
- **T-L1. The database refuses the right code during a lock even if the service's own check is skipped.** Run one sign-in with Node's `Date` faked past `locked_until`, so BetterAuth's check passes, and send the right code. The lazy clear, or the success write, hits step 1 of the guard → 42501 → the request rolls back. No `session` row and no `sign_in_record` row of kind `session` exist. This is the test that makes "while a lock is in force the right code is refused" a database property, not only a library one.
- **T-L2. A race at the 10th code.** Two wrong codes sent at once at count 9 leave one lock, one `second_step_lock` row and the doubled length, never two locks.
- **T-L3. During a lock, poly_auth sets `failed_verification_count = 0` and leaves `locked_until` alone.** The streak is unchanged, the next lock still doubles, and no reset is counted. This passes step 1 and is not the reset shape (OLD `locked_until` is not NULL).
- **T-L4. A factor DELETE during a lock** (§2.3), done with the user's own marker, then re-enrolment. The streak row survives, and the next lock is the doubled one.
- **T-L5.** A catalog scan: no function in `app` or `public` calls `current_setting` on a clock-like name. The guard reads only `poly.client_ip` and `poly.user_agent`, and neither changes its control flow.
- **T-S1. A forged address cannot break the record.** `poly.client_ip` set to a non-`inet` string, or to 10 KB of text, still gives exactly one row, with the address NULL, and the sign-in succeeds or fails exactly as without it.
- **T-S2.** A session INSERT by poly_auth with `ip_address` and `user_agent` of 10 KB still writes the row (cut to 512 characters); it does not fail the sign-in.
- **T-S3.** pgTAP: no login role holds DELETE on `public."user"`, nor UPDATE of `user.id`, granted and effective. This is what R3's "no FK" relies on.
- **T-S4.** The purge as poly_worker, called twice, deletes nothing the second time. A row whose `user_id` names a live user and is 399 days old survives `SET ROLE poly_purge` followed by a direct DELETE.

## 4. The two Principal decisions

### 4.1 Decision 1: the backup reads the sign-in record. **Recommend (a), accept.**
- **How it works (code-read, `roles.sql:44`).** poly_backup holds `pg_read_all_data`, so it reads every table, `app.sign_in_record` included. RLS does not apply to it.
- **Who can use it.** Whoever holds `db_password_backup`. Only the `backup` container mounts it, and that container has no internet route (§6.1). Anyone with a backup file and the backup's private key (password manager and printed sheet only, §6.6) can read it too.
- **What they reach.** The record's lines from the last 400 days: user, time, address and browser. The same credential already reads every `session` row (address, browser and the plain session token), every factor row and all household data. So the record adds nothing to what it reaches (code-read).
- **The other option is weaker, not stronger.** (b) leaves the record out of the backup, so a restore loses it. That turns a restore, or an attacker who can force one, into a way to erase the record, which is what the record exists to prevent. Its cost is about $5 (a guess), and it lowers security.
- **The stronger option** is the off-site copy (option (c) of 2026-11-17). It protects the record rather than hiding it. It is not priced here.
- **For SECURITY:** "no login role reads the record, except the backup role, which reads every table." The criterion's intent was that the app never reads it until a Settings screen gets a grant review, and §2.1(3) keeps that true at the gate.

### 4.2 Decision 2: the sign-in service's SQL can zero the doubling on an unlocked row. **Recommend (a), accept and state it.**
- **How it works.** The database cannot check a code: the TOTP secret is encrypted under the auth secret (SECURITY T1). So it recognises the reset by its shape: both columns written, count 0, no lock before or after (code-read of the ruling's R2).
- **Who can use it.** SQL as poly_auth: an injection in `auth`, its stolen password, or code execution in `auth`. Nobody using the web pages can, because the shape is only written after BetterAuth has accepted a code.
- **What they reach.**
  - They can zero the streak while no lock is in force. They cannot shorten, clear or replace a lock that is running (step 1, measured by T-L1 and T-L3).
  - Every wrong code they then send still adds a `second_step_failure` line, and every lock a `second_step_lock` line (R3). The guessing stays visible.
  - The same SQL can insert a session for the user outright and attach a handle to it (`attach_session_handle` is poly_auth's, POLY-153). That is simpler and gives full access, and it leaves a `session` line too.
  - So zeroing gives them nothing they cannot get more easily (code-read and reasoning; not measured).
- **The stronger option, (b):** a reset counts only if the same transaction inserted a session for that user. It costs about $3 (the architect's guess). It gains a little: every streak reset would leave a `session` line, so a quiet reset becomes visible.
- **What (b) risks.** It rests on a claim nobody has measured: that every correct-code path creates a session. A path that does not would leave the doubling in place after a correct code. The likely one is step-up inside an existing session, if it uses the same verify (my guess, not read). That user's next lock would then be longer than it should be. That is a usability failure, not a security failure, but it would add new behaviour that this loop has not measured.
- **Recommendation: (a).** The reach is no larger than what poly_auth already has, and the guessing it would help is recorded anyway. If the Principal prefers (b), it is safe to add only together with a measurement, through statement logging, of which correct-code paths insert a session.

## 5. The lead's two questions
- **One PR (R9): agree.** The deploy gate lifts only when all three parts merge, so a split buys no earlier real data. The two migration files keep the cut-off open if the fixture change runs long. Security is neutral: 0016 alone adds controls and removes nothing.
- **Revoking poly_app's read of `app.email_challenge`: agree.**
  - It is least privilege: web needs nothing on it.
  - The only code that uses it is `packages/auth/src/anchor.ts`, through definers. `packages/db/src/schema/second-step.ts` declares the table and reads nothing (code-read).
  - Its policy names only poly_app, so dropping it leaves no grant without a policy and no policy without a grant.
  - The measurement that web needs it nowhere is web's suite and the e2e suite on the migrated chain (R1).

## 6. SECURITY edits in this loop (at the build review, against the gate sha)
- **R-2:** the residual stays and is never retired. It says:
  - the sign-in service can create any session, and each one leaves a record line;
  - it can write factor rows within C-03's guards;
  - it can zero the doubling outside a lock (§4.2);
  - code execution in web reaches the users active while it runs;
  - the worker's reach lasts until POLY-64;
  - the database server or the migration credential can erase the record (§2.2).

  The backup-code item and every "until POLY-149" sentence go, and so does the deploy-gate sentence.
- **T-18**, **C-84** and **C-86**: kind `web` and `enter_asserted_user` go. **A-31 (§4.1, C-03):** BetterAuth's writes run in the sign-in service's own transactions; `withTenant` no longer exists. **A-39:** the `SessionUserId` brand and the `db/session` sentences go.
- **§6.1:** poly_app's password reaches no user. Rotating the auth secret also kills planted backup codes.
- **R-26:** the growing lock is in place, with the measured lengths; the cap waits on POLY-137.
- **New controls:**
  - C-88, the growing lock: R2, and T-L1 to T-L5;
  - C-89, the sign-in record: R3, the purge and the backup's read (§4.1).

  The ids are provisional; I take the next free ones at the edit.

## 7. The re-issued ruling at `3725d22e`

Read: `git diff b31be909 3725d22e -- process/cairn/reviews/POLY-149/ruling.md`. It replaces `b31be909` whole and takes in my preparation checklist. **Verdict: ACCEPT `3725d22e`, on one line still missing from §2.1.**

| Item | At `3725d22e` | Result |
|---|---|---|
| §2.1(1)–(2) the gate exits non-zero, each line shown to fail by a plant | R5's opening sentence | **Met.** devops' plant list follows §2.1(2). |
| §2.1(3) the five runtime roles have no SELECT on the record | R5 adds poly_app only, plus poly_app's exact EXECUTE set and no DELETE on `user` | **Still required:** one more R5 row, "poly_auth, poly_worker, poly_operator and poly_migrator hold no SELECT on `app.sign_in_record` (effective)". It can come as an addendum line, or the qa and devops tests can carry it if the lead prefers. It does not reopen anything else. |
| §2.3 a factor DELETE during a lock | A new invoker trigger, `two_factor_16_lock_delete`, refuses unless `current_user = 'poly_govern'`, so only `reset-mfa` passes | **Accepted. It is stronger than I asked**, and T-L4 changes: the delete is refused, and the row is read back unchanged. Its cost: during a lock, a user cannot turn off their own authenticator from a signed-in session. Only `reset-mfa`, or waiting out the lock, clears it. That is acceptable, and SECURITY says so. |
| T-L3 lowering the count during a lock | Step 1 now refuses it | Met, more strictly than the test condition. |
| The reset is the service's word; no clock a role can change | Stated in R2, and pinned by pgTAP 12 with a plant | **Met.** It is the residual R-2 states. |
| The `user` cascade on the streak | Safe, because no login role deletes `user`. The gate and pgTAP 12 pin it | Met (T-S3). |
| §2.4 the `web` marker delete under FORCE RLS | Unchanged | Still a build note, not security. |

§3's other conditions and §4's two recommendations stand unchanged at this sha.

## 8. The R5 addendum at `4b421984`: §2.1 closed

Read: `git diff 3725d22e 4b421984 -- process/cairn/reviews/POLY-149/ruling.md`.
- R5 gains a row: poly_app, poly_auth, poly_worker, poly_operator and poly_migrator hold no SELECT on `app.sign_in_record`, checked by effective privilege. poly_backup is the one exception, pending decision 1.
- R3's test line now has a plant for it, `GRANT SELECT … TO poly_worker`, which must be shown to fail the test. R5's opening sentence already requires the same of the gate.

That is §2.1(3), and with it §2.1 is closed. **The ruling is accepted at `4b421984`, with no required change outstanding.** If the Principal chooses (b) on decision 1, poly_backup joins the row and §4.1 applies.

## 9. Addendum 1 at `44ef4ed4`: the acceptance stands

- **T-L3.** The architect's reading is right. My §3 T-L3 was written against `b31be909`, where step 1 checked only `locked_until`. Since `3725d22e`, step 1 also refuses a lower count, as I recorded in §7. During a lock, `SET failed_verification_count = 0` as poly_auth must give 42501, and the count, `locked_until` and the streak must all read back unchanged. That outcome replaces T-L3 as I worded it in §3. `second-step-lock.test.ts:176-179` tests it.
- **The two invokers leave `definers.json`: accepted.** Each has to see the role that is deleting in `current_user`, so neither can be a definer.
  - pgTAP 12 pins both: their owner, `prosecdef = false`, `search_path = ''`, and no login role can execute them, granted or effective.
  - Neither one widens what any role can do. The delete guard reads only `OLD` and the clock.
  - `sign_in_record_immutable` reads `public."user"` only on the purge branch, as poly_purge, which holds `SELECT (id)` on it (R3). For any other role it refuses before reading anything.
  - Postgres checks EXECUTE on a trigger function when the trigger is created, not when it fires (spec). "No login role can execute it" therefore guards direct calls, and the trigger still fires for every role.

**The ruling is accepted at `44ef4ed4`.** Nothing is outstanding.

## 10. Addendum 2 at `30552d2a`: the slide skips a locked row. Accepted.

- **Only the write changes.** The lookup, the expiry and cap checks, the single refusal and the marker are unchanged. The UPDATE now locks the row with `FOR UPDATE SKIP LOCKED` and writes only if `expires_at < v_new` on the locked row. So the cap case (N1) still writes nothing, and a slide happens at most once.
- **It fails closed.** A skipped or lost slide leaves `expires_at` where it was, so the session ends sooner, never later. `v_new` is still `least(now() + 7 days, created_at + 30 days)`, so nothing can pass the cap.
- **A revoke racing an entry.** A DELETE in progress holds the row lock, and the entry skips its slide. That entry was already admitted by its own snapshot's lookup. Before this addendum it would have waited, updated 0 rows and been admitted all the same (code-read). So this changes nothing: one request in flight during a revoke gets through, then the session is gone. The next entry is refused.
- **Privilege.** `FOR UPDATE` needs UPDATE on at least one column of the table (spec). poly_authz holds `UPDATE (expires_at, updated_at)`. No grant is added, and the build measures it.

**Accepted at `30552d2a`.** Nothing is outstanding.

## 11. Addenda 3 and 4 at `8de05776`: accepted. This is the final sha.

Read: `git diff 30552d2a 8de05776 -- process/cairn/reviews/POLY-149/ruling.md`.
- **Addendum 3.1, `sign_in_record_05_refuse`:** it matches my early read of `002cda1f`. A statement trigger refuses even when RLS would hide every row from the owner, so the refusal does not depend on which policies exist. It is in R5's trigger row and in pgTAP 12, with a plant that drops it.
- **Addendum 3.2–3.3:**
  - Dropping the dead brand-cast rule is right. A rule kept for a type that no longer exists would suggest the brand still guards something.
  - The fixture move keeps the coverage of the other reserved literals.
  - Neither changes what any role can reach.
- **Addendum 4.1, the membership row:** this closes item 4 of my early read.
  - The row is the exact `pg_auth_members` set, checked both ways, so it covers every `poly_*` member and grant and every login member.
  - poly_migrator's eight grants must each be false / true / false (inherit / set / admin), and poly_backup's one grant must be `pg_read_all_data`. Anything else fails, `pg_*` predefined roles included.
  - Its three plants are a SET-only grant to poly_auth, `pg_write_all_data` to poly_worker, and an ADMIN option. Together they cover the three ways the effective checks miss a fault.
  - poly_migrator's own reach is the accepted limit. Decision 3 (DECISIONS 2026-11-19) names it in SECURITY beside the database server.
- **Addendum 4.2:** the owner test must see 42501. A result of `UPDATE 0` or `DELETE 0` fails it. That is exactly what I asked.
- **Addendum 4.3, `app.sign_in_address`:** the inet check is better than the length cap I suggested. It bounds the length and refuses non-addresses with one rule, for both kinds of row.
  - The helper is an invoker, owned by poly_govern and called only inside poly_govern definers, and no login role can execute it. It reads nothing and writes nothing.
  - Its tests (10 000 characters, `'not-an-ip'`, `'::1'`, `'203.0.113.7'`, on both kinds of row) are the T-S1 and T-S2 I asked for.

**The ruling is accepted at `8de05776`.** Nothing is outstanding. The build review is at qa's gate sha.

## 12. ARCH §3.1c at `38305740`: accepted

Read: `git diff abf5298a 38305740 -- docs/ARCH/index.html`, against the decisions dated 2026-11-19 (1–3) and the ruling at `8de05776`.
- **Decision 3 is right.** The erase limit names both the database server and the migration credential, which can `SET ROLE poly_owner` and drop the triggers.
- **The streak** says that no runtime login role holds it and that poly_backup reads it. This matches decision 1 as it applies to the streak, and my early-read item 2.
- **Current state:** the purge has no job yet, so the 400 days is not enforced (POLY-137).
- **The guard's five steps** match R2 and the code at `002cda1f`, in this order: refuse during a lock, the lazy clear, the new lock with its record row, the failure row, the reset.
- **The address** is kept only if it is a valid inet (Addendum 4.3).

No conflict with the Principal's decisions. **ARCH §3.1c is accepted at `38305740`**, together with the ruling at `8de05776`.

## 13. The pgTAP 02 exemption diff at `cd6ab898`: accepted

This is the C-13 review that the file's header requires. The diff touches only `tests/db/pgtap/02_rls_catalog.sql`: two pairs added, and the list size goes from 1 to 3.

`app.sign_in_record:pk_not_uuid`. **Accepted.**
- R3 rules a `bigint GENERATED ALWAYS AS IDENTITY` key.
- C-18 asks for UUID keys so that ids cannot be guessed or counted. Here no login role reads the record (the backup aside), and no definer takes a record id from a caller. A guessable id is therefore worth nothing to anyone.

`app.second_step_streak:for_all_policy`. **Accepted.**
- The single policy is `FOR ALL TO poly_govern USING (true) WITH CHECK (true)`.
- poly_govern is NOLOGIN and is reached only through fixed definer bodies. The guard and `reset_second_step` touch the streak, and no other function does (0016, code-read).
- No login role holds any privilege on the table. pgTAP 12 and R5's gate pin that, with poly_backup's `pg_read_all_data` read as the one exception.
- A FOR ALL policy is a risk on a table that a login role can reach. This table is not one.

The list is still safe:
- Each pair hides only its own reason (the `qa_canary_reasonex` canaries, :190-192).
- `:77` asserts that each listed pair still hides a gap that fires, so an entry that is no longer needed fails CI.
- `:75` asserts that each entry names a real relation.
- The size pin at `:76` makes any further addition a reviewed diff.

**Accepted at `cd6ab898`.**

## 14. Addendum 5 at `d170edfd`, the no-adjustable-clock pin: accepted, with one tightening

Read: `git diff 8de05776 d170edfd -- process/cairn/reviews/POLY-149/ruling.md`; 0013:360, :391, :420; 0016 (the four functions); and a grep of 0000–0017 for `EXECUTE` inside function bodies.

**1. `role` as a fourth allowed setting: accepted.**
- The three 0013 guards compare `current_setting('role') = 'none'` to tell a superuser login with no `SET ROLE` from one that switched to a runtime role (code-read).
- The value is a role name, not a time, so it cannot move a clock.
- It cannot widen what the guards allow either. It is read only after `rolsuper` is true for `session_user`, and a non-superuser cannot make that true.

**2. Only the two address settings in the four lock and record functions, pinned per function with a plant: accepted.** This is the pin my T-L5 asked for, made exact.

**3. Scanning all of `pg_proc` outside `pg_catalog` and `information_schema`, excluding extension members: accepted.** Excluding extension members is safe: only a superuser can install an extension, and that is already the accepted limit.

**4. No read of `pg_settings` or `pg_show_all_settings`, and no dynamic `EXECUTE` in the four functions: accepted, with one tightening.**
- **The tightening:** apply the `EXECUTE` ban over the same schema-wide scope as item 3, not only to the four functions.
- **Why:** a dynamic `EXECUTE` in a helper that the guard comes to call later would escape every text scan, including the schema-wide setting scan. Item 3's own reasoning, that the guard's safety must not depend on where a helper lives, applies to this ban too.
- **Cost:** nothing today. No function body in 0000–0017 contains `EXECUTE`; every match is a GRANT, REVOKE, `EXECUTE FUNCTION` in a CREATE TRIGGER, or a comment (code-read).
- **Side effect:** any future definer that needs dynamic SQL comes for review. That is also a guard against SQL injection inside definers.
- **How:** this only tightens the pin, so qa can write it in the re-write without a new addendum, unless the architect prefers to rule it.
- **Pin and plant:** `prosrc !~* '\mexecute\M'` over item 3's scope, plus a plant: a function in `public` whose body runs `EXECUTE 'SELECT 1'`.

The guards call `pg_catalog.clock_timestamp()` by its qualified name, with `search_path = ''`, so no object can shadow the clock (code-read, 0016).

**Accepted at `d170edfd`**, with item 4's tightening carried by qa's re-write of pgTAP 12.
