# POLY-89 — seceng review of the ruling at `7e73fd7e`

*seceng, 2026-11-16. Read against the ruling at `7e73fd7e`, better-auth and @better-auth/passkey 1.7.18 as installed (code-read), and backend-lead-89's live run. It replaces my review of `41a52277`.*

**Verdict: accepted on one decision (D1) and the conditions below.**

- **Fixed since the last version.** B1 (sign-in's own writes), B2 (`createSession`) and B4 (the race on the exemption) are fixed.
- **What blocks.** D1 is the only blocking item. It is a risk the ruling accepts on the Principal's behalf, and only the Principal can accept it.
- **What qa may start.** qa may write tests now for everything except the backup-code half of R3 #5's unmarked carve-out.

## Blocking

**D1. Backup codes: the ruling accepts the risk (option b) without the Principal.** (R3 #5, [S1, S3])
- **How it works.**
  - BetterAuth stores every user's backup codes encrypted with the one auth secret (code-read: the two-factor plugin's `storeBackupCodes: "encrypted"` default, `backup-codes/index.mjs:19`). Nothing ties the encrypted value to its user.
  - #5 lets `backup_codes` change without a marker, because a sign-in that uses a backup code rewrites it.
  - A trigger cannot tell that rewrite from a copy, because both replace the whole value.
- **What an attacker reaches.**
  - The attack needs SQL as poly_app. An injection bug is enough; no stolen password and no code running in web is needed.
  - One statement copies the attacker's own encrypted codes into a victim's row.
  - SECURITY R-2 already lets that same access plant a magic link for any user. The attacker signs in through the link, then enters one of their own backup codes.
  - The result: signed in as any user who has an authenticator app, with no password and no factor of theirs, and nothing tells the victim. This stays open until POLY-149.
  - The second step is the only thing that stops R-2's magic link for an enrolled user. This hole removes it for every authenticator-app user.
- **Options for the Principal.**
  - **(a) Turn backup codes off. This is my recommendation.**
    - `/two-factor/verify-backup-code` and `/two-factor/generate-backup-codes` go in the Blocked class.
    - #5 refuses any `backup_codes` change without a marker.
    - Cost: one route-policy line, one guard line and two tests, under an hour (a guess).
    - What the user gives up: recovering a lost phone with a backup code. They recover it with a second method (a passkey) or with the operator's `reset-mfa`. On a family instance the operator is a family member.
  - **(b) Keep backup codes as ruled.** SECURITY R-2 then states the bypass above in those words, approved by the Principal, closing at POLY-149.

## Conditions (not blocking; each one is checked at the build review)

**C-a. Sign-in's carve-out needs tests, and the commit-time checks must use the row's own user.** (B1's fix, [S3])
- The carve-out in #5 and #6 is right. Four tests must show it works: as poly_app with 0013 applied, a real TOTP sign-in, a wrong-code lockout, a passkey sign-in and (under option b) a backup-code sign-in each succeed. R8 lists none of them.
- `two_factor_91_consistent` (#9) fires at commit on those sign-in updates, which carry no marker. `sync_second_step` (#8) fires on R6's deletes, which also carry no user marker. Both must compute for the changed row's `user_id` (NEW or OLD), not for `app.current_user_id()`. The "refuse another user's row" check applies only when a marker is present.
  - If #9 uses the marker, sign-in fails at commit.
  - If #8 uses the marker, `reset-mfa` leaves `second_step_at` set. The user is then locked out instead of being sent to set up a second step, which breaks C6.
- Two narrowings:
  - The unmarked carve-out applies only to a **verified** `two_factor` row, since the sign-in step exists only for an enrolled user.
  - An unmarked `passkey.counter` may not go down. An authenticator that always sends 0 still passes.

**C-b. The locks hold only if each check reads after taking its lock.** ([S7], R1.6) A function that reads `second_step_at`, invitations or memberships after taking its lock must be VOLATILE and must read in a statement after the lock. Under READ COMMITTED, only a later statement sees the other transaction's commit. Add the two-connection test to R8: a last-factor delete racing a first invitation on the own Person, and racing an entity's creation. Exactly one may commit.

**C-c. The passkey stamp in #6, judged against "the session id never proves a session". Accepted.** ([S4], [S11])
- **Why it is safe.** The proof is the grant, not the session id.
  - A grant is minted only by a correct emailed code.
  - At minting it is bound to the session named at that moment.
  - Consuming it requires that same session again.
  So the stamp can land only on the session that asked for the code.
- **Condition.** The stamp's UPDATE must hit exactly one row, or the transaction refuses.
- **What stays open, and goes into SECURITY R-2.** With a stolen poly_app password, or code running in web, an attacker can name a victim and that victim's own real session during the 5 minutes after it was stamped, and the step-up check passes. The session id is web's word until POLY-149.
- Add this as a fourth forge case, which passes by design and is documented as such, so the record shows it was looked at.

**C-d. Re-check the claim about passkey delete and rename; the claim is wrong. The closure in #6 and #7 stays.**
- Both routes run BetterAuth's `requireResourceOwnership` middleware before the handler (`passkey/dist/index.mjs`, the `use` arrays of `deletePasskey` and `updatePasskey`; `better-auth/dist/api/middlewares/authorization.mjs`). It loads the passkey by id and refuses when `userId` differs from the session's user. The `WHERE id` the ruling cites is the handler, which runs only after that check.
- So a signed-in user cannot act on another user's passkey through these routes today (code-read).
- #6 and #7 still matter. They are the floor against SQL as poly_app, and against a future BetterAuth release that drops the middleware.
- Change the ruling's sentence to say BetterAuth checks ownership and the triggers are the floor. Keep the test; it then measures both layers.

**C-e. The anchor's substitute for a password is weaker than an IdP round trip.** ([S9], R2)
- A user with no password passes `send-code` with "a session created within the last 5 minutes".
- A magic-link sign-in creates such a session too.
- So for a user with no password, first enrolment needs only their mailbox. That fits "email is the recovery root", but ARCH §3.1c and SECURITY §4.1 must say it in those words, not "a fresh IdP round trip".

**C-f. R6: the `reset_second_step` grant to poly_operator. Approved.**
- **What a stolen poly_operator credential reaches.** It can remove anyone's factors and end all their sessions.
  - Re-enrolment still needs the account's password and the emailed code. So a reset leads to a takeover only for someone who also has both.
  - Without them it is a lockout and a downgrade, and the audit event records it.
- **Conditions, carried from my last review and not in this version:**
  - match the email lower-cased, as the unique index does;
  - refuse, with a non-zero exit, when no user matches or the user is a tombstone;
  - write a `notification` to the user, and an email once POLY-137's mailer exists. A reset is a security event the user must see (SECURITY §9).

## My findings on `41a52277`, re-read against `7e73fd7e`

| Finding | Status | Ruling line it rests on |
|---|---|---|
| B1 sign-in's own writes | **Closed.** Tests are still needed, and #8 and #9 must use the row's own user (C-a). | #5: "Unmarked, only these may change: `failed_verification_count`, `locked_until`, `backup_codes`"; #6: "Unmarked: `counter` only" |
| B2 passkey `createSession` | **Closed.** | "The enrolment class refuses `body.createSession` on `/passkey/verify-registration` with 400"; #3: "`consumed_by = 'totp'`, and `stamped_at` NULL … the stamp fires once" |
| B3 backup-code copy | **Open (D1).** It goes to the Principal. | #5: "An unmarked `backup_codes` rewrite is a residual under R-2 until stage 2" |
| B4 race on the exemption | **Partly closed.** The locks are ruled. Still to do: each check reads after its lock, and the two-connection test (C-b). | R1.6: "`app.refuse_last_method()` takes `FOR UPDATE` … R3 #10 and #11 take `FOR SHARE`" |
| N1 sliding refresh | **Closed.** | #3: "the unmarked refresh (`expires_at`, `updated_at`) … never needs the marker and never stamps"; R8: "the unmarked refresh, passing" |
| N2 `method: otp` | **Closed.** | "`/two-factor/enable` refuses any `body.method` other than `totp`"; "`createAuth` refuses to start if `twoFactor` is given `otpOptions`" |
| N3 the passkey stamp | **Partly closed.** Still to do: the stamp hits exactly one row, and the fourth forge case is recorded (C-c). | #6: "stamps the marker session's `recent_auth_at` (`WHERE id = marker session AND user_id = me`)" |
| N4 who else writes the columns | **Partly closed.** `second_step_at` is covered. Still to do: the flag's writers and the deletes of factor rows (C-a; catalog test). | #8: "A catalog test fails if another function body assigns `second_step_at`" |
| N5 the anchor's password half | **Partly closed.** Still to do: a magic-link session counts as the "IdP round trip" (C-e). | R2: "The password half of the anchor is an app control" |
| N6 guessing the code | **Closed.** The notice waits on the mailer. | R2: "the user's wrong entries in the last 24 hours sum to 10 or more" |
| N7 the R6 grant | **Partly closed.** Still to do: match the email lower-cased, refuse an unknown or deleted user, notify the user (C-f). | R6: "locks the user row … writes `audit_event` kind `second_step.reset`" |
| N8 `user.email` | **Closed** as a stated residual. | R2: "That role can UPDATE `user.email` and so redirect the code. This is R-2's reach" |

## The [Sn] answers, checked against my list

| Item | Verdict |
|---|---|
| S1 | Holds, except the backup codes (D1). |
| S2 | Holds. |
| S3 | Holds, with C-a. |
| S4 | Holds, with C-c. |
| S5 | Holds, with C-a for R6. |
| S6 | Holds. |
| S7 | Holds, with C-b. |
| S8 | Holds. The notice on a code voided at five tries waits on the mailer. |
| S9 | Holds, with C-e. |
| S10 | Holds. |
| S11 | Holds. |
| S12 | Holds. |
| S13 | Holds. |
| S14 | Holds. |
| S15 | Holds. |
| S16 | Holds. |
| S17 | Holds. |
| S18 | Holds. |
| S19 | Holds. |

## For the lead
- After this loop nobody can enrol (R7), and nothing writes `recent_auth_at` except first enrolment (Open). So SECURITY R-25's second-factor mitigation is built in the database but not reachable by users.
  - Two issues are needed: the second-step screens, and the "Confirm it's you" re-authentication route.
  - SECURITY will say exactly this at the build review.
- My SECURITY edits this loop: R-2 (C-c's leftover risk, the unguarded `user.email`, and D1's text under option b), R-25's mitigation status, and §4.1 (C-e).
