# POLY-154: "Trust this device", seceng's assessment

seceng-150's assessment of "Trust this device" from the POLY-150 loop (2026-11-19), filed whole by team-lead for this issue's ruling. Costs are guesses; nothing is measured. The Principal chose to offer it, unticked by default; who may use it (C5) and the lifetime (C6) are still open.


Read: better-auth 1.7.18 `plugins/two-factor/{index,verify-two-factor,constant}.mjs`, our `packages/auth/src/{second-step,options}.ts`, and migration 0013's `reset_second_step`. Tags: **code-read** (read, not run), **spec**, **guessed**. Nothing here is measured.

## 1. How it works in 1.7.18 (code-read)
- **Issued by** `verify-totp` or `verify-backup-code` with `trustDevice: true` (`verify-two-factor.mjs:43`). Passkey sign-ins never issue it. A passkey-only user is held by our own `passkeyOnlyHold`, which ignores the cookie, so they never benefit.
- **The cookie** is `__Secure-better-auth.trust_device`, with our defaults: `Path=/api/auth`, `HttpOnly`, `Secure`, `SameSite=Lax`. Web never sees it.
  - Its value is `HMAC-SHA256(auth secret, userId!trustId)!trustId`, signed again as a signed cookie.
  - A `verification` row holds `identifier = trust-device-<32 random chars>`, `value = userId` and `expiresAt`.
- **What it is bound to:** the user and that server row, nothing else. It is a bearer token: no device, IP, browser, password version or factor set enters it. Copied to another machine, it works there.
- **What it skips:** on a sign-in path, if the cookie checks out and the row is live, the second step is skipped entirely (`index.mjs:28-53, 310-324`). The password is still asked on `/sign-in/email`.
  - **But our `widenTwoFactorMatcher` adds `/magic-link/verify` and `/callback/:id`** (`second-step.ts:27`, `SIGN_IN_PATHS`). So a trusted browser plus a magic link would sign in with **neither the password nor the second step**: only the inbox. The same goes for a Google or GitHub sign-in. Neither path is reachable today (no mailer, and OAuth answers 404 in private-CA mode), but both will be.
- **Lifetime:** `trustDeviceMaxAge`, 30 days by default.
- **It slides, and it rotates.** Each trusted sign-in deletes the row and issues a new cookie and row with a fresh 30 days (`index.mjs:312-323`).
  - So trust never ends for a browser that signs in at least once every 30 days.
  - Rotation means that if a copied cookie is used, the first user invalidates the other copy. If an attacker uses it first, the real user's next sign-in silently asks for the code again. That is the only signal.
- **What ends it today:**
  - `/two-factor/disable` deletes only the row of the browser that calls it, not other browsers (`index.mjs:292-297`).
  - `reset-mfa` deletes every `verification` row of the user (0013:562).
  - Rotating the auth secret voids every cookie.
  - **Nothing else does:** not a password change, a password reset, "sign out everywhere", adding or removing a method, making new codes, or a lock.

