# POLY-150 — test plan (qa-engineer-150)

Written against `ruling.md` @ 48acb75c (R0–R11, D1–D4) and `ruling-review.md` §1 (RC1–RC4; the architect's Addendum 1 may restate them, the tests follow the review). Criteria C1–C5 are `POLY-150.md`'s, in order. "Red because" is the reason the test fails on today's tree; `red-run.md` records the real first failure per file.

## Conventions

- Files: `DB` = `tests/db/second-step-screens.test.ts` (area `auth`, in `DB_AREAS` and the `db-areas.test.ts` row); `SEAM` = `apps/auth/src/seam.test.ts`; `NEXT` = `apps/web/src/lib/safe-next.test.ts`; `BND` = `apps/web/src/routes/second-step-boundary.test.ts`; `E2E` = `apps/web/tests/e2e/*.spec.ts`; `PG11` = `tests/db/pgtap/11_poly_app_grants.sql`; `GATE` = `tests/db/gate-check.test.ts`.
- **Held until the lead relays the Principal's answers** (not written yet): D1 (does sign-up ask the emailed code: the sign-up leg of the enrol test), D2/R-passkey (does the passkey path show backup codes: spec 2's assertion), the locked screen's wording about time (spec 3 `#locked`), bare page vs app shell (page-chrome assertions). Specs 1 and 2 are written for the ruling's reading (sign-in-born set-up, passkey shows no codes) and flagged.
- Refusals assert the state they leave (no session, no handle, no row), not the status alone.
- The e2e specs run in one worker per file; each state-changing spec has its own seeded user (R9). The shared-address limit is measured in `red-run.md` (R8, unmeasured).

## Re-issue fbf9a527: set-up is a dialog (this section wins over any row below that says "page")

Set-up is one dialog (`SecondStepSetup.svelte`, a portal on `document.body`) opened from Settings and from an Entities message; a held user is sent to the one Settings page (`/settings/second-step?setup=1`). The rows below that mention "the set-up page" now read "the dialog". Tests added or changed:

| Ruling | Test | File |
|---|---|---|
| R1.3 exempt exactly `/settings/second-step` and its `__data.json`; the rest of `/settings`, `/entities`, `__data.json`, a longer path and a POST elsewhere 303 to `?setup=1` | unit table over the real `handle`; e2e as held Lou against the built server | `hooks.server.gate.test.ts`; `second-step-misc.spec.ts` › "R1.3 the gate while held" |
| R1.3 a held page loads no entity data, shell included | Enid (manages "Shared Co", seeded with its id): `/settings/second-step/__data.json` holds neither name nor id | `second-step.spec.ts` spec 1 |
| R1.4 whole-of-web: no server file names `/api/auth` (but hooks), no `{@html` in any `.svelte`, no `prerender` under `routes/**`; each shown to fail on a plant | `web-boundary.test.ts`, `second-step-rc.test.ts` | |
| R3.0 dialog outside any form, fetch only, tested on Settings **and** Entities | source: forms carry no action or method, `preventDefault`, mounts on `document.body`, not rendered inside a `<form>` (`second-step-rc.test.ts`); browser: no non-GET request to web outside `/api/auth/*` while enrolling, on Settings (spec 1) and on Entities (spec 2) | |
| R3.5 cleared on close, Escape, backdrop, `beforeNavigate`, destroy, `pagehide`; sidebar navigation | source check for `pagehide`, `beforeNavigate`, destroy; spec 1: a sidebar link with the codes on screen asks first, then the link is followed, back, forward: no code in the DOM; spec 6b: Close, Escape, backdrop each empty a typed password on reopen | `second-step-rc.test.ts`; `second-step.spec.ts`; `second-step-misc.spec.ts` |
| R3.6 carry-on is a new request on the rotated session | spec 1: after the verify, `/dashboard` is 200 and every post-enrolment request is made under the new handle (the `/dashboard` request, Make new codes, the later held sign-in); the dialog's host `invalidateAll()` is a GET (`writes` stays empty) | `second-step.spec.ts` |
| R10 every signed-in HTML and `__data.json` is `no-store`; `/entities` joins the page-data and header scans | misc spec | `second-step-misc.spec.ts` |
| R9 seeds | Enid and Lou are managers of "Shared Co"; **Pia and Vic hold no manager seat** (see note); Rae is gone (spec 6b and spec 1 cover what her test did) | `serve.ts` |

Note for the lead: R9 spec 2 has Pia open `/entities` and see the message, but R9's seeds make her a manager, whom the gate redirects away from `/entities`. I seeded Pia as a non-held user.

## Criteria

