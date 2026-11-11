# POLY-86 gate-1 ruling: SecEng conditions

Reviewer: seceng-86. Ruling under review: `process/cairn/reviews/POLY-86/ruling.md` @ 0b987df.
Result: **approved on conditions S1–S18**. Each one is a requirement for the re-issued ruling, with the test that proves it. There is no veto. Items marked (unmeasured) are code-reads against 1.7.18 that the builder confirms; where a measurement says otherwise, the builder reports it at gate 3 and the condition is re-issued once.

**Against the re-issue @ 64b3eb0**, which folded the pre-ruling notes:
- **Already met:** S1, S2, S11 and S15.
- **Met except one point:** S3 (`backgroundTasks` must stay unset) and S7 (the handle must also 404 *unlisted* paths, not only blocked ones).
- **Still open:** S4–S6, S8–S10, S12–S14 and S16–S18.
  - S8 supersedes the re-issue's choice to hold `/sign-in/social` with an `idToken`: refuse it.
  - S14 settles the re-issue's open point on the clock: use the database's `now()`.

M1, R2, R3 (the flat enrolment refusal), R4, R8 and R11 are accepted as written, apart from the conditions below.

## Routing pool and transaction (R2, R4)

**S1. Commit only on success.** `auth.handler` turns a thrown `APIError` (or a database error it catches) into a `Response`. It does not rethrow. Inside `withTenant` and `withContextFreeTx`, `handleAuthRequest` therefore rolls back whenever the response status is ≥ 400, and also on any throw. It still returns the response, but drops its `Set-Cookie`. Why this matters: BetterAuth's own `ROLLBACK` becomes `ROLLBACK TO SAVEPOINT` and leaves our transaction healthy. Writes made before the failed step would then commit (for example, a first TOTP verify that half-enrols, or a user row left behind by a refused sign-up). Test: a before-hook refusal and a forced trigger refusal mid-request each leave no row from that request.

**S2. The COMMIT result is checked.** In Postgres, `COMMIT` on an aborted transaction succeeds as a statement and actually rolls back; node-pg reports it as `command === 'ROLLBACK'`. `inTransaction` (packages/db `context.ts`) throws when the commit result is not `COMMIT`. Test: inside `withTenant`, a statement fails and the error is caught, the function returns normally, and the call rejects.

**S3. A lease dies with its transaction.** AsyncLocalStorage carries the `{ kind, client }` store into every callback scheduled inside the request, including callbacks that run after `withTenant` has released the client to another tenant. So:
- the store carries a `live` flag, which `inTransaction` clears in `finally` before `release()`;
- `currentClient()` throws `TransactionEnded` on a dead store. It does not return null, which would silently fall through to the plain pool;
- any `query` on a lease after that point throws;
- BetterAuth's background-task option (`advanced.backgroundTasks` or its 1.7.18 name) stays unset, so its work is awaited inside the request.

Test: a `setTimeout` scheduled inside `withTenant` that calls `connect()` after the commit rejects, and the backend's next user sees nothing from it.

**S4. Statement rewriting is a closed grammar.**
- Rewrite exactly `BEGIN`, `START TRANSACTION`, `COMMIT`, `END` and `ROLLBACK` (case-insensitive, optional `;`, no options).
- Pass `SAVEPOINT x`, `RELEASE [SAVEPOINT] x` and `ROLLBACK TO [SAVEPOINT] x` through unchanged. `ROLLBACK TO …` must not match the `ROLLBACK` rule.
- Throw on any other statement that starts with a transaction-control keyword: `BEGIN ISOLATION LEVEL …`, `SET TRANSACTION`, `ABORT`, `COMMIT AND CHAIN`, `PREPARE TRANSACTION`, `COMMIT PREPARED`. Throw too on a query string with more than one statement when the first is a control statement.
- A `ROLLBACK` decrements the depth counter just as `COMMIT` does.

Test: one fixture per form.

**S5. The client stays opaque.** `AuthClient` (the type R2 re-exports) exposes `query` only, never `release`. The routing pool never releases the underlying client. A test asserts the pool's `totalCount` and `idleCount` are back to their earlier values after a signed-in request, and after a failed one. `pool.query()` on the routing pool goes through the same lease queue as `connect()`. A contention timeout cancels its waiter, so a late release does not hand the lease to a request that has already failed.

