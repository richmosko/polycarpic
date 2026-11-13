---
id: POLY-137
title: Auth follow-ups
status: backlog
milestone: POLY-M1
parent: null
blocked_by: []
assignee: backend-lead
labels: [auth, security]
priority: null
pr: null
created: 2026-11-11
updated: 2026-11-12
---

Umbrella for the non-blocking findings from the POLY-86 loop (ruling, verdict and seceng reviews under `process/cairn/reviews/POLY-86/`). One loop for the batch; add later auth nits here.

## Items

- [ ] **S9 dist-enumeration test (gates any upgrade).** Grep the pinned better-auth dist for `createUser`, `createOAuthUser`, `createSession` and `setSessionCookie` and classify each path against `route-policy.ts`. No `better-auth` or `@better-auth/passkey` pin change merges before this test exists (seceng build review @ 04bd75b; verdict follow-up 13).
- [ ] The routing pool refuses a transaction-control statement passed as a query-config object, as it already does for a string (seceng build review, follow-up 1).
- [ ] `/change-password` forces `revokeOtherSessions` (SECURITY C-02); today the caller decides.
- [ ] Settings → Sessions: revoking with an id that is not a uuid answers 404, not 500.
- [ ] A per-email sign-in limit, which C-04 calls for and BetterAuth lacks (seceng S19).
- [ ] One test for `/API/AUTH/...` once routes exist under `/api`: the handle's tree test runs on the raw pathname (verdict follow-up 9).
- [ ] qa: write the e2e step-up stamp inside the revoke spec, not in `serve.ts` before `vite build`; the spec fails if a run takes over 5 minutes to reach it (verdict follow-up 12).
- [ ] The Resend mailer for `sendMagicLink`; apps/web passes one that answers 503 until it exists (ruling follow-up 3).
- [ ] Avatar upload to our own origin, with the same-origin rule on `/update-user` image (ruling follow-up 2; seceng).

## Comments

### @team-lead — 2026-11-12

From the POLY-87 loop (seceng, SECURITY R-24, approved by the Principal 2026-11-13 until the first production deploy): `/callback/:id` holds a `poly_app` pool connection across BetterAuth's outbound call to the IdP, and neither it nor `/magic-link/verify` is rate-limited. Add both routes to C-04's limited list and set `idle_in_transaction_session_timeout` for `poly_app`. This must land before the first deploy.

### @team-lead — 2026-11-12

Added from POLY-145 (seceng-145, threat-model.md S1 and S5 at 53f129b; lead checked against the tree at eb7d195). Verification tokens are stored in the clear. `packages/auth/src/options.ts` sets neither `verification.storeIdentifier` nor the magic-link plugin's `storeToken`; better-auth 1.7.18's magic-link default is `"plain"` (`dist/plugins/magic-link/index.mjs:42`). `public.verification` has no row-level security and `poly_app` holds SELECT on it (`0001_app_foundation.sql:27`). So SQL run as `poly_app` can request a reset or magic link for any user, read the token, and take the account. SECURITY R-12's "a DB read alone cannot forge one" covers the session cookie only.

To do in this issue, whatever POLY-145 decides: set both options to `"hashed"`, add a test that a stored verification value never equals the token sent, and correct R-12's wording. This is a must-have before the first deploy.
