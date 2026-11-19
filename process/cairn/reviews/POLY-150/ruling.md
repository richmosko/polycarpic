# POLY-150 — Second-step screens: ruling (architect)

**Basis.**
- Branch `feature/poly-150-second-step-screens` @ af155b59. better-auth and @better-auth/passkey 1.7.18; no pin changes.
- POLY-89's ruling (R2, R3, R5, R7), POLY-152's (R1.6, R4, R9), POLY-153's (R4, R5, R6, R7, R8, R10), POLY-149's (R2, R3); ARCH §2.4 (the `SecondStep` read model), §3.1, §3.1c; DESIGN flow 5.11 as it stands at af155b59.
- The tree as read today: `apps/web/src/hooks.server.ts`, `apps/web/src/routes/{sign-in,sign-up,settings/second-step}`, `apps/web/vite.config.ts`, `apps/web/playwright.config.ts`, `apps/web/tests/e2e/{serve,second-step.spec}.ts`, `apps/auth/src/main.ts`, `packages/auth/src/{anchor,second-step,route-policy,handler,options}.ts`, `tests/db/helpers/{second-step,webauthn,e2e-auth}.ts`; better-auth 1.7.18 `plugins/two-factor/{index,verify-two-factor}.mjs` and `api/rate-limiter/index.mjs`.
- Criteria are C1–C5 in POLY-150's order.

**Tags.** "(code-read)" means read, not run. "(unmeasured)" means qa's red test measures it first; nothing below drops a control on an unmeasured claim, and a red test that contradicts one reopens this ruling (re-issued whole).

## R0. What this loop is, and what it is not

Web gains the screens that reach POLY-89's routes: the three-step set-up, the sign-in hold page, and Settings → Sign-in and second step. **Every write is a browser `fetch` to the sign-in service at `/api/auth/*` on the same origin.** Web's server code only reads, through one new definer, inside `withSession(handle)`. Web gains no auth secret, no grant on BetterAuth's tables and no call to the service.

**Not here:** the Confirm it's you route (POLY-151; R6 says what is built); the mailer (POLY-137; R4); the role-raise hold and its notice (POLY-91); OAuth and magic-link holds answered as a redirect (Open 1).

## R1. Pages and routes

| Web route | Server code | Browser calls (all `POST` unless BetterAuth's route is a GET) |
|---|---|---|
| `/sign-in` (changed) | none | `/api/auth/sign-in/email`. On `twoFactorRedirect` → `/sign-in/second-step?with=code&next=…`; on `secondStepRequired: 'passkey'` → `?with=passkey&next=…`. |
| `/sign-in/second-step` (new, public) | **none**: no `+page.server.ts`, no load, no database | code: `/two-factor/verify-totp {code}`; backup code: `/two-factor/verify-backup-code {code}`; passkey: `/passkey/generate-authenticate-options` → `navigator.credentials.get` → `/passkey/verify-authentication`. Success → `next` (the existing `safeNext` rule). |
| `/settings/second-step` (replaces the placeholder) | `load` only: `mySecondStep(handle)` from `@poly/auth/web` (R2) plus the gate's `secondStepRequired` from `locals`, and `recentAuthOk` (`app.recent_auth_ok()`, existing). **No form actions.** | With no second step, the set-up (R3). With one, the panel (R5). |
| `/sign-up` (changed) | unchanged | After a successful sign-up, navigates to `/settings/second-step?next=…` for every invitee; the page shows **Skip for now** unless the gate requires the step or the invitation's role is manager or owner (the role is in the sign-up page's data today, or its load gains it from the invitation it already reads (code-read pending; a build that finds it absent reports to me)). |

