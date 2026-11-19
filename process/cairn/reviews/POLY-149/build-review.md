# POLY-149 — Stage 2 revocation and docs: security review of the build at `9fc167f4` (seceng-149)

**Reviewed:** the gate sha `9fc167f4`, with qa's `gate.md` at `1e7a8586`. I read it against the ruling at `8de05776`, Addendum 5 at `d170edfd`, my `ruling-review.md` §1–§14, and my early read of `002cda1f`.

**Verdict: ACCEPT `9fc167f4`.** No blocking finding. There is one build note, which is not about security (§4). SECURITY is brought to the current state in this loop (§5).

## 1. My own run
| Suites | Command | Result |
|---|---|---|
| `second-step-lock`, `sign-in-record`, `revocation`, `gate-check`, `gate-check-membership`, `enter-session-slide`, `sign-in-controls-pins`, `pgtap`, `pgtap-membership` | `pnpm exec vitest run --config tests/db/vitest.config.ts --exclude '.claude/**' second-step-lock sign-in-record revocation gate-check enter-session-slide sign-in-controls-pins pgtap` | 9 files, 243 passed, 0 failed |

Everything else I rely on comes from qa's gate run (`gate.md`): db 1057/1057, e2e 57/0/0 on the real revocation with no harness revoke, and gate-check 94/94 with every plant refused. I re-read the plants' predicates; I did not re-run them.

## 2. Line by line

### 2.1 `0017_revocation.sql` against R1
| Item | Built | Result |
|---|---|---|
| The six BetterAuth tables | One `REVOKE ALL … FROM poly_app`. That also removes the column grants from 0001 and 0005, so poly_app loses `UPDATE(email)` on `user`, the DML on `two_factor` and the INSERT on `verification` | **Matches.** This removes the precondition of R-2's backup-code item and its email item, both for poly_app. |
| `email_challenge` | The SELECT columns are revoked and `email_challenge_own` is dropped | Matches. |
| `enter_asserted_user` | Dropped by its owner, poly_authz | **Matches.** No later grant can restore it. |
| The kind CHECK | `web` markers are deleted, then the CHECK becomes `signup`, `auth`, `session` or `^system:[a-z][a-z0-9_]{0,62}$` | **Matches, and it is tighter than ruled.** The job name is now constrained too. |
| `audit_membership` | The `web` branch goes; `session` maps to `user` | Matches. |
| CREATE on `app` | Granted to poly_govern for the file, then revoked | Matches. |
| poly_app's ten functions | pgTAP 11, granted and effective, both ways, with three plants | **Matches.** |

