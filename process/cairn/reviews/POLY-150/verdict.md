# POLY-150 — verdict (architect)

**APPROVE at `3607aa34`**, against the ruling and its Addenda (`ruling.md` @ 7f7e3ee5, Addenda 1–7 included).
- **Measured:** the gate at `dc48d669` (`gate.md` @ 9c594fce): db 1192/1192, e2e 80/80, ci 542, layers 545, infra 185, config 97, every package and app, lint, and an uncached typecheck.
- **After the gate:** the only code is `3607aa34`, the auth healthcheck's `x-forwarded-for`. That follows from R8's `requireClientIp: true` everywhere, which the ruling did not carry through to the healthcheck.
- **The condition on this verdict:** qa's re-run of tests/infra, tests/ci and lint at `3607aa34` is green. A red there reopens it.
- **Method:** I read the build at `3607aa34`; I ran nothing myself.

| Axis | Ruling | Result | Evidence |
|---|---|---|---|
| Web holds no secret and calls no service | R1.4 | Pass. No server file names `/api/auth`; `/sign-in/second-step` has no server file; no `actions` on the second-step routes; `{@html` and `prerender` are banned in all of web | `web-boundary.test.ts`, `second-step-boundary.test.ts`, `second-step-rc.test.ts` @ dc48d669 |
| The gate | R1.3, Add. 1 P2 | Pass. It exempts exactly `/settings/second-step` and its `__data.json`, and redirects with `?setup=1&next=` through `safe-next.ts`. A held user's selector shows one label, from the session row | `hooks.server.ts`, `hooks.server.gate.test.ts`, `EntitySelector.svelte`, `second-step.spec.ts` spec 1 |
| `no-store` | R10, RC3 | Pass. Every signed-in page and its `__data.json` (hooks), and every `/api/auth` answer (`handleAuthRequest`) | `hooks.server.ts`, `handler.ts`, `second-step-misc.spec.ts` |
| `app.my_second_step()` | R2, RC1 | Pass. poly_govern; EXECUTE poly_app only; kind `session`; the ruled columns; `two_factor.created_at` added. pgTAP 11 is at eleven | 0018, `second-step-screens.test.ts`, pgTAP 07 and 11 |
| The set-up dialog | R3, R3.0, R3.5 | Pass. A portal to `document.body`; forms with no action; `fetch` only to `/api/auth`; cleared on close, Escape, backdrop, `beforeNavigate`, destroy and `pagehide`; the download URL revoked; `invalidateAll()` after the rotation | `SecondStepSetup.svelte`, `second-step.spec.ts` specs 1 and 2 |
| send-code with no mailer | R3.7 | Pass. 503 `mailer_unavailable` before the body; `sentTo` masked by the service | `anchor.ts`, `second-step-screens.test.ts` |
| The code stand-in | R4 | Pass, with deviation 1 below. `deps.sendSecondStepCode` is refused outside development, and `cli()` passes none | `apps/auth/src/main.ts`, `seam.test.ts`, `tests/db/helpers/auth-entry.ts` |
| The held sign-in and `trustDevice` | R7 | Pass. Routed from the response body; `trust_device_refused` on both verify paths | `sign-in/+page.svelte`, `route-policy.ts`, `second-step-held.spec.ts` |
| The lock band | D6 (b), Add. 1 to D6 | Pass. Read only through the signed cookie and a live hold; three bands; nothing with a session, a forged hold or an expired hold | `lock-band.ts`, `second-step-lock-band.test.ts`, `second-step-locked.spec.ts` |
| The client address | R8 | Pass. Vite's proxy overwrites `x-forwarded-for`; `requireClientIp: true`; Playwright sends no address; the `rate-limit` project runs last | `vite.config.ts`, `playwright.config.ts`, `rate-limit.spec.ts` |
| Framing | R10, RC2 | Pass. Caddy's `X-Frame-Options "DENY"` and its lint entry; the CSP header on the new pages | `Caddyfile`, `compose-policy.mjs`, `tests/infra` |
| The re-check routes | Add. 3 A1, Add. 4, Add. 7 | Pass. Class `reauth`, in `LIMITED`, refusals committed. Lock, then password, then factor; one `step_up_failed`; `challenge_expired`; the lock refusal carries no band | `reauth.ts`, `route-policy.ts`, `step-up-reauth.test.ts` (32) |
| The stamp | Add. 3 A3.2, RC6 | Pass. `complete_step_up` is the one writer, poly_auth only, kind `auth`. It spends the challenge, checks the lock, steps forward only within ±1, stamps `now()` on exactly one row, and writes the `step_up` record in the same transaction | 0019:145-215, pgTAP 08 and 12, `step-up-reauth.test.ts` T1–T9 |
| The backup-code order | Add. 3 A3.3, D7 (b) | Pass. Stamp, then the list, then the counter reset; the deferred `step_up_pending_resolved` | `reauth.ts`, 0019:282-300 and 368-371 |
| The sign-in step joining the guard | Add. 3 A3.4 | Pass, with note 6 below | `noteTotpStepHook`, `note_totp_step` |
| The passkey re-check | Add. 3 A1, A3.5, Add. 6 | Pass. User verification required; no session is made; the counter never goes down, marked or not; `step_up_challenge_hash` as accepted | `reauth.ts`, 0019:264-279 and 376-412 |
| The method audit and no-truncate | Add. 5 | Pass. `sync_second_step` writes `second_step.method_added` and `method_removed`, with the ruled actor and payload. TRUNCATE is refused on `two_factor` and `passkey` | 0019:305-358 and 366-367, `method-audit.test.ts` |
| The deploy gate | Add. 5 | Pass. Steps 12 and 13 check the sync triggers, the body pin, the no-truncate triggers, `complete_step_up` and the step-up triggers | `infra/postgres/gate-check.sql`, `gate-check.test.ts` |

**Deviations from the ruling, each accepted:**
1. **The test entry** is `tests/db/helpers/auth-entry.ts`, not `apps/web/tests/e2e/auth-entry.ts`. It is still under `tests/`, outside the image, with its path fixed in code, and `seam.test.ts` pins that `apps/auth` names no sink.
2. **0019 replaces `app.refuse_last_method()`.** It now chooses the kind by table before reading `verified`, which a passkey row lacks. That is a fix to POLY-89's trigger, which would have failed on a passkey delete. `last-method-guard.test.ts` proves it.
3. **`app.step_up_challenge_hash(uuid)`** (Addendum 6).
4. **The lock-band hook sits in the anchor plugin** (D6's correction).
5. **The auth healthcheck sends `x-forwarded-for`** (`3607aa34`). This was R8's gap. devops found the 503.
6. **`noteTotpStepHook` logs `totp_step_not_noted`** and lets the sign-in stand when `note_totp_step` refuses a step outside the database's ±1. That happens only when the clocks differ by a full step. The re-check's own window and guard still apply, so the cost is one code that a re-check could reuse in that case.

**Debt and drift for the lead (none blocks):**
- ARCH is brought to this build in the same commit.
- SECURITY's items (R-2's new sentence, C-03, C-88, C-89, R-25, the T-entry) are seceng's, at its build review.
- INFRA's step 16 is the lead's.
- Open 5 (sign-in's reused code) and Open 6 (`/change-email`) need filing.
