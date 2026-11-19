# POLY-150 — test plan (qa-engineer-150)

Written against `ruling.md` @ 48acb75c (R0–R11, D1–D4) and `ruling-review.md` §1 (RC1–RC4; the architect's Addendum 1 may restate them, the tests follow the review). Criteria C1–C5 are `POLY-150.md`'s, in order. "Red because" is the reason the test fails on today's tree; `red-run.md` records the real first failure per file.

## Conventions

- Files: `DB` = `tests/db/second-step-screens.test.ts` (area `auth`, in `DB_AREAS` and the `db-areas.test.ts` row); `SEAM` = `apps/auth/src/seam.test.ts`; `NEXT` = `apps/web/src/lib/safe-next.test.ts`; `BND` = `apps/web/src/routes/second-step-boundary.test.ts`; `E2E` = `apps/web/tests/e2e/*.spec.ts`; `PG11` = `tests/db/pgtap/11_poly_app_grants.sql`; `GATE` = `tests/db/gate-check.test.ts`.
- **Held until the lead relays the Principal's answers** (not written yet): D1 (does sign-up ask the emailed code: the sign-up leg of the enrol test), D2/R-passkey (does the passkey path show backup codes: spec 2's assertion), the locked screen's wording about time (spec 3 `#locked`), bare page vs app shell (page-chrome assertions). Specs 1 and 2 are written for the ruling's reading (sign-in-born set-up, passkey shows no codes) and flagged.
- Refusals assert the state they leave (no session, no handle, no row), not the status alone.
- The e2e specs run in one worker per file; each state-changing spec has its own seeded user (R9). The shared-address limit is measured in `red-run.md` (R8, unmeasured).

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
| **R5** Settings panel: methods, add passkey, remove, new codes, last-method Remove absent, paused Remove disabled | E2E spec 8 (Tess: panel shows app + date, Remove app is absent while `needs_a_method`; Make new codes inside the 5-minute freshness runs directly) | no panel |
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

## Not covered, on purpose

- The Principal-held items above, until relayed.
- Confirm it's you's form states (POLY-151): the interim state only.
- Caddy's header (RC2's second half): a devops lint, not a browser test.
