---
id: POLY-148
title: Sign-in service spike
status: done
milestone: POLY-M1
parent: null
blocked_by: [POLY-147]
assignee: seceng
paths: [process/cairn/issues/POLY-148.md, process/cairn/reviews/POLY-148/**, spikes/POLY-148/**]
labels: [security, auth, spike]
priority: P1
pr: https://github.com/richmosko/polycarpic/pull/129
created: 2026-11-13
updated: 2026-11-15
---

This spike measures, before stage 2 is ruled, the four things stage 2's price and design rest on (`process/cairn/reviews/POLY-145/pricing.md` §2 (e1), `comparison.md` §7 point 1, `architect-recommendation.md` open question 3). It ships a measurement record and throwaway code under `spikes/`, with no product change. seceng drives and backend-lead builds. The architect rules stage 2 from the record.

## Acceptance criteria

- [x] **Hashed session handle.** Option 1 of `comparison.md` §7 point 1: a second random cookie, with only `sha256(handle)` stored in `app.session_handle` cascading from `session`. Measured on the pinned better-auth: every path that creates or replaces a session reaches our hook, and the service can set the second cookie on that response. The paths are sign-in by email, magic link, OAuth callback, the second-factor step, session rotation at first TOTP verify, and refresh. Each path is named in the record with a pass or fail. If any path fails, option 2 (a symmetric rewrite in the adapter) is measured in the same way. The record also gives the handle cookie's attributes (`__Host-`, `HttpOnly`, `Secure`, `SameSite`) and confirms the handle rotates with every session rotation (seceng #14).
- [x] **BetterAuth as a same-origin service.** A second Node process from the same image serves `/api/auth/*` behind Caddy on the app origin. The following are measured to work unchanged, as poly_auth: the routing pool, the route allowlist, `withContextFreeTx` sign-up with `provisionPerson` and claim/accept, and the twoFactor hold. The record lists every grant poly_auth needs beyond BetterAuth's tables and the existing definers. If that list includes a tenancy write grant, stage 2's price is re-opened.
- [x] **BetterAuth's cookie scope (seceng #13).**
  - The problem: on one origin, the browser also sends BetterAuth's session cookie to web, and BetterAuth accepts that cookie for auth actions.
  - What to measure: whether BetterAuth's cookies can carry `Path=/api/auth`. The `__Host-` prefix requires `Path=/`, so a path-scoped cookie would have to use `__Secure-` instead; the record gives that trade-off.
  - Why it matters: if the cookie can be scoped, code execution in web harvests handles only, not BetterAuth sessions.
- [x] **The sign-in pages.** Measure the cost of serving `/sign-in` and `/sign-up` from the sign-in service rather than web, so that a persistent web compromise cannot alter the page that takes the password. Record the size, the effect on DESIGN, and how the CSP and the Caddy routes change. The Principal decides from the record whether stage 2 includes it.
- [x] **Magic link and the second factor.** Measure whether an enrolled user signing in by magic link is asked for their second factor (the open item in `comparison.md` §6). The result goes to POLY-89 if it is a gap.
- [x] **Dev and e2e.** Record what Vite's dev proxy and Playwright's `serve.ts` need to run two servers. Size only; no harness change lands here.
- [x] The record, `process/cairn/reviews/POLY-148/spike.md`, gives each item's command, predicate and result, and ends with any change to stage 2's blocks S, E and H and to their price.

## Estimate

1.5–2 loop-days, 1 loop (guess; no measured analogue; +0.5 for the cookie-scope item)

## Comments

### @team-lead — 2026-11-15

Feature started. Branch: `feature/poly-148-sign-in-service-spike`.

### @team-lead — 2026-11-15

Acceptance criteria ticked against the record `process/cairn/reviews/POLY-148/spike.md` (accepted by seceng in §7 on the record at `65a85c25`; first line corrected at `9db9428f`). Run: harness `c3055b0e`, checks `9fda8f8d`, 36 lines: 28 PASS, 4 FAIL, 4 REPORT, 0 UNMEASURED; Chromium 7 of 7; reproduced independently by seceng.

1. Hashed handle: §1 H, one named line per path (13 paths, six beyond this issue's list), cookie attributes given, rotation confirmed. Option 2 not measured: no session path failed, and seceng rules it not owed (§7). H.forgery and H.refresh FAIL as stage-2 findings.
2. Same-origin service: §1 S and the grant list. **The list includes a tenancy write grant (`entity INSERT`), so stage 2's price is re-opened** (§6: +0.5 loop-day guess for a `provision_person` definer).
3. Cookie scope: §1 C, with the `__Host-` versus `__Secure-` trade-off (§7.9).
4. Sign-in pages: §2 (Chromium), §3 (size, DESIGN, CSP, Caddy). Principal's decision: not moved (`process/DECISIONS.md`, 2026-11-15).
5. Magic link and second factor: §1 M, an enrolled user is held; no gap for POLY-89 from this item.
6. Dev and e2e: §4, size only.
7. The record: §6 gives the changes to blocks S, E and H and their price.

Follow-ups for POLY-149, POLY-89, POLY-138 and SECURITY are held for one filing pass after merge.

### @team-lead — 2026-11-15

PR opened: https://github.com/richmosko/polycarpic/pull/129. Awaiting Validate.

### @team-lead — 2026-11-15

Validate passed (seceng's accepting verdict in the record's §7; CI green on `4bb0f395`); merging via PR #129. Closing.
