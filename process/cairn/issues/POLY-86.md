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
- [ ] BetterAuth, with every installed plugin (twoFactor, passkey included), takes the `fields` map from `db/auth` and starts as poly_app with no schema mismatch; a test that drops one map entry sees BetterAuth refuse to start.
- [ ] With every BetterAuth timestamp column declared timestamptz, signUpEmail, signInEmail and getSession succeed as poly_app (POLY-76 (b′) re-run).
- [ ] The routing pool takes its pool and Kysely dialect from `db/auth`; packages/auth imports no Postgres driver or PostgresDialect.
- [ ] The routes that can insert a `user` row (invitation sign-up `/sign-up/email`, OAuth first sign-in `/callback/:id`, magic link `/magic-link/verify`, and any other the pinned version has) are listed in `src/route-policy.ts`, and the handler runs each inside `withContextFreeTx`; a test drives each listed route to create a user and asserts it ran inside the wrapper (ARCH v1.14 §3.1c).
- [ ] With no withContextFreeTx open (`currentClient()` is null), the sign-up hook throws and writes nothing; it never opens a transaction of its own. This is a test-time catch; the per-route tests above are the guard (SECURITY A-40).


## Comments

### @team-lead — 2026-11-08

Heads-up from the layer-map work (ARCH v1.12.1 §2.1, POLY-82): only packages/db may import a Postgres driver, type imports included, and `PostgresDialect` from kysely is on the banned list. The routing pool must take its pool and dialect types from db. If BetterAuth needs packages/auth itself to construct a `PostgresDialect`, measure that here and bring it back to the architect before working around the rule.
