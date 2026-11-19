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
- **D6 (b) is decided.** The lock refusal to a held sign-in carries `pausedFor` (`under_an_hour` | `a_few_hours` | `up_to_a_day`), returned as D6 sets out under its conditions.
- The one `#locked` state reads: "Codes are paused for this account. Try again in under an hour" (or "in a few hours", or "within a day"), ". Use a passkey, or try again then."
- With no `pausedFor` (a forged, expired or missing hold never gets one), it falls back to "Codes are paused for this account. Use a passkey, or try again later."
- Tests are D6's list, plus a browser check that each band shows its wording.
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

## Decisions for the Principal (status as of 2026-11-19; `process/DECISIONS.md` @ 6f30441a)

Decided: D1 (a), D3 (a, Addendum 3), D4 (a), D5 (a), D6 (b). D2 goes to POLY-154; R7's refusal stands here. D7 (Addendum 3) is still open, pending seceng's assessment. A decided option is a rule the build follows.

- **D1. Tries left. Decided: (a).**
  - **(a, recommended)** Show no count of wrong tries, as built: R2 returns no attempt count, and the hold page shows none. A count helps someone guessing more than the owner. Cost nil.
  - **(b)** Show "3 tries left". R2 returns `5 − attempts` for the emailed code, and the service adds the hold's remaining tries to the verify refusal. It reveals to a password holder how close the hold is to ending. About +$5 and 15 minutes (guess).
- **D2. Trust this device. Decided:** offered, unticked, as its own issue POLY-154 (Addendum 2). Not built here; R7's refusal stands.
  - **(a, recommended)** No checkbox, and the service refuses `trustDevice` (R7). A device counts as known while its session lasts. Cost nil.
  - **(b)** A "Trust this device for 30 days" option. That browser then skips the second step on every new sign-in for 30 days, so a stolen browser profile or trust cookie bypasses it. SECURITY's session story changes, and the refusal goes. About +$4 and 15 minutes (guess).
- **D3. Confirm it's you. Decided: (a).** Built in this loop, per Addendum 3, which replaces R6.
  - **(a)** Bring POLY-151 into this loop. It needs its own ruling first, because the database cannot check a TOTP code, so a stamp is the service's word. About +$35 and 1 h 45 min (guess), with a second ruling cycle on the critical path.
  - **(b, recommended)** The dialog in its interim state (R6): it says plainly it cannot confirm yet and has no inputs. About +$3, included in R11.
  - The failure is closed either way: until POLY-151, an enrolled user changes methods only in the first 5 minutes or by `reset-mfa`.
- **D4. Sign-up asks for the emailed code. Decided: (a).**
  - **(a, recommended)** Like every first enrolment, because the database mints a grant only from a confirmed code. It costs an invitee one extra email, and nothing else.
  - **(b)** A grant minted from the invitation proof in the sign-up transaction: a new definer path with its own seceng review. About +$12 and 40 minutes (guess).
- **D5. Passkey users get no backup codes. Decided: (a).** The passkey path ends with no codes, and one line says to add an authenticator app to get them.
  - **(a, recommended)** BetterAuth's codes belong to TOTP and work only inside a twoFactor hold, which a passkey-only user never meets. The dialog says "add an authenticator app to get backup codes". Cost nil.
  - **(b)** Our own codes for passkey users: a table, routes and a hold. That is its own issue, about one loop.
- **D6. What a locked person is told. Decided: (b), three bands. This is a rule the build follows**, with seceng's conditions below: the band is read only through the signed-cookie check, and appears only on the lock refusal. No field is added with no hold, a forged hold, an expired hold, or a session. Locks run 15 minutes, doubling up to 24 hours. A refusal during a lock does not count, so a password holder can already find the end by retrying, one sign-in per try under 5 a minute. The wording changes the effort, not the exposure, and the guess count is capped either way.
  - **(a)** "Try again later", as drawn now. It reveals nothing and costs nothing. The usability cost is that a person locked for up to a day gets no idea how long to wait, and may retry or ask for a reset they do not need.
  - **(b, recommended)** A coarse band. On the lock refusal only, the service adds `pausedFor: 'under_an_hour' | 'a_few_hours' | 'up_to_a_day'` (under 60 minutes, under 6 hours, or longer). It reveals three bands, and so a rough doubling level for long locks. DESIGN's "later today" and "tomorrow" would need the user's time zone, which the service does not have, so the wording uses the bands. About +$6 and 20 minutes (guess).
  - **(c)** The exact end time, `pausedUntil`. It reveals the minute to resume, and from successive lengths whether the real user signed in correctly in between. About +$5 and 20 minutes (guess).
  - **How (b) and (c) return it, to a held sign-in only:**
    - An after-hook in the second-step anchor plugin (`packages/auth/src/lock-band.ts`), on `/two-factor/verify-totp` and `/two-factor/verify-backup-code`, runs only when the response is BetterAuth's lock refusal and the request carries no session. The ruling's earlier "last plugin" is corrected to match the build: the band needs nothing from `cookieLifetime()`, which stays last with its two pinned after-hooks.
    - It reads the hold cookie **only through BetterAuth's signed-cookie check** (`ctx.getSignedCookie` with the auth secret). An unsigned or wrongly signed value counts as no hold, and so does a `verification` row past `expiresAt`.
    - It then takes the row's user and reads `two_factor.locked_until` as poly_auth.
    - That after-hooks see a thrown lock refusal is (unmeasured); if they do not, the code goes in `handleAuthRequest`.
  - **Tests for (b) and (c):**
    - one field value per band, or the exact time, with `locked_until` set by a superuser helper;
    - no field with no hold cookie;
    - no field with a forged one (unsigned, wrong secret, or a valid signature over another identifier);
    - no field with an expired hold. **Measured by backend-lead-150:** BetterAuth checks the lock before the hold's expiry, and an after-hook cannot change the status, so a locked account with an expired hold answers 429 with no `pausedFor`, not 401.
      - **This is accepted.** The caller learns only that the account is locked, which the same expired cookie learnt when it was live, and gets no band.
      - The page shows `#locked`'s no-band fallback, not `#expired`. That is the right advice, because starting again meets the same lock.
      - A test pins it: locked plus expired hold gives 429, no `pausedFor`, and the fallback wording;
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

