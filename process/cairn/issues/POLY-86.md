---
id: POLY-86
title: BetterAuth: routing pool + allowlist
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-83, POLY-76]
assignee: backend-lead
paths: [packages/auth/**, packages/db/**, packages/tenancy/**, apps/web/src/**, apps/web/tests/**, apps/web/playwright.config.ts, infra/ci/**, .github/workflows/**, .gitignore, pnpm-workspace.yaml, scripts/layers/**, process/cairn/issues/POLY-86.md, process/cairn/reviews/POLY-86/**, tests/**, layers.json, eslint.config.js, apps/*/package.json, packages/*/package.json, pnpm-lock.yaml, package.json, docs/ARCH/**, docs/SECURITY/**]
labels: [auth, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-11
---

packages/auth per ARCH §2.2 and §3.1c, from the 2026-11-08 measurement on POLY-62 (SECURITY A-31, A-33, A-34): BetterAuth on its Kysely path over the routing pool, the pinned options, the /api/auth/* route allowlist and step-up. better-auth and @better-auth/passkey are pinned to one exact version. This is the enabler under the sign-up, providers and second-step stories (POLY-87, POLY-88, POLY-89); POLY-101 wires its tests into CI.

## Acceptance criteria

- [ ] Routing pool: inside withTenant BetterAuth gets the request's client with BEGIN/COMMIT/ROLLBACK as savepoints; outside, a plain pool with no GUC; concurrent connect() in one request serialises.
- [ ] Pinned options exactly as ARCH §2.2 lists (encryptOAuthTokens, idToken-dropping hook, allowPasswordless, no otpOptions, deleteUser off, no bearer plugin, freshAge 30 days, trusted device ≤ 30 days); lint refuses drizzleAdapter in packages/auth.
- [ ] src/route-policy.ts AUTH_ROUTES classifies every route into open / enrolment / step-up / blocked per ARCH §3.1c; an unlisted path answers 404; the blocked class applies to HTTP only.
- [ ] requireRecentAuth() passes within 5 minutes of recent_auth_at (input: false); Settings → Sessions lists without tokens and revokes by id.
- [ ] SECURITY A-38 amendments per ARCH v1.10 §3.1c: /revoke-other-sessions at step-up; the blocked class also refused in the SvelteKit handle; the root layout returns a token-free session projection and forwards a refreshed Set-Cookie; /update-user image null or same-origin; revokeSessionsOnPasswordReset: true; OAuth routes 404 in private-CA mode.
- [ ] Measured on 1.7.18: twoFactor holds only /sign-in/email, and only for a TOTP user (ruling M1). The hold in `src/second-step.ts`: twoFactor's matcher widened to /sign-in/email, /magic-link/verify and /callback/:id, and our after-hook for a passkey-only user; /sign-in/social with an idToken is refused. Test: an enrolled TOTP user and an enrolled passkey-only user each leave all three paths with no session row and no session cookie; createAuth refuses to start unless exactly one twoFactor hook matches. Seceng conditions S1–S18 (`process/cairn/reviews/POLY-86/seceng-ruling-review.md`) bind the build.
- [ ] The routing-pool test and the route-policy test (ARCH §8 rows; `tests/db/auth-routing-pool.test.ts`, `tests/db/auth-route-policy.test.ts`, run in the `db` job) exist and pass against the pinned versions.
- [ ] BetterAuth, with every installed plugin (twoFactor, passkey included), takes the `fields` map from `db/auth` and starts as poly_app with no schema mismatch; a test that drops one map entry sees BetterAuth refuse to start.
- [ ] With every BetterAuth timestamp column declared timestamptz, signUpEmail, signInEmail and getSession succeed as poly_app (POLY-76 (b′) re-run).
- [ ] The routing pool takes its plain pool and `currentClient()` from `db/auth`, and better-auth builds the Kysely dialect from the routing pool; packages/auth imports no Postgres driver (type imports included) and no PostgresDialect.
- [ ] The routes that can insert a `user` row (invitation sign-up `/sign-up/email`, OAuth first sign-in `/callback/:id`, magic link `/magic-link/verify`, and any other the pinned version has) are listed in `src/route-policy.ts`, and the handler runs each inside `withContextFreeTx`; a test drives each listed route to create a user and asserts it ran inside the wrapper: an AFTER INSERT trigger's `txid_current()` on the user row equals the wrapper's `txid_current()` (ARCH §3.1c; ruling R4, addendum 1).
- [ ] With no withContextFreeTx open (`currentClient()` is null), the sign-up hook throws and writes nothing; it never opens a transaction of its own. This is a test-time catch; the per-route tests above are the guard (SECURITY A-40).
- [ ] The session loader calls `provisionPerson` inside `withTenant` and retries the whole transaction once, in a fresh transaction, on 23505 naming `entity_self_user_id_unique`; the retry returns the existing Person with `created: false`. A second 23505, or any other error, fails the request with a logged error and is never swallowed; there is no loop, and no retry on the sign-up path. Test: two concurrent first loads for one new user end with one Person and one owner membership, and both requests succeed (POLY-62 verdict, criterion 1; seceng `reviewed @ 8779392`).
- [ ] `hooks.server.ts` sets `locals.session` as POLY-128's `ShellSession` projection (no token) and redirects a signed-out request. The Playwright smoke loads the shell signed in and asserts the user's name and avatar at the sidebar foot (the half of POLY-128's criterion 3 that moved here).
- [ ] The avatar shown at the sidebar foot is served from our own origin (until avatar upload ships, `image` is always null and the sidebar shows initials); a remote provider image is blocked by the CSP's `img-src 'self' data:`, and the fix is not to allow remote images (seceng, POLY-128 review).


## Comments

### @team-lead — 2026-11-08

Heads-up from the layer-map work (ARCH v1.12.1 §2.1, POLY-82): only packages/db may import a Postgres driver, type imports included, and `PostgresDialect` from kysely is on the banned list. The routing pool must take its pool and dialect types from db. If BetterAuth needs packages/auth itself to construct a `PostgresDialect`, measure that here and bring it back to the architect before working around the rule.

### @team-lead — 2026-11-10

Placed from the POLY-62 and POLY-128 loops (2026-11-11): three criteria added in place (the `provisionPerson` retry, `locals.session` with the signed-in smoke, own-origin avatars).

Also placed here: POLY-85 ruling Open 1 (pass the loaded `Secret` to the pool). The POLY-62 ruling (R9) deferred it to "the next issue that edits `connection.ts`", and this issue builds the routing pool on that code. The architect's gate-1 ruling for this issue decides whether it lands here or names a later owner. Open 3 (`jobs` in the status payload) stays with the first worker-job feature.

The `db` CI job is at 160 s of its 180 s budget after POLY-62; POLY-102 (P1) restores headroom and comes before this issue.

### @team-lead — 2026-11-10

Feature started. Branch: `feature/poly-86-betterauth-routing-pool`. Runs in parallel with POLY-95 (team suffix `-86`).

### @architect — 2026-11-10

Gate 1 ruling: process/cairn/reviews/POLY-86/ruling.md (seceng review pending; re-issued whole if their conditions change it).

Criterion 6 measured on better-auth 1.7.18 (process/cairn/reviews/POLY-86/measure-twofactor.mjs): twoFactor's after-hook matcher covers /sign-in/email, /sign-in/username and /sign-in/phone-number only, and only for twoFactorEnabled. For an enrolled user, /magic-link/verify returned 302 with a new session row and a full getSession, so it was not held. With the matcher widened to /magic-link/verify and /callback/:id, the same call left no session and set the two_factor cookie. A passkey-only enrolled user is held on no path. The hold is added (ruling M1) and folded into ARCH §3.1c. Criteria 6, 7, 10 and 11 are amended in place.
