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
updated: 2026-11-08
---

packages/auth per ARCH §2.2 and §3.1c, from the 2026-11-08 measurement on POLY-62 (SECURITY A-31, A-33, A-34): BetterAuth on its Kysely path over the routing pool, the pinned options, the /api/auth/* route allowlist and step-up. better-auth and @better-auth/passkey are pinned to one exact version. This is the enabler under the sign-up, providers and second-step stories (POLY-87, POLY-88, POLY-89); POLY-101 wires its tests into CI.

## Acceptance criteria

- [ ] Routing pool: inside withTenant BetterAuth gets the request's client with BEGIN/COMMIT/ROLLBACK as savepoints; outside, a plain pool with no GUC; concurrent connect() in one request serialises.
- [ ] Pinned options exactly as ARCH §2.2 lists (encryptOAuthTokens, idToken-dropping hook, allowPasswordless, no otpOptions, deleteUser off, no bearer plugin, freshAge 30 days, trusted device ≤ 30 days); lint refuses drizzleAdapter in packages/auth.
- [ ] src/route-policy.ts AUTH_ROUTES classifies every route into open / enrolment / step-up / blocked per ARCH §3.1c; an unlisted path answers 404; the blocked class applies to HTTP only.
- [ ] requireRecentAuth() passes within 5 minutes of recent_auth_at (input: false); Settings → Sessions lists without tokens and revokes by id.
- [ ] The routing-pool test and the route-policy test (ARCH §8 rows) exist and pass against the pinned versions.