**R9 seeds and spec 2, corrected.**
- **The seed.** Pia is not a manager. She is a non-held user whose only entity is her own Person, with no second step. R9's seed line becomes: "Enid: a manager with no second step who also manages 'Shared Co'. Pia: a user who owns only her own Person, with no second step and never held."
- **Why spec 2 needs that.** A manager would be sent to Settings by the gate and would never see Entities' message. Spec 2 runs unchanged for Pia: `/entities` shows the message, and the dialog enrols her by passkey.
- **The held case** stays Enid's, in spec 1.

## Addendum 2 (proposed, not in force): "Trust this device" (D2 (b), the Principal's choice)

**Deferred to POLY-154; not built in this loop.** R7's `trustDevice` refusal stands here. The Principal confirmed the box is unticked by default. This addendum is input to POLY-154's ruling.

**seceng's finding, for POLY-154: trust must never be honoured on a magic-link or OAuth sign-in.**
- twoFactor's widened hold covers `/magic-link/verify` and `/callback/:id` (`SIGN_IN_PATHS`), and the trust check runs on any held path (`index.mjs:28`).
- On those paths, a trusted device would skip the second step after a sign-in that proved only the mailbox or the provider account, with no password.
- POLY-154 limits the skip to `/sign-in/email`, and tests that the other two still hold a trusted device.

R7's `trustDevice` refusal stands until the lead relays approval of a shape below. Line references are to better-auth 1.7.18 `plugins/two-factor/{index,verify-two-factor}.mjs` (code-read).

**What BetterAuth already does.**
- A verify with `trustDevice: true` stores a `verification` row, `trust-device-<random>`, with the user id and an expiry 30 days out (`trustDeviceMaxAge`, set in `options.ts`).
- It also sets a signed cookie: `HMAC(secret, user!id)!id` (`verify-two-factor.mjs:43`).
- On the next sign-in, a valid cookie plus a live row skips the hold (`index.mjs:28-53`). The skip then **rotates the trust**: it deletes the row and writes a new one with a fresh 30 days, so **the trust slides**, and a device used once a month is never asked again (`index.mjs:312-323`).
- Disabling TOTP deletes the trust of the requesting device only (`index.mjs:292`). Nothing else ends it: not a password change or reset, sign-out, removing a passkey, or a lock.
- `reset-mfa` already deletes every `verification` row whose value is the user's id (POLY-89 R6), and that covers these rows.
- Trust applies only to the TOTP hold. A passkey-only user is held by our `passkeyOnlyHold`, which ignores trust, and needs nothing more than the passkey.

**The shape I recommend** (each point an option for the Principal; the recommended choice first):
1. **The tick-box:** "Trust this device for 30 days", **unticked**, on `/sign-in/second-step`'s code state only. A device is trusted only when the user asks, each time.
   - Not on the backup-code state. A backup code is the recovery path, and trusting a device from it would stretch a possibly stolen code into 30 days.
   - Ticked by default would make the weaker setting the one most users get without choosing it.
2. **Lifetime: 30 days from the tick, not sliding.** The second step is then asked at least monthly on each device. BetterAuth's slide would make trust permanent on any device used within each 30 days.
   - Keeping the expiry needs our own table (point 4): the rotation re-keys the device's row and keeps its first expiry.
   - The alternative is to accept the slide, about $4 less (guess).