### 2.2 `0016_sign_in_controls.sql` against R2–R4 and Addenda 1–5
- **The streak.** Keyed by user, RLS forced, only poly_govern, truncate refused. Matches.
- **The guard.**
  - It reads `pg_catalog.clock_timestamp()` only.
  - Step 1 refuses any change to `locked_until`, and any lower count, while a lock is in force.
  - The length `LEAST(15 * (1 << LEAST(n, 7)), 1440)` gives 15 to 960 minutes, then 1440. It overwrites `NEW.locked_until`.
  - The reset is an `ELSIF` of the new-lock branch, so a lazy clear (old value not NULL) never resets the streak.
  - **It matches R2.** Measured: T-L1 (Node's `Date` faked past the lock: refused, no session, no `session` record row), the race at count 9, and T-L3.
- **The delete guard.** An invoker; it refuses unless `current_user = 'poly_govern'`. `reset_second_step` deletes as poly_govern and also deletes the streak. Matches.
- **The record.**
  - The AFTER INSERT trigger is a poly_govern definer that reads only `NEW`.
  - Both kinds of row pass through `app.sign_in_address` (`pg_input_is_valid(…, 'inet')`, otherwise NULL), and the browser is cut to 512 characters.
  - The statement trigger and the row trigger both apply, and the truncate trigger refuses.
  - There is no FK. The purge takes no argument, is executable by poly_worker only, and deletes exactly the purgeable rows.
  - **It matches R3 and Addendum 4.**
- **`enter_session`'s slide.**
  - `FOR UPDATE SKIP LOCKED`, and it writes only if `expires_at < v_new` on the locked row. That covers N1 and Addendum 2.
  - The checks before the marker are unchanged.
  - The slide still runs after the marker insert, so the first-write check holds.

### 2.3 The deploy-gate check (`infra/postgres/gate-check.sql`) against R5 and Addendum 4
- **Triggers.** All five are listed, `sign_in_record_05_refuse` included.
- **Membership.**
  - `member_want` and `member_have` are compared both ways with `EXCEPT`, over every row whose member or granted role is `poly_*`, and every row whose member is a login role.
  - poly_migrator must hold false / true / false (inherit / set / admin). For poly_backup only admin is compared, which is the right loosening: inherit and set on its grant affect whether it can read, not what it can write.
  - Its plants are in `gate-check-membership.test.ts`, which passes in my run.
- **Fails closed.** A superuser login that holds a membership would also fail the gate. That is the right way for it to fail.

### 2.4 The pin and the reset-shape measurement
- **pgTAP 12's setting scan** follows Addendum 5. The dynamic-`EXECUTE` ban runs over the whole scope, as my §14 asked (`12_sign_in_controls.sql:111`).
- **The statement log:**
  - Only a correct TOTP and a correct backup code send the reset shape (`[0, null, id]`). Measured in `red-run.md` row R2.
  - Enrolment, regenerating backup codes, disable, a held sign-in and a passkey sign-in send no statement listing either column.
  - So decision 2's (a) rests on a measurement, not on a guess.

## 3. Criteria
| Block | Result |
|---|---|
| V: revocation, complete EXECUTE set, fixtures moved, harness revoke gone | Met (§2.1; e2e on the migrated chain) |
| L: lengths, reset rules, refusal during a lock, restart, write guard, passkey, `reset-mfa`, red first | Met (§2.2; `red-run.md`) |
| S: the record, append-only, purge only, failure and lock rows, no typed code, no login-role writer, no runtime-role reader | Met (§2.2). poly_backup reads it, by decision 1 |
| INFRA §7.1 step 16 | Met (§2.3) |
| N1, F1 | Met |
| D: SECURITY | Done in this loop (§5) |

## 4. Build note (not security)
0017 deletes `web` markers as poly_owner. `app.tx_identity` is under FORCE RLS, and only poly_purge has a DELETE policy, so that delete matches 0 rows. On a fresh chain no `web` marker exists, so the new CHECK passes, and CI is green. A developer database migrated through 0015 that still holds a `web` marker less than an hour old would refuse 0017 at the CHECK. That failure is closed. Fixing it means running the delete as poly_purge, or deleting the line. This is my ruling-review §2.4, still open; it is the architect's call, and it does not block.

## 5. SECURITY (1.13.0)
Edited to the current state, with no history:
- **R-2.** The residual stays and is never retired. It says:
  - the sign-in service can create any session, and each one leaves a line in the record;
  - it can write factor rows within C-03's guards;
  - it can zero the doubling outside a lock (decision 2);
  - code execution in web reaches the users active while it runs;
  - the worker's reach lasts until POLY-64;
  - the database server or the migration credential can erase the record (decision 3).

  The backup-code item and the email item for poly_app are gone, along with every "until POLY-149" sentence and the deploy-gate sentence. Review: when POLY-64 lands, and no later than 2027-03-31.
- **T-18, C-11, C-13, C-84, C-86, §4.3:** `withTenant`, the brand, `enter_asserted_user` and kind `web` are gone. Web's only entry is `withSession` by handle.
- **A-31 (§4.1, C-03):** BetterAuth runs in the sign-in service's own transactions. **A-39:** the type test and the lint rule that keep web from naming a user.
- **§6.1:**
  - poly_app's password reaches no user;
  - poly_auth's can create any session;
  - poly_migrator's can erase the record;
  - rotating the auth secret ends copied backup codes.
- **New:**
  - C-88, the growing lock, including the delete guard's cost;
  - C-89, the sign-in record, including decision 1's backup read and the 400 days not enforced until POLY-137;
  - T-103 (an erased break-in) and T-104 (second-step guessing);
  - the §9 sign-in-record bullet.
- **R-26:** the lock is in place, with its lengths. The cap waits on POLY-137.

## 6. The architect's N1: `app.sign_in_address` is labelled IMMUTABLE but calls a STABLE function. I agree it does not block.

**It has no security consequence** (code-read and spec):
- **The result cannot change with a setting.** `pg_input_is_valid` is STABLE because some types' input depends on settings, such as `DateStyle` for dates. `inet` input reads no setting, so for this call the result depends on the argument alone. The label is wrong in general but true for this use.
- **Nothing relies on the label in a way that matters here.**
  - Both callers pass a runtime value: `NEW.ip_address`, or the transaction setting. The planner has no constant to fold.
  - The function has a `SET search_path` clause, and a SQL function with one is never inlined.
  - No index, generated column or constraint uses it, so there is nothing a wrong label could leave stale.
- **The worst a wrong label could do** is make the record store, or drop, an address that a strictly computed check would have treated differently. The address is the service's word in any case (C-89). It never affects whether a row is written, its kind, user, time or lock length, or anything the lock guard decides.

**Agreed:** relabel it STABLE when it is next touched, and move pgTAP 12's pin with it. This is not a change for this PR.

## 7. The Addendum 7 build at `1e832bbc`: ACCEPT, pending qa's counts

Read: `git diff 9fc167f4 1e832bbc -- packages`, 12 lines in 0016 and 0017, and pgTAP 07:69 at `1e832bbc`.
- **`app.sign_in_address` is now `STABLE`.** It matches §6, and its behaviour is unchanged.
- **0017's lock is its first statement**, before the REVOKEs and the `DROP FUNCTION`. That closes the deadlock risk I raised in ruling-review §15.1.
- **The second temporary policy, `tx_identity_drop_web_read`**, is `FOR SELECT TO poly_owner USING (kind = 'web')`. It is needed because a DELETE's WHERE reads rows under the SELECT policies too (spec; backend-lead measured that without it the delete matched nothing).
  - My §15.1 reading holds for it as it does for the DELETE policy.
  - It is created and dropped inside 0017's one transaction, so no other session ever sees it.
  - It names only poly_owner, whose session can already switch off RLS on the table, and only `web` rows.
  - Both policies are dropped before the CHECK.
  - pgTAP 07:69 counts every `tx_identity` policy that names poly_owner and requires 0. So it pins both names, and any later policy of the same kind.
- **Nothing else in `packages` changed** since my ACCEPT at `9fc167f4`.

**ACCEPT `1e832bbc`**, once qa's re-gate reports green on that sha with the counts in `gate.md`. If a count drops or a plant stops failing, this acceptance does not hold until I have read why.
