# POLY-150 — seceng review of the ruling at `56eec7fa` (seceng-150)

**Reviewed:** `process/cairn/reviews/POLY-150/ruling.md` at `56eec7fa`, against my checklist (31 items), DESIGN at `c93449ad`, POLY-89's ruling and reviews, POLY-149's build review, and SECURITY C-03, C-88, C-89, R-2, R-25 and R-26. I read the code it cites (`anchor.ts`, `handler.ts`, `route-policy.ts`, `apps/auth/src/main.ts`, `packages/config/src/check.ts`, `Dockerfile`, `infra/caddy/Caddyfile`, `serve.ts`, `playwright.config.ts`). I ran nothing.

**Verdict: ACCEPT `56eec7fa` with three required changes (RC1, RC3, RC4) and one condition (RC2).** Each is small, and none changes the ruling's design. They can come in one addendum. qa may write the tests for R1–R10 now, adding these tests.

## 1. Required changes

**RC1. The pin on what poly_app may EXECUTE must move, and the ruling must say so.**
- R2 grants `app.my_second_step()` to poly_app. SECURITY R-2 states that poly_app "executes only ten functions in `app`, pinned both ways by pgTAP" (POLY-149 build review §2.1).
- The ruling should name that pin test and its new count, and list the new function's safety property as POLY-89 R1.5 does for the others. Its property: it reads only the marker's own user and session, writes nothing, and carries the exact-call check.
- Otherwise the build either fails the pin with no ruling to update it from, or someone loosens the pin.

**RC2. Framing: withdrawn. C-07 already covers it, with one condition.**
- I was wrong that no page sets `frame-ancestors`; my search missed `apps/web/vite.config.ts`. Kit's `csp` option (SECURITY C-07) sets `frame-ancestors 'none'`, `connect-src 'self'` and `script-src 'self'`.
- **It applies in production** (code-read, spec):
  - web is built with `adapter-node`, and no route sets `prerender`;
  - Kit sends the policy as a response header on every page it renders on the server, and as a `<meta>` tag only on prerendered pages;
  - browsers ignore `frame-ancestors` in a `<meta>` tag.
- **Condition:** the R10 test that reads the header from the built server's HTTP response stands. The boundary test adds that no file under the second-step routes or Settings exports `prerender`, since a prerendered page would silently lose `frame-ancestors`. No Caddy header is needed.

**RC3. The backup codes can come back with the back button.**
- *How it works (spec):* R10 drops the codes from component state on Continue. Two cases escape that:
  - a user who leaves the codes screen by the browser's back or forward button, or by a link, never presses Continue;
  - a page restored from the back-forward cache comes back with its DOM and state intact.
- *Who can use it:* someone at the same browser later, such as a shared or borrowed computer.
- *What they reach:* the ten codes. Each one passes the second step for someone who also holds the password.
- *Fix:*
  - `/settings/second-step` responses carry `Cache-Control: no-store`;
  - the component clears the codes on `pagehide`, as well as on Continue;
  - R9 spec 1 adds a check: after the codes screen, navigate away, go back, and no code is in the DOM.
- *Cost:* a few lines and one test step.

**RC4. A passkey name is the user's own text and must be shown as text.**
- R2 returns `passkeys[].name`, which the user typed (`/passkey/update-passkey` is open). Svelte escapes `{name}`, but not `{@html name}`.
- *Fix:* a lint or boundary rule bans `{@html` under the two second-step routes and the Settings panel. R9 seeds one passkey whose name is `<img src=x onerror=…>` and checks it shows as literal text.
- *What it would reach otherwise:* code running on the user's own pages, so their own session (self-XSS, unless another member can name a passkey, which no one can). Cheap to pin.

## 2. The points the lead asked me to weigh

**R4, the 503 and the test stand-in: accept.**
- **The 503 comes before the body is read.** No answer depends on the password or on suppression, and no challenge row is written. That closes my checklist gap 2.
- **What the route still reveals.** It runs after the route policy, so a signed-out caller gets 401 and an enrolled user 403. That reveals only the caller's own state.
- **The stand-in cannot reach production** (code-read):
  - `deps.sendSecondStepCode` throws unless `appEnv === 'development'`;
  - the release image sets `POLY_IMAGE_REVISION` (`Dockerfile:30`), so `check.ts:111` refuses `development` there, and `seceng.test.ts:123` pins that;
  - `cli()` passes no `deps`, and the entry point lives under `apps/web/tests/`, which is not in the image.
- **The outbox file** holds codes for test users only, mode 0600, gitignored. The entry fixes the path itself, not from env.
- **What a production user sees.** Until POLY-137 nobody can enrol, so the second factor protects no browser user. SECURITY R-25 keeps saying so. That is the residual, and it fails closed: no entity sharing, no invitations.

**R6, Confirm it's you as a component mounted nowhere: accept.**
- No shipped page offers a check that cannot succeed.
- R5's disabled actions mean an enrolled user cannot remove a lost authenticator from Settings after 5 minutes. Their recovery is the operator's reset-mfa. That is a usability cost, not a hole, and it ends with POLY-151.

**R7, no lock length in web, and `trustDevice` refused: accept. Both are the stronger option.**
- **Lock length.** Showing it allowed no guesses beyond C-88 (my wording read). Showing none also hides the doubling level from a password holder.
  - The cost: the real user does not know when to retry.
  - DESIGN's #locked and #locked-long must drop the clock time and the length so the screens match the ruling (with W1: one locked state).
- **`trustDevice`.** Refusing it closes an unused 30-day skip of the second step on both verify paths. The cookie is never minted, so there is nothing to forge.

**R8, `requireClientIp` true everywhere: accept.**
- In the tests, Vite's proxy overwrites `x-forwarded-for`.
- In production, Caddy has no `trusted_proxies`, which `compose-policy.mjs:309` enforces, so it ignores the client's header and sets its own (spec: Caddy 2.5+ default).
- `clientIpResolved` accepts only a single address.
- Removing Playwright's fixed header, and the forged-header spec, close my checklist item 25.
- "Never raise the limit or add a reset route" is the right rule.

**R10, nothing in logs, page data or the bundle: accept**, with RC3 added. The boundary test (no `fetch`, no `/api/auth`, no `actions`, and no server file for `/sign-in/second-step`) is what keeps every secret out of web's process. Without it R10 would be a policy, not a control.

## 3. The Principal's decisions

**D1. Sign-up asks for the emailed code. Recommend (a), strongly.**
- *How (b) works:* the grant would be minted from the invitation.
  - The invitation link comes from `polycarpic cli user invite`, which prints it to the operator's terminal (`user-invite.ts:29`).
  - The operator passes it on by any channel: chat, a text message, in person.
  - So the link proves who received it from the operator, **not that they control the mailbox**.
- *Who could use (b):* anyone who gets the link on its way to the invitee: a forwarded message, a shared chat, or the operator's own account being read.
- *What they reach:* they would set the account's first factor themselves.
  - With (a), the account's email anchors that step, as it does for everyone else (C-03).
  - (b) would also add a second way to mint a grant inside `claimInvitation`, and any bug there mints grants.