## 2. Who can use it, and what they reach
| Who | With the password | Without the password |
|---|---|---|
| **A copied browser profile**: an infostealer log, a synced or backed-up profile, a sold or lost computer not wiped | **The whole account**, with no second step, for up to 30 days after the browser's last trusted sign-in. Infostealers take saved passwords together with cookies, and the second step is exactly what defeats that today. | Nothing on `/sign-in/email`. **But with the profile's signed-in webmail, a magic link (once POLY-137 lands) gets in with neither** (the §1 bug). |
| **Malware running on the machine** | It already rides the live sessions (R-2's class). Trust adds **persistence**: new sessions without the factor after those end, for as long as it keeps signing in. | It can usually read the saved password from the same profile. |
| **Someone at an unlocked or shared computer** | Signs in with no second step if the browser fills the password. | Only the sessions already open (unchanged). |
| **A network attacker, another site, another user of this instance** | Nothing: the cookie is Secure and HttpOnly, sent only to `/api/auth`, and bound to the user id by the HMAC. | Nothing. |

**What that reaches:**
- For an owner or manager, the books of every shared entity: R-25's "the second factor makes a captured password alone insufficient" no longer holds for a trusted browser.
- For a viewer, or a user with only their own Person, their own books.

## 3. What SECURITY would have to say
- **C-03:** the second step is asked "on every new sign-in, except in a browser the user chose to trust", with the lifetime, what ends trust, and who may not trust.
- **R-26 and C-88:** a trusted browser never meets the code step, so the lock does not apply to it. That helps the real user, but a stolen trusted profile is not slowed by the lock.
- **R-25:** the protection against a captured password holds only where the user has not trusted the browser.
- **A new open risk** (beside T-101): a copied profile with a trust cookie and a saved password is a full sign-in until trust ends. Who, reach, the stronger option, and the Principal as approver.
- **C-89:** the record marks a sign-in that skipped the second step (condition C3 below).
- **§6.1:** rotating the auth secret ends every trust.

## 4. Conditions
Costs are guessed. "Must" means the option is not acceptable without it.

| # | Condition | Why | Cost (guess) | Verdict |
|---|---|---|---|---|
| C1 | **Unticked by default**, with a plain line saying what it skips | Opt-in, as the Principal said | nil | **Must** |
| C2 | **Trust never applies to magic-link or OAuth sign-ins.** A before-hook drops the trust cookie from the request on `/magic-link/verify` and `/callback/:id`, so the password is always the other half | Closes "inbox alone" (§1) | $4, 15 min | **Must** |
| C3 | **The sign-in record marks it.** The service sets a transaction setting (like `poly.client_ip`) when it skips the second step, and the record row stores `second_step = 'trusted'` (others: `code`, `backup_code`, `passkey`, `none`) | Lets the user and the operator tell a trusted sign-in from a checked one. It is the service's word, as the address is | $6, 20 min | **Must** |
| C4 | **Ended by:** password change, password reset, `reset-mfa` (already), adding or removing a method or making new codes, "sign out everywhere", and an email change. One poly_govern definer deletes the user's `trust-device-%` rows, called from those writes (triggers on `account.password`, `two_factor`, `passkey` and `user.email`, and the revoke route) | Without it, a user who changes the password after a theft still leaves the thief trusted | $8, 25 min | **Must** |
| C5 | **Not offered to owners and managers of shared entities** (`second_step_needed()` true): `verify-*` refuses `trustDevice` for them. A raise to manager or owner (seat, or POLY-91's promotion) deletes their trust rows, so trust taken as a viewer does not carry over | The Principal requires the second step precisely for those who can reach others' books. Trust for them undoes that mandate for every stolen profile | $8, 25 min | **Must, strongly recommended.** If the Principal still wants it for managers, the minimum is C6 at 7 days |
| C6 | **A shorter, absolute lifetime:** 14 days from the code entry, not extended by use. Rotation keeps the original expiry, through a hook that copies `expiresAt` | Sliding makes "30 days" mean "forever while used" | $8, 25 min (nil for 14 days that still slides) | Recommended. The minimum is 14 days sliding at nil cost |
| C7 | **A list with Revoke in Settings:** each trusted browser with the date it was trusted and its browser name, stored at issuance (`verification` holds no label, so a column or a side table). A definer lists and deletes only the caller's own rows | Lets a user end one lost device's trust without changing the password | $18, 50 min | Recommended, with POLY-139 (Sessions). C4's password change is the fallback until then |
| C8 | **A lock ends trust** | Not needed. A lock means someone without trust is guessing, and trust lets the real user in during it. C4 covers the follow-up password change | $3 | Not recommended |

**Cost of the "must" set:** C1 + C2 + C3 + C4 + C5, about $26 and 1 h 25 min (guessed), on top of removing R7's refusal.

## 5. Recommendation
- **The stronger option is still D2 (a), no trust,** at nil cost.
- **If the Principal keeps (b),** it is acceptable with C1–C5. Then:
  - **viewers and own-Person users get the convenience;**
  - owners and managers still meet the second step on every new sign-in;
  - the password is always required;
  - every trusted sign-in leaves a marked line;
  - changing the password or a method ends every trust.
- **C6 and C7 can follow,** C7 with POLY-139.
- **The residual to state to the Principal in one line:** a stolen browser profile with a saved password gets into a trusting viewer's account without the second step, until that viewer changes their password.