- **The gate** (`hooks.server.ts`) is unchanged except that its redirect to `/settings/second-step` carries `?next=` (`safeNext` of the requested path). `/sign-in/*` stays public.
- **What web's server code may touch:** `withSession(handle, …)`, then `app.my_second_step()` and `app.recent_auth_ok()`, both through `@poly/auth/web`. **It may not:** call or proxy the service (no server `fetch` to `/api/auth` or to `AUTH_PUBLIC_PORT`); export `actions` from either second-step route; receive a password, code, TOTP secret or URI, backup code, WebAuthn credential or BetterAuth cookie; name a BetterAuth table (POLY-153 R6's boundary grep already covers the last). A boundary test pins the first two: no server file under `apps/web/src/routes/{sign-in/second-step,settings/second-step}` calls `fetch`, names `/api/auth` or exports `actions`, and `/sign-in/second-step` has no server file.
- **Every request the browser sends is checked by the service** (origin check, `AUTH_ROUTES`, the anchor and enrolment classes); the screens add no control the service lacks. A page that shows a step out of order gets the service's refusal and shows it.

## R2. `app.my_second_step()`: the one read

ARCH §2.4's `SecondStep` read model needs facts poly_app cannot read since POLY-149. One definer supplies them.
- Owner **poly_govern**, SECURITY DEFINER, `SET search_path = ''`, EXECUTE **poly_app only**. Canonical call `SELECT * FROM app.my_second_step()`; 0011's exact-call check. Refuses 42501 unless the marker exists with `kind = 'session'`.
- Returns one row for the marker's user and session:
  - `second_step_at`;
  - `totp_added_at`: the verified `two_factor` row's `created_at`, else NULL;
  - `passkeys` jsonb: `[{id, name, created_at}]`, ordered by `created_at`;
  - `challenge_expires_at`, `challenge_attempts_left` (5 − attempts): the open `first_enrolment` challenge **for the marker session**, else NULL;
  - `resend_available_at`: when `issue_email_challenge` would next issue (the 3-in-15-minutes rule; `now()` when it would now), NULL while the 10-wrong-in-24-hours rule suppresses;
  - `grant_expires_at`: the live grant for (user, marker session), else NULL;
  - `needs_a_method`: the user holds manager or owner on an entity where `app.own_person_exempt` is false (the rule `refuse_last_method` applies; the gate's `second_step_required()` is false once enrolled, so it cannot serve).
- **It returns no secret, no `backup_codes`, no `public_key` or `credential_id`, no `code_hash`, no email.** A catalog test pins the return columns.
- `step` (ARCH §2.4) is derived in `@poly/auth/web`: `factor` while `grant_expires_at` is set, `email_code` while a challenge is, else `password`; `enrolment` is null once `second_step_at` is set.
- **Migration `0018_my_second_step`:** `two_factor.created_at timestamptz NOT NULL DEFAULT now()` (BetterAuth's INSERT does not name it, so the default fills it (unmeasured)), then the definer. poly_govern already holds SELECT on `two_factor`, `passkey`, and reads the two app tables in its own definers (code-read); **a build that finds a grant short reports the failing statement to me and adds nothing.** `definers.json` lists it.
- **"Backup codes left" is not shown in this loop.** The codes are encrypted with the auth secret, so the database cannot count them. Open 3.

## R3. The set-up, step by step (C1, C3, C5)

All three steps run in `/settings/second-step`'s page, in browser memory. A reload re-derives the step from R2.
1. **Your password.** `POST /api/auth/second-step/send-code {password}`. A user with no password sends `{}`; the service requires a session under 5 minutes old (POLY-89 R2). The response gains **`sentTo`**, the masked current address computed by the service (it already holds `user.email`), identical whether the code was sent or suppressed. On reload at step 2 the page says "your account email".
2. **Check your email.** `POST /api/auth/second-step/confirm-code {code}`. Resend is step 1's call again; the page needs the password again for it (the service checks it every time). A 403 `invalid_code` shows inline; R2's `challenge_attempts_left` drives the count.
3. **The factor.**
   - **Authenticator app:** `POST /api/auth/two-factor/enable {password}` (none for a passwordless user, `allowPasswordless`) → `{totpURI, backupCodes}`. The QR code is drawn **in the browser** as inline SVG by a pinned, dependency-free QR encoder (frontend-lead picks; exact pin); no image request, no CSP change. The key is shown typed out. `POST /api/auth/two-factor/verify-totp {code}`: the session rotates and the response sets the new session cookie and the new `__Host-poly_handle` (POLY-153 R5). Only then are the ten backup codes shown, once.
   - **Passkey:** `/passkey/generate-register-options` → `navigator.credentials.create` → `/passkey/verify-registration` (never `createSession`, POLY-89 S16). No rotation; the marker session is stamped. **No backup codes** (D2).
- **Continue** goes to `next`. The gate clears because `second_step_required()` is now false.

## R4. The emailed code with no mailer

**Production until POLY-137.** `apps/auth/src/main.ts` passes **no** `sendSecondStepCode`. The anchor's `send-code` then answers **503 `mailer_unavailable` as its first statement**, before it reads the body, checks the password or issues a challenge. So the answer does not depend on the password or on suppression, and no challenge row is written. The screen shows step 1 with DESIGN's copy for this state (ux-designer-150 to add: "This server cannot send email yet, so a second step cannot be set up. Ask the person who runs it."). Today's "throw at send time" (a 500, after the password check) goes. Magic link is unchanged.

**Browser tests: a delivery stand-in, not a route.**
- `startAuthService(env, deps = {})` gains `deps.sendSecondStepCode`. It throws `ConfigError` unless `config.appEnv === 'development'`, and `loadConfig` already refuses `development` in a release image (`check.ts:111`). `cli()` passes no `deps`; a unit test pins both.
- The e2e harness starts the service from a test-only entry, `apps/web/tests/e2e/auth-entry.ts`, which calls `startAuthService(process.env, { sendSecondStepCode })`. The stand-in appends `{email, code}` as one JSON line to `apps/web/tests/e2e/.auth/outbox.jsonl` (gitignored; mode 0600), whose path the entry fixes itself, not from env.
- **What this exercises:** the real handler, the real anchor, `issue_email_challenge` and `confirm_email_challenge` on poly_auth, and the real rate limit. Only delivery is replaced, the seam POLY-137 fills.
- **Why it is unreachable in production:** it is no route and no env flag. It needs an in-process import of `startAuthService` with a `deps` argument, under `APP_ENV=development`, which a release image refuses. `tests/` is not in the image (the image test already lists what is).
- Specs read the outbox by their own user's email and take the line written after their send.

## R5. Settings → Sign-in and second step (C3)

With `second_step_at` set, the page lists the methods (R2: the app with `totp_added_at`, each passkey with its name and date). Actions, all browser calls to the service:
- **Add passkey:** the enrolment class with `second_step_at` set, so it needs a fresh step-up.
- **Remove** (passkey: `/passkey/delete-passkey`; app: `/two-factor/disable {password}`) and **Make new codes** (`/two-factor/generate-backup-codes {password}`, codes shown once): step-up class.
- While `recentAuthOk` is true (5 minutes after first enrolment), they are enabled. **Otherwise they are shown disabled with one line saying a fresh check is needed and is not available yet** (ux to word it). R6 replaces that.
- The last method has no Remove while R2's `needs_a_method` is true, and the panel says why. The database refuses it anyway (POLY-89 R3 #7).
- **Change password is not in this loop** (it is not in POLY-150's criteria; DESIGN keeps it on the panel for a later issue).

## R6. Confirm it's you

**Built here:** the dialog as DESIGN draws it, as a component (`ConfirmItsYou.svelte`): the action's name, password and code or a passkey, the provider path, its error states, and "won't ask again for 5 minutes". It takes a `confirm` function prop and is covered by a component test with a stub. **It is mounted nowhere in this loop**, so no shipped page shows a dialog that cannot succeed.

**POLY-151:** the route, its ruling and seceng's review, mounting the dialog on R5's actions (and later on every step-up action), and removing R5's disabled state.

## R7. The held sign-in (C2, C4)

- A held sign-in has no session and no handle: twoFactor's hold deletes the session (code-read, `index.mjs:338`) and `attach_session_handle` returns false (POLY-153 R3). The hold lives in `__Secure-better-auth.two_factor` at `Path=/api/auth`, 10 minutes, which web never sees.
- **Web knows to show `/sign-in/second-step` only from the sign-in response body**, which the sign-in page already reads (R1). The `with` parameter is a display hint (code, or passkey only); it grants nothing. Opened with no hold, the page's first call gets 401 and the page offers "Start again" → `/sign-in`.
- **`trustDevice` is refused.** DESIGN asks again on every new sign-in, and BetterAuth's `trustDevice: true` would skip the second step on that browser for 30 days. `routePolicyHook` answers 400 `trust_device_refused` when `body.trustDevice` is truthy on `/two-factor/verify-totp` or `/two-factor/verify-backup-code`; the page never sends it. Tests: each path with `trustDevice: true` → 400, no session, no `trust_device` cookie. (seceng: this closes an unused bypass; it is a service change in this loop.)
- The lock (POLY-149 R2) shows as DESIGN's lock state; web does not know its length and shows none.

## R8. Browser tests behind a proxy that sets the client address

- **The proxy is the one already there.** In dev and `vite preview`, `/api/auth` reaches the service through Vite's proxy. Its `configure` hook sets `x-forwarded-for` on every proxied request to the browser socket's address (`::ffff:` stripped), **overwriting** anything the browser sent, as Caddy does in production. Vite's proxy is dev tooling and is not in the built web server.
- **`requireClientIp` becomes `true` in every `APP_ENV`** in `startAuthService`. The development exception exists only because the dev proxy set no address; it goes. serve.ts's readiness probe on `/api/auth/ok` sends `x-forwarded-for: 127.0.0.1` itself (it is the harness, acting as the proxy).
- **Playwright's `extraHTTPHeaders: { 'x-forwarded-for': … }` is removed.** A spec sends a forged `x-forwarded-for: 198.51.100.9` on a real sign-in and finds the sign-in record's `ip_address` is the loopback address, not the forged one (POLY-149 R3).
- **The rate limit is real in e2e:** every browser request shares one address, so 5 calls per path per 60 s across the suite (`LIMITED`). That the suite fits is (unmeasured). If a 429 appears, the fix is ordering (`serial` files, fewer sign-ins per spec), **never** raising the limit, forging the address or adding a reset route.

## R9. The browser tests (C4, C5)

Seeded by serve.ts through the service's code path (POLY-153 R10), one user per state-changing spec so specs do not share state: Enid and Pia (managers, no second step), Tess (manager, TOTP enrolled through `handleAuthRequest`; her base32 secret and backup codes written to `.auth/`, mode 0600, for the spec's `totp()` helper), Kay (manager, passkey only, through `tests/db/helpers/webauthn.ts`).
1. **Enrol by app (C5):** Enid signs in, is sent to `/settings/second-step`, gives the password, reads the code from the outbox, scans nothing (the spec reads the key from the page's typed-out key), enters a TOTP, sees ten backup codes, continues, and reaches `/dashboard`; a reload of `/settings/second-step` shows the panel and no codes.
2. **Enrol by passkey (C5):** Pia, the same through a Chromium virtual authenticator (CDP `WebAuthn.addVirtualAuthenticator`); no backup-code screen.
3. **Held by code (C4):** Tess signs in → `/sign-in/second-step`; no `__Host-poly_handle`; `/dashboard` → 303 `/sign-in`. A wrong code stays held; the right code sets the handle and reaches `next`.
4. **Held, backup code:** Tess with one backup code; the same code a second time is refused.
5. **Held, passkey only:** Kay signs in by password → `?with=passkey`, no handle; the passkey sign-in reaches `/dashboard`.
6. **The address** (R8), and **step out of order:** confirm-code with no challenge, enable with no grant → the service's refusal is shown and nothing is enabled.
- `second-step.spec.ts`'s placeholder test ("has no form") is replaced by 1; C1 and C6 stay.
- **Secrets (R10):** in 1 and 3, after the flow, `localStorage`, `sessionStorage` and IndexedDB are empty of the code, the key and every backup code; no URL in the page's history or its requests' query strings contains them.

## R10. What never reaches web's logs, page data or the client bundle

- **Never in web's server at all:** the password, the emailed code, the TOTP secret and `totpURI`, backup codes, WebAuthn credentials, BetterAuth's cookies. They exist only in browser memory and in `/api/auth` request and response bodies, which web never sees (R1).
- **Never in page data:** all of the above plus the handle. `mySecondStep`'s output is R2's columns only; a test serialises the page's `load` output and finds none of a seeded user's secret, backup codes, credential id or public key.
- **Never in the bundle:** no env value; the existing build checks stand.
- **In the browser:** codes live only in component state; never in a URL, storage, a `console` call or an error message. Backup codes are dropped from state on Continue and are never re-fetched.
- **Logs:** the existing canary log test gains the emailed code, the TOTP secret and the backup codes: enrolment and a held sign-in with web's and the service's log capture on, then no line contains any of them.

## R11. One PR, and the cost

**One PR.** The pages need R2's definer and R4, R7 and R8's service changes, and the e2e proves them together. A split costs a second loop and CI run (about $12 and 30 minutes, guess) and leaves one half untestable in a browser.

| Part | Cost (guess) | Active time (guess) |
|---|---|---|
| Design (150a, in flight) | $8 | 30 min |
| Ruling and seceng review (150b, c) | $9 | 35 min |
| Tests: 6 e2e specs, harness (outbox, seeds, virtual authenticator), definer and service unit tests (150d) | $18 | 50 min |
| Build: three pages, the dialog component, 0018, the service changes, the Vite proxy (150e) | $24 | 70 min |
| Verdict and ARCH (150f) | $7 | 25 min |
| **Total** | **$66** | **about 3 h 30 min** |

Against POLY-149's $58 in 2 h 40 min, this has less SQL and more browser work; e2e flakes on the shared rate limit are the main risk to the time.

## Decisions for the lead (the Principal's where marked)

- **D1 (Principal, recommend a). Sign-up asks the emailed code.** DESIGN says sign-up asks no extra code because the invite proved the address. The database mints an enrolment grant only from a confirmed code (`confirm_email_challenge`, POLY-89 R2). (a) Sign-up's set-up asks for the code like every other first enrolment; DESIGN changes to say so. One extra email for an invitee; no new database path; cost nil. (b) Mint a grant in the sign-up transaction from the invitation proof: a new definer path inside `claimInvitation`, its own seceng review; about +$12 and 40 minutes (guess). (a) keeps a single anchor for every first factor.
- **D2 (Principal, recommend a). Passkey users get no backup codes.** BetterAuth's backup codes belong to its twoFactor plugin: they are generated by enabling TOTP, and used only inside a twoFactor hold, which a passkey-only user never meets (code-read). (a) The passkey path shows no codes, and DESIGN says "add an authenticator app to get backup codes"; the operator reset stays the recovery path. Cost nil. (b) Our own backup codes for passkey users: a table, routes, and a hold that accepts them; its own issue and ruling, about one loop.
- **D3 (lead; seceng to review).** R7's `trustDevice` refusal and R8's `requireClientIp: true` everywhere are service changes in a screens loop. Both tighten; neither is reachable from web.

## Open (no ruling owed here)

1. **OAuth and magic-link holds answer JSON to a browser navigation.** twoFactor's widened hold on the GET paths `/callback/:id` and `/magic-link/verify` returns `{twoFactorRedirect}` as a JSON page (code-read; only `passkeyOnlyHold` redirects GETs). Neither is reachable today (private-CA 404s OAuth; magic link needs the mailer). POLY-88 and POLY-137 must turn it into a 302 to `/sign-in/second-step?with=code`.
2. **DESIGN items for ux-designer-150:** the `mailer_unavailable` state (R4), "Skip for now" for viewers (R1), R5's disabled actions, and no "remember this device" control (R7).
3. **"Backup codes left"** needs the service to decrypt and count; a later issue adds a count-only route to the anchor plugin.
