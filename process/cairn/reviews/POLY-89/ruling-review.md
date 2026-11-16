# POLY-89 — seceng review of the ruling at `41a52277`

*seceng, 2026-11-16. Read against the tree at `8e3d9d88`, better-auth / @better-auth/passkey 1.7.18 from `node_modules` (code-read), and backend-lead-89's live write-order run. **Verdict: changes requested** (four blocking findings, B1–B4). Everything else stands as ruled.*

The ruling gets the main thing right. Factor rows, the on/off flag and the step-up stamp are all guarded in the database. Every proof is a row that only a definer writes. No new poly_app grant is added. Removing any factor (not only the last) needs a fresh step-up. The flag is checked at commit against a verified row. Those close the bypass routes I listed before the ruling: factors added, moved, re-keyed or deleted by direct SQL, and a flag switched off or on by direct SQL.

## Blocking

**B1. The factor guards refuse sign-in's own writes, so TOTP and passkey sign-in break.** (R3 #5)
- **How it works.** At sign-in the user has no session yet, so the request runs on the plain pool with no marker, and `app.current_user_id()` is NULL. BetterAuth still writes the factor rows there (code-read):
  - TOTP verify resets or increments `failed_verification_count` and sets `locked_until` (`verify-two-factor.mjs:136-202`);
  - a backup code rewrites `backup_codes` (`backup-codes/index.mjs:222-233`);
  - a passkey sign-in updates `counter` (`passkey/dist/index.mjs:581`).

  R3 #5 requires `user_id = app.current_user_id()` on every UPDATE, so each of these writes is refused.
- **What it reaches.** No attacker gains anything; the failure is closed. But no enrolled user can finish signing in, and a wrong TOTP code errors without counting toward the lockout.
- **Fix.** With no marker, an UPDATE may change exactly:
  - `two_factor`: `failed_verification_count` and `locked_until`; `backup_codes` too, unless B3 takes option (a);
  - `passkey`: `counter`, and only to a value no lower than before (authenticators that always send 0 pass).

  Every other column, every INSERT and every DELETE without a marker is refused. Tests: a real TOTP sign-in, a wrong-code lockout and a passkey sign-in each succeed as poly_app; an unmarked UPDATE of `secret`, `verified`, `user_id`, `public_key` or `credential_id` is refused.

