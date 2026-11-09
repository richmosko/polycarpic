---
id: POLY-86
title: BetterAuth: routing pool + allowlist
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-83, POLY-76]
assignee: backend-lead
paths: [packages/auth/**, apps/web/src/routes/api/auth/**]
labels: [auth, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-09
---

packages/auth per ARCH §2.2 and §3.1c, from the 2026-11-08 measurement on POLY-62 (SECURITY A-31, A-33, A-34): BetterAuth on its Kysely path over the routing pool, the pinned options, the /api/auth/* route allowlist and step-up. better-auth and @better-auth/passkey are pinned to one exact version. This is the enabler under the sign-up, providers and second-step stories (POLY-87, POLY-88, POLY-89); POLY-101 wires its tests into CI.

## Acceptance criteria

- [ ] Routing pool: inside withTenant BetterAuth gets the request's client with BEGIN/COMMIT/ROLLBACK as savepoints; outside, a plain pool with no GUC; concurrent connect() in one request serialises.
- [ ] Pinned options exactly as ARCH §2.2 lists (encryptOAuthTokens, idToken-dropping hook, allowPasswordless, no otpOptions, deleteUser off, no bearer plugin, freshAge 30 days, trusted device ≤ 30 days); lint refuses drizzleAdapter in packages/auth.
- [ ] src/route-policy.ts AUTH_ROUTES classifies every route into open / enrolment / step-up / blocked per ARCH §3.1c; an unlisted path answers 404; the blocked class applies to HTTP only.
- [ ] requireRecentAuth() passes within 5 minutes of recent_auth_at (input: false); Settings → Sessions lists without tokens and revokes by id.
- [ ] SECURITY A-38 amendments per ARCH v1.10 §3.1c: /revoke-other-sessions at step-up; the blocked class also refused in the SvelteKit handle; the root layout returns a token-free session projection and forwards a refreshed Set-Cookie; /update-user image null or same-origin; revokeSessionsOnPasswordReset: true; OAuth routes 404 in private-CA mode.
- [ ] Measure (unmeasured on 1.7.18) whether twoFactor holds /magic-link/verify and /callback/:id for an enrolled user; if not, add the pending-session hold so withTenant refuses the session until the second step. Result recorded as a comment and folded into ARCH §3.1c.
- [ ] The routing-pool test and the route-policy test (ARCH §8 rows) exist and pass against the pinned versions.
