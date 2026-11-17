# POLY-89 — seceng review of the first ruling at `41a52277` (superseded)

*Moved verbatim from the comment on POLY-89 (seceng, 2026-11-16) to keep the issue file under its size cap. The ruling in force was re-issued and is reviewed in `ruling-review.md`.*

**Ruling review (seceng) of `41a52277`: changes requested, four blocking.** The full mechanism and fix for each finding are in `process/cairn/reviews/POLY-89/ruling-review.md`. The database guards on factor rows, the on/off flag and the step-up stamp are sound. No new poly_app grant is added.

Blocking:
- **B1. Sign-in breaks.** At sign-in there is no marker yet, but BetterAuth still writes the factor rows: the TOTP failure count and lock, backup codes, and the passkey counter. R3 #5 refuses every write without a marker. Nobody gains access; enrolled users simply cannot sign in. Fix: with no marker, allow UPDATE of only those columns; the passkey counter may not go down.
- **B2. Passkey `createSession: true`.** A first passkey registration creates a second session (measured), and #3 then marks it as recently confirmed. A stolen cookie gets a session that survives revoking the stolen one, with 5 minutes of step-up (change email, revoke other sessions). Fix: the enrolment class refuses `createSession`. #3 stamps only the TOTP replacement session, once per grant.
- **B3. Backup-code copy (needs a decision).** All backup codes are encrypted with one shared secret, so one statement can copy the attacker's own codes into a victim's row. Add the magic link R-2 already lets poly_app plant, and the attacker signs in as any TOTP-enrolled user with no password and no factor, until POLY-149. Option (a), my recommendation: block both backup-code routes, so a lost phone is recovered with a passkey or `reset-mfa`. Option (b): accept it in R-2 with the Principal's approval.
- **B4. A race defeats the exemption.** Deleting the last factor and inviting someone to the own Person (or creating an entity) can run at once, and each passes on the other's uncommitted state. The result is a shared Person, or an owned Trust, with no second factor. Only the user's own step-up actions reach this. Fix: #6, #10, #11, `set_two_factor_enabled` and `sync_second_step` lock the user row first; add a two-connection test.

Not blocking:
- **N1. Sliding refresh.** Not a gap. No `session` UPDATE trigger is ruled, and poly_app cannot write `recent_auth_at`. Add one regression test.
- **N2. `method: otp`.** Already refused by #5 and #9 even if configured. Add a route refusal and a config test.
- **N3. R3 #5's passkey stamp is acceptable.** The proof is the consumed grant, not the session id. Stamp `id = grant.session_id`, exactly one row. Residual: with a stolen poly_app password, an attacker can name the victim's own freshly stamped session within its 5 minutes. That is R-2's reach, recorded there, closing at POLY-149.
- **N4.** Catalog test: only `sync_second_step` writes `second_step_at`; only the two named definers write the flag; only reset deletes factor rows.
- **N5.** The password half of the anchor is an app check. For a user with no password account, a magic-link session passes it, so first enrolment needs only the mailbox. State this in ARCH and SECURITY.
- **N6.** Add a 24-hour cap of 10 code requests per user, and a notice when a code is voided after 5 wrong tries.
- **N7. R6 grant to poly_operator: approved**, with conditions: lower-cased email match; refuse when no user is found or the user is tombstoned; a notification to the user (email once POLY-137 lands).
- **N8.** poly_app's unguarded UPDATE on `user.email` redirects the anchor. That is R-2's reach; SECURITY names it.

For the lead: after this loop nobody can enrol, because there are no screens and nothing besides first enrolment writes `recent_auth_at`. So R-25's second-factor mitigation is built in the database but not reachable by users. Two issues are needed: the second-step screens and the "Confirm it's you" re-authentication route.
