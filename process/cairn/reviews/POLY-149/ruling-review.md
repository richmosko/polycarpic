# POLY-149 — Stage 2 revocation and docs: security review of the ruling at `b31be909` (seceng-149)

**Reviewed:** `process/cairn/reviews/POLY-149/ruling.md` at `b31be909` (R0–R9, decisions 1–5). I read it against POLY-149's criteria (V, L, S, D) and its 2026-11-19 comments (F1, N1). I also read migrations 0000–0015 (grep), `packages/db/sql/roles.sql`, `infra/postgres/pg_hba.prod.conf` and the callers of `email_challenge`. I have not read better-auth's source myself; for it I rely on the ruling's code-read of `verify-two-factor.mjs`. Nothing was run: this is a design, and each item below is a test that qa writes red before the build.

**Verdict: ACCEPT, on one required change (§2.1).** The change adds a few lines to R5 and does not reopen the rest. I will check it at the addendum's sha. §3 lists the test conditions. §4 answers the two Principal decisions, and §5 the lead's two questions. One residual has to be stated in SECURITY (§2.2). It needs no new decision from the Principal.

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
