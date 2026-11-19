# POLY-150 — Second-step screens: ruling (architect)

**Basis.**
- Branch `feature/poly-150-second-step-screens` @ 56eec7fa. better-auth and @better-auth/passkey 1.7.18; no pin changes.
- POLY-89's ruling (R2, R3, R5, R7), POLY-152's (R1.6, R4, R9), POLY-153's (R4, R5, R6, R7, R8, R10), POLY-149's (R2, R3); ARCH §2.4 (the `SecondStep` read model), §3.1, §3.1c.
- DESIGN 0.18.0 @ c93449ad: flow 5.11, `styled-screens/second-step-setup.html`, `styled-screens/sign-in-second-step.html`, and the edits to settings, sign-up and login. ux-designer-150's questions 5–8 are answered in place, cited as [U5]…[U8].
- seceng-150's checklist (items 1–31), answered in place, cited as [S1]…[S31].
- The tree as read today: `apps/web/src/hooks.server.ts`, `apps/web/src/routes/{sign-in,sign-up,settings/second-step}`, `apps/web/vite.config.ts` (its CSP already sets `frame-ancestors 'none'`), `apps/web/playwright.config.ts`, `apps/web/tests/e2e/{serve,second-step.spec}.ts`, `apps/auth/src/main.ts`, `packages/auth/src/{anchor,second-step,route-policy,handler,options}.ts`, `tests/db/helpers/{second-step,webauthn,e2e-auth}.ts`, `infra/caddy/Caddyfile`, `infra/compose/prod.yml`; better-auth 1.7.18 `plugins/two-factor/{index,verify-two-factor}.mjs` and `api/rate-limiter/index.mjs`.
- This file replaces the ruling at 56eec7fa whole.
- Criteria are C1–C5 in POLY-150's order.

**Tags.** "(code-read)" means read, not run. "(unmeasured)" means qa's red test measures it first; nothing below drops a control on an unmeasured claim, and a red test that contradicts one reopens this ruling (re-issued whole).

## R0. What this loop is, and what it is not

Web gains the screens that reach POLY-89's routes:
- the three-step set-up;
- the held sign-in page;
- Settings → Sign-in and second step.

**Every write is a browser `fetch` to the sign-in service at `/api/auth/*` on the same origin.** Web's server code only reads, through one new definer, inside `withSession(handle)`. Web gains no auth secret, no grant on BetterAuth's tables and no call to the service.

**Not here:**
- the Confirm it's you route (POLY-151; R6 and D1);
- the mailer and the first-method email (POLY-137; R4);
- the role-raise hold and its notice (POLY-91);
- the in-place "Set up a second step first" modal on Create entity (DESIGN `entities.html#second-step-first`), which lands with the first action that needs it, because web has no Create entity yet;
- the provider round trip for a user with no password (POLY-88);
- OAuth and magic-link holds answered as a redirect (Open 1).

## R1. Pages and routes

