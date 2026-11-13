---
id: POLY-148
title: Sign-in service spike
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-147]
assignee: seceng
paths: [process/cairn/issues/POLY-148.md, process/cairn/reviews/POLY-148/**, spikes/POLY-148/**]
labels: [security, auth, spike]
priority: P1
pr: null
created: 2026-11-13
updated: 2026-11-13
---

This spike measures, before stage 2 is ruled, the four things stage 2's price and design rest on (`process/cairn/reviews/POLY-145/pricing.md` §2 (e1), `comparison.md` §7 point 1, `architect-recommendation.md` open question 3). It ships a measurement record and throwaway code under `spikes/`, with no product change. seceng drives and backend-lead builds. The architect rules stage 2 from the record.

## Acceptance criteria

- [ ] **Hashed session handle.** Option 1 of `comparison.md` §7 point 1: a second random cookie, with only `sha256(handle)` stored in `app.session_handle` cascading from `session`. Measured on the pinned better-auth: every path that creates or replaces a session reaches our hook, and the service can set the second cookie on that response. The paths are sign-in by email, magic link, OAuth callback, the second-factor step, session rotation at first TOTP verify, and refresh. Each path is named in the record with a pass or fail. If any path fails, option 2 (a symmetric rewrite in the adapter) is measured in the same way. The record also gives the handle cookie's attributes (`__Host-`, `HttpOnly`, `Secure`, `SameSite`) and confirms the handle rotates with every session rotation (seceng #14).
- [ ] **BetterAuth as a same-origin service.** A second Node process from the same image serves `/api/auth/*` behind Caddy on the app origin. The following are measured to work unchanged, as poly_auth: the routing pool, the route allowlist, `withContextFreeTx` sign-up with `provisionPerson` and claim/accept, and the twoFactor hold. The record lists every grant poly_auth needs beyond BetterAuth's tables and the existing definers. If that list includes a tenancy write grant, stage 2's price is re-opened.
- [ ] **BetterAuth's cookie scope (seceng #13).**
  - The problem: on one origin, the browser also sends BetterAuth's session cookie to web, and BetterAuth accepts that cookie for auth actions.
  - What to measure: whether BetterAuth's cookies can carry `Path=/api/auth`. The `__Host-` prefix requires `Path=/`, so a path-scoped cookie would have to use `__Secure-` instead; the record gives that trade-off.
  - Why it matters: if the cookie can be scoped, code execution in web harvests handles only, not BetterAuth sessions.
- [ ] **The sign-in pages.** Measure the cost of serving `/sign-in` and `/sign-up` from the sign-in service rather than web, so that a persistent web compromise cannot alter the page that takes the password. Record the size, the effect on DESIGN, and how the CSP and the Caddy routes change. The Principal decides from the record whether stage 2 includes it.
- [ ] **Magic link and the second factor.** Measure whether an enrolled user signing in by magic link is asked for their second factor (the open item in `comparison.md` §6). The result goes to POLY-89 if it is a gap.
- [ ] **Dev and e2e.** Record what Vite's dev proxy and Playwright's `serve.ts` need to run two servers. Size only; no harness change lands here.
- [ ] The record, `process/cairn/reviews/POLY-148/spike.md`, gives each item's command, predicate and result, and ends with any change to stage 2's blocks S, E and H and to their price.

## Estimate

1.5–2 loop-days, 1 loop (guess; no measured analogue; +0.5 for the cookie-scope item)
