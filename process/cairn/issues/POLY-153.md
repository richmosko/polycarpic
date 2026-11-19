---
id: POLY-153
title: Web enters by handle
status: done
milestone: POLY-M1
parent: null
blocked_by: [POLY-152]
assignee: backend-lead
paths: [process/cairn/issues/POLY-153.md, process/cairn/reviews/POLY-153/**, apps/auth/**, apps/web/**, apps/worker/**, packages/**, infra/**, tests/**, layers.json, eslint.config.js, scripts/layers/**, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .gitignore, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, docs/DESIGN/**]
labels: [security, auth]
priority: P1
pr: https://github.com/richmosko/polycarpic/pull/136
created: 2026-11-17
updated: 2026-11-19
---

Loop 2 of stage 2 (split from POLY-149 on 2026-11-17). Web enters a transaction only by handing the database a session handle. The database holds just a hash of that handle and checks it in `app.enter_session`. The handle is a second cookie, `__Host-poly_handle`, set by one plugin that must be last in `plugins[]`, on all 13 session paths (`process/cairn/reviews/POLY-148/spike.md` §1 H, §7). Design source: `process/cairn/reviews/POLY-145/pricing.md` §1 blocks E and H. The dev and e2e harness's seeded `storageState` must carry the handle cookie and its `app.session_handle` row (spike §4).

## Acceptance criteria

- [x] `app.enter_session(handle)` takes the **plain** handle and hashes it inside Postgres; web never computes or sends a hash, and a test calls it as poly_app with a stored `handle_hash` (as bytea and as hex text) and gets no user (spike §7.1 H.forgery, required). It finds a live session that is not expired and is under the 30-day cap, writes the marker, and returns the shell projection. Expired, revoked, unknown, and copied-from-the-database values each yield no marker. As in stage 1 (seceng #18): `enter_session` refuses when a marker already exists, poly_worker cannot execute it, and the extended-mode test also covers poly_auth's pools. _Proved by: `tests/db/session-handle-enter.test.ts` (forgery set: stored hash as bytea, `\x…`, bare hex, base64url; token; expired, capped, revoked, unknown; second marker; earlier write; EXECUTE per role; extended-mode two-statement on poly_app and poly_auth), `session-handle-attach.test.ts`, `pgtap/10_session_handle.sql`. Gate: `process/cairn/reviews/POLY-153/gate.md`._
- [x] No column in the database equals a live cookie's handle, checked by query in the test. Deleting a session kills its handle in the same transaction. _Proved by: `session-handle-enter.test.ts` (row scan of every table in public and app for the plain handle), `session-handle-attach.test.ts` (cascade on sign-out and on revoke, no privilege on the table). Gate: `process/cairn/reviews/POLY-153/gate.md`._
- [x] Settings → Sessions, revoke and `requireRecentAuth` are definers that read the marker's session. `loadSession` and the `SessionUserId` brand are removed from web. _Proved by: `session-handle-definers.test.ts` (T3: kinds web and auth refused), `session-handle-pins.test.ts` (step_up_fresh, fails closed), `tests/layers/web-no-betterauth-sql.test.ts`, `apps/web/src/hooks.server.auth.test.ts`, eslint fixtures `35-web-handle-entry`. Gate: `process/cairn/reviews/POLY-153/gate.md`._

- [x] **Cookie scope (seceng #19).** BetterAuth's cookies become `__Secure-` with `Path=/api/auth`; the handle stays `__Host-` with `Path=/`. A test shows web never receives BetterAuth's cookies (spike §1 C, §7.9; moved here by POLY-152's ruling R7, since web reads BetterAuth's cookie until the handle exists). _Proved by: `session-handle-paths.test.ts` (every BetterAuth Set-Cookie `__Secure-` at `/api/auth` on the 13 paths), `auth-refresh.test.ts`, `packages/auth/src/options.test.ts`, e2e `sign-in-flow.spec.ts` and `handle-cookie.spec.ts`, `hooks.server.auth.test.ts` (a hand-sent BetterAuth cookie gets a 303). Gate: `process/cairn/reviews/POLY-153/gate.md`._
- [x] **The session and its handle commit together** on the sign-in paths that have no session yet (email, magic link, OAuth callback, passkey sign-in); a forced handle-INSERT failure leaves no session row (spike §7.8). POLY-152 proves the one-transaction rule with a test plugin (its ruling R9); this is the handle half. _Proved by: `session-handle-signin.test.ts` (forced handle-INSERT failure on the four paths and sign-up, and the silently skipped insert caught by the deferred check at commit), `session-handle-attach.test.ts` (created-and-deleted held sign-in commits), `pgtap/10` (the constraint trigger pinned, plants shown). Gate: `process/cairn/reviews/POLY-153/gate.md`._
- [x] **The interim session call is removed.** Web no longer asks the service's internal `/session` listener who is signed in (POLY-152's ruling R6), and the listener is gone or refuses web. _Proved by: `tests/db/auth-service-main.test.ts` (GET /session 404, one origin), `packages/config/src/auth-service.test.ts`, `tests/infra/auth-service.test.ts` (no web-auth network, one port), `apps/auth/src/bind.test.ts`, `packages/auth/src/web.test.ts`. Gate: `process/cairn/reviews/POLY-153/gate.md`._

## Estimate

3–4.5 loop-days (E 2–3, H 1–1.5; from POLY-149's estimate)

## Comments

### @team-lead — 2026-11-18

Follow-ups from POLY-152 (seceng's build review, `process/cairn/reviews/POLY-152/build-review.md` §3; none blocking):
- **N1 (devops-engineer):** a rendered-compose assertion that `AUTH_INTERNAL_HOST` equals auth's `ipv4_address` on the `internal: true` network and that web's `AUTH_INTERNAL_URL` host equals it, prod and staging. Drop it if this issue removes the interim listener first.
- **N2 (qa):** add `GRANT poly_app TO poly_auth` and the `WITH INHERIT FALSE, SET TRUE` variant to pgTAP 08's planted-grant list.
- **N3 (backend-lead):** eslint refuses `better-auth` and `@better-auth/*` in apps/web; today only the transitive scan does, at test time.
- **N6 (qa):** stale comment at `tests/db/second-step-gates.test.ts:2-3`.

### @team-lead — 2026-11-18

Feature started. Branch: `feature/poly-153-web-enters-by-handle`.

### @architect — 2026-11-18

Architect confirms qa's judgment calls in red-run.md @ 6878c65c; no ruling change.
- Hooks contract: confirmed. R7.1's `shell` is the flat camelCase row withSession hands to fn; hooks builds `locals.session` in today's ShellSession shape from it, and `shell.name` in R7.2 is that row's `name`.
- Bytea forgery case: confirmed. R4's safety property is no marker; a refusal by the driver or the encoding check before the definer is as good. The three text shapes keep the one-message assertion.
- serve.ts catalog lookup: confirmed, on one condition. The lookup must find exactly one function, `app.enter_asserted_user(uuid, uuid)`, and serve.ts must fail otherwise, so the R7.4 revoke can never be a silent no-op. R7.4's three conditions still apply.
- SERIAL pgtap-membership for N2, and deleting auth-internal-session: agreed (R2, R9).

### @architect — 2026-11-18

Architect on backend-lead-153's five build judgment calls @ 943a8fd0. Four are within the ruling; (a) is corrected back to R5.1 as written. No R-item changes.
- (a) Hold and the handle cookie: corrected. R5.1 clears the handle whenever the response clears the session-token cookie, with no hold exception, and that stands. A twoFactor hold overwrites the browser's session cookie with Max-Age=0, so that browser is signed out of /api/auth. Keeping the handle would leave it signed in to web under the earlier session while /api/auth has none, which is incoherent, and on a shared machine an abandoned sign-in by B would leave A signed in to web. The builder's exception was forced by session-handle-paths.test.ts:118 ('no handle cookie at all'). qa narrows that test to: no handle issued, meaning no handle Set-Cookie with a non-empty value and no handle row, while a clearing handle cookie is allowed and required when the session cookie is cleared. The plugin then drops the two_factor exception.
- (b) A 23514 at COMMIT gives a 500 with no cookie and a generic body: within R5.2/R5.3, which require 5xx and no Set-Cookie. It must also give no handle value in the body or log (T5). Confirmed.
- /get-session never attaches: within R5's refresh row. getSession only refreshes and never issues a session. Condition: /get-session stays blocked in AUTH_ROUTES, so an external request never reaches that branch (route-policy-shape pins it).
- Attach by position with no alias: within R3 step 1, which requires the exact text. Confirmed.
- Enter logic in hooks.server.ts; revokeMySession answers { current }; the Sessions action clears the handle and redirects to /sign-in when current: within R6 and R7. Confirmed.

### @team-lead — 2026-11-18

PR opened: https://github.com/richmosko/polycarpic/pull/136. Gate sha 13af0fad; docs and tracker only since.

### @team-lead — 2026-11-19

Validate passed; merging via PR #136. Closing.