| Web route | Server code | Browser calls (POST unless BetterAuth's route is a GET) |
|---|---|---|
| `/sign-in` (changed) | none | `/api/auth/sign-in/email`. On `twoFactorRedirect` → `/sign-in/second-step?next=…`; on `secondStepRequired: 'passkey'` → `/sign-in/second-step?with=passkey&next=…`. |
| `/sign-in/second-step` (new, public) | **none**: no server file, no load, no database | code: `/two-factor/verify-totp {code}`; backup code: `/two-factor/verify-backup-code {code}`; passkey: `/passkey/generate-authenticate-options` → `navigator.credentials.get` → `/passkey/verify-authentication`. Success → `next`. |
| `/settings/second-step` (replaces the placeholder; DESIGN's bare page, `second-step-setup.html`) | `load` only: `mySecondStep(handle)` from `@poly/auth/web` (R2), the gate's `secondStepRequired` from `locals`, `recentAuthOk` (`app.recent_auth_ok()`, existing), and the validated `next`. **No form actions.** | With no second step: the set-up (R3). With one: the panel (R5). Sign out: `/api/auth/sign-out` [S29]. |
| `/sign-up` (changed) | unchanged | After a successful sign-up, the page navigates to `/settings/second-step?next=…` instead of showing DESIGN's inline enrolment block (`sign-up.html#second-step`, `#backup-codes`). **The build differs from DESIGN here**: one set-up page serves every first enrolment, and it includes the emailed code (D2). **Skip for now** shows unless the gate requires the step or the invitation's role is manager or owner. The role is in the sign-up page's data today, or its load gains it from the invitation it already reads (code-read pending; a build that finds it absent reports to me). |

**The gate** (`hooks.server.ts`):
- Its only change: the redirect to `/settings/second-step` carries `?next=`.
- Its exemption list is unchanged: `/settings/second-step` alone, with `/sign-in/*` public and `/api/auth/*` outside web [S21].
- Without a handle, `/settings/second-step` redirects to `/sign-in` like every page [S11].

**`next` [S22].**
- One module, `apps/web/src/lib/safe-next.ts`, holds today's rule: a path on this origin, never `//x` or `/\x`.
- hooks, the set-up page's `load` (which returns the validated value) and the two sign-in pages (in the browser, before `location.assign`) all import it.
- A unit test covers `//x`, `/\x`, `https://x`, `javascript:x`, `%2F%2Fx` and an empty value; each gives `/`.

**What web's server code may touch:** `withSession(handle, …)`, then `app.my_second_step()` and `app.recent_auth_ok()`, both through `@poly/auth/web`.

**What it may not** [S1, S2]:
- call or proxy the service (no server `fetch` to `/api/auth` or to `AUTH_PUBLIC_PORT`);
- export `actions`, or add a `+server.ts`, under either second-step route;
- receive a password, a code, the TOTP secret or URI, a backup code, a WebAuthn credential or a BetterAuth cookie;
- name a BetterAuth table (POLY-153 R6's boundary grep covers this one).

A boundary test pins the first two: no server file under `apps/web/src/routes/{sign-in/second-step,settings/second-step}` calls `fetch`, names `/api/auth` or exports `actions`, and `/sign-in/second-step` has no server file.

**The service checks every request** [S17, S31]: the origin check (`routePolicyHook` refuses a cross-origin state change), `AUTH_ROUTES`, the anchor and enrolment classes. The screen order is cosmetic. A page that shows a step out of order gets the service's refusal and shows it. Web accepts no form post on these routes, so it has no cross-origin post to refuse.

## R2. `app.my_second_step()`: the one read

ARCH §2.4's `SecondStep` read model needs facts poly_app cannot read since POLY-149. One definer supplies them.
- **Owner and access.** Owner **poly_govern**, SECURITY DEFINER, `SET search_path = ''`, EXECUTE **poly_app only**. The canonical call is `SELECT * FROM app.my_second_step()`, under 0011's exact-call check. It refuses 42501 unless the marker exists with `kind = 'session'`.
- **Returns one row for the marker's user and session:**
  - `second_step_at`;
  - `totp_added_at`: the verified `two_factor` row's `created_at`, else NULL;
  - `passkeys` jsonb: `[{id, name, created_at}]`, ordered by `created_at`;
  - `challenge_expires_at`: the open `first_enrolment` challenge **for the marker session**, else NULL;
  - `resend_available_at`: when `issue_email_challenge` would next issue under the 3-in-15-minutes rule (`now()` when it would issue now). It is **NULL both while the 10-wrong-in-24-hours rule suppresses and when nothing suppresses**, so it never says which rule applies;
  - `grant_expires_at`: the live grant for (user, marker session), else NULL;
  - `needs_a_method`: the user holds manager or owner on an entity where `app.own_person_exempt` is false. This is the rule `refuse_last_method` applies. The gate's `second_step_required()` cannot serve, because it is false once the user is enrolled;
  - `codes_paused`: the verified `two_factor` row's `locked_until > clock_timestamp()`. A boolean only, never the time [S14] (DESIGN `settings.html#second-step-paused`).
- **Never returned:** a secret, `backup_codes`, `public_key`, `credential_id`, `code_hash`, the attempt count [S16] (DESIGN's question 3, option a) or the email. A catalog test pins the return columns.
- **Derived in `@poly/auth/web`:** `step` (ARCH §2.4) is `factor` while `grant_expires_at` is set, `email_code` while a challenge is, else `password`. `enrolment` is null once `second_step_at` is set. The set-up restarts at the password (DESIGN `#restart`) when the page is at `factor` and the service answers 403 `email_confirmation_required`.
- **Migration `0018_my_second_step`:**
  - adds `two_factor.created_at timestamptz NOT NULL DEFAULT now()`. BetterAuth's INSERT does not name the column, so the default fills it (unmeasured);
  - creates the definer, which `definers.json` lists.
  - poly_govern already holds SELECT on `two_factor` and `passkey`, and reads the two app tables in its own definers (code-read). **A build that finds a grant short reports the failing statement to me and adds nothing.**
- **"Backup codes left" is not shown.** The codes are encrypted with the auth secret, so the database cannot count them (Open 3). The build differs from DESIGN's Settings panel here.

## R3. The set-up, step by step (C1, C3, C5)

All three steps run in `/settings/second-step`'s page, in component state. A reload re-derives the step from R2.

1. **Your password** (`#password`; `#held` when the gate sent the user).
   - The page sends `POST /api/auth/second-step/send-code {password}` (`autocomplete="current-password"` [S5]). The route is in `LIMITED` [S13].
   - The response gains **`sentTo`**, the masked current address. The service computes it, since it already holds `user.email`, and it is the same whether the code was sent or suppressed.
   - Every user in this loop has a password: OAuth is off in private-CA mode, and magic link needs the mailer. So DESIGN's line "Signed in with Google or GitHub only? Continue sends you to that provider" is **not built** until POLY-88. A `recent_sign_in_required` answer shows "Sign in again", which signs out to `/sign-in`.
   - `email_not_verified` and `invalid_password` are shown inline. Both are facts about the signed-in user's own account [S13].
2. **Check your email** (`#email`, `#email-error`).
   - The page sends `POST /api/auth/second-step/confirm-code {code}` (`autocomplete="one-time-code"`).
   - A 403 `invalid_code` shows DESIGN's one wrong-or-expired message, with no count of tries left.
   - **Resend returns to the password step** with the field empty. The build differs from DESIGN, whose resend link takes no password: the service checks the password on every send, and the page keeps no password in memory past its own request [S5, S15]. The cap stays the service's; the page never retries by itself.
   - On reload, the copy says "your account email" in place of `sentTo`.
3. **The factor** (`#app`, `#app-error`, `#passkey`, `#passkey-wait`, `#passkey-error`).
   - **Authenticator app.**
     - `POST /api/auth/two-factor/enable {password}` returns `{totpURI, backupCodes}`. The page asks the password again on this step, since it keeps none; DESIGN's step 3 adds the field.
     - The QR code is drawn **in the browser** as inline SVG by a pinned, dependency-free QR encoder, which frontend-lead picks with an exact pin. It makes no image request and needs no CSP change [S4]. The key is shown typed out.
     - `POST /api/auth/two-factor/verify-totp {code}` rotates the session. Its response sets the new session cookie and the new `__Host-poly_handle` (POLY-153 R5).
     - After a successful verify, the URI, the key and the QR are dropped from state. No route returns them again: `/two-factor/get-totp-uri` stays `blocked` [S7, S9].
   - **Passkey.**
     - `/passkey/generate-register-options`, then `navigator.credentials.create`, then `/passkey/verify-registration {name}`. The page never sends `createSession` (POLY-89 S16) [S19].
     - The session does not rotate; the marker session is stamped.
     - **No backup codes** [U5]. DESIGN's "Next you get ten backup codes" on the passkey card changes to "Add an authenticator app in Settings to get backup codes" (D3).
4. **Backup codes** (`#backup-codes`; authenticator app only).
   - The ten codes from `enable`'s response are shown only after a successful verify, with Copy all and Download. Download is a client-side `Blob`; no request is made.
   - **Finish** stays disabled until "I have saved these" is checked [S8]. Leaving by any other way drops the codes, and nothing shows them again: a reload, the back button or a revisit shows none, because no page data or route holds them [S7].
   - The codes are valid from the verify. A user who lost them makes new ones in Settings, which needs a fresh check (R5, R6), or asks for `reset-mfa`.
5. **Done** (`#done`). DESIGN's sentence "We sent a note to … saying it was turned on" is **not built**: no mailer sends it until POLY-137. **Continue** goes to `next`, and the gate clears because `second_step_required()` is now false.

**What the service returns, and the neutral message on step 1** [S12, S27, S28].
- **No mailer (production until POLY-137).** `apps/auth/src/main.ts` passes **no** `sendSecondStepCode`. `send-code` then answers **503 `{code: 'mailer_unavailable'}` as its first statement**, before it reads the body, checks the password, counts the call against the cap or issues a challenge.
  - Every caller therefore gets the same answer, whether the cap applies or not.
  - The suppressed 200 the checklist found cannot be reached while no mailer exists.
  - Today's throw at send time goes. It was a 500, reached only after the password check and only when no cap applied, and that was the oracle.
- **With a mailer:** a sent code and a suppressed code both answer `200 {status: true, sentTo}`, unchanged from POLY-89 R2.
- **The screen contract:**
  - Every 200 shows `#email` with "We sent a code to <sentTo>" and the same resend line, whatever the cause. No message, status, timing or `resend_available_at` value tells a suppressed send from a sent one.
  - A 503 `mailer_unavailable` shows one fixed message on step 1: "Codes can't be sent from this server yet, so a second step can't be set up. Ask the person who runs Polycarpic." It carries no error string, no status number and no word about configuration. The password field is cleared once and the page does not loop. Sign out stays available.
  - Nothing falls back: no code on screen, in a log or by another path. ux-designer-150 adds this state to DESIGN.

## R4. Browser tests get the code from a delivery stand-in, not a route [S23, S24]

- **The seam.** `startAuthService(env, deps = {})` gains `deps.sendSecondStepCode`.
  - It throws `ConfigError` unless `config.appEnv === 'development'`, and `loadConfig` already refuses `development` in a release image (`check.ts:111`).
  - `cli()` passes no `deps`.
  - A unit test pins three things: `main.ts`'s `cli()` passes nothing; `startAuthService` refuses `deps` under staging and production; and `apps/auth/src/**` names no outbox, no file sink and no test entry.
- **The test entry.** The e2e harness starts the service from `apps/web/tests/e2e/auth-entry.ts`, which calls `startAuthService(process.env, { sendSecondStepCode })`.
  - The stand-in appends `{email, code}` as one JSON line to `apps/web/tests/e2e/.auth/outbox.jsonl`, which is gitignored and written with mode 0600.
  - The entry fixes that path in its own code. No env var names it, and the shipped image reads no env var for it.
- **What this exercises:** the real handler, the real anchor, `issue_email_challenge` and `confirm_email_challenge` on poly_auth, and the real rate limit. Only delivery is replaced, which is the seam POLY-137 fills.
- **Why it is unreachable in production:** it is no route, no flag and no env switch. Reaching it needs an in-process import of `startAuthService` with a `deps` argument under `APP_ENV=development`, which a release image refuses. `tests/` is not in the image; the image test lists what is.
- **Using it.** A spec reads the outbox by its own user's email and takes the line written after its send. The code cannot be recomputed from the database, which holds only a hash.

## R5. Settings → Sign-in and second step (C3)

With `second_step_at` set, the page lists the methods from R2: the app with `totp_added_at`, and each passkey with its name and date. The actions are all browser calls to the service:
- **Add passkey** (`/passkey/generate-register-options`, `/passkey/verify-registration`): the enrolment class with `second_step_at` set, so it needs a fresh step-up.
- **Remove:**
  - a passkey: `/passkey/delete-passkey`;
  - the app: `/two-factor/disable {password}`.
- **Make new codes** (`/two-factor/generate-backup-codes {password}`): the codes are shown once, as in R3.4.
- **Freshness.** Remove and Make new codes are the step-up class. While `recentAuthOk` is true (5 minutes after a first enrolment) the actions run directly. Otherwise they open Confirm it's you in its interim form (R6).
- **The last method** has no Remove while R2's `needs_a_method` is true, and the panel says why. The database refuses it anyway (POLY-89 R3 #7).
- **While `codes_paused`**, Remove is disabled, as DESIGN `#second-step-paused` shows. POLY-149's delete guard refuses it anyway.
- **Not in this loop:** Change password (not in POLY-150's criteria; DESIGN keeps it on the panel for a later issue).

## R6. Confirm it's you [S20, U8]

The gap: nothing writes `recent_auth_at` for an enrolled user after the first 5 minutes, and BetterAuth 1.7.18 has no re-check against an existing session. The choice is D1. **Ruled here, recommended (b):**
- **Built:** `ConfirmItsYou.svelte`, the dialog as DESIGN draws it: the action's name, password and code or a passkey, the provider path, and its error states (`settings.html#step-up-states`). It takes a `confirm` function prop and is covered by a component test with a stub.
- **Mounted** on R5's step-up actions when `recentAuthOk` is false, in its **interim state only**. The dialog names the action and says, plainly, "Confirming it's you isn't available yet. Changes to your second step can be made in the first 5 minutes after setting it up, or the person who runs Polycarpic can reset it." Its only button is Close. It shows **no password, code or passkey input**, because an input that cannot succeed invites retries and guesses. The form states switch on when POLY-151 supplies `confirm`.
- **Never in this loop:** web, a password alone, or a backup code stamping `recent_auth_at`. No route or definer here writes it (C-03).

## R7. The held sign-in (C2, C4)

- **What a hold leaves.** A held sign-in has no session and no handle: twoFactor's hold deletes the session (code-read, `index.mjs:338`), and `attach_session_handle` returns false (POLY-153 R3). The hold lives in `__Secure-better-auth.two_factor` at `Path=/api/auth`, which web never sees.
- **How web knows to show `/sign-in/second-step`:** only from the sign-in response body, which the sign-in page already reads (R1).
  - The `with=passkey` parameter is a display hint that opens the passkey state; it grants nothing.
  - **The page is the same for every caller** [S10]: the same HTML, status and states, with no email, no list of factors and no "passkey available".
  - **Every state offers the code, a backup code and a passkey.** The page cannot know which methods the user has: `twoFactorMethods` lists TOTP only. Opened with no hold, the page's first call gets 401 and shows `#expired`.
- **The hold's lifetime [U7].** BetterAuth sets the hold cookie and its `verification` row to `twoFactorCookieMaxAge ?? 600` seconds, and we do not set the option (code-read, `index.mjs:341`). That is 10 minutes (unmeasured). qa measures two things:
  - the hold cookie's `Max-Age` is 600 and the row's `expiresAt` is 600 s ± 5 after the sign-in;
  - a hold whose row a superuser helper has moved past `expiresAt` answers 401 → `#expired`.
  
  The 5-wrong-codes end is measured already (ARCH §3.1c). If 600 fails, DESIGN's "10 minutes" changes to what was measured; the limit does not.
- **Wrong codes [S16].** A wrong TOTP code and a wrong backup code show one message each, as DESIGN has them, with no count. Until the lock, the service's refusal is the same for both.
- **The lock [U6, S14].**
  - **The service does not return `locked_until`, and should not.** It would tell someone who holds the password exactly when to resume, and successive lengths would show whether the real user reset the doubling.
  - The build shows **one** `#locked` state: "Codes are paused for this account. Each pause lasts longer, from 15 minutes up to a day. Use a passkey, or try again later." It also keeps DESIGN's "If this wasn't you…" and the reset line. That is the general rule, not this pause's time.
  - **The build differs from DESIGN:** no time left, no clock time, and no `#locked-long`, which would need to know whether a passkey exists. The passkey button is always offered; a user without one gets the passkey failure state.
  - The page never retries by itself and never offers anything that shortens a lock [S15].
- **`trustDevice` is refused** [DESIGN question 4, option a].
  - DESIGN asks again on every new sign-in, but BetterAuth's `trustDevice: true` would skip the second step in that browser for 30 days.
  - `routePolicyHook` answers 400 `trust_device_refused` when `body.trustDevice` is truthy on `/two-factor/verify-totp` or `/two-factor/verify-backup-code`, and the page never sends it.
  - Tests: each path with `trustDevice: true` gets 400, no session and no `trust_device` cookie.

## R8. Browser tests behind a proxy that sets the client address [S25, S26]

- **Production** (code-read, `infra/caddy/Caddyfile`). Caddy's `reverse_proxy` has no `trusted_proxies`, so it replaces any incoming `X-Forwarded-For` with the connecting address; it does not append.
  - The auth container publishes no port (`prod.yml`). It is reachable from Caddy and from the containers on its compose networks, web included.
  - So a compromised web could send the service a forged address. That reaches only the rate-limit bucket and the address in the sign-in record. SECURITY states it at build review.
- **Dev and e2e: the proxy already there.** In dev and in `vite preview`, `/api/auth` reaches the service through Vite's proxy.
  - Its `configure` hook sets `x-forwarded-for` on every proxied request to the browser socket's address (`::ffff:` stripped), **overwriting** whatever the browser sent, as Caddy does.
  - Vite's proxy is dev tooling and is not in the built web server.
- **`requireClientIp` becomes `true` in every `APP_ENV`** in `startAuthService`. The development exception existed only because the dev proxy set no address.
  - serve.ts's readiness probe on `/api/auth/ok` sends `x-forwarded-for: 127.0.0.1` itself, since it is the harness acting as the proxy.
  - The in-process `tests/db` suites pass their own value, unchanged.
- **Playwright's `extraHTTPHeaders: { 'x-forwarded-for': … }` is removed.** No browser test proves anything that depends on trusting the client's header.
  - A spec sends a forged `x-forwarded-for: 198.51.100.9` on a real sign-in. The sign-in record's `ip_address` must be the loopback address, not the forged one (POLY-149 R3).
- **The rate limit is real in e2e.** Every browser request shares one address, so `LIMITED` allows 5 calls per path per 60 s across the suite. That the suite fits is (unmeasured).
  - If a 429 appears, the fix is ordering (`serial` files, fewer sign-ins per spec). It is **never** raising the limit, forging the address or adding a reset route.
- **The 429 spec [S26]** is its own Playwright project, `rate-limit`, which depends on the main project and so runs after it. Six wrong `/second-step/confirm-code` calls within a minute: the 6th gets 429 with BetterAuth's standard body, and the page shows its rate-limit message.

## R9. The browser tests (C4, C5)

**Seeds.** serve.ts seeds through the service's code path (POLY-153 R10), one user per state-changing spec, so specs share no state:
- Enid and Pia: managers with no second step;
- Tess: a manager with TOTP enrolled through `handleAuthRequest`. Her base32 secret and backup codes are written to `.auth/` with mode 0600, for the spec's `totp()` helper;
- Kay: a manager with a passkey only, enrolled through `tests/db/helpers/webauthn.ts`;
- Lou: a manager with no second step, for the step-out-of-order spec.

**The specs:**
1. **Enrol by app (C5).** Enid signs in and is sent to `/settings/second-step` (`#held`). She gives the password, reads the code from the outbox, gives the password again, reads the key from the page's typed-out key, enters a TOTP, sees ten codes, checks "I have saved these" and finishes at `next`. Then:
   - a reload of `/settings/second-step` and a back navigation show the panel and no code [S7];
   - a re-sign-in as Enid is held.
2. **Enrol by passkey (C5).** Pia does the same through a Chromium virtual authenticator (CDP `WebAuthn.addVirtualAuthenticator`). She sees no backup-code screen, and the request carries no `createSession`.
3. **Held by code (C4).** Tess signs in and is sent to `/sign-in/second-step`. There is no `__Host-poly_handle`, and `/dashboard` answers 303 to `/sign-in`. A wrong code leaves her held; the right code sets the handle and reaches `next`.
4. **Held, backup code.** Tess signs in with one backup code; the same code a second time is refused.
5. **Held, passkey only.** Kay signs in by password and lands on `?with=passkey` with no handle; the passkey sign-in reaches `/dashboard`.
6. **Step out of order** [S17]. As Lou, by direct `fetch` from the page context and not through the UI: `confirm-code` with no challenge, then `enable` with no grant. The service refuses both and nothing is enabled.
7. **The address** (R8), and `/sign-in/second-step` with no hold [S10]. An anonymous visitor, Enid and Tess each open it with no hold and get the same status, the same states and the same text.

`second-step.spec.ts`'s placeholder test ("has no form") is replaced by spec 1; C1 and C6 stay.

## R10. What never reaches web's logs, page data or the client bundle

- **Never in web's server at all** [S1]: the password, the emailed code, the TOTP secret and `totpURI`, backup codes, WebAuthn credentials and BetterAuth's cookies. They exist only in browser memory and in `/api/auth` request and response bodies, which web never sees (R1).
- **Never in page data** [S2]: all of the above, plus the handle.
  - `mySecondStep`'s output is R2's columns only.
  - The test fetches the rendered HTML and `__data.json` of `/settings/second-step` (before and after spec 1) and of `/sign-in/second-step`, and finds none of a seeded user's secret, backup codes, credential id or public key.
- **Never in the bundle:** no env value; the existing build checks stand.
- **In the browser** [S4, S5]:
  - codes live only in component state, never in a Svelte store that outlives the page;
  - never in a URL, its fragment or `history` state, in storage, in a `console` call or in an error message.
  - Spec 1 and spec 3 assert, after the flow, that `localStorage`, `sessionStorage`, IndexedDB and `document.cookie` hold none of them, and that no URL in the page's history or its requests' query strings does.
- **Headers** [S6, S30]:
  - `handleAuthRequest` sets `Cache-Control: no-store` on every `/api/auth` response, whatever BetterAuth sent. That BetterAuth sends none on `enable` is (unmeasured); the header is set either way.
  - Web's CSP already sends `frame-ancestors 'none'` and `script-src 'self'`, with no third-party script.
  - A test reads both headers on the two new pages from the HTTP response (a `<meta>` CSP cannot carry `frame-ancestors`), and `Cache-Control: no-store` on `enable`'s response.
- **Logs** [S3]: the existing canary log test gains the emailed code, the password, the TOTP secret and the backup codes. Spec 1 and spec 3 run with web's and the service's stdout and stderr captured, and no line may contain any of them.

## R11. One PR, and the cost

**One PR.** The pages need R2's definer and the service changes in R3, R7, R8 and R10, and the e2e proves them together. A split costs a second loop and CI run (about $12 and 30 minutes, guess) and leaves one half untestable in a browser.

| Part | Cost (guess) | Active time (guess) |
|---|---|---|
| Design (150a, done) | $8 | 30 min |
| Ruling, its re-issue, and seceng's review (150b, c) | $12 | 45 min |
| Tests: 7 e2e specs and the 429 project; the harness (outbox, seeds, virtual authenticator); definer, service and header tests (150d) | $20 | 55 min |
| Build: three pages, the dialog component and its interim state, 0018, the service changes, the Vite proxy (150e) | $25 | 75 min |
| Verdict and ARCH (150f) | $7 | 25 min |
| **Total, D1 (b)** | **$72** | **about 3 h 50 min** |

Compared with POLY-149's $58 in 2 h 40 min, this loop has less SQL and more browser work. The main risk to the time is e2e flakes on the shared rate limit.

## Decisions for the lead (the Principal's where marked)

- **D1 (Principal, recommend b). Confirm it's you has no route.**
  - **(a) Bring POLY-151 into this loop.** It needs its own ruling first, because the database cannot check a TOTP code: the secret is encrypted with the auth secret. A stamp the service writes is therefore the service's word, and that needs its own proof design and seceng's review. Then its tests and build. About **+$35 and +1 h 45 min** (guess), so about $107 and 5 h 35 min in one PR, with a second ruling cycle on the critical path.
  - **(b) Ship the dialog in its interim state (R6).** It names the action and says plainly that it cannot confirm yet. It has no inputs, so it invites no retries. About **+$3** over not mounting it (included above).
  - The failure is closed: until POLY-151, an enrolled user can change their methods only in the first 5 minutes after setting one up, or by `reset-mfa`. Nobody gains reach.
  - (b) keeps POLY-151's proof question in a loop of its own. POLY-151 has to land before POLY-110 and POLY-144 either way.
- **D2 (Principal, recommend a). Sign-up asks the emailed code.**
  - DESIGN says sign-up asks no extra code because the invite proved the address. The database mints an enrolment grant only from a confirmed code (`confirm_email_challenge`, POLY-89 R2).
  - **(a)** Sign-up's set-up asks for the code like every other first enrolment, and DESIGN changes to say so. It costs one extra email for an invitee, adds no new database path, and costs nothing more. It keeps one anchor for every first factor.
  - **(b)** Mint a grant in the sign-up transaction from the invitation proof. That is a new definer path inside `claimInvitation` with its own seceng review, about +$12 and 40 minutes (guess).
  - Until POLY-137, (a) means an invitee cannot enrol in production. That is the same closed state as every other first enrolment.
- **D3 (Principal, recommend a). Passkey users get no backup codes [U5].**
  - BetterAuth's backup codes belong to its twoFactor plugin: they are generated by enabling TOTP and used only inside a twoFactor hold, which a passkey-only user never meets (code-read). SECURITY R-26 already assumes passkey-only users have none.
  - **(a)** The passkey path shows no codes, and DESIGN says "add an authenticator app to get backup codes". The operator reset stays the recovery path. It costs nothing more.
  - **(b)** Our own backup codes for passkey users: a table, routes, and a hold that accepts them. That needs its own issue and ruling, about one loop.
- **D4 (lead; seceng to review).** Three service changes in a screens loop:
  - R7's `trustDevice` refusal;
  - R8's `requireClientIp: true` everywhere;
  - R10's `Cache-Control: no-store`.
  
  Each tightens security, and none is reachable from web.
- **DESIGN's own questions 1–4.** The build follows the recommended option of each: a bare page; the modal later (R0); no count of tries; no trust checkbox.

## Where the build differs from DESIGN 0.18.0 (for ux-designer-150 to fold in)

1. Sign-up goes to the set-up page and asks for the emailed code. It does not use the inline block (R1, D2).
2. Resend returns to the password step (R3.2).
3. Step 3's authenticator app path asks for the password again, for `enable` (R3.3).
4. The passkey path has no backup codes (R3.3, D3).
5. `#done` has no "we sent a note" sentence until POLY-137 (R3.5).
6. The Google or GitHub line on step 1 is not built until POLY-88 (R3.1).
7. A new `mailer_unavailable` state on step 1, with R3's fixed wording.
8. `#locked` has no time and no clock; `#locked-long` is not built (R7).
9. There is no "backup codes left" on Settings (R2).
10. Confirm it's you is built in its interim, no-input state (R6, D1 b).

## Open (no ruling owed here)

1. **OAuth and magic-link holds answer JSON to a browser navigation.** twoFactor's widened hold on the GET paths `/callback/:id` and `/magic-link/verify` returns `{twoFactorRedirect}` as a JSON page (code-read; only `passkeyOnlyHold` redirects GETs). Neither path is reachable today: private-CA mode answers 404 to OAuth, and magic link needs the mailer. POLY-88 and POLY-137 must turn it into a 302 to `/sign-in/second-step`.
2. **The first-method email** (DESIGN: "A first-method email follows the set-up") needs POLY-137's mailer, and is a security notice the user must see (SECURITY §9). POLY-137's criteria should carry it.
3. **"Backup codes left"** needs the service to decrypt and count. A later issue adds a count-only route to the anchor plugin.

## Addendum 1 (seceng's review at 88780475, RC1–RC4; the lock wording)

seceng reviewed 56eec7fa. Its D1 and D2 are this file's D2 and D3. It has not yet reviewed what the re-issue changed: D1 and R6's interim dialog, R3's resend and enable steps, and R7's single lock state.

**RC1. The poly_app pin.** `tests/db/pgtap/11_poly_app_grants.sql` goes from ten functions to **eleven**, with `app.my_second_step()` added to its list, and its planted-grant twin `tests/db/sign-in-controls-pins.test.ts` moves with it. SECURITY R-2's count follows at build review. The function is safe for the reason POLY-89 R1.5 gives the read-only exemptions:
- it reads only the marker's own user and session (kind `session`), and writes nothing;
- it carries the exact-call check;
- it returns no secret (R2).

**RC2. Framing: the premise is half right.**
- Web already sends `frame-ancestors 'none'`. SvelteKit's `kit.csp` (`vite.config.ts:30`) puts it in the response header on every page web renders, in dev, `vite preview` and e2e as well as in production. `shell.spec.ts:92` pins it on one page.
- Caddy must not set a CSP: `infra/lint/compose-policy.mjs:308` (`caddy-csp`) refuses one, so web owns a single policy.
- **Ruled:**
  1. Caddy's `(security_headers)` gains `X-Frame-Options "DENY"`, for old browsers, and the lint's `need` list gains it. This applies behind Caddy only (staging, production); in dev and e2e the CSP header covers it.
  2. Neither new page prerenders. A prerendered page gets a `<meta>` CSP, and a meta CSP cannot carry `frame-ancestors`.
  3. An e2e test reads `frame-ancestors 'none'` from the HTTP header of `/settings/second-step`, `/sign-in/second-step` and the Settings panel.
- **Who builds it:** the build lead, in this loop (`infra/**` is in the paths). seceng reads it at the build review; devops is not needed.

**RC3. The codes must not come back.**
- `/settings/second-step`'s `load` sets `Cache-Control: no-store`.
- The component clears the codes on `pagehide` and on destroy, as well as on Finish. Clearing on `pagehide` is the control that counts: newer Chromium may keep a `no-store` page in the back-forward cache.
- R9 spec 1 adds: from the codes screen, follow a link away, then `page.goBack()`, then forward. No code may be in the DOM at any of those points.

**RC4. Passkey names are text.**
- A lint rule bans `{@html` under `apps/web/src/routes/{settings,sign-in}/**` and in `ConfirmItsYou.svelte`. The one existing use, `lib/shell/icons.ts`, holds static SVG strings and is outside those paths.
- R9 seeds Pia's second passkey with the name `<img src=x onerror="window.__xss=1">`. The test finds it rendered as literal text and `window.__xss` undefined.

**reset-mfa identity check.** This belongs in INFRA's runbook (devops-engineer). It is not a ruling item here; the lead files it.

**D5 (Principal, recommend b). What a locked person is told.** Locks run 15 minutes, doubling up to 24 hours (POLY-149 R2).
- **What anyone learns now, under any option.** A refusal during a lock does not count against the user. So someone holding the password can already find when a lock ends by trying again, with one sign-in per try under the rate limit of 5 per minute. Whatever the screen says changes how much effort that takes, not whether it can be found. The number of guesses is capped by the lock either way.
- **(a) Nothing:** "Codes are paused. Use a passkey, or try again later." It costs nothing and reveals nothing. The usability cost is real: a person locked for up to a day gets no idea how long to wait, keeps retrying, or asks the operator for a reset-mfa they don't need.
- **(b) A coarse bucket.** On the lock refusal only, the service adds `pausedFor: 'under_an_hour' | 'a_few_hours' | 'up_to_a_day'` (remaining time under 60 minutes, under 6 hours, or longer). The screen says "in under an hour", "in a few hours" or "within a day".
  - It reveals three bands, and from them a rough doubling level for long locks.
  - DESIGN's "later today" and "tomorrow" need the user's time zone, which the service does not have, so its wording changes to the bands.
  - Cost: about $6 and 20 minutes (guess).
- **(c) The exact end time:** the field `pausedUntil` (ISO). The screen shows the time left and the clock time.
  - It reveals when to resume to the second. Successive lock lengths also show whether the real user has signed in correctly in between: a 15-minute lock after a long one means the doubling was reset.
  - Cost: about $5 and 20 minutes (guess).
- **How (b) and (c) return it, to a held sign-in only.**
  - An after-hook in the existing last plugin, on `/two-factor/verify-totp` and `/two-factor/verify-backup-code`, runs only when the response is BetterAuth's lock refusal and the request carries no session.
  - It reads the signed hold cookie, finds its live `verification` row, takes that row's user, and reads `two_factor.locked_until` as poly_auth, which already holds SELECT on both tables.
  - A caller reaches this only after passing the password. With no hold, a dead hold or a session, nothing is added. That BetterAuth's after-hooks see a thrown lock refusal is (unmeasured); if they do not, the code goes in `handleAuthRequest`.
  - Tests: one field value per band (or the exact time) with `locked_until` set by a superuser helper; and no field with no hold cookie, with a forged one, or with a session.
- **Why (b):** it answers the real user's question ("today or tomorrow?") without handing a password holder minutes or the reset signal. (a) is the stronger option but leaves a locked user with no guidance for up to a day. seceng names coarse as stronger than exact.