**S6. Rate-limit storage stays off the routing pool.** Pin `rateLimit: { enabled: true, storage: 'memory' }`. On `'database'`, S1's rollback would erase the counter of every failed step-up attempt. Tests that need the limiter off disable it in the test's own options input, never in `authOptions` defaults.

## Allowlist and handle (R3, R6)

**S7. The handle matches as the router does.**
- The SvelteKit handle answers 404 for every path that matches no `AUTH_ROUTES` template, as well as for the blocked class. Unlisted paths are the larger risk.
- It matches the normalised path that BetterAuth's router dispatches, using the router's own matcher or an equivalent, against templates (`/callback/:id`).

Test, against `/get-session` and `/list-sessions`: a trailing slash, `//`, upper case, `%2F` and `%2f`, a query string, and the `HEAD` and `OPTIONS` methods. None of them reaches a blocked endpoint.

**S8. No ID-token sign-in.** The before-hook refuses `/sign-in/social` with a 400 when the body carries `idToken`. That flow signs in, and can create a user, without the `state` and PKCE round trip that SECURITY §4.1 requires. The native client (POLY-122) reopens it under its own review. Test: an `idToken` body creates no session and no user, whatever the grep in R3 finds.

**S9. Every session-creating path is enumerated.** The R3 grep for `createUser` / `createOAuthUser` is extended to `createSession` and `setSessionCookie`. Each path the grep finds must be:
- in `SIGN_IN_PATHS` (held by M1),
- a factor path (`/passkey/verify-authentication`, or the no-session `/two-factor/verify-*`),
- the replacement session of a verify, or
- a new user with no factor (`/sign-up/email`).

Otherwise the test fails and names the path. `emailVerification.autoSignInAfterVerification` stays unset; if it is ever set, `/verify-email` joins `SIGN_IN_PATHS`.

**S10. M1's matcher patch finds its hook by behaviour, not by index.**
- `createAuth` locates the twoFactor after-hook whose matcher answers true for `/sign-in/email` and false for a sentinel path. It throws at start unless exactly one hook matches.
- It wraps that hook's matcher as `ctx => original(ctx) || SIGN_IN_PATHS.has(ctx.path)`, so the plugin's own paths stay covered.

A reordered hook array can then neither widen the wrong hook nor leave this one narrow. This is in addition to M1's end-to-end test.

**S11. The invitation is claimed at user creation, on every path.** R3 puts `claimInvitation` on `/sign-up/email` only. That leaves `/callback/:id` and `/magic-link/verify` creating users for unknown emails, which C-01 forbids ("OAuth sign-in for an unknown email with no pending invite is rejected").
- Move the call to `databaseHooks.user.create.before`. It runs inside `withContextFreeTx` on every user-creating path, including any the grep adds.
- It throws `InvitationRequired` there, before the user row is written.

Test: each `USER_INSERTING` route with no invitation (the stub left in place) leaves no `user` row and answers an error.

**S12. Redirect targets stay on our origin.**
- `trustedOrigins` is exactly `baseURL`'s origin.
- `advanced.disableCSRFCheck` and the origin check are left unset.
- The sign-in redirect's `next` is accepted only when it starts with `/` and its second character is neither `/` nor `\`. Anything else becomes `/`.
- SvelteKit's `csrf.checkOrigin` is not turned off.

Test:
- an external `callbackURL` is refused on `/sign-in/magic-link` and `/sign-in/social`;
- `next=//evil.example` and `next=/\evil.example` both land on `/`;
- a cross-origin POST to `/sign-in/email` and to the Sessions revoke action answers 403.

## Sessions and step-up (R5, R6)

**S13. Revoking another session is a step-up action.** A stolen cookie can revoke the owner's sessions by id, one at a time, and keep its own, which is exactly why `/revoke-other-sessions` is step-up (A-38).
- In Settings → Sessions, revoking any session other than the current one calls `requireRecentAuth()`.
- Revoking the current session is sign-out, which stays open.

