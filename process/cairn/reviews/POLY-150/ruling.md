# POLY-150 — Second-step screens: ruling (architect)

**Basis.**
- **Branch.** `feature/poly-150-second-step-screens` @ 60f45d2f. better-auth and @better-auth/passkey 1.7.18; no pin changes.
- **This file replaces the ruling at 2bc48313 whole.** It folds in Addenda 1–3. Addendum 3 was approved by the Principal on 2026-11-19 (`process/DECISIONS.md` @ 60f45d2f): Part 1, one set-up dialog; Part 2, option (a), with the database per-entity lock filed on POLY-91.
- **Earlier rulings:** POLY-89 (R2, R3, R5, R7), POLY-152 (R1.6, R4, R9), POLY-153 (R4, R5, R6, R7, R8, R10) and POLY-149 (R2, R3). ARCH §2.4 (the `SecondStep` read model), §3.1 and §3.1c.
- **DESIGN 0.19.0 @ 233b2feb:**
  - `styled-screens/second-step-dialog.html` (the set-up dialog, shown over Settings);
  - `styled-screens/sign-in-second-step.html`;
  - `styled-screens/settings.html` and `styled-screens/entities.html`;
  - flow 5.11.
- **seceng-150's reviews**, with their conditions adopted in place:
  - `ruling-review.md` at 88780475, 82caa505 and d4279713 (RC1–RC4);
  - the per-entity gate and dialog assessment (seceng's worktree, `temp/2026-11-19-seceng-150-per-entity-gate.md`), cited as [G1]–[G8] for its §3 items and [GA] for its §1 (a) conditions;
  - the checklist items, cited as [S1]…[S31].
- **qa's red run** at 35395695, with Addendum 2's three points folded in.
- **The tree as read today:**
  - `apps/web/src/{hooks.server.ts,routes/+layout.server.ts}`, `apps/web/src/routes/{sign-in,sign-up,settings}`, `apps/web/vite.config.ts` (its CSP sends `frame-ancestors 'none'`), `apps/web/playwright.config.ts`, `apps/web/tests/e2e/serve.ts`;
  - `apps/auth/src/main.ts`, `packages/auth/src/{anchor,second-step,route-policy,handler,options}.ts`;
  - migrations 0003 (`has_role`, `visible_entities`) and 0013;
  - `infra/caddy/Caddyfile`, `infra/compose/prod.yml`, `infra/lint/compose-policy.mjs`;
  - better-auth 1.7.18 `plugins/two-factor/{index,verify-two-factor}.mjs` and `api/rate-limiter/index.mjs`.
- **Criteria** are C1–C5 in POLY-150's order.

**Tags.** "(code-read)" means read, not run. "(unmeasured)" means qa's red test measures it first. Nothing below drops a control on an unmeasured claim, and a red test that contradicts one reopens this ruling (re-issued whole).

## R0. What this loop is, and what it is not

Web gains:
- **one set-up dialog**, opened from Settings → Sign-in and second step and from a message on Entities;
- the **held sign-in page**, `/sign-in/second-step`, which stays a bare page;
- the **Settings panel** for an enrolled user.

**Every write is a browser `fetch` to the sign-in service at `/api/auth/*` on the same origin.** Web's server code only reads, through one new definer, inside `withSession(handle)`. Web gains no auth secret, no grant on BetterAuth's tables and no call to the service.

The sign-in gate stays as POLY-89 R5 built it: one check, closed by default. It is aimed at the single Settings route (R1.3).

**Not here:**
- **The Confirm it's you route** (POLY-151; R6, D3).
- **The mailer and the first-method email** (POLY-137; R3).
- **The role-raise hold, and the per-entity lock in the database** (POLY-91). With that lock, a held user can use the own Person while shared entities are greyed out (DECISIONS 2026-11-19).
- **The provider round trip for a user with no password** (POLY-88).
- **OAuth and magic-link holds answered as a redirect** (Open 1).
- **Opening the dialog from actions other than Entities' message**, such as Create entity and invite: each lands with its action. The dialog's carry-on contract (R3.6) is ruled here so they need no new ruling.

## R1. Pages, routes and the gate

**R1.1 Routes.**

| Web route | Server code | Browser calls (POST unless BetterAuth's route is a GET) |
|---|---|---|
| `/sign-in` (changed) | none | `/api/auth/sign-in/email`. On `twoFactorRedirect` → `/sign-in/second-step?next=…`; on `secondStepRequired: 'passkey'` → `/sign-in/second-step?with=passkey&next=…`. |
| `/sign-in/second-step` (new, public, bare) | **none**: no server file, no load, no database | code: `/two-factor/verify-totp {code}`; backup code: `/two-factor/verify-backup-code {code}`; passkey: `/passkey/generate-authenticate-options` → `navigator.credentials.get` → `/passkey/verify-authentication`. Success → `next`. |
| `/settings/second-step` (replaces the placeholder; an ordinary app-shell Settings page) | `load` only: `mySecondStep(handle)` from `@poly/auth/web` (R2), `locals.secondStepRequired`, and `recentAuthOk` (`app.recent_auth_ok()`, existing). **No form actions.** | The panel (R5). **Set up second step** opens the dialog (R3). `?setup=1` opens it on load; the parameter is a display hint and grants nothing. Sign out goes to `/api/auth/sign-out` [S29]. |
| `/entities` (changed) | unchanged, plus `mySecondStep`'s `second_step_at` only | While `second_step_at` is NULL: DESIGN's message with a button that opens the same dialog. |
| `/sign-up` (changed) | unchanged | After a successful sign-up, the page navigates to `/settings/second-step?setup=1`. The dialog shows **Skip for now** unless the gate requires the step or the invitation's role is manager or owner. The role is in the sign-up page's data today, or its load gains it from the invitation it already reads (code-read pending; a build that finds it absent reports to me). DESIGN's inline sign-up enrolment block is replaced by the dialog (D4). |

**R1.2 `next` [S22].**
- One module, `apps/web/src/lib/safe-next.ts`, holds today's rule: a path on this origin, never `//x` or `/\x`.
- `hooks.server.ts` and the two sign-in pages import it. The sign-in pages use it in the browser, before `location.assign`.
- A unit test covers `//x`, `/\x`, `https://x`, `javascript:x`, `%2F%2Fx` and an empty value; each gives `/`.
- The dialog needs no `next`: it returns to the page that opened it.

**R1.3 The gate [GA].**
- `hooks.server.ts` keeps one check, before `resolve`, for every non-public path. While `app.second_step_required()` is true, it answers 303 to `/settings/second-step?setup=1`.
- **The exemption is exactly two paths**, compared as strings after SvelteKit's own normalisation:
  - `/settings/second-step`;
  - `/settings/second-step/__data.json`.
  
  It is **never** the `/settings` tree: Sessions, and later export and account deletion, stay behind the gate.
- `/sign-in/*`, `/sign-up`, `/healthz` stay public, and `/api/auth/*` stays outside web.
- **Tests,** each while held → 303 to `/settings/second-step?setup=1`: `/settings`, `/settings/sessions`, `/settings/second-step/x`, `/settings/second-step/` (trailing slash, if Kit does not normalise it to the exempt path), `/entities`, `/entities/__data.json`, and a POST to a form action elsewhere. The two exempt paths answer 200.
- **What the exempt page loads while held [GA]:** no shared-entity data, the shell included.
  - Today `+layout.server.ts` returns only the session's user, and the page's `load` returns R2's row, which names no entity.
  - **Rule:** while `locals.secondStepRequired` is true, no layout or page `load` on that route returns an entity id, name or type. Any later shell data, such as the entity selector or the landing entity, is skipped.
  - Test: a held user who manages a seeded shared entity fetches `/settings/second-step/__data.json`. Neither the shared entity's id nor its name appears in it.
- **The sidebar** behaves normally for a user who is not held. A held user's sidebar links come back to Settings through the gate. The Principal's preferred shape, with the own Person usable and shared entities greyed out, is POLY-91's (R0).

**R1.4 What web's server code may touch:** `withSession(handle, …)`, then `app.my_second_step()` and `app.recent_auth_ok()`, both through `@poly/auth/web`.

**What it may not** [S1, S2, G6]:
- call or proxy the service, and send no server `fetch` to `/api/auth` or to `AUTH_PUBLIC_PORT`;
- receive a password, a code, the TOTP secret or URI, a backup code, a WebAuthn credential or a BetterAuth cookie;
- name a BetterAuth table (POLY-153 R6's grep).

**Boundary tests,** across all of `apps/web/src` and not only the second-step routes, because the dialog can be mounted anywhere:
- no server file names `/api/auth` or calls the service, except `hooks.server.ts`'s 404 for the tree;
- `/sign-in/second-step` has no server file;
- `{@html` appears in no `.svelte` file, since `Icon.svelte` already renders without it (SECURITY C-41) [RC4, G5];
- no file under `routes/**` sets `prerender` (R10) [RC2];
- each test is shown to fail with a planted copy.

**R1.5 The service checks every request** [S17, S31]:
- the origin check: `routePolicyHook` refuses a cross-origin state change;
- `AUTH_ROUTES`;
- the anchor and enrolment classes.

The order the dialog shows its steps in is cosmetic. A step taken out of order gets the service's refusal, and the dialog shows it.

## R2. `app.my_second_step()`: the one read

ARCH §2.4's `SecondStep` read model needs facts poly_app cannot read since POLY-149. One definer supplies them.

- **Owner and access.** Owner **poly_govern**, SECURITY DEFINER, `SET search_path = ''`, EXECUTE **poly_app only**. Canonical call `SELECT * FROM app.my_second_step()`, under 0011's exact-call check. It refuses 42501 unless the marker exists with `kind = 'session'`.
- **Returns one row for the marker's user and session:**
  - `second_step_at`;
  - `totp_added_at`: the verified `two_factor` row's `created_at`, else NULL;
  - `passkeys` jsonb: `[{id, name, created_at}]`, ordered by `created_at`;
  - `challenge_expires_at`: the open `first_enrolment` challenge **for the marker session**, else NULL;
  - `resend_available_at`: **a future time only while the 3-in-15-minutes rule holds**, namely the third-newest challenge's `created_at` + 15 minutes; **NULL in every other case**, both when a send would issue now and while the 10-wrong-in-24-hours rule suppresses;
  - `grant_expires_at`: the live grant for (user, marker session), else NULL;
  - `needs_a_method`: the user holds manager or owner on an entity where `app.own_person_exempt` is false. That is the rule `refuse_last_method` applies; the gate's `second_step_required()` is false once the user is enrolled, so it cannot serve;
  - `codes_paused`: the verified row's `locked_until > clock_timestamp()`. A boolean, never the time [S14].
- **Never returned:**
  - a secret, `backup_codes`, `public_key`, `credential_id` or `code_hash`;
  - the email;
  - an attempt count (D1).
  
  A catalog test pins the return columns.
- **Derived in `@poly/auth/web`:**
  - `step`: `factor` while `grant_expires_at` is set, `email_code` while a challenge is, else `password`;
  - `enrolment`: null once `second_step_at` is set;
  - the dialog restarts at the password when it is at `factor` and the service answers 403 `email_confirmation_required`.
- **Tests on `resend_available_at`:**
  - NULL with no sends;
  - a future time after three sends in 15 minutes;
  - NULL after 10 wrong entries in 24 hours with fewer than three sends.
- **Its safety [RC1].** It reads only the marker's own user and session, writes nothing, carries the exact-call check and returns no secret. That is POLY-89 R1.5's ground for read-only functions. Two pins move with it:
  - `tests/db/pgtap/11_poly_app_grants.sql` goes from ten functions to **eleven**, and its planted-grant twin `tests/db/sign-in-controls-pins.test.ts` moves with it;
  - pgTAP 07's identity-marker reader list gains it (thirteen readers, accepted at 82608edf).
  
  SECURITY R-2's count follows at build review.
- **Migration `0018_my_second_step`:**
  - adds `two_factor.created_at timestamptz NOT NULL DEFAULT now()`. BetterAuth's INSERT does not name it, so the default fills it (unmeasured);
  - then creates the definer, which `definers.json` lists.
  
  poly_govern already holds SELECT on `two_factor` and `passkey`, and reads the two app tables in its own definers (code-read). **A build that finds a grant short reports the failing statement to me and adds nothing.**
- **"Backup codes left" is not shown.** The codes are encrypted with the auth secret, so the database cannot count them (Open 3).

## R3. The set-up dialog (C1, C3, C5)

`SecondStepSetup.svelte`, in `apps/web/src/lib/second-step/`, has one entry point and one set of states, as DESIGN `second-step-dialog.html` draws them.

**R3.0 How it is mounted [G1, G4].**
- It is rendered **outside the page tree**, as a portal to `document.body`, so it never sits inside any page `<form>`.
- Its steps are `<form>` elements of its own, with no `action` and no `method`. Each submit handler calls `preventDefault()` first and posts only by `fetch` to `/api/auth/*`. With JavaScript off, the dialog does not open, because the button that opens it needs script. A submit therefore can never fall back to a web action.
- **Every secret lives only in the dialog's own component state:** the password while its own request runs, the code, the URI, the key, the QR and the backup codes.
  - None goes into a Svelte store, a context, layout data, a URL, a fragment, `history` state, storage, a cookie or a `console` call.
  - The client `handleError` serialises no component state.
  - The download's object URL is revoked once used.
- **Test [G1]:** while each step is submitted, the page's request log shows no request to web's origin other than `/api/auth/*`. It is run with the dialog opened on `/settings/second-step` and again on `/entities`.

**R3.1 Your password.**
- The dialog sends `POST /api/auth/second-step/send-code {password}`, with `autocomplete="current-password"` [S5]. The route is in `LIMITED` [S13].
- The response gains **`sentTo`**, the masked current address. The service computes it, and it is the same whether the code was sent or suppressed.
- Every user in this loop has a password: OAuth is off in private-CA mode, and magic link needs the mailer. DESIGN's provider line is therefore not built until POLY-88. A `recent_sign_in_required` answer shows "Sign in again".
- `email_not_verified` and `invalid_password` are shown inline. Each is a fact about the signed-in user's own account.

**R3.2 Check your email.**
- The dialog sends `POST /api/auth/second-step/confirm-code {code}`, with `autocomplete="one-time-code"`.
- A 403 `invalid_code` shows DESIGN's single message for a wrong or expired code.
- **Resend returns to the password step** with the field empty. The service checks the password on every send, and the dialog keeps no password past its own request [S5, S15].
- The cap is the service's, and the dialog never retries on its own.
- After a reopen, the copy reads "your account email" in place of `sentTo`.

**R3.3 The factor.**
- **Authenticator app:**
  - `POST /api/auth/two-factor/enable {password}`, so the step asks for the password again, returns `{totpURI, backupCodes}`.
  - The QR code is drawn **in the browser** as inline SVG by an exactly pinned, dependency-free QR encoder that makes no network calls. frontend-lead names the package and version in the build commit; seceng reads them at the build review. There is no image request and no CSP change [S4].
  - The key is also shown typed out.
  - `POST /api/auth/two-factor/verify-totp {code}` rotates the session. The response sets the new session cookie and the new `__Host-poly_handle` (POLY-153 R5).
  - After the verify, the URI, the key and the QR are dropped from state. No route returns them again: `/two-factor/get-totp-uri` stays `blocked` [S7, S9].
- **Passkey:**
  - `/passkey/generate-register-options` → `navigator.credentials.create` → `/passkey/verify-registration {name}`. `createSession` is never sent [S19].
  - There is no rotation; the marker session is stamped.
  - Under D5 (a), there are no backup codes.

**R3.4 Backup codes (authenticator app).**
- They are shown only after a successful verify, with Copy all and Download. Download is a client-side `Blob` and needs no request.
- **Finish** stays disabled until "I have saved these" is checked [S8].
- Closing at this step without the check asks first, because the codes are already valid [G2].
- A user who lost them makes new ones in Settings (R5) or asks for `reset-mfa`.

**R3.5 Clearing [RC3, G2].** The URI, the key, the QR and the codes are cleared on every way out:
- Finish, close, Escape, a backdrop click;
- `beforeNavigate`, because a client-side sidebar link fires no `pagehide`;
- `onDestroy` and `pagehide`.

No page data or route ever holds them, so nothing can show them again.

**R3.6 Done, and carrying on [G7].**
- After a successful verify, the host calls `invalidateAll()`, so its data loads under the rotated handle.
- An action that opened the dialog runs **after** that, as a new request on the new session. A request from before the rotation is never replayed.
- The first enrolment's `recent_auth_at` stamp makes the new session fresh (POLY-89 R3 #3, #6), so the action needs no Confirm it's you.
- The sentence "We sent a note to … saying it was turned on" is not built until POLY-137.
- `second_step_required()` is now false, so the gate clears.

**R3.7 What send-code answers, and the neutral message [S12, S27, S28].**
- **No mailer (production until POLY-137).** `apps/auth/src/main.ts` passes **no** `sendSecondStepCode`. `send-code` then answers **503 `{code: 'mailer_unavailable'}` as its first statement**: before it reads the body, checks the password, counts against the cap or issues a challenge.
  - Every caller therefore gets the same answer, so the cap is not revealed.
  - Today's throw at send time goes. It was a 500, reached only after the password check and only when no cap applied.
- **With a mailer:** sent and suppressed both answer `200 {status: true, sentTo}`.
- **Screen contract:**
  - Every 200 shows "We sent a code to <sentTo>" and the same resend line. No message, status, timing or `resend_available_at` value tells a suppressed send from a sent one.
  - A 503 `mailer_unavailable` shows DESIGN's one fixed no-mailer message, with no error string, no status number and no word about configuration. The password field is cleared once and does not loop. Sign out stays available.
  - Nothing falls back: no code on screen, in a log or by another path.

## R4. Browser tests get the code from a delivery stand-in, not a route [S23, S24]

- **The seam.** `startAuthService(env, deps = {})` gains `deps.sendSecondStepCode`.
  - It throws `ConfigError` unless `config.appEnv === 'development'`. `loadConfig` already refuses `development` in a release image (`check.ts:111`; the image sets `POLY_IMAGE_REVISION`).
  - `cli()` passes no `deps`.
  - A unit test pins three things: `cli()` passes nothing; `deps` is refused under staging and production; `apps/auth/src/**` names no outbox, no file sink and no test entry.
- **The test entry.** The e2e harness starts the service from `apps/web/tests/e2e/auth-entry.ts`, which calls `startAuthService(process.env, { sendSecondStepCode })`.
  - The stand-in appends `{email, code}` as one JSON line to `apps/web/tests/e2e/.auth/outbox.jsonl`, which is gitignored and mode 0600.
  - The entry fixes that path itself, not from env.
- **What this exercises:** the real handler, the real anchor, `issue_email_challenge` and `confirm_email_challenge` on poly_auth, and the real rate limit. Only delivery is replaced, the seam POLY-137 fills.
- **Why production cannot reach it:** it is no route, no flag and no env switch. Reaching it needs an in-process import with `deps` under `APP_ENV=development`, which a release image refuses, and `tests/` is not in the image.
- **How a spec uses it:** it reads the outbox by its own user's email and takes the line written after its send.

## R5. Settings → Sign-in and second step (C3)

**With no second step:** the panel shows **Set up second step**, which opens the dialog.

**With one,** it lists the methods from R2: the app with `totp_added_at`, and each passkey with its name and date. The actions are browser calls to the service:
- **Add passkey** (`/passkey/generate-register-options`, then `/passkey/verify-registration`): the enrolment class with `second_step_at` set, so it needs a fresh step-up.
- **Remove:** a passkey through `/passkey/delete-passkey`; the app through `/two-factor/disable {password}`.
- **Make new codes** (`/two-factor/generate-backup-codes {password}`): the codes appear in a dialog under R3.4 and R3.5's rules.
- **Freshness.** While `recentAuthOk` is true, the step-up actions run directly. Otherwise they open Confirm it's you (R6).

**When actions are hidden or disabled:**
- The last method has no Remove while `needs_a_method` is true, and the panel says why. While `codes_paused`, Remove is disabled.
- The database refuses both anyway (POLY-89 R3 #7; POLY-149's delete guard), so the screen's part is cosmetic.
- One pure function decides each action's state (`shown`, `disabled` or `hidden`) from R2's row and `recentAuthOk`. It gets a unit test.

**Not in this loop:** Change password, which is not in POLY-150's criteria.

**Passkey names are text [RC4].** They render as `{name}`, never as HTML (R1.4's ban). R9 seeds a script-like name and checks it shows literally.

## R6. Confirm it's you [S20]

**Built:** `ConfirmItsYou.svelte`, the dialog as DESIGN draws it:
- the action's name;
- password and code, or a passkey;
- the provider path;
- its error states.

It takes a `confirm` function prop and has a component test with a stub. It follows R3.0's mounting and R3.5's clearing.

**Mounted** on R5's step-up actions when `recentAuthOk` is false, **in the form D3 picks.** Under D3 (b), the recommended option, that is its interim state:
- it names the action and says plainly that confirming isn't available yet;
- changes can be made in the first 5 minutes after set-up, or the operator can reset;
- Close is its only button, and it has no input.

**Never in this loop:** web, a password alone, or a backup code stamping `recent_auth_at` (C-03).

## R7. The held sign-in (C2, C4)

**What a hold leaves.**
- A held sign-in has no session and no handle. twoFactor's hold deletes the session (code-read, `index.mjs:338`), and `attach_session_handle` returns false (POLY-153 R3).
- The hold lives in `__Secure-better-auth.two_factor` at `Path=/api/auth`, which web never sees.

**How web knows to show `/sign-in/second-step`:** only from the sign-in response body (R1.1).
- `with=passkey` is a display hint.
- The page is the same for every caller [S10]: no email, no list of factors, no "passkey available". Every state offers the code, a backup code and a passkey.
- Opened with no hold, the first call gets 401 and the page shows `#expired`.

**The hold's lifetime.**
- It is `twoFactorCookieMaxAge ?? 600` seconds, and we set no option (code-read, `index.mjs:341`), so 10 minutes (unmeasured).
- qa measures it: the cookie's `Max-Age` is 600, and the row's `expiresAt` is 600 s ± 5 after the sign-in.
- A hold that a superuser helper moved past `expiresAt` answers 401 and shows `#expired`.
- If 600 fails, DESIGN's wording changes to what was measured, and the limit does not.

**Wrong codes [S16].** One message each for a wrong TOTP code and a wrong backup code, with no count (D1).

**The lock [S14].**
- The screen shows what D6 picks. Under D6 (a) and as DESIGN draws it today, that is one `#locked` state: "Codes are paused for this account. Each pause lasts longer, from 15 minutes up to a day. Use a passkey, or try again later."
- The page never retries by itself and never offers anything that shortens a lock [S15].

**`trustDevice`** is refused under D2 (a), the recommended option:
- `routePolicyHook` answers 400 `trust_device_refused` when `body.trustDevice` is truthy on `/two-factor/verify-totp` or `/two-factor/verify-backup-code`;
- tests: each path with `trustDevice: true` gets 400, no session and no `trust_device` cookie.

## R8. Browser tests behind a proxy that sets the client address [S25, S26]

**Production** (code-read):
- Caddy's `reverse_proxy` has no `trusted_proxies`, and the lint pins that (`compose-policy.mjs:309`). So Caddy replaces any incoming `X-Forwarded-For` with the connecting address.
- The auth container publishes no port. It shares compose networks with web, so a compromised web could send the service a forged address. That reaches only the rate-limit bucket and the address on the sign-in record; SECURITY states it at build review.

**Dev and e2e:**
- In dev and `vite preview`, `/api/auth` goes through Vite's proxy. Its `configure` hook sets `x-forwarded-for` on every proxied request to the browser socket's address, with `::ffff:` stripped. It **overwrites** whatever the browser sent.
- **`requireClientIp` is `true` in every `APP_ENV`.** serve.ts's readiness probe sends its own `x-forwarded-for: 127.0.0.1`. The `tests/db` suites pass their own value.
- **Playwright's `extraHTTPHeaders` address is removed.** A spec sends a forged `x-forwarded-for: 198.51.100.9` on a real sign-in, and the sign-in record's `ip_address` is the loopback address.

**The rate limit is real in e2e:**
- `LIMITED` allows 5 calls per path per 60 s across the suite. qa paces the 12 sign-ins, about 2–3 minutes more. The limit is never raised, the address never forged, and no reset route is added.
- **The 429 spec** is its own Playwright project, `rate-limit`, which depends on the main project. Six wrong `/second-step/confirm-code` calls within a minute: the 6th gets 429 with BetterAuth's standard body, and the dialog shows its rate-limit message.

## R9. The browser tests (C4, C5)

**Seeds.** serve.ts seeds through the service's code path (POLY-153 R10), one user per state-changing spec:
- **Enid and Pia:** managers with no second step. Enid also manages a seeded shared entity, "Shared Co".
- **Tess:** a manager with TOTP enrolled through `handleAuthRequest`. Her base32 secret and backup codes are written to `.auth/`, mode 0600.
- **Kay:** a manager with a passkey only, enrolled through `tests/db/helpers/webauthn.ts`.
- **Lou:** a manager with no second step.
- **Vic:** a viewer with only the own Person, never held.

**Specs:**
1. **Enrol by app from the gate (C5).** Enid signs in. Every page answers 303 to `/settings/second-step?setup=1`, and `__data.json` there names no "Shared Co" (R1.3). The dialog is open. She:
   - gives the password and reads the code from the outbox;
   - gives the password again and reads the key from the typed-out key;
   - enters a TOTP code and sees ten codes;
   - **clicks a sidebar link with the codes on screen:** the dialog asks first; on confirming, the link is followed, then back, then forward. No code is in the DOM at any point [G2];
   - reopens the set-up from Settings, which now shows the panel; a full reload, then back, shows no code;
   - within the 5-minute window, uses **Make new codes**: it asks her password and shows ten codes that differ from the first set; the same leave, back and forward checks find none.
   
   Then `/dashboard` loads with no redirect. A later held sign-in refuses one of the first codes.
2. **Enrol by passkey from Entities (C5).** Pia opens `/entities`, sees the message and opens the dialog. She enrols through a Chromium virtual authenticator (CDP `WebAuthn.addVirtualAuthenticator`). No backup-code step appears, and no request carries `createSession`. A second passkey named `<img src=x onerror="window.__xss=1">` renders as literal text, and `window.__xss` is undefined [RC4].
3. **Held by code (C4).** Tess signs in and lands on `/sign-in/second-step`. She has no `__Host-poly_handle`, and `/dashboard` answers 303 to `/sign-in`. A wrong code leaves her held; the right code sets the handle and reaches `next`.
4. **Held, backup code.** Tess signs in with one backup code. The same code a second time is refused.
5. **Held, passkey only.** Kay signs in by password and lands on `?with=passkey` with no handle. The passkey sign-in reaches `/dashboard`.
6. **Step out of order, and closing.** As Lou, by direct `fetch` from the page context: `confirm-code` with no challenge, and `enable` with no grant, are both refused and nothing is enabled [S17]. Then Lou opens the dialog at each step and closes it four ways (Close, Escape, backdrop, `beforeNavigate`). Each time the dialog's state is empty when it is reopened.
7. **Same page for every caller.** An anonymous visitor, Vic and Tess each open `/sign-in/second-step` with no hold, and get the same status, states and text [S10]. This spec also carries the address check (R8).

**What changes in existing tests.** `second-step.spec.ts`'s placeholder test goes; C1 and C6 stay, with C6's target now `/settings/second-step?setup=1`. qa's `second-step-boundary.test.ts` and `second-step-rc.test.ts` widen to R1.4's whole-of-web scope.

## R10. What never reaches web's logs, page data or the client bundle

**Never in web's server at all** [S1]: the password, the emailed code, the TOTP secret and `totpURI`, the backup codes, WebAuthn credentials and BetterAuth's cookies.

**Never in page data** [S2, G6]: all of the above, plus the handle.
- The test fetches the rendered HTML and `__data.json` of `/settings/second-step` and `/entities`, before and after specs 1 and 2, and of `/sign-in/second-step`.
- It finds none of a seeded user's secret, backup codes, credential id or public key.

**In the browser:** R3.0 and R3.5.
- Specs 1 and 3 assert, after the flow, that `localStorage`, `sessionStorage`, IndexedDB and `document.cookie` hold none of them, and that no URL in the history or in any request's query does.

**Headers** [S6, S30, RC2, RC3]:
- **`/api/auth`:** `handleAuthRequest` sets `Cache-Control: no-store` on **every** response, overwriting whatever BetterAuth sent. The test reads it on `/two-factor/enable`, `/two-factor/generate-backup-codes` and `/two-factor/verify-totp`.
- **Web's pages:** every signed-in HTML and `__data.json` response carries `Cache-Control: no-store`, set once in `hooks.server.ts`. It covers any page that mounts the dialog, now or later. It is defence in depth; R3.5's clearing is the control that counts, since a back-forward cache restore can outlive `no-store`.
- **Framing:** web's CSP header already sends `frame-ancestors 'none'` and `script-src 'self'` on every page it renders, in every environment.
  - No route prerenders (R1.4), because a prerendered page would carry the policy only in a `<meta>` tag, where browsers ignore `frame-ancestors`.
  - Caddy's `(security_headers)` gains `X-Frame-Options "DENY"` for old browsers, and the lint's `need` list gains it. This applies behind Caddy only.
  - Caddy sets no CSP (`compose-policy.mjs:308`).
  - The header test reads `frame-ancestors 'none'` and `no-store` from the HTTP response of `/settings/second-step`, `/entities` and `/sign-in/second-step`.
  - The build lead builds the Caddy line in this loop (`infra/**` is in the paths), and seceng reads it at the build review.

**Logs** [S3]:
- The canary log test gains the emailed code, the password, the TOTP secret and the backup codes.
- Specs 1 and 3 run with web's and the service's stdout and stderr captured. No line contains any of them.

## R11. One PR, and the cost

**One PR.** The dialog and pages need R2's definer and the service changes in R3, R7, R8 and R10, and the e2e proves them together. A split costs a second loop and CI run (about $12 and 30 minutes, guess).

| Part | Cost (guess) | Active time (guess) |
|---|---|---|
| Design (150a, through 0.19.0) | $12 | 45 min |
| Ruling, re-issues, addenda and seceng's reviews (150b, c) | $18 | 70 min |
| Tests: 7 e2e specs, the 429 project, harness, definer, service, header and boundary tests, and the rework for the dialog (150d) | $24 | 65 min |
| Build: dialog, panel, Entities message, `/sign-in/second-step`, Confirm it's you, 0018, the service changes, the Vite proxy, Caddy (150e) | $28 | 85 min |
| Verdict and ARCH (150f) | $7 | 25 min |
| **Total, on the recommended options** | **$89** | **about 4 h 50 min** |

The rise over the earlier $72 is the extra design and review cycles, plus the dialog. The main remaining time risk is e2e pacing under the shared rate limit.

## Decisions for the Principal (still open; the build follows the recommended option unless told otherwise)

- **D1. Tries left.**
  - **(a, recommended)** Show no count of wrong tries, as built: R2 returns no attempt count, and the hold page shows none. A count helps someone guessing more than the owner. Cost nil.
  - **(b)** Show "3 tries left". R2 returns `5 − attempts` for the emailed code, and the service adds the hold's remaining tries to the verify refusal. It reveals to a password holder how close the hold is to ending. About +$5 and 15 minutes (guess).
- **D2. Trust this device.**
  - **(a, recommended)** No checkbox, and the service refuses `trustDevice` (R7). A device counts as known while its session lasts. Cost nil.
  - **(b)** A "Trust this device for 30 days" option. That browser then skips the second step on every new sign-in for 30 days, so a stolen browser profile or trust cookie bypasses it. SECURITY's session story changes, and the refusal goes. About +$4 and 15 minutes (guess).
- **D3. Confirm it's you.**
  - **(a)** Bring POLY-151 into this loop. It needs its own ruling first, because the database cannot check a TOTP code, so a stamp is the service's word. About +$35 and 1 h 45 min (guess), with a second ruling cycle on the critical path.
  - **(b, recommended)** The dialog in its interim state (R6): it says plainly it cannot confirm yet and has no inputs. About +$3, included in R11.
  - The failure is closed either way: until POLY-151, an enrolled user changes methods only in the first 5 minutes or by `reset-mfa`.
- **D4. Sign-up asks for the emailed code.**
  - **(a, recommended)** Like every first enrolment, because the database mints a grant only from a confirmed code. It costs an invitee one extra email, and nothing else.
  - **(b)** A grant minted from the invitation proof in the sign-up transaction: a new definer path with its own seceng review. About +$12 and 40 minutes (guess).
- **D5. Passkey users get no backup codes.**
  - **(a, recommended)** BetterAuth's codes belong to TOTP and work only inside a twoFactor hold, which a passkey-only user never meets. The dialog says "add an authenticator app to get backup codes". Cost nil.
  - **(b)** Our own codes for passkey users: a table, routes and a hold. That is its own issue, about one loop.
- **D6. What a locked person is told.** Locks run 15 minutes, doubling up to 24 hours. A refusal during a lock does not count, so a password holder can already find the end by retrying, one sign-in per try under 5 a minute. The wording changes the effort, not the exposure, and the guess count is capped either way.
  - **(a)** "Try again later", as drawn now. It reveals nothing and costs nothing. The usability cost is that a person locked for up to a day gets no idea how long to wait, and may retry or ask for a reset they do not need.
  - **(b, recommended)** A coarse band. On the lock refusal only, the service adds `pausedFor: 'under_an_hour' | 'a_few_hours' | 'up_to_a_day'` (under 60 minutes, under 6 hours, or longer). It reveals three bands, and so a rough doubling level for long locks. DESIGN's "later today" and "tomorrow" would need the user's time zone, which the service does not have, so the wording uses the bands. About +$6 and 20 minutes (guess).
  - **(c)** The exact end time, `pausedUntil`. It reveals the minute to resume, and from successive lengths whether the real user signed in correctly in between. About +$5 and 20 minutes (guess).
  - **How (b) and (c) return it, to a held sign-in only:**
    - An after-hook in the existing last plugin, on `/two-factor/verify-totp` and `/two-factor/verify-backup-code`, runs only when the response is BetterAuth's lock refusal and the request carries no session.
    - It reads the hold cookie **only through BetterAuth's signed-cookie check** (`ctx.getSignedCookie` with the auth secret). An unsigned or wrongly signed value counts as no hold, and so does a `verification` row past `expiresAt`.
    - It then takes the row's user and reads `two_factor.locked_until` as poly_auth.
    - That after-hooks see a thrown lock refusal is (unmeasured); if they do not, the code goes in `handleAuthRequest`.
  - **Tests for (b) and (c):**
    - one field value per band, or the exact time, with `locked_until` set by a superuser helper;
    - no field with no hold cookie;
    - no field with a forged one (unsigned, wrong secret, or a valid signature over another identifier);
    - no field with an expired hold;
    - no field with a session.

## Where the build differs from DESIGN 0.19.0 (for ux-designer-150)

1. **Gate destination.** The gate's destination is `/settings/second-step?setup=1`, so a held user sees the Settings panel with the dialog open. Their sidebar links return there until set-up (R1.3).
2. **Resend.** Resend returns to the password step (R3.2).
3. **App step.** The app step asks for the password again, for `enable` (R3.3).
4. **First-method note.** There is no first-method note on Done until POLY-137 (R3.6).
5. **Provider line.** The provider line on the password step is not built until POLY-88 (R3.1).
6. **Backup codes left.** There is no "backup codes left" on Settings (R2).
7. **Closing at the codes step.** Closing at the codes step asks first (R3.4).

## Open (no ruling owed here)

1. **OAuth and magic-link holds answer JSON to a browser navigation.**
   - twoFactor's widened hold on the GET paths `/callback/:id` and `/magic-link/verify` returns `{twoFactorRedirect}` as a JSON page (code-read).
   - Neither path is reachable today.
   - POLY-88 and POLY-137 must turn it into a 302 to `/sign-in/second-step`.
2. **The first-method email** needs POLY-137's mailer, and it is a security notice the user must see (SECURITY §9). POLY-137's criteria should carry it.
3. **"Backup codes left"** needs the service to decrypt and count. A later issue adds a count-only route to the anchor plugin.
4. **The reset-mfa runbook's identity check** (INFRA, devops-engineer) carries more weight until POLY-91's per-entity lock lands, because a reset is the one way into the held state.

## Addendum 1 (seceng's review §9 at 0ded5af6: P1, P2; the Principal's D1)

**D1 is decided: (a).** The Principal chose to show no count of tries left, so R2 and R7 stand as written.

**P1. Where the held page's own-Person label comes from.**
- While `locals.secondStepRequired` is true, the shell's entity selector shows one label, "<name> (Person)". The name is taken from `locals.session.user.name`, the row `enter_session` returned.
- On that route, no `load` runs an entity query, filtered or not, and the label carries no entity id. Every link it could offer leads back through the gate anyway.
- R1.3's rule (no entity id, name or type in that page's data) stands, and the user's own name is not entity data.
- Test: R1.3's `__data.json` check is unchanged. In addition, Enid's held page shows her name as the selector's only label.

**P2. `next` after set-up.** The gate carries the page the user asked for:
- **The gate's redirect** becomes `/settings/second-step?setup=1&next=<safeNext(path + search)>`, through `apps/web/src/lib/safe-next.ts`.
- **When the dialog finishes,** it runs `goto(safeNext(next))` after R3.6's `invalidateAll()`, using the same module in the browser. With no `next`, it stays on the page that opened it.
- **Replaced in R1.2:** the line "the dialog needs no `next`".
- **Unchanged:** opened from Settings, or from Entities' message, the dialog returns to its own page. Opened from an action, it carries on with the action (R3.6).
- **Tests:**
  - R9 spec 1: Enid asks for `/dashboard`, is sent to the dialog, and lands on `/dashboard` after Finish;
  - a gate redirect for `//evil.example` carries `next=/`;
  - R1.2's unit test covers both callers.
