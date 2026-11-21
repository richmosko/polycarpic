# POLY-137: seceng review of the ruling at `ad35aa31`

**Verdict: REQUIRED CHANGES (RC1–RC9).** I accept the shape of the design:
- the database decides which add is held (R3.2, R3.3), and no login role can write the hold;
- the guards refuse a held method on every sign-in and Confirm it's you path (R3.4);
- a held method does not count toward the last-method rule (R3.5);
- notices are written by the trigger into an outbox that `poly_auth` cannot touch (R3.6);
- the cancel token lives in the fragment, is stored only as a hash, and a GET never cancels (R3.7);
- D1 (no login role changes `user.email`) and D2 (a notice when backup codes are replaced).

What remains: one row is not ruled, the hold does not fail closed, and three paths let a plant or a token slip past.

Everything here is code-read against better-auth 1.7.18 (the main checkout's `node_modules`) and the tree at `ad35aa31`. I ran nothing.

## 1. Required changes

**RC1. The per-recipient cap row is not ruled.** The row (POLY-137.md @ `3c6e5bee`, which `ad35aa31` contains) has no section in the ruling. Rule it, with each of these:
- **What it covers:** `magic_link`, `reset_password` and `second_step_code` share **one** counter per address.
- **The number:** 10 per **rolling** 60 minutes. A fixed clock hour lets 20 through across the boundary.
- **The key:** the address as **requested**, trimmed and lower-cased, whether or not it has an account.
  - Reason: the magic-link route mails any address with no user lookup (`plugins/magic-link/index.mjs:90-113`, code-read).
  - A key on the account's stored address would leave the route an open relay to non-members. That relay is the reputation risk the Principal bought the cap for.
- **When it counts:** before the provider call. A failed send still counts, so a failing provider cannot be looped.
- **Where the count lives:** in the `auth` process's memory (one instance), never in the request's transaction (C-04's reason: a rollback would erase it). State that a restart resets it.
- **What a capped request answers:**
  - Magic link and reset: **exactly** the uncapped answer (`200 {status: true}` and the same body), with nothing sent. Log `mail.capped {kind}`, with no address.
  - `/second-step/send-code`: a distinct `429 mail_capped` is fine. The caller is signed in and already knows the account.
- **Notices are outside the counter by construction:** they are sent by the worker, in another process.
- **Tests (red first):**
  - The 11th magic-link request for one address within 60 min is byte-identical to the 10th and sends no mail.
  - The same holds for an address with no account.
  - Kinds share the counter: 6 magic links plus 5 resets means the 11th mail is not sent.
  - After the cap, a method-change notice to that address is still sent by the drain.
  - At 61 min the address can be mailed again.

**RC2. The hold must not end before its email has gone out.**
- **The gap:** `usable_at` is fixed at add + 24 h (R3.1). Suppose the notice is late or never sent: the worker is down, the key is revoked, Resend fails, or 10 attempts are used up. The planted method then goes live with no warning, or with less than 24 h to cancel. That is the silent takeover the hold exists to stop.
- **Gate line 19 does not cover it.** `gate-check` runs once, at INFRA §7.1 step 16, before the first account. INFRA says "The deploy itself is not gated" on the Neon path. So "fails a later deploy" does not hold as written. Either drop that sentence, or rule where the gate runs again.
- **Required:**
  - `app.method_held` is true while `usable_at > now()` **or** the hold's `method_added` outbox row has `sent_at IS NULL`.
  - `app.arm_hold_cancel` sets `usable_at = greatest(usable_at, clock_timestamp() + interval '24 hours')` and returns it, so the mail's `{until}` is the database's own value.
  - The cancel link is valid until then.
  - The "not armed" form is then reached only when the hold was cancelled.
- **Tests:**
  - A hold whose mail is still unsent 25 h after the add is still refused at sign-in.
  - A mail sent 23 h late makes the method usable 24 h after the send, and not before.
- **Cost to the owner:** a broken mailer keeps their own new method off until it is fixed. That is visible, and it is the right way to fail.

**RC3. D2 misses the unmarked write: SQL can copy known backup codes into a victim's row with no notice and no hold.**
- **How it works** (code-read):
  - `guard_two_factor`'s no-marker branch lets `backup_codes` change on a verified row, because that is the spend at sign-in (0013, `v_uid IS NULL` branch).
  - The list is encrypted under the instance-wide auth secret, with no binding to the user (`two-factor/backup-codes/index.mjs:19`).
  - So SQL as `poly_auth` copies the encrypted list from an account it controls into the victim's row. It now holds ten codes that work for the victim.
  - D2 writes a notice only when "a marker is present", so this copy writes none, and no hold applies.
  - SECURITY already records the copy (§6.1, the auth-secret row). This loop's promise is that every plant is warned.
- **Required:**
  - `note_codes_replaced` writes a notice for **every** change of `backup_codes` on a row that was verified before the update and has no `step_up_pending` row in this transaction, with a marker or without one.
  - The unmarked case is kind `backup_code_used`: "A backup code was used to sign in to your polycarpic account on {when}. If it was not you, someone has your password and one of your backup codes: change your password and make new codes."
  - The template and the outbox CHECK list each gain the kind. The template shows no count.
  - This also tells the owner each time a found code is used to sign in, which is the case DECISIONS 2026-11-19 accepted.
- **Test:** an unmarked UPDATE that copies another verified row's `backup_codes` writes one `backup_code_used` outbox row.
- **Optional (S):** also refuse an unmarked change whose `octet_length` does not shrink. A spend removes a code; a copy of a longer list does not shrink.

**RC4. A merged `method_added` mail arms only one cancel.**
- **The gap:** R3.2 merges every add in one transaction into one outbox row, and `payload.hold_id` is singular. SQL with a forged marker can insert two passkeys in one transaction.
  - The owner then gets one mail, worded for one method ("{Method} was added").
  - Its link cancels one hold. The other stays live after 24 h.
- **Required:** `cancel_method_hold` cancels **every** open hold of the token's user, and the mail names every method added.
  - An owner who did not add one wants them all gone anyway.
  - Simpler than one row per hold.
- **Test:** two passkeys held in one transaction, one token: both rows are gone and both holds are cancelled.

**RC5. The reset token must not travel in a URL path or query.**
- **The gap:** BetterAuth's mailed URL is `{baseURL}/reset-password/{token}?callbackURL=…` (`password.mjs:81`), and its GET then redirects to `?token=` (`:127`). Both put the token where Caddy's access log, the app's request log and the browser history record it.
- **What it reaches:** for an account with no second step, anyone who reads the log within 15 minutes resets the password and owns the account.
- **Required:**
  - The sender ignores `url` and mails `{origin}/sign-in/reset#{token}`. The sender receives `token` (`password.mjs:85`).
  - The page reads the token from `location.hash`, as the cancel page does, then POSTs `/reset-password`.
  - `/reset-password/:token` becomes `blocked` in `route-policy.ts` (today `open()`, line 39).
  - `redirectTo` is not sent.
- **Test:** the mailed text contains no `/api/auth/` and no `?token=`, and `GET /api/auth/reset-password/x` answers 404.
- The magic link's `?token=` query has the same exposure for 5 minutes. It must stay a GET to set the cookie, so it goes to POLY-138: the edge log must not record that route's query (follow-up 1).

**RC6. The TOTP hold depends on a BetterAuth option.**
- `two_factor_12_method_hold` catches a correct TOTP at sign-in only because BetterAuth writes `failed_verification_count = 0` on success.
- It does that only while `accountLockout` is enabled: `verify-two-factor.mjs:191-193` returns early otherwise. The default is enabled (`:122`), and `options.ts` does not set it.
- One config line, `accountLockout: {enabled: false}`, would turn off the hold on TOTP sign-in, with no test failing except R3.10 #2.
- **Required:**
  - R3.4 states this dependency.
  - `options.test.ts` asserts that the two-factor plugin's `accountLockout?.enabled` is not `false`, and the assertion's message names the hold.

**RC7. The Resend key must be a sending-only key.**
- **The gap:** a full-access Resend key can read back sent mail through the API. That includes magic links, reset links and codes that are still valid.
- **What it reaches:** the key is mounted in `worker` as well as `auth` (R1.3), so a compromise of the lower-privilege worker would become account takeover through `auth`'s mail.
- **Required:**
  - R1.3 says each service gets a Resend API key with **sending access only**, restricted to the sending domain: one key for `auth`, one for `worker`.
  - INFRA §6.1 and its rotation runbook say so.
  - The runbook step checks it: `GET https://api.resend.com/emails` with the key answers 401 or 403. Run it once on staging before the first deploy, and show it failing with a full-access key.

**RC8. The magic-link send: state its transaction and its failure answer.**
- R2.2 rules the reset sender non-awaiting. The magic-link plugin awaits `sendMagicLink` (`magic-link/index.mjs:108`), and the ruling does not say whether `/sign-in/magic-link` runs inside a transaction of ours.
- **Required:** rule one of these.
  - (a) Non-awaiting, like reset.
  - (b) Awaited, outside any transaction, with the 5 s timeout. A provider failure then answers the same status and body for every address: today's 500, or better a 200.
- Either way, test that a `fakeMailer({fail: true})` gives the same answer for a member's address and an unknown one.

**RC9. Two test additions in R3.10.**
- **#6 (the R0 attacker):** `poly_auth` cannot INSERT into `audit_event`. Rule 2 of R3.3 trusts the `actor = 'operator'` rows. If `poly_auth` could forge one, its re-enrolment after removing every method would not be held. Today only `poly_govern` holds INSERT (0003:15), so this pins the fact.
- **#5 (cancel):** add a cancel for user A with user B's session cookie. It cancels A's hold, and B's sessions survive.

## 2. Notes (not blocking)
- **Gate line 17** matches text in a function body (`prosrc`), so a comment can satisfy it. Label it a tripwire in gate-check.sql's comment. The behaviour is proven by R3.10.
- **Gate line 19** also fires on a notice that can never be delivered (an address that bounces, 10 attempts used up). With RC2 such a method also stays held. That is correct, but the runbook should say what the operator does about it.
- **R4.2:** any role can `SET idle_in_transaction_session_timeout` for its own session. The role setting bounds floods and bugs, not a compromised service. I write that into R-24 at the build review.
- **R3.7:** after a retry with an unknown result, the first mail's link no longer works. The page's 400 text covers it ("may have been used already").
- **R2.2:** the known-address path writes a verification row that the unknown path does not write. The extra write is sub-millisecond. Accepted.
- **`trustDevice`** is refused on both verify paths (C-03), so a cancel has no trusted device to revoke. I checked this because a trusted device would bypass the hold.

## 3. SECURITY at the build review
- **C-02:** `/change-password` refuses unless `revokeOtherSessions` is true.
- **C-04:** the new limited routes, `/reset-password/:token` blocked, and the cap (RC1).
- **C-03:** the hold, the cancel, the counting rule and the notices.
- **R-12 / T1:** reset is on, and its token travels only in the fragment.
- **R-24:** the 15 s timeout and its limit.
- **R-2:** the hold and the notices bound the planted-method reach. Add the backup-code copy, now noticed.
- **§6.1:** sending-only keys, one per service.
- **The Confirm it's you risk:** met by the hold, the cancel and the notices. The residual: a stolen mailbox plus a backup code is still a takeover after 24 h with nobody warned (follow-up 2).

## 4. Follow-ups (for the lead to file after merge)
1. POLY-138: the edge access log records no query string for `/api/auth/magic-link/verify` (RC5).
2. A warning in the app that does not depend on the mailbox: Settings shows a held method with "works from {until}", and the signed-in shell shows a banner while a method is held. Today a stolen mailbox loses the only warning. This extends the ruling's own follow-up 2.
3. A notice on a password change or reset. This is the ruling's follow-up 5, and I endorse it. It is the strongest signal of R0.

---

## 5. Review of the replacement ruling at `fab91743` (replaces §1's verdict)

**Verdict: ACCEPT `fab91743`.** Each of RC1–RC9 is met. The new material (R1.8, R1.9, RC3's refusal of a change that does not shrink, D4) adds no reach for an attacker. qa may write the tests now.

I read the whole replacement against the tree, by reading the code; I ran nothing.

### 5.1 RC1–RC9
| Item | At `fab91743` | Result |
|---|---|---|
| **RC1** the cap | R1.8, R1.9. Counter keyed on the stored address. The magic-link sender looks the address up first and mails no address without an account | **Met.** RC1 keyed on the requested address to close the open relay. R1.9 closes the relay outright, so the stored-address key is sound: only members are mailed, and for them the requested and stored addresses are the same. The answers, the counting, where the count lives, the notice exemption and the tests are all as asked |
| **RC2** fail closed | A method is held while `notice_sent_at IS NULL OR usable_at > now()`. `arm_hold_cancel` sets `usable_at` to at least 24 h after the arming. Line 19 is no longer claimed as a monitor | **Met** |
| **RC3** the unmarked copy | D2 writes a notice on every change of `backup_codes`, with a marker or without one (`backup_code_used` when unmarked). An unmarked change that does not shrink is refused | **Met.** The optional size check is taken |
| **RC4** merged adds | One mail id across the transaction's holds. Arming and cancelling act on every held method of the user | **Met** |
| **RC5** the reset token | Travels only in the fragment. `/reset-password/:token` is blocked. No `redirectTo`. Test (f) | **Met.** The magic link's query string is follow-up 8 (POLY-138) |
| **RC6** `accountLockout` | The dependency is stated, and `options.test.ts` asserts it | **Met** |
| **RC7** sending-only keys | R1.3, one per service; the INFRA check is follow-up 7 | **Met.** The runbook check is devops's, before the first deploy |
| **RC8** the magic-link send | (a): not awaited, outside any transaction, and the answer never changes. Tests (d) and (g) | **Met** |
| **RC9** tests | #6 (`audit_event` INSERT) and #5 (B's cookie) | **Met** |

### 5.2 Notes (not blocking; fix at the build if convenient)
- **A stolen `poly_worker` can make a held method live without its mail.**
  - **How:** it calls `arm_hold_cancel`, then `mail_sent`, and never sends. The method then goes live 24 h after the arming, silently.
  - **Why it does not block:** it needs **two** credentials, `poly_auth` to plant and `poly_worker` to mark the mail sent. An injection in `auth` yields only the first.
  - **For the Principal's record:** the ruling's sentence "a stolen `poly_worker` … cannot make one live sooner" is true. It should also say "but it can make one live unannounced". I write that into R-2 at the build review.
- **`purge_mail_outbox`** should delete only sent rows. An unsent row older than 30 days still keeps its method held, because `notice_sent_at` stays NULL, so it fails closed either way. But deleting the row hides it from gate line 19 and from the operator.
- **`magicLink({disableSignUp: true})`.** Since R1.9 mails no address without an account, `/magic-link/verify` can no longer reach a sign-up legitimately. Turning sign-up off there removes `insertsUser` from a route that no longer needs it, which is defence in depth. It is a one-line change, so do it if it fits.
- **Two leftover phrases from before RC4:**
  - R3.7's "What a stolen cancel link can do" still says "remove one method". It now removes every held method.
  - "If arming returns false" should read "returns NULL" (R3.6).

### 5.3 SECURITY at the build review (adds to §3)
- **R-2:** the `poly_worker` note above.
- **C-03:** D2's size check on an unmarked change, and D4.
- **T1:** the reset token is only ever in the fragment; `/reset-password/:token` is blocked.

## 6. Addendum 1 at `bb2dd89f` (after qa's red at `78cbbc94`)

**Verdict: ACCEPT.** I read `git diff fab91743 bb2dd89f -- …/ruling.md`, code-read only.

- **§5.2 is taken in full:**
  - the stolen-`poly_worker` sentence now says "live unannounced";
  - `disableSignUp: true`, with S9's `option-off` row for the magic-link `createUser` site;
  - the two leftover phrases are fixed.
- The test plan's row 7 has `purge_mail_outbox` delete only sent rows, and gate line 24's wording ("sent rows older than 31 days") matches.
- **Items 1–3, 6 and 7** change names and shapes, not reach. Dropping `hold_id` removes a field, and no payload key carries a token or a user string.
- **Item 4:** `42501` with a fixed message, and no value echoed back. Fine.
- **Item 5, the `log` seam:** fine. Every call site passes the fixed field sets of R1.2, R1.8 and R2.2 (`kind`, `status`, `user_id`), never an address, a subject, a body or a `MailError` body. The default writes to `console.error` as `handler.ts:130` does.
  - At the build review I check each `log(` call's fields against that list.
- **Item 8, the 303:** accepted. A signed-out `/API/AUTH/...` meets the sign-in gate, which redirects to our own `/sign-in?next=…` and makes no auth call.
  - **Note (not blocking):** add the same request **with a session** to `auth-pages-137.test.ts`. A signed-in caller passes the gate, so that case is the one that proves web never treats the path as the auth tree. Expect 404 and no call to the auth service.