3. **The cookie:** `__Secure-better-auth.trust_device`, `Path=/api/auth`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Max-Age` = the time left (POLY-153 R8's prefix and defaults; unmeasured for this cookie, so qa reads it).
   - Web never receives it.
   - It proves nothing without its live row, so deleting the row ends the trust even while the cookie is still in the browser. BetterAuth then expires the cookie (`index.mjs:325`).
4. **`app.device_trust`** (owner poly_govern; no login role holds any privilege on it): `id`, `user_id`, `identifier_hash` (sha256 of the `trust-device-…` identifier), `trusted_at`, `expires_at`, `last_used_at`, `user_agent` (the first 512 characters), `ip_address`.
   - It is kept in step by triggers on `verification` rows whose identifier starts `trust-device-`:
     - **INSERT with no rotation** creates the row;
     - **DELETE then INSERT for the same user in one transaction** (the rotation) re-keys the row, sets `last_used_at`, and sets `NEW."expiresAt" := least(NEW."expiresAt", trusted_at + 30 days)`. This is what makes point 2's limit hold;
     - **DELETE with no INSERT** deletes the row at commit, by a deferred check.
   - That the rotation's delete and insert share one transaction holds on the `withSignInTx` paths (POLY-152 R9) (unmeasured).
5. **What ends trust.** All of these are database triggers, so they hold on every path, including BetterAuth's. Each deletes all of the user's trust rows: `verification` and `app.device_trust`.
   - **Ends it:**
     - **a password change or reset:** AFTER UPDATE OF `password` ON `account`. This is the step a user takes when they think the password leaked;
     - **removing a method:** extending `app.sync_second_step()` on DELETE. This is the lost-phone case;
     - **disabling TOTP:** the same trigger, for every device and not BetterAuth's one;
     - **`reset-mfa`:** as today, plus the new table;
     - **Forget, or Forget all, in Settings** (point 6).
   - **Does not end it:**
     - **Adding a method.** It is not a sign of compromise, and forgetting every device on add would teach users not to add methods.
     - **Sign-out.** Trust exists to outlive the session; "Sign out and forget this device" can be a later addition.
     - **Revoking a session in Settings.** That ends a session, not a device.
     - **A lock.** A lock means someone without a trusted device is guessing codes. Ending the real user's trust then would push them into the locked code step.
6. **Seeing and revoking.** Settings → Sign-in and second step gains "Trusted devices": the browser (from `user_agent`), the address, when it was trusted, when it was last used, and when it expires. Each has **Forget**, and the list has **Forget all**.
   - Two definers, owner poly_govern, EXECUTE poly_app, refusing unless the marker has kind `session`, under the exact-call check:
     - `app.my_trusted_devices()` returns no identifier and no hash;
     - `app.forget_trusted_device(p_id uuid)` (or NULL for all) deletes the user's own rows only.
   - Forgetting needs no step-up: it only removes trust.
7. **The sign-in record (C-89):**
   - a skipped hold appends one `app.sign_in_record` row, **kind `trusted_device`**, with the user, the time, and the request's address and browser from POLY-149 R3's settings. It is written by point 4's rotation trigger, next to the `session` row;
   - a `trusted_device_added` row is written when trust is first granted, and `trusted_device_forgotten` when it ends, with the cause: `password`, `method_removed`, `forgotten` or `reset`;
   - the kind CHECK gains the three values.
8. **Who may use it: every role, owners and managers included,** recommended.
   - Trust needs this device's cookie **and** the password. A remote attacker with only the password is still held.
   - The residual is a stolen or shared device plus the password, for up to 30 days. Points 2, 5 and 6 bound it.
   - (b) Viewers only: managers and owners, who reach shared books, are always asked. It is stronger, costs nothing more, and is less useful to exactly the users with the most to protect.
   - seceng's assessment should decide between the two.

**Fit and cost (guesses).**

| Option | What it holds | Cost | Time |
|---|---|---|---|
| (i) BetterAuth as is: lift the refusal, add the tick-box | Sliding and permanent; ends only on `reset-mfa` and this device's TOTP disable; no list, no revoke, no record line | $5 | 20 min |
| (ii) Points 1–8 in this loop | Everything above | +$40, plus a seceng review cycle | +2 h |
| **(iii) Points 1–8 as their own issue,** with R7's refusal staying until it lands | The same, without reopening POLY-150's tests, which are already red and in flight | about $45 | about 2 h 15 min |

**Recommend (iii).**
- The refusal is the safe interim: the cost is only that every new sign-in asks.
- Points 4–7 are database work with their own guards and tests, the shape of a POLY-149 loop. Folding them in would re-gate POLY-150's tests and build.
- (i) is not recommended. It ships trust that slides forever and survives a password change, and the user cannot see or revoke it. That defeats the opt-out the Principal wants.


## Addendum 3: Confirm it's you (POLY-150h; POLY-151 in this loop, DECISIONS @ d5ec9130)

**This addendum replaces 3427c586's Addendum 3 whole.** It answers seceng's acceptance checklist (seceng's worktree, `temp/2026-11-19-seceng-150-confirm-its-you-checklist.md`) in place, cited as [M1]–[M15], [S1], [S2] and [T1]–[T10]. It replaces R6's interim state and R5's disabled actions.
- POLY-151's criteria are C1–C4 in its order.
- Line references are to better-auth 1.7.18 (code-read) unless measured.
- **The Principal has decided D4 (a):** sign-up asks for the emailed code. R1.1 and R3 stand as written.

### H. The hard parts, plainly

1. **This adds reach for SQL run as poly_auth, and it is not designed away** [M1].
   - **What that SQL reaches today:**
     - It cannot make an enrolled user's session fresh. `recent_auth_at` is written only by the first-enrolment insert (0013, `take_recent_auth_stamp`), and `guard_recent_auth` refuses every other write.
     - It can already create a session for any user, and reach web as them (R-2; POLY-153 R12). That session is never fresh.
   - **What this route adds.** The database checks no factor: the TOTP secret and the backup codes are encrypted with the auth secret, and SQL cannot verify a WebAuthn signature. A stamp is therefore **the service's word**. SQL as poly_auth can begin and complete its own re-check for any session it holds or creates, and so pass every step-up guard (H.3) for every enrolled user.
   - **The worst case** is that it **adds its own passkey or TOTP to a victim as a "later factor"**, then signs in with it through the ordinary HTTP routes. That is account takeover that outlasts the compromise.
   - **What it cannot do:** remove the trace. Every stamp writes a `step_up` row (A4), and every created session writes a `session` row (C-89), and no login role can delete either.
   - **SECURITY R-2 gains:** "SQL as poly_auth can mark any session it holds or creates as freshly confirmed, which unlocks the step-up actions for every enrolled user, including adding a factor. Each stamp leaves a `step_up` row it cannot remove."
2. **What would design it away, and why each is declined:**
   - **[S1] The database checks the TOTP code itself.** It needs a seed copy in a poly_govern-only table and HMAC-SHA1 in SQL (pgcrypto, about $15 and 50 minutes, guess).
     - **Declined:** the seed becomes readable to the database server and to every backup (`poly_backup` reads all data), where today it is encrypted under the auth secret. That trades a service compromise for a backup leak, and a backup is the likelier to leak.
     - It also leaves the passkey path as the service's word, because SQL cannot verify a WebAuthn signature. So it would not close the gap.
   - **Binding the stamp to the session's web handle,** which no login role can read.
     - **Declined:** SQL as poly_auth can create a victim session and attach its own handle (POLY-153 R3), then stamp that. So the binding only forces a new `session` row, and the `step_up` row is written anyway.
     - About $4 (guess), for nothing new.
3. **Every step-up the stamp unlocks today** [M13], for 300 s on the database clock, on that one session [M12]:
   - **The service's step-up class:** `/passkey/delete-passkey`, `/two-factor/disable`, `/two-factor/generate-backup-codes`, `/unlink-account`, `/link-social` (real domain only), `/change-email` and `/revoke-other-sessions`;
   - **the enrolment class once `second_step_at` is set:** `/two-factor/enable`, `/passkey/generate-register-options` and `/passkey/verify-registration`, which add a later factor;
   - **the database's own guards,** which read the stamp:
     - a later factor's `two_factor` and `passkey` INSERTs (POLY-89 R3 #5, #6);
     - a marked change of `backup_codes` (#5);
     - the method deletes (#7), which still pass `refuse_last_method`, so the stamp never removes the last method while it is needed [M14];
   - **web:** `app.revoke_my_session` of another session, and `recent_auth_ok()` for R5's actions;
   - **nothing else.**
   - **What later actions will do with it.** Export, purge, bank link and account deletion will read it. **Purge and account deletion should consume it,** through a single-use `consumed_at`, so that one check is never spent on two irreversible actions. That is ruled when they land, and named here.
4. **`/change-email`** [M15]. `options.ts` does not enable BetterAuth's `changeEmail`, so the route answers BetterAuth's refusal today (code-read pending; qa reads the answer).
   - Before anyone enables it: changing the email moves the first-enrolment anchor and the recovery address, and it writes no record row today.
   - That is **Open 6**. Enabling it needs a security notice to the old address (SECURITY §9) and a record row.
5. **The backup code (D7)** is the lost-phone path and also a takeover path for someone who holds the password and a code. The write order that passes guard #5 is A3.3 [M10].

### A1. Routes (anchor plugin, `packages/auth/src/anchor.ts`), new route class `reauth` [M7]

| Route | Body | Does |
|---|---|---|
| `POST /second-step/reauth/begin` | `{method: 'totp' \| 'backup_code' \| 'passkey'}` | `app.begin_step_up` issues the challenge. Passkey: also answers WebAuthn request options |
| `POST /second-step/reauth` | `{challengeId, password, code}` or `{challengeId, password, backupCode}` | The code check and the stamp, in one `withAuthSession` transaction |
| `POST /second-step/reauth/passkey` | `{challengeId, response}` | The assertion check and the stamp |

**The `reauth` class (`AUTH_ROUTES`):**
- It is POST only, under `routePolicyHook`'s origin check.
- It needs a session, and answers 401 with none. It needs `second_step_at`, and answers 403 `no_second_step` without one.
- It runs in `withAuthSession` (marker kind `auth`).
- All three paths join `LIMITED` (5 per 60 s per address).
- **The per-user cap is the shared counter and lock** (A4), so no second per-user limit is added [M9].
- They join the second-step commit rule (POLY-152 R9): a refusal below 500 commits, through `COMMIT_HEADER`, so wrong-code counts and consumed challenges survive.

**`POST /second-step/reauth`, in order:**
1. **Not during a lock** [M8]. If the verified `two_factor` row's `locked_until > now()`, answer the lock refusal before any check. Under D6 (b) it carries `pausedFor`; the passkey path stays open.
2. **The password** (`ctx.context.password.verify`, against `session.user` from the cookie [M4]). Wrong → 403 `step_up_failed`, the same answer as a wrong code [M6], and no factor counter is touched.
   - A user with no password → 403 `password_required`. There is no provider path until POLY-88 [M6].
   - A password alone never passes: the code step is always required (C-03).
3. **The code, checked against `session.user`'s own row and never against a user id in the body** [M4].
   - **For `code`:** decrypt the secret as `totp/index.mjs:153` does, and find which of the steps `now − 1`, `now` and `now + 1` (30 s each) it matches, in constant time.
     - BetterAuth's own `createOTP(…).verify(code)` (`totp/index.mjs:157-160`) returns only true or false and records no step. So **it accepts the same code again within its window** (code-read, the lines cited) [M3].
   - **For `backupCode`:** decrypt the list as `backup-codes/index.mjs:46` does, then find and remove the code. Which storage the list uses (`storeBackupCodes` is unset in `options.ts`) is (code-read pending); the builder reads it and does not assume it.
4. **A wrong code** → BetterAuth's own counter statements and shape (POLY-149 R2): `+1`, and the lock at 10. Then 403 `step_up_failed`.
5. **A right code, in this order:**
   1. `SELECT app.complete_step_up($1, $2, $3)`, as in A3.2;
   2. on the backup-code path, `UPDATE two_factor SET backup_codes` with the shortened, re-encrypted list (A3.3);
   3. the correct-code reset (`failed_verification_count = 0, locked_until = NULL`).
   
   Then `200 {status: true}`.

**The passkey path** [M5]:
- **Options** (from `begin`):
  - user verification `required`;
  - `allowCredentials` set to `session.user`'s passkeys;
  - a 32-byte challenge stored only as `sha256` on the challenge row.
- **Verify:** `@simplewebauthn/server`'s `verifyAuthenticationResponse`, a direct dependency pinned to the version `@better-auth/passkey` uses (13.3.3, measured from the lockfile directory).
  - `expectedChallenge` is a function comparing `sha256` with the stored hash.
  - `requireUserVerification` is `true`.
  - The credential's `user_id` must be `session.user`'s [M4].
  - The counter is written back, never lower (A3.5).
  - Then `complete_step_up('passkey', $challengeId, NULL)`.
- **It creates no session and no rotation.** BetterAuth's `/passkey/verify-authentication` signs in, so it is not used [M5].
- **A failed assertion** consumes the challenge (committed), appends `step_up_failure` (A4) and answers 403 `step_up_failed`.

**Not reused:** BetterAuth's `/two-factor/verify-totp` with a session. That is the enrolment verify: it rotates the session and is gated by the step-up it would grant (POLY-89 R3).

### A2. What web sends and where the dialog is mounted (replaces R6's interim state and R5's disabled actions)

**What it is.** `ConfirmItsYou.svelte` follows R3.0's rules: a portal, outside any page form, with `fetch` only to `/api/auth`. It follows R3.5's clearing.

**Opening it.** Opening the dialog sends `begin` for the method shown first:
- the authenticator app if `totp_added_at` is set, else a passkey;
- switching method sends `begin` again, which replaces the open challenge.

**The methods** come from `mySecondStep`, the user's own facts:
- **Authenticator app:** password and 6-digit code (`autocomplete="current-password"` and `"one-time-code"`). "Use a backup code instead" is shown under D7 (b).
- **Passkey:** one button, which runs `navigator.credentials.get` and then verify.

**After a pass:**
- `invalidateAll()` runs, so `recentAuthOk` is true.
- The action that opened the dialog runs as a new request, never a replay.
- A failure shows DESIGN's single message, "That password or code didn't work", with no count [M6, S16].

**Where it is mounted:**
- on R5's step-up actions (Add passkey, Remove, Make new codes) whenever `recentAuthOk` is false;
- on later step-up actions (export, purge and the rest), which mount the same component;
- while `recentAuthOk` is true, the actions run directly.

### A3. How the stamp is written

**Tables** (owner poly_owner; RLS forced; no privilege for any login role):
- `app.step_up_challenge (id uuid PK, user_id → user CASCADE, session_id → session CASCADE, method text CHECK (method IN ('totp','backup_code','passkey')), webauthn_hash bytea NULL CHECK (octet_length = 32), created_at, expires_at)`.
  - A unique index on `session_id` allows one open challenge per session.
  - The CHECK `(method = 'passkey') = (webauthn_hash IS NOT NULL)`.
  - poly_govern holds SELECT, INSERT and DELETE.
- `app.step_up_totp (user_id PK → user CASCADE, last_step bigint NOT NULL)`. It is forward-only: poly_govern holds SELECT, INSERT and UPDATE, and `step_up_totp_10_forward` (BEFORE UPDATE) refuses `NEW.last_step < OLD.last_step` for every role [M3].
- `app.step_up_pending (xid xid8 PK, user_id)`. poly_govern holds INSERT and DELETE (A3.3).

**Definers** (owner poly_govern; SECURITY DEFINER; `SET search_path = ''`; **EXECUTE poly_auth only**; 0011's exact-call check; listed in `definers.json`). None takes a session or user parameter.

**A3.1 `app.begin_step_up(p_method text, p_webauthn_hash bytea) RETURNS uuid`** [M2]
- **Refuses (42501)** unless all hold:
  - a marker with kind `auth` and a session;
  - the marker user has `second_step_at`;
  - for `totp` and `backup_code`, a verified `two_factor` row;
  - for `passkey`, a passkey and a hash.
- It deletes the session's open challenge, then inserts the new one: `id = gen_random_uuid()` and `expires_at = now() + 5 minutes`. It returns the id.

**A3.2 `app.complete_step_up(p_method text, p_challenge uuid, p_step bigint) RETURNS boolean` — the one new writer of `recent_auth_at`** [M1]
- **Refuses (42501), leaving everything unchanged,** unless all hold:
  - a marker with kind `auth` and a session;
  - the marker user has `second_step_at`;
  - no earlier stamp in this transaction;
  - **the challenge `p_challenge` exists for the marker user and the marker session, with `method = p_method`, and is unexpired.** It is then deleted, so it is single-use [M2];
  - **for `totp` and `backup_code`:** the verified `two_factor` row's `locked_until` is NULL or not later than `clock_timestamp()` [M8];
  - **for `totp`:** `p_step` is within `floor(extract(epoch FROM clock_timestamp()) / 30) ± 1`, and **greater than** `step_up_totp.last_step`. That row is then set to `p_step` [M3];
  - **for `backup_code`:** it inserts `step_up_pending (pg_current_xact_id(), user)` (A3.3).
- **Then:**
  - `UPDATE public.session SET recent_auth_at = now() WHERE id = app.current_session_id() AND user_id = app.current_user_id()`. It must hit **exactly one row**, or it raises. That is the session row's own `user_id` [M4]. It uses `now()`, the transaction's start time, because `step_up_fresh()` requires `recent_auth_at <= now()` (0013:118); a `clock_timestamp()` stamp would fail that test inside the same transaction and refuse A3.3's list write. `step_up_fresh()` is not loosened (RC6).
  - It inserts the `step_up` record row (A4) in the same statement sequence, so no stamp exists without its row [M11].
  - It returns true.
- **Its grants.** poly_govern holds `UPDATE (recent_auth_at)` (POLY-89 R1.4). `guard_recent_auth` lets it through under R1.3 and refuses every other writer (unmeasured: qa stamps through it, and is refused writing the column directly as poly_auth).
- **A catalog test pins it** as the only function, outside 0013's two, whose body assigns `recent_auth_at` [M1].

**A3.3 The backup-code write order** [M10]
- Guard #5 lets a **marked** change of `backup_codes` through only with a fresh step-up. So the code cannot be consumed before the stamp.
- **The order is: stamp first, then write the list, in one transaction.** Guard #5 then sees the new stamp and passes the write.
- **Two triggers keep a stamp from standing without the write:**
  - `two_factor_85_step_up_spent` (AFTER UPDATE OF `backup_codes`, poly_govern) deletes this transaction's `step_up_pending` row when `OLD.backup_codes IS DISTINCT FROM NEW.backup_codes`;
  - `step_up_pending_resolved` is a CONSTRAINT trigger, DEFERRABLE INITIALLY DEFERRED, that raises at commit if the row is still there.
- **The result:** writing the list first is refused by #5, and never writing it is refused at commit. In both cases the whole transaction, stamp included, rolls back. Both orders are (unmeasured); qa runs them.
- The guard gains no exception.

**A3.4 The sign-in TOTP step joins the guard** [M3]
- `app.note_totp_step(p_user uuid, p_step bigint)` is a poly_govern definer, EXECUTE poly_auth, under the exact-call check. It sets `last_step = greatest(last_step, p_step)`, and refuses a step outside `now ± 1`.
- It is called by an after-hook in the existing last plugin when `/two-factor/verify-totp` succeeds, at sign-in or at first enrolment. The hook recomputes the matched step from `ctx.body.code` against the user's secret.
- **The result:** a code accepted at sign-in cannot then pass a re-check, across all sessions, because the step guard is per user.
- **It does not make BetterAuth's sign-in refuse a reused code** (Open 5).
- **Its reach for SQL as poly_auth:** it can only push `last_step` forward by at most one step, which can at worst refuse one honest re-check for 30 s.

**A3.5 The passkey counter.**
- Guard #6 (POLY-89 R3) already confines a marked UPDATE to the row's own user, and to `name` or `counter`.
- 0019 replaces it so that **a marked `counter` change, like an unmarked one, never goes down**. A constant 0 still passes [M4].

### A4. The growing lock (C-88) and the sign-in record (C-89)

**One counter, one lock [M8].**
- A wrong code at a re-check writes `two_factor.failed_verification_count` with BetterAuth's shape. `two_factor_15_lock` then doubles the same streak and locks the same factor, and POLY-149's guard appends `second_step_failure` with the address and browser (from `poly.client_ip` and `poly.user_agent`, which `withAuthSession` sets).
- A right code writes the correct-code reset, which is the service's word, as accepted.
- During a lock, the code paths are refused by the service (A1 step 1) and again by the database (A3.2). The passkey path stays open.
- That a marked counter write on a verified row passes guard #5 and reaches `two_factor_15_lock` is (unmeasured).

**The record, written by the database [M11].**
- `complete_step_up` appends `kind = 'step_up'` with `method`, `session_id`, and the address and browser from the transaction's settings.
- `sign_in_record`'s kind CHECK gains `step_up` and `step_up_failure`, and a nullable `method` column, CHECKed, is set only on those two kinds.
- **A failed passkey assertion**, which no counter records, appends `step_up_failure` through `app.record_step_up_failure()`: poly_govern, EXECUTE poly_auth, exact-call, marker kind `auth`. That row is the service's word; a forger gains nothing by writing it.
- Wrong codes are recorded by the lock guard, as above.

### A5. Migration `0019_step_up` (custom, as poly_owner)

In this order:
1. the three tables, their RLS, the poly_govern grants, and `step_up_totp_10_forward`;
2. `sign_in_record`'s kind CHECK and the `method` column;
3. `SET ROLE poly_govern`:
   - `begin_step_up`, `complete_step_up`, `note_totp_step` and `record_step_up_failure`;
   - the A3.3 trigger functions;
   - `guard_passkey`, replaced (A3.5);
   - then REVOKE FROM PUBLIC, the EXECUTE grants to poly_auth, and a temporary EXECUTE to poly_owner on the trigger functions (as 0016 did);
4. `SET ROLE poly_owner`: the triggers, then the temporary EXECUTEs revoked.

**What moves with it:**
- `definers.json`;
- pgTAP 08: poly_auth gains four EXECUTEs, granted and effective;
- pgTAP 09: poly_govern's grants on the three tables;
- pgTAP 12: the new triggers, `tgenabled = 'O'`, and their owners;
- pgTAP 11 and pgTAP 07 move only if their pins require it, each in its own commit [T4].

### A6. Tests [T1–T10] (POLY-151 C3, C4)

**`tests/db`, through the real handler on poly_auth**, each refusal reading `recent_auth_at` back unchanged:

| # | Test |
|---|---|
| **T1 Replay** | The same `/second-step/reauth` request twice: the second answers 403, and the challenge row is gone after the first. |
| **T2 Code reuse** | A code accepted at a held sign-in, then the same code at a re-check within 30 s → refused. The same between two sessions of one user, and an earlier step. |
| **T3 Forgery and confusion** | `begin_step_up` and `complete_step_up` as poly_app → permission denied. As poly_auth under kinds `session` and `signup`, with no marker, and outside the exact call → 42501. Another session's challenge → refused. POLY-89 R1.2's cases: another user's session, and a session id with no row. A direct `UPDATE session SET recent_auth_at` as poly_auth → refused. |
| **T4 Catalog** | The four definers' EXECUTE grants (poly_auth only), the exact-call check, the single-writer pin (A3.2), and that only poly_govern holds `UPDATE (recent_auth_at)` on `public.session`, granted and effective. |
| **T5 Lock** | 10 wrong re-check codes lock the factor, the 2nd lock is 30 minutes, and `second_step_failure` rows are written. During the lock, a code re-check is refused and a passkey re-check passes. |
| **T6 Backup code** | It is consumed once, and its record row says `backup_code`. Used twice → refused. A stamp with the list unwritten → the commit fails. The list written first → refused by #5. |
| **T7 Passkey** | Through `helpers/webauthn.ts`: no new `session` row, no rotation, and the stamp lands on the existing session. An assertion for another user's credential → refused. A counter lower than stored → refused. |
| **T8 Window** | With a superuser-set stamp: unlocked at 299 s, refused at 301 s. A rotation (first-verify, disable) leaves the new session with no stamp. |
| **T9 Record** | One `step_up` row per success, with the method. It is written even when the route is bypassed and `complete_step_up` is called directly as SQL on poly_auth, which shows the row comes from the database. |
| **C3** | After the 5-minute window: `/two-factor/disable` → 403. Then a re-check by code, by passkey and by backup code, and then remove a method and add a passkey. |

**Further tests:**
- the wrong password and the wrong code give the same answer;
- `password_required` for a user with no password;
- `no_second_step`.

**E2E [T10]:**
- Tess, past her window, opens Settings → Remove, re-checks with TOTP in the dialog, and the passkey is removed.
- Kay does the same with a virtual authenticator, `isUserVerified: true`.
- A wrong code shows the one message with no count, and the action does not run.
- R3.0's request-log check and R3.5's clearing checks run for this dialog.

**Unmeasured, for qa's red run:**
- the step matching against `createOTP`;
- the backup-code storage format;
- A3.3 in both orders;
- `guard_recent_auth` letting the definer through;
- marked counter writes reaching the lock guard;
- refusals committing;
- the virtual authenticator's user verification passing `requireUserVerification`;
- `/change-email`'s answer.

### A7. Cost (guess), added to R11

| Part | Cost | Time |
|---|---|---|
| This ruling, its re-issue, and seceng's review | $13 | 50 min |
| Tests (A6) | $18 | 50 min |
| Build: routes, the step hook, 0019, the dialog wired (150i) | $29 | 90 min |
| **Added to the loop** | **$60** | **about 3 h 10 min** |

With R6's interim state removed (−$3), the loop total on the recommended options is about **$146 and 7 h 55 min**.

### D7. The backup code as a re-check [M10, S2]. Decided: (b) (Addendum 5)

- **(a) [S2, the stronger option] No backup codes for a re-check; they stay for sign-in recovery only.**
  - A stolen code plus the password then signs someone in, but cannot change the user's methods.
  - There is no A3.3. It saves about $6 and 20 minutes (guess).
  - A user who lost their phone signs in with a code, but needs the operator's `reset-mfa` to replace the lost authenticator.
- **(b) Accepted with the password, as above.** It is what DESIGN draws and what the codes are for.
  - Over signing in with the same two things, it adds one power: changing methods, which is H.1's takeover.
- **Why (b):** without it, the only recovery is an operator's identity check, which is the weaker control (Open 4).
- **If seceng or the Principal weigh takeover above recovery, (a) is the safer choice,** and costs only A3.3's removal.

### Open (Addendum 3)

5. **BetterAuth's sign-in verify still accepts a reused code within its window** (`totp/index.mjs:157-160`). A3.4 only records the step. Making sign-in refuse a reused step means a before-hook on `/two-factor/verify-totp` that reads `step_up_totp`. That is a change to BetterAuth's sign-in path, for its own issue.
6. **`/change-email`** must not be enabled until it sends a security notice to the old address and writes a record row (H.4).

## Addendum 4: the re-check routes' request and response shapes (Addendum 3 A1)

The Principal accepted Addendum 3 with H.1's limit (`process/DECISIONS.md` @ cb2ae18f). This addendum fixes the wire shapes, so the dialog (26895352) and the routes meet. It keeps the dialog's assumptions where they are sound: `begin` answers `{challengeId, options?}`, and failures read `step_up_failed`, plus the lock as 429 `ACCOUNT_TEMPORARILY_LOCKED`.

**Every refusal body is `{code, message}`, with `message` equal to `code`,** as the anchor's refusals are today (`anchor.ts`'s `refusal`). The dialog branches on `status` and `code` only, and never shows `message`. A success sets no cookie and does not rotate the session.

| Route | Request body | 200 |
|---|---|---|
| `POST /api/auth/second-step/reauth/begin` | `{method: 'totp' \| 'passkey'}` (`'backup_code'` once D7 is decided (b)) | `{challengeId: string (uuid), options?: PublicKeyCredentialRequestOptionsJSON}`. `options` is present for `passkey` only: user verification `required`, `allowCredentials` the user's passkeys, the 32-byte challenge base64url-encoded. |
| `POST /api/auth/second-step/reauth` | `{challengeId, password, code}`, with `code` six digits as a string. `{challengeId, password, backupCode}` once D7 is decided (b). | `{status: true}` |
| `POST /api/auth/second-step/reauth/passkey` | `{challengeId, response: AuthenticationResponseJSON}` (`@simplewebauthn/browser`'s `startAuthentication` output, unmodified) | `{status: true}` |

**Errors** (the same on all three routes unless the row says otherwise):

| Status | `code` | When | The dialog |
|---|---|---|---|
| 400 | `invalid_request` | The body is missing a field, has an extra field, or fails its type: `challengeId` not a uuid, `code` not 6 digits, both `code` and `backupCode` present, or `method` unknown. | A generic failure. This is a client bug, never a user error. |
| 401 | BetterAuth's own | No session. | Back to `/sign-in`. |
| 403 | `no_second_step` | `second_step_at` is NULL. | It is never opened for such a user. |
| 403 | `method_unavailable` | `begin` for a method the user has not set up (`begin_step_up`'s refusal). | It offers only `mySecondStep`'s methods. |
| 403 | `password_required` | The user has no password. Not reachable in this loop (A1). | "Sign in again". |
| 403 | `step_up_failed` | A wrong password, a wrong code, a TOTP step that is not later than the last one accepted, a failed or foreign passkey assertion. **One code for all of them** [M6]. | DESIGN's single message, with no count. |
| 403 | `challenge_expired` | The challenge is missing, used, expired, another session's, or for another method. | It calls `begin` again and says "Try again". The code tells nothing about the password or the factor. |
| 429 | `ACCOUNT_TEMPORARILY_LOCKED` | The code paths during a lock, on `begin` (method `totp`) and on `/reauth`. The body is `{code, message}` with **no `pausedFor`**: D6's band is only for a held sign-in with no session, and this caller has one. | The locked message, with the passkey offered if the user has one. |
| 429 | none (BetterAuth's limiter: `{message}` only, code-read `rate-limiter/index.mjs:65`) | `LIMITED`'s 5 per 60 s. | "Too many attempts. Wait a minute and try again." It tells this from the lock by the absence of `code`. |
| 5xx | — | Anything else, which rolls the transaction back. | A generic failure. |

**How the service tells the two refusals apart.** `complete_step_up` raises 42501 with one of two fixed messages, which never reach the client:
- `step_up_challenge` for the challenge conditions → `challenge_expired`;
- `step_up_refused` for everything else (no marker, no second step, an earlier stamp, the lock, the step guard) → `step_up_failed`, or the lock refusal when the lock holds.

A raise rolls back the transaction, so a TOTP step it refused is not recorded either.

**When a challenge is consumed:**
- **Consumed:** on success, by `complete_step_up`; and by a failed passkey assertion, committed through `COMMIT_HEADER` (A1).
- **Not consumed:** by a wrong password or a wrong TOTP code. The dialog can retry on the same `challengeId` within its 5 minutes, and the shared counter and lock bound the guesses (A4).

**Tests** (added to A6):
- one per row of the errors table, asserting status and `code`;
- the lock refusal on `/reauth` carries no `pausedFor`;
- a wrong code followed by the right code on the same `challengeId` passes;
- a used `challengeId` answers `challenge_expired`.

## Addendum 5: D7 decided (b); method changes audited by the database (RC5(c), now required)

**D7 is decided: (b)** (`process/DECISIONS.md` @ c49f5d33). A backup code is accepted for Confirm it's you, with the password.
- **A3.3 is a rule:** the stamp comes first, then the list is written, under the deferred evidence check.
- **`begin` and `/second-step/reauth` take `method: 'backup_code'` and `{challengeId, password, backupCode}`**, as Addendum 4's table shows for "once D7 is decided (b)".
- **`method_refused` is dropped** from Addendum 4: nothing refuses a method on these routes now. An unknown `method` stays 400 `invalid_request`.
- **The Principal accepted the residual** with H.1's limit: a found backup code plus the password is a full takeover. A method added through a re-check waiting 24 hours, with an email to the user, is POLY-137's deploy condition (DECISIONS @ cb2ae18f).

**The audit event (seceng RC5(c), required under D7 (b)).** Every second-step method added or removed is written to `public.audit_event` **by the database**, whichever role or path made the change.

- **Where:** `app.sync_second_step()`, the poly_govern function already run by the AFTER triggers `two_factor_80_sync` (INSERT, UPDATE OF `verified`, DELETE) and `passkey_80_sync` (INSERT, DELETE). It is replaced in 0019 (CREATE OR REPLACE, `SET ROLE poly_govern`). No new trigger is needed, and no path that changes a method can skip it.
- **What counts as a change:**
  - **TOTP is added** when `verified` goes false → true (an unverified row is not a method).
  - **TOTP is removed** when a verified row is DELETEd.
  - **A passkey is added** on INSERT and **removed** on DELETE.
  - An unverified `two_factor` row inserted or deleted writes nothing.
- **What it writes,** one row per change:
  - `kind`: `second_step.method_added` | `second_step.method_removed`;
  - `subject_user_id`: the row's `user_id` (NEW, or OLD on a delete);
  - `actor` and `actor_user_id`: `user` and `app.current_user_id()` when a user marker is present; `operator` and NULL when `session_user = 'poly_operator'` (`reset-mfa`); `system` and NULL otherwise;
  - `entity_id`: NULL;
  - `payload`: `{method: 'totp' | 'passkey', passkey_id (or null), session_id: app.current_session_id() (or null), marker_kind (or null)}`;
  - `created_at`: the database clock.
  - Whether `audit_event` CHECKs `actor` or `kind` is (code-read pending). If it does, 0019 widens the CHECK to the values above; a build that finds a CHECK it cannot widen reports to me.
- **Who can write it:** only poly_govern, as now (0003's grant and the `audit_event_insert` policy).
  - It is append-only (`audit_event_append_only`, `audit_event_no_truncate`).
  - No login role can UPDATE or DELETE it, poly_auth included. A planted factor therefore leaves a row its planter cannot remove.
- **Who can read it, under 0003's `audit_event_select`, unchanged:**
  - **poly_app,** for the user themself, on rows where `actor_user_id` is them, so the events of changes they made;
  - **poly_worker;**
  - **poly_backup** (all data).
  
  Rows written under `reset-mfa` or with no marker have `actor_user_id` NULL and `entity_id` NULL, so poly_app cannot read them. **This loop shows no audit list in web.** Settings' added dates (R2) are where a user sees a planted method, and POLY-137's email will be the alert.
- **Tests (`tests/db`, through the real handler on poly_auth unless noted):**
  - each of these writes exactly one row with the fields above: first TOTP verify, TOTP disable, passkey registration, passkey delete, a later factor added after a re-check;
  - an unverified `two_factor` row inserted then deleted writes none;
  - **a factor planted directly by SQL as poly_auth** (H.1's path: a created session, a stamp, then an INSERT into `passkey`) writes `method_added`, with `actor_user_id` the victim and `marker_kind = 'auth'`;
  - `reset-mfa` writes one `method_removed` per method with `actor = 'operator'`, plus the existing `second_step.reset`;
  - as each login role, UPDATE and DELETE of such a row are refused and the row reads back unchanged;
  - as poly_app with the user's marker, the user reads the rows they acted on and not another user's.
- **The deploy gate (INFRA §7.1 step 16, POLY-149 R5's table).** H.1's residual was accepted on the condition that a planted factor is recorded, so these join the gate. The lead edits INFRA at the build review, with devops-engineer when spawned.

| Object | Check |
|---|---|
| triggers `two_factor_80_sync`, `passkey_80_sync` | exist, `tgenabled = 'O'`, and run `app.sync_second_step()` |
| `app.sync_second_step()` | owner poly_govern, SECURITY DEFINER, no login role can execute; its body inserts both `second_step.method_*` kinds (a pgTAP body pin, as for `record_session_sign_in`) |
| `app.complete_step_up(text, uuid, bigint)` | owner poly_govern; EXECUTE poly_auth only; the only new writer of `recent_auth_at` |
| triggers `step_up_totp_10_forward`, `two_factor_85_step_up_spent`, `step_up_pending_resolved` | exist, `tgenabled = 'O'`; the last is DEFERRABLE INITIALLY DEFERRED |

- **No TRUNCATE on the method tables.** A TRUNCATE fires no row trigger, so it could remove every method with no audit row. 0019 therefore adds `two_factor_no_truncate` and `passkey_no_truncate`: `BEFORE TRUNCATE … FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate()`, the function `audit_event` and `tx_identity` already use.
  - **pgTAP 12** pins both triggers: they exist, `tgenabled = 'O'`, and they are statement-level BEFORE TRUNCATE. It also pins that no login role holds TRUNCATE on either table. Plant: one trigger dropped.
  - Both triggers join the deploy-gate table, with the same check: exist and `tgenabled = 'O'`.

**Cost (guess):** about $5 and 15 minutes, inside A7's build and tests.