| Criterion | Test | Red because |
|---|---|---|
| **C1** DESIGN carries the set-up flow | DESIGN's stage (150a), not a test. E2E spec 1 walks the DESIGN ids (`#held`, `#password`, `#email`, `#app`, `#backup-codes`, `#done`) | no screens |
| **C2** DESIGN carries `/sign-in/second-step` and Confirm it's you | E2E spec 3/4/5 walk its ids (`#expired`, `#locked`, passkey states); E2E spec 8 the interim dialog (no inputs, only Close) | no page |
| **C3** screens built in web, replace the placeholder | E2E spec 1 (`second-step.spec.ts`: the "has no form" test is replaced); spec 8 Settings panel (methods listed, last-method Remove absent, add/remove); `BND` (routes exist, no server file under `/sign-in/second-step`) | placeholder only |
| **C4** enrolled user held at `/sign-in` until the second step passes | E2E spec 3 (Tess: no `__Host-poly_handle`, `/dashboard` 303 → `/sign-in`, wrong code leaves her held, right code sets the handle and reaches `next`), spec 4 (backup code, reuse refused), spec 5 (Kay passkey-only, `?with=passkey`, no handle) | no page, serve.ts seeds no Tess/Kay |
| **C5** browser test enrols end to end against the real handler | E2E spec 1 (app: password → emailed code from the outbox → password → typed-out key → TOTP → ten codes → Finish → reload/back show no code → re-sign-in held), spec 2 (passkey, Chromium virtual authenticator, no `createSession`) | no screens, no outbox |

## Ruled items