Test: without a step-up the revoke answers 403 and the row stays; with one, the row is deleted.

**S14. The step-up window and the session cap.**
- `requireRecentAuth` passes only when `0 ≤ now − recentAuthAt ≤ 300 s`, with `now` taken from the database clock (`now()` on the request's transaction). A stamp in the future fails.
- `recentAuthAt` is read from the session row on each call. `cookieCache` is off, as R1 says.

The open question on C-02: yes, C-02 pins **7 days idle and 30 days absolute**. BetterAuth's sliding expiry has no absolute cap, so:
- set `session.expiresIn: 7 * 86400` and `session.updateAge: 86400`;
- `loadSession` and step 1 of `handleAuthRequest` treat a session with `createdAt + 30 days ≤ now` as signed out. They delete the row on the plain pool and expire the cookie before calling `auth.handler`. BetterAuth's own session middleware would otherwise still accept the cookie.

Tests:
- a 31-day-old session that keeps being refreshed is refused, on a page and on `/api/auth/*`;
- an 8-day-idle session is refused;
- stamps at 4 minutes, 6 minutes, none and +1 minute give pass, 403, 403 and 403.

**S15. The 23505 retry and the projection.**
- Match `code === '23505'` and `constraint === 'entity_self_user_id_unique'` on the pg error. Drizzle may wrap it, so walk `.cause`. The concurrent-first-load test exercises the real error shape.
- The log line carries the error code, the constraint and the user id. It never carries the cookie, the token or the email.
- The serialised page data, and the SSR HTML of a signed-in page, contain neither the session token nor the cookie value. The test checks for the actual token string, not only a `token` key.
- The handle forwards only BetterAuth's own `Set-Cookie` headers from `loadSession`.

## Schema and avatar (R7, R8)

**S16. Column-level guards and the image rule.**
- (a) R8 withholds UPDATE on `user.second_step_at` and `session.recent_auth_at`. INSERT must be withheld for both as well, because a table-level INSERT grant covers every column. If BetterAuth 1.7.18 names those columns in its INSERT, a column-level grant would break session creation (unmeasured). In that case a `BEFORE INSERT` trigger forces both to null for `poly_app`. The builder measures and picks one. pgTAP: as `poly_app`, an INSERT or UPDATE that sets either column is refused or lands null.
- (b) R7: no avatar upload exists, so the only accepted `image` is **null**. `create.before`, `update.before` and the `/update-user` narrowing all null or refuse any other value. The upload follow-up brings back the same-origin path rule. The rule is parsed with `new URL(image, baseURL)` and compares origins, because `startsWith('/')` lets `/\evil.example` through.
- (c) Until POLY-89, `user.two_factor_enabled` and the `two_factor` and `passkey` tables have no guard trigger. The flat enrolment refusal (R3) is the only control. That is accepted for this issue, and it holds because no HTTP path reaches those writes. The route-policy test asserts that each enrolment path answers 403 for a user with no `second_step_at`.

## Cookies and e2e (not in the ruling)

**S17. C-02 cookie attributes.** The session cookie and the `two_factor` cookie are measured in the test from the real `Set-Cookie`: a `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` and no `Domain`. `crossSubDomainCookies` stays off. If 1.7.18 cannot emit `__Host-` (unmeasured), the builder reports it at gate 3. SecEng then either amends C-02 to `__Secure-` with `Path=/` and no `Domain`, or rules a cookie-name override. The builder does not choose.

**S18. No test switch in the app.** The Playwright `globalSetup` seeds its user in the test process, through the test database or BetterAuth's internal adapter. No environment variable, flag or build mode in `apps/web` or `packages/auth` relaxes the invitation check (SECURITY §4.1: "no switch reopens public sign-up"). The review greps for it at gate 3.

## Follow-ups for the lead (in addition to the ruling's list)

1. POLY-122: the ID-token sign-in under its own review (S8).
2. Avatar upload: bring back the same-origin path rule with URL parsing (S16b).
3. SECURITY C-02 text: whether it changes depends on S17's measurement. SecEng edits it at the verdict if needed.

## Build review: reviewed @ 182d054, **pass**

Read from `git diff main...182d054`, covering:
- `packages/db/src/context.ts`;
- `packages/auth/src/{routing-pool,handler,route-policy,second-step,user-hooks,recent-auth,session,options,index}.ts`;
- `apps/web/src/hooks.server.ts` and `lib/server/auth.ts`, the Sessions page, the sign-in redirect and the root layout projection;
- migrations 0004 and 0005;
- the test titles of the `tests/db/auth-*` suites.

I did not run the suites; the gate owner does.

**Met:**
- **S1:** a failed BetterAuth response (status ≥ 400, or a redirect to its error page or an `?error=` query) rolls back, and its `Set-Cookie` is dropped.
- **S2:** a COMMIT that reports `ROLLBACK` throws `TransactionAborted`.
- **S3:** the store is marked dead in `finally` before release, `currentClient()` throws `TransactionEnded`, and `backgroundTasks` is unset.
- **S4:** the grammar is closed, `ROLLBACK TO` passes through, and a ROLLBACK decrements the depth.
- **S5:** `AuthClient` exposes `query` only, `pool.query` shares the lease queue, and a timed-out waiter is cancelled.
- **S6:** rate-limit storage is memory.
- **S7:** the handle and the handler answer 404 to unlisted and blocked paths after normalising the path; the variants are tested.
- **S8:** an `idToken` on `/sign-in/social` is refused with a 400.
- **S10:** the hook is found by behaviour, the original matcher is wrapped, and start-up throws unless exactly one hook matches.
- **S11:** the invitation claim is in `user.create.before`, behind the wrapper assertion.
- **S12:** `trustedOrigins` is our origin only, redirect keys are checked, a cross-origin POST is refused, and `next` is safe on both the server and the client.
- **S13:** revoking another session calls `requireRecentAuth`.
- **S14:** the window is measured on the database's `now()`, with 7 days idle, `updateAge` 1 day and our own 30-day cap that deletes the row.
- **S15:** the pg error is found by walking `.cause`, the retry runs once, the log has no token or email, and the projection is built field by field.
- **S16:**
  - (a) column-level INSERT and UPDATE grants leave out `second_step_at` and `recent_auth_at`;
  - (b) `image` is always null;
  - (c) enrolment answers 403 with no `second_step_at`.
- **S17:** the `__Host-` cookie, measured.
- **S18:** no switch in the app relaxes the invitation check.
- **S19:** a single-entry `X-Forwarded-For` limited to address characters, `requireClientIp` required, and the limits at 5 a minute.

**Not met, deferred (judgment call): S9's enumeration test.** The suites have no test that greps the pinned dist for `createSession`, `setSessionCookie`, `createUser` and `createOAuthUser` call sites. On 1.7.18 the lists were set by code-read (ruling U1, M1), and the hold and wrapper tests cover every path on those lists. So the gap opens only on a version bump. Condition: no change to the `better-auth` or `@better-auth/passkey` pin merges before that test exists (follow-up 1).

## Follow-ups for the lead (from the build review)

1. **Auth upgrade guards, before any better-auth bump:**
   - (a) S9's dist enumeration test for the session- and user-creating call sites;
   - (b) `Lease.query` must refuse or rewrite a transaction-control statement passed as a query-config object. Today an object form with the text `BEGIN` or `COMMIT` would pass through unrewritten. Kysely 0.29.8 sends strings, so this is unreachable on the pin.
2. `/change-password`: force `revokeOtherSessions: true` in the before-hook (C-02: all sessions are revoked on a password change). Today only the caller decides. No password-change UI exists yet.
3. POLY-89: `two_factor.verified` defaults to `true` in 0004 (BetterAuth's schema default). Make it `false`, so a write that leaves it out never marks a factor verified.
4. Settings → Sessions: a revoke with an `id` that is not a uuid answers 500 (22P02). It should answer 404.
5. Carried from earlier: POLY-95's Caddy `header_up` line (S19), the per-email limit, the Vercel client IP and limiter storage, POLY-122's ID-token sign-in, and avatar upload with the same-origin rule.