- *What (b) would buy:* invitees could enrol before the mailer exists (POLY-137).
- *Costs:* (a) one extra email per invitee, nil build cost. (b) about $12 and 40 minutes (the architect's guess) plus a review, and a weaker anchor.

**D2. Passkey-only users get no backup codes. Recommend (a).**
- *(a):* there is no code to guess on a passkey-only account, so R-26's "a passkey-only user is not exposed" stays true. A lost passkey is recovered by the operator's reset-mfa.
  - The residual is persuading the operator. Who can use it: anyone who can convince the operator they are the user. They reach a reset second step, and they still need the password or the inbox.
  - The stronger mitigation is cheap: INFRA's reset-mfa runbook says how the operator checks who is asking (devops-engineer; my wording-read W5).
  - Synced passkeys (iCloud, Google) make loss rarer.
  - DESIGN's "add an authenticator app to get backup codes" also nudges users to a second method.
- *(b):* ten guessable codes on a new table that C-88's lock does not cover. They would need their own lock, sign-in-record rows and hold. That is one loop, and a new surface for R-26.

**D3. The two service changes in a screens loop: agree.** Both only tighten, and web cannot reach either.

## 4. Notes (not blocking)

- **N1. R2's `resend_available_at` and `challenge_attempts_left` tell the session holder about suppression and attempts, which POLY-89 R2's identical answer hid.**
  - Who learns it: only someone who already holds the session and the password.
  - The limits are published (C-03), and knowing them adds no guesses: 10⁶ codes, 5 tries per code, 10 a day.
  - Accept. SECURITY §4.1 will say that suppression is visible to the user at build review.
- **N2. Reloading between `verify-totp` and the codes screen loses the codes.** The user regenerates them within the 5-minute window, or later through POLY-151. That is a usability point.
- **N3. The QR encoder runs in the browser with the TOTP secret.**
  - Pin it exactly, with no dependencies and no network calls. frontend-lead names the package and version in the build commit, and I read it at build review.
  - C-07's `connect-src 'self'` stops a compromised encoder sending the secret to another site by `fetch`, but not by a navigation or a form post to the same origin. That is R-25's class: same-origin code is trusted.
- **N4. Open 1 (OAuth and magic-link holds answering JSON) stays unreachable while private-CA returns 404 for OAuth and magic link needs the mailer.** POLY-88 and POLY-137 own it, as the ruling says.

## 5. Checklist items closed by the ruling

| Checklist items | Closed by |
|---|---|
| 1–4 | R1, R10 |
| 5 | R9 storage check |
| 6 | RC3 (page); `/api/auth` POST responses are not stored by browsers (spec) |
| 7–9 | R3, R10 |
| 10–11 | R1, R7 |
| 12 | R4 |
| 13 | `LIMITED` |
| 14–16 | R7, DESIGN |
| 17–19 | R1, R3, R9 spec 6 |
| 20 | R6 |
| 21–22 | R1 `safeNext` |
| 23–24 | R4 |
| 25–26 | R8 |
| 27–29 | R4, DESIGN W3 |
| 30 | C-07 (RC2's condition) |
| 31 | the service's origin check; web has no form actions (R1) |

## 6. SECURITY at build review (not before)

- **C-03:** the screens and the browser tests.
- **R-2:** poly_app's EXECUTE count.
- **R-25:** the screens exist, production enrolment waits on POLY-137, and the page set that takes a secret grows.
- **R-26:** no lock time is shown, and `trustDevice` is refused.
- **§4.1:** sign-up asks for the code (D1), passkey-only users get no codes (D2), and suppression is visible to its own user.
- **C-07:** the second-step pages are covered, and no page there may be prerendered.

---

## 7. Final verdict at `ee09c8d9` (the re-issue at `48acb75c` plus Addendum 1)

**Verdict: ACCEPT `ee09c8d9`. Nothing blocks.** The ruling file is unchanged after it. This section replaces §1's list of open changes. §2–§4 still give my reasons; their numbering follows the ruling at `56eec7fa`, so my D1 and D2 there are the ruling's D2 and D3 now.

### 7.1 RC1–RC4
| Item | Ruled | Result |
|---|---|---|
| RC1 | pgTAP 11 goes to eleven functions, and `sign-in-controls-pins` moves with it. The safety property is stated: it reads only its own user and session, writes nothing, carries the exact-call check and returns no secret | **Met.** |
| RC2 | The CSP header is tested on three pages from the HTTP response; `X-Frame-Options: DENY` in Caddy with a lint entry; no new page prerenders | **Met. Keep the Caddy header.** It costs one line, covers old browsers behind Caddy, and does not clash with the `caddy-csp` lint, because it is not a CSP. **The prerender ban is tested as I asked, indirectly:** e2e runs the built server, a prerendered page is served as a static file with only a `<meta>` CSP (spec), and the header test on those three pages then fails. A future page outside the three has no such test. Acceptable. |
| RC3 | `load` sets `no-store`; the codes are cleared on `pagehide`, on destroy and on Finish; a test follows a link away, then goes back and forward | **Met.** Clearing on `pagehide` is the control that counts, and the ruling says so. |
| RC4 | `{@html` is banned under `settings` and `sign-in`, and in `ConfirmItsYou.svelte`; a passkey name with a script-like payload is seeded | **Met.** |

### 7.2 What the re-issue changed
- **Resend goes back to the password step; `enable` asks for the password again (R3).** Accept. These are the stronger choices. The page keeps no password beyond its own request, so no password sits in component state, and none is left in memory after the request. The cost is that the user types the password up to three times. Each password check needs a session; `send-code` is in `LIMITED`, and `enable` also needs a live grant, so neither gives a password-guessing route to anyone without a session and the emailed code.
- **One lock state; every state offers code, backup code and passkey; the page is the same for every caller (R7).** Accept. This closes W1 and checklist item 10.
- **`resend_available_at` is NULL for both "the 24-hour rule suppresses" and "nothing suppresses" (R2).** Accept. It shows only the published 15-minute cap, and only to the session holder. This replaces my note N1.
- **`codes_paused`, a boolean, on Settings (R2).** Accept. Its reader holds a session, so has already passed the second step. It shows no time.
- **A compromised web can forge `x-forwarded-for` to auth, which is on the same compose network (R8).** Accept, as stated. It reaches the rate-limit bucket and the address in the sign-in record, nothing that grants access. It goes into R-2 at the build review.
- **`Cache-Control: no-store` on every `/api/auth` response (R10, D4).** Accept.

### 7.3 D1: Confirm it's you. Recommend (b), the dialog in its interim, no-input state
- **Mechanism (code-read).**
  - Nothing writes `recent_auth_at` for an enrolled user after the first 5 minutes, and BetterAuth 1.7.18 has no way to re-check an existing session.
  - Under both options, everything in the step-up class is refused after that window: remove a method, make new backup codes, add a passkey, and the other step-up routes.
  - The database refuses these anyway (C-03). The dialog changes only what the user is told.
- **Who it affects.**
  - **The real user, after a loss.** A user whose phone is stolen cannot remove that authenticator. A user whose backup codes leak cannot replace them.
    - Their remedy is the operator's `reset-mfa`, plus ending their own sessions.
    - The stolen phone keeps producing valid codes until the reset. A thief who also has the password can sign in in that time.
  - **An attacker holding a stolen session** also cannot change or remove methods. That is a gain.
- **What anyone reaches:** nothing new. The failure is closed.
- **The stronger option (a), POLY-151 now.** The service would stamp `recent_auth_at` on its own word, because the database cannot check a TOTP code. That proof needs its own design and review.
  - Cost: about +$35 and 1 h 45 min (the architect's guess), and a second ruling on the critical path of a loop that is already the longest so far.
  - A rushed proof design is the larger risk to the Principal.
- **Recommend (b),** on two conditions the lead should carry:
  - POLY-151 lands before POLY-110 and POLY-144, as already filed;
  - INFRA's `reset-mfa` runbook says how the operator checks who is asking, since that runbook is the only recovery path until then.

### 7.4 D5: what a locked person is told. Recommend (b), coarse bands, with conditions
- **Mechanism.**
  - The lock caps guesses whatever the screen says (C-88).
  - A refusal during a lock is not counted, so someone holding the password can already find the end of a lock by retrying. Each try costs a password sign-in, at 5 per minute per address under `LIMITED`, and someone using many addresses goes faster.
  - Since they caused the lock, polling also tells them its length, and so whether the real user reset the doubling. That holds even under (a). It is effort, not something they could not otherwise learn.
- **Who learns what.**

  | Option | What a password holder learns | What the real user learns |
  |---|---|---|
  | (a) | Nothing from the screen | Nothing, for up to a day |
  | (b) | One of three bands, saving some polling | Whether to wait minutes, hours or until tomorrow |
  | (c) | The exact second, and the reset signal directly | The exact time |

- **What none of them reach:** none adds a guess or shortens a lock.
- **The security cost of (b) or (c) is mostly the new code path, not the wording.**
  - The after-hook reads the hold cookie and looks up a user's `locked_until`.
  - If it trusted an unsigned or expired hold, anyone could ask about any user. Only one fact would leak: whether that user is locked, and roughly how long.
- **Conditions for (b):**
  1. Read the hold with BetterAuth's own signed-cookie check, never by parsing the value. Then match the live `verification` row by its exact identifier, unexpired.
  2. Add the field only to BetterAuth's lock refusal, never to any other answer.
  3. Run the tests the ruling lists: no field with no hold cookie, a forged one, an expired one or a session.
  4. If the after-hook does not see the thrown refusal, put the code in `handleAuthRequest` under the same conditions. Do not loosen them.
- **The stronger option (a):** costs nothing and adds no code path. The usability cost is a locked user retrying for up to a day, or asking the operator for a `reset-mfa` they don't need. That reset path is the one an attacker can try to talk the operator into, so it widens what the operator has to defend.
- **(c)** gives the attacker convenience over (b) and the real user little more. I would not take it.
- **The recommendation is (b).** (a) is the right choice if the Principal prefers no new code reading lock state in this loop.

### 7.5 Tags
- Code-read: the C-88 retry behaviour, R8's network reach, and the absence of any `recent_auth_at` writer.
- Spec: serving a prerendered page as a static file with only a `<meta>` CSP, and the back-forward cache's handling of `no-store`.
- Guessed: the costs in §7.3 and §7.4, which are the architect's.

---

## 8. Final verdict at `91c8aea6`, with DESIGN at `afc74388` (0.18.3). This replaces §7's verdict.

**Verdict: ACCEPT `91c8aea6`. Nothing blocks.** From `ee09c8d9` to `91c8aea6` only Addendum 1's RC2 block changed (`git diff ee09c8d9 91c8aea6 -- …/ruling.md`). Everything else in §7 stands, except its Caddy line.

- **RC2: met, as I withdrew it.**
  - No Caddy header is added.
  - R10's header test reads `frame-ancestors 'none'` from the HTTP response on three pages.
  - The R1 boundary test refuses `prerender` anywhere under `routes/{settings,sign-in}/**`, layouts included, and it is shown to fail on a planted copy. This is a direct test, stronger than the indirect one I accepted in §7.1, and it also covers future pages under those paths.
  - §7.1's "keep the Caddy header" is withdrawn. It is not needed: every browser that is still supported honours `frame-ancestors`.
- **RC1, RC3 and RC4:** ruled as in §7.1. Met.
- **D1 and D5:** my assessment for the Principal is unchanged. §7.3 recommends (b), the interim no-input dialog, with its two conditions. §7.4 recommends (b), three bands, with four conditions on the hold-cookie read. (a) is the stronger option and costs nothing.

### DESIGN 0.18.3: the wording against the ruling
| Item | Result |
|---|---|
| W1: one locked state | **Met.** `#locked` says "Use a passkey" for everyone, and `#locked-long` is gone. The step-up variant reads "Use a passkey if you have one". |
| W2: no claimed email | **Met.** `#done` says only that every new sign-in asks. |
| W3: no-mailer state | **Met.** `#no-mail` has one neutral line and no password field. It is shown before anything is checked, and Sign out stays. The send step reads "We've asked for a code to be sent", the same whether the code was sent, was capped or failed. |
| W4: no "this device is new" | **Met.** |
| The lock wording | It matches option (a) today, with no time. If the Principal picks D5 (b), DESIGN gains the three bands, and those are the only change. |
| Wrong-code text | The TOTP and backup-code paths read the same, with no count. |
| Confirm it's you | The not-available state has Close only, and no inputs (R6). |
| Resend and enable | Both ask for the password again, and the page says it keeps none. |
| Viewer `#offered` | Skip for now. It names the entity and the role to the user who just joined, which is the user's own fact. Fine. |

**One wording note, not about security.** `#backup` says "make new codes in Settings if you are running low". Under D1 (b), that is possible only in the first 5 minutes until POLY-151 lands. The designer may add "or ask the person who runs Polycarpic".

**Still to come at the build review:**
- the QR encoder's exact pin (N3);
- SECURITY brought to the current state (§6), with D1 and D5 as the Principal decides;
- R8's forged-address reach added to R-2.

**Accepted tip: `e3e2b003`.** I read `git diff ee09c8d9 e3e2b003`. It keeps the Caddy `X-Frame-Options: DENY` line, which I accept: it is harmless and reverses §8's withdrawal of it. It adds the direct prerender ban with its plant. D5 (b) now carries my §7.4 conditions in full. ACCEPT.

**Addendum 2 at `7d87cbfa`: ACCEPT.** I read `git diff e3e2b003 7d87cbfa`.
- (1) `resend_available_at` is a future time only under the published 3-in-15-minutes cap. It is NULL otherwise, so it never tells the 24-hour suppression apart from "would send now". The resend answer stays the same 200 either way.
- (2) Setting `no-store` on every `/api/auth` response removes the unmeasured dependency on BetterAuth's headers.
- (3) I accept a browser test for Make new codes only, with RC3's steps and an old code refused. Remove on the last method and Remove while paused need no browser test: the controls are the database refusals (POLY-89 R3 #7, POLY-149's delete guard), already tested in `tests/db`, and the button state is cosmetic and covered by the unit test of the pure function. Accepted tip: `7d87cbfa`.

**pgTAP 07 pin at `09a55671`: ACCEPT** (code-read of `app.my_second_step()` in 0018 at `fad5c4a2`). The pin lists exactly one new reader of the marker table, and the function meets R2:
- **It trusts the marker only under kind `session`.** It runs the exact-call check first, then the same `tx_identity … kind = 'session'` test as `recent_auth_ok`, then refuses a NULL user or session.
- **Every row it reads is keyed to the marker's own user.** The challenge and the grant are also keyed to the marker's session.
- **It returns no secret**, only the eight R2 columns: no secret, `backup_codes`, public key, credential id, hash, attempt count, lock time or email. `codes_paused` is a boolean, and `resend_available_at` follows Addendum 2 (`v_wrong < 10`).
- **It writes nothing:** only SELECTs, and the call to the read-only `second_step_needed`. Its owner is poly_govern, with `search_path` set to empty and EXECUTE granted to poly_app only.

The formal build review waits for the gate.

---

## 9. Verdict on the ruling re-issued at `fbf9a527`, with DESIGN at `00412384` (0.19.1). This replaces every earlier verdict.

**Verdict: ACCEPT `fbf9a527`.** The conditions from my gate and dialog assessment landed as I wrote them. Two points need a line from the architect, or the build must follow them as written here (§9.2). Neither blocks the tests.

### 9.1 My conditions
| Condition | Ruling | Result |
|---|---|---|
| [GA] Gate (a): exempt exactly one route, and while held the page loads no shared-entity data | R1.3. The exemption is exactly `/settings/second-step` and its `__data.json`, never the `/settings` tree. Tests cover the trailing slash, `/x`, Sessions and a form POST elsewhere. The page's `__data.json` must not name the seeded "Shared Co" | **Met.** It is still one check before `resolve`, closed by default, as strong as today (assessment §0). |
| [G1] No page form; posts by `fetch` only | R3.0. A portal to `body`, forms with no `action` or `method`, `preventDefault` first, and no JavaScript means no dialog. The test logs requests while the dialog is opened on Settings and on Entities | **Met.** |
| [G2] Codes cleared on every way out | R3.5. Cleared on Finish, close, Escape, a backdrop click, `beforeNavigate`, `onDestroy` and `pagehide`. Spec 1 clicks a sidebar link and goes back and forward. Spec 6 closes the dialog four ways | **Met.** |
| [G3] `no-store` | R10. Set once in `hooks.server.ts` on every signed-in HTML and `__data.json` response, so it covers every page that can host the dialog. `/api/auth` keeps it too | **Met, and stronger than I asked.** |
| [G4] Secrets stay in the dialog's own state; `handleError` serialises none; the object URL is revoked | R3.0 | **Met.** |
| [G5] The `{@html` ban | R1.4. The ban covers every `.svelte` file in web, each test fails on a plant | **Met, and stronger than I asked.** |
| [G6] Boundary and page-data tests on every page that hosts the dialog | R1.4 (all of web), R10 (Settings, Entities, the hold page) | **Met.** |
| [G7] Carrying on as a new request on the rotated session | R3.6. `invalidateAll()`, then the action as a new request, never a replay; the first-enrolment stamp makes the new session fresh | **Met.** |
| RC1–RC4, Addendum 2, the D6 (b) conditions | Folded in unchanged | **Met.** |
| D1: no count of tries left | The Principal chose (a). R2 returns no attempt count and the screens show none | **Met.** |

### 9.2 Two points for the build (the ruling and DESIGN 0.19.1 differ)
- **P1. The entity selector while held.**
  - **The mismatch.** DESIGN's `second-step-required.html` shows the selector listing the own Person, but R1.3 says no entity id or name at all.
  - **The rule I accept.** The own Person may show. Its name comes from the session row (`enter_session` already returns it, `hooks.server.ts`), **not** from an entity-list query filtered in web, because a bug in that filter would put the shared names on screen.
  - **The test.** R1.3's "Shared Co" test is unchanged.
  - If the architect prefers no selector while held, that is also fine.
- **P2. "Goes on to the page they asked for".**
  - **The mismatch.** DESIGN says the held user goes on to the page they asked for, but R1.2 says the dialog needs no `next`, and the gate sends `?setup=1` with no target.
  - **The rule I accept.** If the build carries the target, the gate adds `next` from `safe-next.ts`, and the dialog goes there with the same module in the browser, under R1.2's unit test. Otherwise the user lands on the dashboard.
  - Either is acceptable. An unchecked `next` is not.

### 9.3 DESIGN 0.19.1 wording
- **Dialog states.** They match R3: `#no-mail` has one line and Close, the backup-code step has no Cancel and the Finish check, and `#done` claims no email.
- **The held page.** It names no entity in its message, keeps Log out, and shows nothing else of Settings. That matches R1.3, with P1.

**Accepted tip: `be15ecae`.** I read `git diff fbf9a527 be15ecae`.
- P1: the selector's label comes from the session row, no entity query runs on that route, and the label carries no id.
- P2: `next` passes through `safe-next.ts` at both the gate and the dialog, with `//evil` giving `/`.
- D1 (a) is recorded. ACCEPT.

**Gate assertion for data requests at `cfc65712`: ACCEPT** (spec and code-read; I ran nothing).
- **Why it is the right test.** The gate returns in `handle` before `resolve`, so no `load` runs for a held user. A 200 `{type: "redirect"}` is how SvelteKit carries a redirect on a data request. Allowing 200 or 303, both checked to reach `/settings/second-step?setup=1` and anything else failing, matches R1.3.
- **Recommended, not blocking.** Two cheap additions would make it check "no page data" directly rather than only the absence of the `nodes` key a SvelteKit version happens to use:
  - assert the body's keys are a subset of `{type, location, status}`;
  - assert the raw body text contains no "Shared Co".

---

## 10. The per-entity gate and the set-up dialog: seceng-150's assessment (2026-11-19)

*Recorded from my hand-off. POLY-91 cites it for option (c). The Principal chose (a) for this loop, with (c) filed on POLY-91 (`process/DECISIONS.md` @ 60f45d2f).*

Read at `82608edf`: `apps/web/src/hooks.server.ts`, migrations 0003, 0013 and 0018, and POLY-91. Tags: **measured**, **code-read**, **spec**, **guessed**. I ran nothing.

### 0. Who is held today, and how strong the redirect is

**Who is held.** The gate holds a user while `app.second_step_required()` is true: they have no second step, and they are manager or owner of an entity other than their own unshared Person. Three things make that state hard to reach (code-read, 0013):
- A manager or owner seat for an unenrolled user is refused (`membership_05`).
- An invited manager is seated only when they enrol (`seat_claimed_invitations`). Until then they are not held: they see only their own Person.
- Removing the last method is refused while the user needs one (`refuse_last_method`).

So **in practice the only held user is a manager after the operator's `reset-mfa`**. Reset leaves memberships unchanged. The forced case is rare, and it is exactly the case an attacker aims for: persuade the operator to reset, then sign in with the password alone. The new-invitee case the Principal may be picturing already works his way: the user sees their own Person, and the shared entity appears once they enrol.

**What the redirect is** (code-read, `hooks.server.ts:84`):
- **One check point, closed by default.** It runs in `handle` before `resolve`, for every path that is not public. That covers every page, every `__data.json`, every form action and every `+server.ts`, including routes not written yet. One path is exempt.
- **The database decides.** The answer is `app.second_step_required()`, read in the same transaction as the session marker.
- **It fails closed.** If the call raises, `enter` throws and nothing is served.
- **Its weakness is that only web enforces it.** No RLS policy and no guard reads `second_step_at` for ordinary reads and writes. `app.has_role()` checks the membership role alone, and POLY-91's held role is not built (backlog). So the database would let a held manager do every manager write. Only web's choke point stops it.
- **How strong it is: strong against a page someone forgot**, because there are no per-page checks to forget. **Weak against a bug in those five lines** or a future widening of the exemption. **No protection against code execution in web**, which R-2 already gives the run of every active user. SQL injection by a held user has almost nothing to aim at, since only the exempt page is served to them.

### 1. The options

#### (a) Keep the redirect; its target becomes the Settings panel
- **Mechanism.** As today, but the exempt path becomes the Settings route that hosts the set-up.
- **Who can use a gap:** a password holder for a reset manager.
- **What a gap reaches.** Whatever the exempt page loads and does. This needs two rules, or (a) gets weaker than today:
  1. **Exempt exactly one route** (and its `__data.json`), never the `/settings` tree. Settings also holds Sessions, export, and later account deletion.
  2. **The exempt page loads no entity data.** That includes the app shell's entity selector, if the panel is rendered in the shell. Either render it without shell data, or have the shell show only the own Person.
- **Strength:** the same as today.
- **Cost:** small, inside Addendum 3 (guessed: under $5).

#### (b) A per-entity gate in web's loaders
- **Mechanism.** The global redirect goes. Each loader, action and endpoint that touches an entity checks "shared, and the user has no second step" and refuses or greys it out.
- **Who can use a gap:** the same password holder.
- **What a gap reaches.** Any loader, action or `+server.ts` that forgets the check, now or later, gives **full manager or owner rights on that shared entity**. Entity ids come from URL parameters and the selector, so a hand-typed URL is all it takes.
  - A shared helper (`withEntity(id)`) with a lint rule narrows the risk but does not remove it. It is still only web, and still something each page opts into.
  - **This is weaker than today.** It replaces one check that is closed by default with many checks that are open by default, while the attacker in question is the one this population invites.
- **Stronger option:** (a) or (c).
- **Cost:** guessed $25–35 now, and a check in every future entity page for good. I advise against (b) alone.

#### (c) A per-entity gate in the database
- **Mechanism.** `app.has_role(entity, role)`, which every RLS policy and guard uses, returns false for manager or owner rights on an entity where `own_person_exempt` is false while the user has no second step. That is the same rule as `second_step_needed`, applied per entity.
  - Greying out needs the names of the locked entities: one narrow definer that returns id and name only.
  - This is the machinery POLY-91 already plans: a held role keeps viewer access until enrolment. The two should be one design. The choice is whether a held entity is invisible, viewer-only, or name-only.
  - The own Person keeps working through the exemption.
- **Who can use a gap:** a gap would be a bug in `has_role` itself, pinned by pgTAP like every policy.
- **What it holds against:** a forgotten page, a web bug, and SQL injection as poly_app. It does **not** hold against code execution in web, which is R-2's reach whatever is chosen.
- **What a gap reaches.** If web shows something it shouldn't, the database still refuses, so the greying is cosmetic and safe. Once (c) lands, the global redirect can go.
- **Costs and risks:**
  - `has_role` is on the hot path of every policy, so one extra lookup per check (guessed small; qa should measure it).
  - Its effect on `owner_count` and approvals: a reset sole owner leaves the entity with no effective owner until they enrol. That is safe and closed, but it needs stating.
- **Cost:** guessed one loop, $60–80 and 3–4 h. **It is its own issue, merged with or right after POLY-91, not this loop.**

### 2. Recommendation for the Principal
- **Now (this loop): (a).** It is the only shape as strong as today, and the case it bites is rare (after a reset). Settings is the redirect target, and the set-up dialog opens there.
- **Next: (c) with POLY-91**, so that the database enforces "own Person usable, shared entities greyed". The redirect is then replaced by web greying entities in a way the database backs.
- **Never (b) on its own.**
- **Until (c):** the reset-mfa runbook's identity check (INFRA, devops) carries even more weight, because a reset is the one way into the held state.

### 3. Part 1: what I need for the QR key and backup codes in a dialog on an app page
1. **No page form around it.** The dialog's inputs must not sit inside any page `<form>`, and it posts only by `fetch` to `/api/auth`, never to a web `action`.
   - Entities will soon have form actions (Create entity). A dialog inside that form, or a submit that falls back to the page's action, would hand the password and codes to web's server.
   - Render it outside the page tree (portal). Its submit handler always prevents the default.
   - Test: submitting each step sends no request to web's origin other than `/api/auth/*`.
2. **Codes cleared on every way out.**
   - Clear the URI, key, QR and backup codes on close, Escape, a backdrop click, `onDestroy`, `beforeNavigate` (a client-side sidebar link fires no `pagehide`) and `pagehide`.
   - Closing at the codes step without "I have saved these" asks first, because the codes are already valid.
   - Test: from the codes step, click a sidebar link, then back, then forward; then a full reload, then back. Each time, no code is in the DOM.
3. **no-store.** Codes are never in page data, so a host page's HTML holds none. `no-store` on the host pages is then defence in depth, and clearing on `pagehide` is the control that counts.
   - Set `no-store` on every page that can mount the dialog (Settings, Entities), or say the clearing replaces it. Either is acceptable if the test in item 2 passes.
   - `/api/auth`'s `no-store` (Addendum 2) stays.
4. **State stays inside the dialog.** No Svelte store, context or layout data carries any secret. They live only in the dialog's own component state.
   - No `console` call, and no client-side `handleError` that serialises component state.
   - The download blob's URL is revoked after use.
5. **The `{@html` ban** extends to the dialog component and its folder (`lib/…`), and to every route that mounts it. RC4's literal-text passkey test stays in Settings.
6. **R10's boundary test** covers every route that mounts the dialog: no server file there receives a dialog field, and the R10 page-data and log canaries run with the dialog flow on an app page.
7. **Carrying on with the action** (for example Create entity) happens after `verify-totp` rotates the session. The pending action is sent again on the new handle and never replays a request from before the rotation. The fresh step-up stamp covers it.
8. **Unchanged:** QR as inline SVG with no image URL, the CSP (`connect-src 'self'`, `frame-ancestors 'none'`), the rule that nothing returns the URI after verify, and `/sign-in/second-step` staying a bare page with no server file.

---

## 11. "Trust this device": seceng-150's assessment (2026-11-19)

*Recorded from my hand-off. POLY-154 cites it. The Principal chose to offer it, unticked by default, as POLY-154. R7's refusal stands until that issue ships.*

Read: better-auth 1.7.18 `plugins/two-factor/{index,verify-two-factor,constant}.mjs`, our `packages/auth/src/{second-step,options}.ts`, and migration 0013's `reset_second_step`. Tags: **code-read** (read, not run), **spec**, **guessed**. Nothing here is measured.

### 1. How it works in 1.7.18 (code-read)
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

### 2. Who can use it, and what they reach
| Who | With the password | Without the password |
|---|---|---|
| **A copied browser profile**: an infostealer log, a synced or backed-up profile, a sold or lost computer not wiped | **The whole account**, with no second step, for up to 30 days after the browser's last trusted sign-in. Infostealers take saved passwords together with cookies, and the second step is exactly what defeats that today. | Nothing on `/sign-in/email`. **But with the profile's signed-in webmail, a magic link (once POLY-137 lands) gets in with neither** (the §1 bug). |
| **Malware running on the machine** | It already rides the live sessions (R-2's class). Trust adds **persistence**: new sessions without the factor after those end, for as long as it keeps signing in. | It can usually read the saved password from the same profile. |
| **Someone at an unlocked or shared computer** | Signs in with no second step if the browser fills the password. | Only the sessions already open (unchanged). |
| **A network attacker, another site, another user of this instance** | Nothing: the cookie is Secure and HttpOnly, sent only to `/api/auth`, and bound to the user id by the HMAC. | Nothing. |

**What that reaches:**
- For an owner or manager, the books of every shared entity: R-25's "the second factor makes a captured password alone insufficient" no longer holds for a trusted browser.
- For a viewer, or a user with only their own Person, their own books.

### 3. What SECURITY would have to say
- **C-03:** the second step is asked "on every new sign-in, except in a browser the user chose to trust", with the lifetime, what ends trust, and who may not trust.
- **R-26 and C-88:** a trusted browser never meets the code step, so the lock does not apply to it. That helps the real user, but a stolen trusted profile is not slowed by the lock.
- **R-25:** the protection against a captured password holds only where the user has not trusted the browser.
- **A new open risk** (beside T-101): a copied profile with a trust cookie and a saved password is a full sign-in until trust ends. Who, reach, the stronger option, and the Principal as approver.
- **C-89:** the record marks a sign-in that skipped the second step (condition C3 below).
- **§6.1:** rotating the auth secret ends every trust.

### 4. Conditions
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

### 5. Recommendation
- **The stronger option is still D2 (a), no trust,** at nil cost.
- **If the Principal keeps (b),** it is acceptable with C1–C5. Then:
  - **viewers and own-Person users get the convenience;**
  - owners and managers still meet the second step on every new sign-in;
  - the password is always required;
  - every trusted sign-in leaves a marked line;
  - changing the password or a method ends every trust.
- **C6 and C7 can follow,** C7 with POLY-139.
- **The residual to state to the Principal in one line:** a stolen browser profile with a saved password gets into a trusting viewer's account without the second step, until that viewer changes their password.

---

## 12. Confirm it's you: review of Addendum 3 at `3427c586`

**Verdict: REQUIRED CHANGES (RC5–RC10).** The design is sound and I accept its shape: one writer, the step guard, the single-use passkey challenge, the backup-code evidence, the shared lock and the record row written in the database.
- **RC5:** the ruling's central claim about SQL as poly_auth is wrong in one case that matters.
- **RC6:** the backup-code path as written cannot commit.
- **RC7–RC10:** wording and tests.

None of these changes A1–A5's design except the stamp's time. qa may write the A6 tests now, with RC6 and RC10 folded in.

Everything here is code-read against the tree at `3427c586` and better-auth 1.7.18. Nothing was run.

### 12.1 Against my checklist
| # | Ruling | Result |
|---|---|---|
| M1 one writer | `complete_step_up`: poly_auth only, exact call, kind `auth`, stamps only the marker's session of the marker's user, and must hit exactly one row. pgTAP 08 moves | **Met,** with RC10's catalog pin. The R-2 statement is **not** met (RC5). |
| M2 single-use challenge | The passkey challenge is stored as a hash, one per session, deleted on use. TOTP: the monotone `last_step`. Backup: the code leaves the list | **Met in substance.** The step guard is a fair stand-in for a TOTP challenge. |
| M3 no code twice | `step > last_step`, within ±1, at the re-check. A code first used at sign-in is not covered (Open 5) | **Partly met, accepted as open.** The exposure is narrow: it needs the user's session and password, plus a code seen at sign-in and used within about 90 s. File Open 5 as an issue. |
| M4 the session's own user | `withAuthSession` (proven by the token), and `allowCredentials` limited to the user's passkeys | **Met.** Add a test (RC10). |
| M5 passkey makes no session | A dedicated options and verify pair, `requireUserVerification: true`, no session, the counter written back | **Met.** |
| M6 password plus a factor | Code and backup paths: the password first, the same `step_up_failed` for both, no provider path | **Met.** The passkey path takes no password, and H4 says every path does (RC9). |
| M7 route class | `reauth`: needs a session and `second_step_at`, in `LIMITED`, commits refusals | **Met.** |
| S1 database-checked TOTP | H1 says the database checks no factor. The stronger option is not priced or declined in words | **RC8.** |
| M8 one counter and lock | BetterAuth's counter shape, so `two_factor_15_lock` applies; refused during a lock by the service and the database; passkey stays open | **Met.** |
| M9 rate limit | `LIMITED`, with M8 as the per-user cap | **Met.** |
| M10 backup-code order | Stamp, then the list, with a deferred evidence check | **The design is met, but it cannot commit as written (RC6).** |
| M11 record | `step_up` with its method, written by `complete_step_up` in the same transaction; `step_up_failure` for a passkey | **Met.** |
| M12 window | 300 s, one session, not copied by a rotation | **Met.** |
| M13 the list | "Every step-up action" | **RC7.** |
| M14 last method | `refuse_last_method` unchanged | **Met.** |
| M15 change-email | Not addressed | **Open,** for POLY-137: a security notice. |

### 12.2 Required changes

**RC5. SQL as poly_auth can stamp a session it can use, and with it plant its own second step on any enrolled user.**
- **The claim** (H1, A3.4): poly_auth's SQL stamps only "a session it still cannot use", because it lacks the auth secret and the handle.
- **That holds for sessions other people created.** It does not hold for sessions poly_auth creates itself.
- **How it works** (code-read):
  1. SQL as poly_auth inserts a session for the victim and attaches a handle it chose. Today's R-2 already says so, and `attach_session_handle` allows it in the creating transaction.
  2. In a later transaction it enters that session with `enter_auth_session` (kind `auth`), using the token it wrote.
  3. It calls `complete_step_up('totp', <current step + 1>)`. Nothing checks a code, and the step guard only needs a later step.
  4. The session is now fresh, and poly_auth holds its handle.
- **What it reaches:**
  - **At web, for 300 s,** every step-up action as the victim. Today none exists in web, but export, purge, bank link and account deletion will, once they land.
  - **In the database, directly,** what guard #5 and the passkey guard now allow: a **later factor needs only a fresh step-up** (POLY-89 R3 #5, #6).
    - It inserts a TOTP row with a secret it knows and verifies it, or inserts a passkey of its own.
    - It can then remove the victim's methods (`refuse_last_method` is satisfied by the fresh stamp).
    - **This persists after the breach is fixed:** a password change, a session revocation and rotating the auth secret all leave a planted factor in place. Only `reset-mfa`, or the user noticing it in Settings, ends it.
- **Today's baseline** (code-read, §0 of my checklist): none of this is possible for an enrolled user. `recent_auth_at` comes only from a first enrolment's grant, so a compromised service can act as anyone, but cannot change an enrolled user's second step.
- **Who can use it:** anyone with SQL as poly_auth, through injection in the sign-in service or its stolen database password. Code execution in auth could already do it, since it holds the auth secret (R-2).
- **Required:**
  - (a) **Correct H1 and A3.4** to say this.
  - (b) **Write R-2's new bullet at build review, in these words:** "SQL as poly_auth can create a session for any user, mark it freshly confirmed, and use it. It can then perform every step-up action as that user, including adding its own authenticator or passkey and removing theirs, which outlasts a password change, session revocation and rotating the auth secret. Every such session leaves a `session` and a `step_up` line in the sign-in record, which it cannot remove."
  - (c) **Make a planted factor visible:**
    - every method added or removed writes an `audit_event` (`second_step.method_added` or `method_removed`, with `subject_user_id` and the method kind) **from the database**, through the AFTER triggers on `two_factor` and `passkey` that `sync_second_step` already runs;
    - the Settings panel shows each method's added date, as R2 returns.

    The cost is small (guessed: $4, 15 min). Today only `reset-mfa` writes a second-step audit event (0013:563).
- **The stronger option and its cost:**
  - **The database checks the code (S1).** It closes this for SQL-only attackers. It costs about one loop, and the TOTP seeds become readable to the database server and every backup, where today they are encrypted under the auth secret. It does not help against code execution in auth. **I would decline it,** for the backup exposure.
  - **A planted-factor delay:** a factor added on a re-check works only after 24 hours, and the user is notified. That needs POLY-137's mailer to be meaningful; name it for POLY-137.
  - **The residual for the Principal in one line:** a breach of the sign-in service's database password lets the attacker quietly add their own second step to any account. The database records it, but nothing tells the user until the mailer exists.

**RC6. The backup-code path cannot commit, because the stamp is later than `now()`.**
- `complete_step_up` writes `recent_auth_at = clock_timestamp()`.
- Guard #5 then checks the list write with `step_up_fresh()`, which requires `recent_auth_at <= now()` (0013:118). In the same transaction `now()` is the transaction's start, earlier than `clock_timestamp()`. So the fresh check fails, the list write is refused, and every backup-code re-check is refused.
- `recent_auth_ok` has the same bound (0015:145), which is harmless for later requests.
- **Fix:** stamp with `now()`, the transaction time. The window then starts at the transaction's start, a few milliseconds early, which is harmless. Do not loosen `step_up_fresh`.
- qa's "both orders" test would find this. Rule it now so the build does not discover it at red.

**RC7. List what the fresh stamp unlocks.**
- **Today, at `/api/auth`:**
  - `/passkey/delete-passkey`, `/two-factor/disable`, `/two-factor/generate-backup-codes`;
  - `/unlink-account`, `/link-social`, `/change-email`, `/revoke-other-sessions`;
  - the enrolment class with `second_step_at` set (add a passkey);
  - and, in the database, guard #5's and #6's later-factor writes, plus `refuse_last_method`.
- **Later:** C-03's tenant actions. Name purge and account deletion as **consuming** the stamp (single-use) when they land, so one re-check cannot serve two irreversible actions.

**RC8. Write S1 down.** The database checking the TOTP code: what it closes, what it costs, the backup exposure, and that it is declined.

**RC9. H4's sentence.** The passkey path takes no password, because a passkey with user verification counts as two factors itself. Say so, instead of "every path takes the password and a factor".

**RC10. Two tests.**
- A passkey assertion naming another user's credential is refused, and `recent_auth_at` is unchanged.
- A catalog test fails if any function other than `stamp_recent_auth`'s trigger path and `complete_step_up` writes `recent_auth_at`, or if any role other than poly_govern holds UPDATE on it.

### 12.3 D7: the backup code as a re-check. I recommend (a), not accepting it. The architect recommends (b).
- **How it works.** With (b), the password and one backup code give a fresh stamp. That unlocks RC7's list: removing the user's authenticator, adding the holder's own, new codes, and changing the email.
- **Who can use it:** anyone holding the password and one unused backup code.
  - The codes are designed to be written down or downloaded. DESIGN's Download makes a `.txt`, which usually lands in Downloads.
  - Malware that steals files, or saved passwords and files together, a shared computer, or someone at home who finds the printout.
- **What they reach:**
  - **With (a):** up to ten sign-ins, one per code, each acting as the user at web. Serious, but they cannot change the user's methods, so the user keeps their authenticator, and a password change ends it.
  - **With (b):** the account taken for good. They replace the user's methods with their own, the user is locked out, and only `reset-mfa` recovers it.
- **What (a) costs.** A user who lost their phone signs in with a backup code but cannot remove the lost authenticator or add a new one. They ask the operator for `reset-mfa`, whose runbook carries the identity check.
  - Meanwhile the lost phone still produces valid codes, so a thief who has it and the password can sign in.
  - On a household instance where the operator knows everyone, that is a short wait, not a dead end.
- **Why (a).** Self-service recovery and takeover are the same act here: remove the old factor, add a new one. (b) lets the weaker credential, a code meant to be stored, perform it. (a) puts it behind the operator's check. It saves about $6 and 20 minutes (guessed), and removes A3.3's evidence check, which is the part of this addendum most likely to fail at red.
- **If the Principal chooses (b):** RC5(c)'s audit event becomes required, not just recommended, so a takeover by backup code is at least on the record. Say plainly to the Principal that a found code plus the password is a full takeover.

### 12.4 SECURITY at the build review
- **R-2:** RC5(b)'s bullet.
- **C-03:** the re-check routes, the 300 s window, RC7's list, and D7's choice.
- **C-88:** one counter, and the re-check locks.
- **C-89:** the `step_up` and `step_up_failure` kinds, and the `method` column.
- **R-25:** codes captured from altered pages work once at a re-check, and Open 5 covers sign-in.
- **A new T-entry:** a planted factor by poly_auth SQL.
- **§9:** method changes are audited.

---

## 13. Confirm it's you: review of Addendum 3 re-issued at `671d219e` (replaces §12's verdict)

**Verdict: ACCEPT `671d219e` once RC6 is fixed.** RC6 is one word in A3.2, and nothing else blocks.

The re-issue answers my checklist item by item. It also states H.1's added reach plainly, which is what RC5(a) asked for. I read the whole addendum against the tree. Everything is code-read; nothing was run.

### 13.1 What is left from §12
| Item | At `671d219e` | Result |
|---|---|---|
| **RC5(a)**: say what poly_auth's SQL gains | H.1 says it plainly: stamp any session it holds **or creates**, add its own factor, takeover that outlasts the compromise | **Met.** |
| **RC5(b)**: R-2's wording | H.1's sentence covers the stamp and the factor. §13.2 below is the fuller text to write at the build review | **Met at build review.** |
| **RC5(c)**: a planted factor is visible | Settings lists every method with its added date (R2: `totp_added_at`, the passkeys' `created_at`). That is the one place a user sees it live. No audit event is written | **Accepted as is.** No runtime role reads `audit_event` for a user, so that event would add forensics, not detection. Required instead: **POLY-137's criteria gain "email the user when a second-step method is added or removed"**. The lead files that. |
| **RC6**: the stamp later than `now()` | **Still `clock_timestamp()`** (A3.2, the `UPDATE public.session` line). `step_up_fresh()` needs `recent_auth_at <= now()` (0013:118), so guard #5 refuses the backup-code list write in the same transaction, and A3.3 then rolls back every backup-code re-check | **Required.** Stamp with `now()`. Do not loosen `step_up_fresh`. If D7 (a) is chosen, A3.3 goes, and with it the only in-transaction reader. Still use `now()`, so that no future same-transaction step-up check meets this. |
| **RC7**: the list of what the stamp unlocks | H.3, including the enrolment class, the database guards and web's `revoke_my_session`; purge and account deletion named as consuming | **Met.** |
| **RC8**: S1 written down | H.2. Also: S1 would not close the gap anyway, because the passkey path stays the service's word | **Met. I agree with declining it.** |
| **RC9**: the passkey sentence | H no longer says every path takes the password | **Met.** |
| **RC10**: two tests | T7 refuses another user's credential. T4 pins the single writer | **Met.** Add to T4: only poly_govern holds `UPDATE (recent_auth_at)`. That is minor and does not block. |
| **M2** challenge | Now a database challenge for every method (`begin` → `complete`), single-use | **Met, fully.** |
| **M3** reuse at sign-in | A3.4 feeds sign-in's step into the guard, so a code used at sign-in cannot pass a re-check. Sign-in itself still accepts a reused code (Open 5) | **Met for the re-check.** Open 5 stays open, filed. |
| **M15** change-email | Not enabled; Open 6 keeps it off until it sends a notice and writes a record row | **Met.** |
| Also checked | A3.5 (a marked passkey counter never goes down), `note_totp_step` (SQL can only push `last_step` forward one step, a 30-second denial of one re-check) | **Fine.** |

### 13.2 H.1 for the Principal: what this route adds over today's R-2
**How it works** (code-read).
- The database cannot check a code or a passkey signature, so the sign-in service's word that a check passed is the stamp.
- SQL as poly_auth can:
  1. create a session for any user, with a handle it knows;
  2. stamp that session through `begin_step_up` and `complete_step_up`;
  3. then pass every check that needs Confirm it's you (H.3).

**Who can use it:** anyone who gets SQL as poly_auth, through an injection bug in the sign-in service or its stolen database password. Code execution in the service could already do all of this, so for that attacker nothing is new.

**Today versus with this route**, for a user with a second step:

| | Today (R-2) | With this route |
|---|---|---|
| **Act as the user at web while the breach lasts** | Yes: it reads and writes their books through a session it creates | Unchanged |
| **Step-up actions** (export, purge, bank link and account deletion, once built; changing methods) | No | **Yes,** for 300 s per stamp, as often as it likes |
| **Survive being evicted** | No. Its sessions die when they are revoked or capped. To sign in afterwards it needs the password and the second step. It can set a password hash, but it cannot pass the second step. | **Yes.** It plants its own authenticator or passkey, and sets a password it knows. Afterwards it signs in normally over HTTP. |
| **Lock the user out** | No | **Yes.** It adds its own method first, then removes the user's. `refuse_last_method` is satisfied, because one method still remains: the attacker's. |
| **Survive the user changing their password** | No | **Only if it also changed the email.** It can do that by SQL today, which redirects the password reset. Otherwise the user's new password ends its sign-in, and the planted method alone is useless. |

**For a user with no second step, nothing is new.** Today's R-2 already lets it set their email and password and take the account.

**How it is detected:**
- **Live:** the user sees an unfamiliar method, with its added date, in Settings, or finds they cannot sign in.
- **Forensic:** every stamp leaves a `step_up` row, and every session it created leaves a `session` row. No login role can delete either. But nothing reads them at runtime: only `poly_backup` does.
- **No email** until POLY-137, which is why RC5(c) adds the method-change notice to POLY-137.

**The stronger options:**

| Option | What it closes | Cost | Verdict |
|---|---|---|---|
| **The database checks the TOTP code** (S1) | Nothing on its own: the passkey path stays the service's word | About $15 and 50 min (guess). The TOTP seeds become readable to the database server and every backup | **Declined,** agreed |
| **Bind the stamp to the web handle** | Nothing: poly_auth creates the session and its handle itself | About $4 | **Declined,** agreed |
| **A method added through a re-check, as opposed to first enrolment, waits 24 h before it works; the user is emailed at once and can cancel** | It turns a silent takeover into one the user is warned of and can stop. A user who adds a method for real waits a day | About $12 and 40 min (guess), plus the mailer | **Recommended with POLY-137.** It is meaningless without the email |
| **A worker job that reports `step_up` followed by a method change to the operator** | Detection by the operator | About $10 (guess), plus the mailer or an operator report | With POLY-137 or POLY-64 |
| **Building no re-check (D3 (b), the interim dialog)** | All of it | Nil. Users cannot change methods after 5 minutes without `reset-mfa` | The Principal chose against it, at `d5ec9130` |

**The residual for the Principal, in one sentence:** a breach of the sign-in service's database password can, beyond what it reaches today, plant a second step of its own on any enrolled account and lock the owner out. It leaves a record the user cannot see until the mailer exists, and Settings shows the planted method's date.

**R-2's text at build review:** "SQL as poly_auth can create a session for any user, mark it freshly confirmed, and so pass every step-up check as that user. That includes adding its own authenticator or passkey and removing theirs, which lets it sign in again after it is evicted and lock the user out, until `reset-mfa`. Each stamp leaves a `step_up` line and each session a `session` line in the sign-in record, which it cannot remove. The user sees each method's added date in Settings."

### 13.3 D7: the backup code as a re-check. I still recommend (a), S2
§12.3 stands. On the architect's reason for (b), "the operator's identity check is the weaker control":
- On this instance the operator knows each member in person, while a backup code is a stored secret: printed, or a `.txt` in Downloads.
- Under (b), a found code plus the password is **the same takeover as H.1** (add a method, remove the user's), without needing any breach of the service.
- Under (a), it is up to ten sign-ins that cannot change methods.
- (a) also removes A3.3, the part most likely to fail at red, and with it RC6's only current reader.

If the Principal picks (b), tell them plainly: a found backup code plus the password lets someone take the account and lock the owner out.

**Accepted tip for Addendum 3: `fa3bac5c`.** I read `git diff 671d219e fa3bac5c -- …/ruling.md`.
- **RC6 is fixed.** A3.2 stamps with `now()`, and `step_up_fresh` is unchanged.
- **T4** now pins that only poly_govern holds `UPDATE (recent_auth_at)`.
- **Also in that diff:** the decisions status and R7's lock wording under D6 (b). These match my §7.4 conditions: a band only on the lock refusal, and the fallback wording when no band comes back.
- **ACCEPT.** H.1's residual and D7 are with the Principal (§13.2, §13.3).

**Addendum 4 at `35fd42bd`: ACCEPT** (code-read; I ran nothing). Every caller of these routes already holds the user's session, so each answer below is judged against what that caller can already learn.
- **`step_up_failed` is one code, 403,** for a wrong password, a wrong code, a reused or earlier TOTP step, and a failed or foreign passkey assertion.
  - So a right code refused as reused is not told apart from a wrong one, and a foreign credential is not told apart from a bad one.
  - **One indirect signal remains:** a wrong code moves the shared counter and a wrong password does not. So a caller guessing passwords sees the lock arrive within 10 tries of the right one.
  - That tells them nothing new. The open `/change-password` route already says directly whether a session holder's password is right. Accepted.
- **A wrong password or code does not use up the challenge. That is right.**
  - The challenge exists to make a *successful* stamp single-use, and `begin` is free. Using it up on each failure would add a round trip and no limit.
  - Guesses are bounded by `LIMITED` and by the shared counter and lock (10, then the doubling), exactly as at sign-in.
  - A refused reused step rolls back, so it neither counts as a wrong code nor resets the counter.
- **`challenge_expired`** covers missing, used, expired, another session's and another method's challenge with one code. It reveals nothing about other sessions.
- **The other codes** each tell the caller only facts about their own account, which `mySecondStep` already returns: `method_unavailable`, `no_second_step`, the 429 with no `pausedFor`, and the limiter's 429 with no code.
  - The strict `invalid_request` (extra fields refused) is good.
- **The lock-band amendment** (locked plus an expired hold gives 429 with no band) is accepted. The holder of an expired hold learns only that the account is locked.

**Addendum 5 at `1ff6c9ed`: ACCEPT** (code-read; I ran nothing).
- **Written by the database, on add and remove, on every path.** The event lives in `app.sync_second_step()`, which runs for `two_factor` (INSERT, UPDATE OF `verified`, DELETE) and `passkey` (INSERT, DELETE). No new trigger can be skipped, and the paths are:
  - BetterAuth's routes;
  - direct SQL as poly_auth, which is H.1's planted factor and is tested;
  - `reset-mfa`;
  - a cascade from a deleted user (row triggers fire on cascades).
- **Nothing can change a method silently.** Replacing a passkey's key, or flipping a verified TOTP back, would be a method change without an INSERT or DELETE, and both are already refused (guards #5 and #6). No role holds TRUNCATE on either table: poly_auth has S/I/U/D (0014:17), poly_govern has SELECT and DELETE.
- **Append-only:** written by poly_govern only, with `audit_event_append_only` and `audit_event_no_truncate`.
- **The pending point:**
  - `audit_event` has no CHECK on `actor` or `kind`, and no FK on `subject_user_id` (0002:1-10, 79), so nothing needs widening;
  - a user's delete cascading through their methods can write its rows.
- **Recommended, not blocking:** a `no_truncate` trigger on `two_factor` and `passkey`, so even the table owner cannot clear methods without rows. A superuser can always bypass triggers.
- **The four deploy-gate rows:** agreed.

**Addendum 6 at `df8a4c6f`, and `app.step_up_challenge_hash` at `360246a4` (0019:264-279): ACCEPT** (code-read; I ran nothing).
- **The function matches the addendum:**
  - the exact-call check comes first, then a kind `auth` marker for this transaction;
  - it returns `webauthn_hash` only for the marker user's and the marker session's unexpired passkey challenge, and NULL otherwise;
  - it is STABLE and writes nothing.
- **It gives poly_auth nothing new:**
  - the value is a SHA-256 of a 32-byte challenge that poly_auth itself passed to `begin_step_up`, for its own session only;
  - a hash cannot produce a WebAuthn assertion, because that still needs the authenticator's signature over the challenge;
  - `complete_step_up` still checks the challenge and deletes it, so it stays single-use in the database.
- **Declining the comparison in the database:** agreed, for the reason given. The only forger wrote the hash itself.
- **Build note:** the service should compare the hashes in constant time (`timingSafeEqual`). That is minor, because the challenge is single-use and expires.
- **The no-truncate triggers on `two_factor` and `passkey`,** added in the same addendum and pinned in pgTAP 12, meet my recommendation.