| Item | Test | Red because |
|---|---|---|
| **R1** pages and routes, no server I/O | `BND`: no server file under `routes/{sign-in/second-step,settings/second-step}` calls `fetch`, names `/api/auth` or exports `actions`; `/sign-in/second-step` has no server file; no `+server.ts` under either | no routes yet (the placeholder's server file names nothing, so the "no server file" half is the red one) |
| **R1 `next`** (S22) | `NEXT`: `//x`, `/\x`, `https://x`, `javascript:x`, `%2F%2Fx`, empty → `/`; a plain path passes; hooks.server.ts imports the module (`BND`) | no `safe-next.ts` |
| **R1** gate redirect carries `?next=` | E2E spec 1 (`#held` URL has `next`); `hooks.server.gate.test.ts` is unchanged and stays green | redirect has no `next` |
| **R2** definer: owner, secdef, search_path, EXECUTE poly_app only, exact-call, return columns pinned, no secret column | `DB` › "R2 catalog" (owner `poly_govern`, `prosecdef`, `proconfig`, ACL, `0018` column `two_factor.created_at` with default); › "R2 return columns are exactly the eight" | no function |
| **R2** behaviour: fresh user; TOTP enrolled (`totp_added_at`); passkeys list ordered; open challenge; `resend_available_at` NULL under suppression and idle; live grant; `needs_a_method`; `codes_paused` boolean only | `DB` › "R2 rows" (one case per field; seeded through the real handler where BetterAuth writes) | no function |
| **R2** refusal: no marker / non-session marker → 42501 | `DB` › "R2 refuses without a session marker" | no function |
| **R2** never returns secret, backup codes, key, credential id, count, email | `DB` › canary: seeded secret/backup text/credential id absent from the serialized row | no function |
| **RC1** poly_app's EXECUTE set moves from ten to eleven | `PG11` (list, both readings, `routine_privileges`) now names `app.my_second_step()`; `GATE` plant "poly_app loses my_second_step"; `DB` › "definers.json lists it" (existing `definerGaps` check in pgtap.test.ts covers the rest) | function absent |
| **R3** no mailer: `send-code` answers 503 `mailer_unavailable` first | `DB` › "no mailer: 503 before the body is read": with a wrong password, an empty body, a right password, and past the 5-a-minute cap each give the same 503 body; no challenge row written; wrong password does **not** answer `invalid_password` | today: 403 `invalid_password`, or a 500 after the check |
| **R3** with a mailer: 200 `{status, sentTo}` masked, equal for sent and suppressed | `DB` › "sentTo"; suppressed after 3 sends answers the same shape | no `sentTo` |
| **R3** nothing falls back: code in no log/response | `DB` › canary over a captured console and response bodies; E2E R10 log capture | — |
| **R4** seam | `SEAM`: `cli()` passes no deps; `startAuthService` with `deps.sendSecondStepCode` throws `ConfigError` unless `APP_ENV=development`; `apps/auth/src/**` names no outbox/file sink/test entry. E2E harness: `auth-entry.ts` + `outbox.jsonl` (0600) are the stand-in | no `deps` parameter |
| **R5** Settings panel: methods listed, Remove and Make new codes | E2E spec 8 (Una, an app and a passkey: both listed, no backup-code count). The service side of add, remove and make-new-codes is POLY-89's. **Not browser-tested here**: the last-method Remove being absent, a paused Remove being disabled, and Make new codes running inside the 5-minute freshness: each needs a user in a state the seed cannot hold for the length of the suite (the 5 minutes) or a second user per state; `my_second_step`'s `needs_a_method` and `codes_paused` are covered in `DB`, so the build has the data | no panel |
| **R6** interim Confirm it's you: names the action, one Close button, no inputs | E2E spec 8 (Kay's session older than 5 minutes: serve.ts back-dates `recent_auth_at`) | no dialog |
| **R7** hold lifetime 600 s | `DB` › "unmeasured (R7): hold cookie Max-Age 600 and verification expiresAt 600 ± 5"; "a hold past expiresAt answers 401" | measured in `red-run.md` |
| **R7** `trustDevice` refused 400 on both paths, no session, no `trust_device` cookie | `DB` › "trustDevice on verify-totp / verify-backup-code" | passes through today |
| **R7** page identical for every caller (S10) | E2E spec 7: anonymous, Enid and Tess open `/sign-in/second-step` with no hold: same status, same text, same states | no page |
| **R7** lock: one `#locked` state, no time shown | held (see top): wording pending; the **absence** of a time is asserted by `BND` (no `locked_until`/`lockedUntil` in the second-step sources) | no page |
| **R8** proxy sets the client address; forged header ignored | E2E spec 7b: a real sign-in with `x-forwarded-for: 198.51.100.9`; `sign_in_record.ip_address` is loopback, not the forged one; `extraHTTPHeaders` removed from `playwright.config.ts` | Vite proxy forwards the browser's header |
| **R8** `requireClientIp` true in every `APP_ENV` | `DB` › "development service refuses a request with no x-forwarded-for"; serve.ts's readiness probe sends its own | development exempt today |
| **R8** rate limit real; suite fits | `rate-limit` Playwright project (6th wrong `confirm-code` → 429, page shows its message); measurement in `red-run.md` | no project |
| **R9** seeds Enid, Pia, Tess, Kay, Lou, Manny/Ada unchanged | `serve.ts` (harness) | — |
| **R9** specs 1–7 | `second-step.spec.ts` (1, 2), `second-step-held.spec.ts` (3, 4, 5), `second-step-misc.spec.ts` (6, 7, 7b, 8, 9: panel/dialog/RC4) | see rows above |
| **R10** nothing in logs / page data / bundle | `E2E` › "page data": rendered HTML and `__data.json` of both pages hold none of the seeded secrets/backup codes/credential id/public key; "browser storage and history hold none"; "logs": web and service stdout captured across specs 1 and 3 hold none of the canaries; "headers": `frame-ancestors 'none'` on both pages, `Cache-Control: no-store` on `enable` | pages absent |
| **R10** `no-store` on every `/api/auth` response | `DB` › "no-store on enable, sign-in, errors" | BetterAuth sends none on `enable` (unmeasured; measured in `red-run.md`) |
| **RC2** `frame-ancestors 'none'` | `E2E` › "headers" (web's CSP; the Caddy half is devops's lint and not mine) | page absent |
| **RC3** backup codes not recoverable by back/forward or the page cache | `E2E` spec 1: after the codes screen, navigate away and `goBack`, and reload: no code in the DOM, and `/settings/second-step`'s response is `Cache-Control: no-store` | page absent |
| **RC4** passkey name shown as text | `BND`: no `{@html` under the second-step routes or the Settings panel; `E2E` spec 9: a seeded passkey named `<img src=x onerror=…>` renders as literal text and runs nothing | no panel |

## E2E users and the shared sign-in limit

Seeded by `serve.ts` through the service's code path: Enid (spec 1, app), Pia (spec 2, passkey), Rae (RC3), Lou (spec 6), Tess (specs 3, 4; TOTP), Kay (spec 5; passkey only, key exported for Chromium's virtual authenticator), Una (specs 7–9, R10; TOTP + a passkey named `<img src=x onerror=window.__xss=1>`, step-up stamp an hour old). Enid, Pia, Rae, Lou and Una start from a signed-in state file, so a spec that is not about signing in spends no limiter budget. `support.ts` `slot()` paces the real 5-a-minute limit (see `red-run.md`); the limit is never raised, forged or reset. Logs of web and the service are teed to `.auth/` for the R10 scan, which runs last in the `rate-limit` project.

## Not covered, on purpose

- The Principal-held items above, until relayed.
- Confirm it's you's form states (POLY-151): the interim state only.
- Caddy's header (RC2's second half): a devops lint, not a browser test.