**B2. A first passkey registration with `createSession: true` creates a second session, and the database marks it as recently confirmed.** (R3 #3 with #5; live run, flow 6)
- **How it works.** `/passkey/verify-registration` with `createSession: true` inserts the passkey, then a new session, in one transaction (measured: 200 as poly_app, and the route policy did not refuse it).
  - Under the ruling, the passkey INSERT consumes the grant.
  - The session-INSERT stamp (#3) then sees a grant consumed in this transaction and stamps the new session's `recent_auth_at`.
- **What it reaches.** Someone holding the user's cookie gets a second session with a fresh step-up. Revoking the stolen session does not end it. For 5 minutes it can do any step-up action: change the email, unlink a provider, revoke the user's other sessions. The same flag on an enrolled user's later passkey still creates an unstamped extra session, so the problem is not only the stamp.
- **Fix, both parts.**
  1. The enrolment class refuses `body.createSession` when it is set to anything but false, in the before-hook, with a test.
  2. #3 stamps only the TOTP path's replacement session. The grant records which write consumed it (`consumed_by` `totp` | `passkey`). #3 stamps only when it is `totp` and the marker's session row was deleted in this transaction, and only once per grant (`stamped_at`).

**B3. Copying encrypted backup codes lets anyone with SQL as poly_app skip the second step. This needs a decision.**
- **How it works.** BetterAuth encrypts every user's backup codes with the same auth secret, and nothing ties the encrypted value to the user. So one statement copies the attacker's own encrypted codes into a victim's row: `UPDATE two_factor SET backup_codes = (mine) WHERE user_id = victim`. B1 has to let `backup_codes` change without a marker, because redeeming a code at sign-in does exactly that. A trigger cannot tell a redemption from a copy, since both replace the whole encrypted value.
- **What it reaches.** SECURITY R-2 already lets SQL as poly_app outside a marked transaction plant a magic link for any user. Until now the second step was what still stopped that for an enrolled user. With the copy, the attacker uses the planted link, then one of their own backup codes, and signs in as any TOTP-enrolled user with no password and no factor. Nothing tells the victim. This stays open until POLY-149 removes poly_app's grants.
- **Option (a), my recommendation.** Put `/two-factor/verify-backup-code` and `/two-factor/generate-backup-codes` in the Blocked class, and refuse any `backup_codes` change without a marker.
  - Cost: about half a loop-hour (a guess) for a route-policy line, a guard line and two tests.
  - The user loses self-service recovery with a backup code. A lost phone is recovered with a second method (a passkey) or the operator's `reset-mfa`, and on a family instance the operator is a family member.
- **Option (b).** Keep backup codes. SECURITY R-2 then states the bypass above for the Principal's approval, closing at POLY-149.

**B4. The exemption can be lost and kept at the same time: two transactions each pass on what the other has not yet committed.** (R4; C10)
- **How it works.**
  - Transaction 1 deletes the user's last factor. The last-method check passes because the Person has no invitations yet.
  - Transaction 2, at the same moment, inserts the user's first invitation on their Person. The enrolled-inviter check (#11) passes because `second_step_at` is still set.
  - Both commit. The same race exists between a factor delete and the owner row written when an entity is created (#10).
- **What it reaches.** The user's Person is shared, or they own a Trust, with no second factor. The rule the issue exists for is broken. Only the user's own actions get there, and they need a step-up, so another person gains nothing. But "the one predicate" stops being an invariant.
- **Fix.** #6, #10, #11, `set_two_factor_enabled` and `sync_second_step` each take `SELECT 1 FROM "user" WHERE id = me FOR UPDATE` as their first statement. One test runs two connections, one deleting the factor and one inviting, and expects exactly one to commit.

## Not blocking

**N1. The sliding refresh.** The ruling adds no trigger on `session` UPDATE, only #3 on INSERT. poly_app cannot update `recent_auth_at` or `user_id`. So getSession's unmarked `UPDATE session SET expires_at, updated_at` meets no guard and gains nothing. Correction to the lead's reading: this is not a gap in the ruling. Add one regression test that a signed-in request still refreshes as poly_app with 0013 applied.

**N2. `method: "otp"`.** Correction to the lead's reading: the database already refuses it, even if `otpOptions` were set. Turning the flag on needs a grant or a step-up and an unverified row. #5 refuses a verified row without a consumed grant. The commit check (#9) refuses the flag without a verified row. Belt and braces, as the live run said: add `method: otp` to the enrolment class's refusals, and a test that fails if `otpOptions` is ever configured.

**N3. R3 #5's passkey stamp, judged against "the session id never proves a session".** It holds, on one condition.
- **Why it holds.** The proof is the grant, not the session id. A grant is minted only by a correct emailed code, for the session named at that moment, and consuming it requires the same session again. The stamp can only land on the session that asked for the code. A stamp never travels to another session.
- **Condition.** Stamp `WHERE id = grant.session_id AND user_id = me`, refuse unless exactly one row is updated, and do it in the same statement block as the consume.
- **What stays open.** With a stolen poly_app password, or code running inside web, an attacker can name the victim and the victim's own real session. During the 5 minutes after that session's enrolment, the step-up check passes for them, because the marker's session id is web's word. This is R-2's reach, narrowed to a 5-minute window, and it closes at POLY-149. R1.2's forge test (a) names a session with no grant. Add a fourth case that records this by design: a real session of the same user with a fresh stamp passes, and is listed in SECURITY R-2.

**N4. Second writers.** poly_govern gets `UPDATE (two_factor_enabled, second_step_at)` on `user`, and every guard lets poly_govern through unchecked. So any present or future poly_govern definer could write `second_step_at` or a factor row, and "only `sync_second_step` writes it" (C7) is enforced by nothing. Add a catalog test:
- only `app.sync_second_step`'s body writes `second_step_at`;
- only `set_two_factor_enabled` and `reset_second_step` write `two_factor_enabled`;
- only `reset_second_step` deletes from `two_factor`, `passkey` or `verification`.

**N5. The password half of the anchor is an app check, not a database one.** R2's issuer checks only the marker. The password is checked by the route's `validatePassword`. A user with no password account passes on "a session created in the last 5 minutes", and a magic-link sign-in creates such a session too. For a user with no password and no IdP account, first enrolment therefore needs only their mailbox. That is the recovery root ARCH already accepts, but SECURITY §4.1 and ARCH §3.1c must say it plainly. They must not claim the database enforces the password.

**N6. Guessing the emailed code.** Three sends per 15 minutes, five tries each, is 15 guesses per 15 minutes, about 1,440 a day, against 10^6 codes. That is roughly a 0.14% chance a day, and each send needs the password. Add a 24-hour cap of 10 challenges per user, and email the user when a code is voided at five wrong tries (once the mailer exists). This is cheap.

**N7. R6: `reset_second_step`'s grant to `poly_operator`. Approved, with conditions.**
- **What a stolen `poly_operator` credential reaches.** It can remove anyone's factors and sign them out everywhere. Re-enrolment still needs the account's password and the emailed code, so a reset alone is a takeover only for someone who also holds both. Otherwise it is a lockout and a downgrade.
- **Conditions.**
  - Match the email the way the unique index does (lower-cased). Refuse when no user is found, with the CLI's non-zero exit.
  - Refuse a tombstoned user.
  - Write a `notification` to the user now, and email them when POLY-137's mailer lands. An operator reset is a security event the user must see (SECURITY §9).
  - Lint keeps the one-caller confinement.

**N8. `user.email` is still updatable with no guard.** poly_app holds UPDATE on `email` and `email_verified`. One statement can point a victim's account at the attacker's mailbox, which defeats the anchor and password reset alike. This is R-2's reach and not this loop's to close. SECURITY R-2 will name it, and POLY-149 inherits it.

## Bubble-up (for the lead, not the ruling)
- **R7 plus the ruling's Open list mean nobody can enrol after this loop.** There are no screens for setting up a second step, and nothing writes `recent_auth_at` apart from first enrolment. So SECURITY R-25's second-factor mitigation stays "not in effect" after POLY-89 merges. Two issues need filing: the second-step screens, and the re-authentication route for "Confirm it's you". SECURITY will say R-25's mitigation is built in the database and not reachable by users.
- **SECURITY edits this loop** (mine, at the build review): R-2 (N3, N8, and B3 if option (b)), R-25's mitigation status, §4.1 (N5).
