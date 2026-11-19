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
