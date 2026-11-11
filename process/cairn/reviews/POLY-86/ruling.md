# POLY-86 ruling (gate 1): BetterAuth on the routing pool, the allowlist, the session loader

Architect, 2026-11-11. Builder: backend-lead-86. Tests: qa-engineer-86. Review: seceng-86.
Final, re-issued whole with seceng-86's conditions folded in: the pre-ruling notes, and S1–S18 of `seceng-ruling-review.md` @ 8e98d78 (approved, no veto). **S1–S18 bind the build as written there, tests included. Where this file and an S condition differ, the S condition governs.**
Sources: ARCH §2.2, §3.1, §3.1c, §8; SECURITY A-31, A-33, A-34, A-38, A-40; POLY-62 ruling R9 and verdict; POLY-85 ruling Open 1; POLY-128 `ShellSession`.

## M1. The twoFactor measurement (criterion 6): measured, the answer is no

Command: `node process/cairn/reviews/POLY-86/measure-twofactor.mjs` from a directory with better-auth 1.7.18 + @better-auth/passkey 1.7.18 from npm, memory adapter (the hold is plugin logic and independent of the adapter). The widened run replaces `hooks.after[0].matcher` with a set of the three paths, `twoFactor({ allowPasswordless: true })`, `magicLink`, `passkey`; one user with `twoFactorEnabled = true`.

| Path | Result |
|---|---|
| `/sign-in/email` (control) | 200 `{ twoFactorRedirect: true }`, no session row, no session cookie: held |
| `/magic-link/verify` | 302, a new session row and a session cookie; `getSession` on it returns the full session: **not held** |
| twoFactor's after-hook `matcher` | true for `/sign-in/email` only; false for `/callback/:id`, `/magic-link/verify`, `/sign-in/social`, `/passkey/verify-authentication` (code-read confirms: a fixed `signInPaths` set of the three credential paths, `plugins/two-factor/index.mjs`) |
| Same run, matcher widened to `/sign-in/email`, `/magic-link/verify`, `/callback/:id` | `/magic-link/verify`: 302, no session row, no session cookie, the `two_factor` cookie set: held, the same way `/sign-in/email` is |

Further findings by code-read on 1.7.18: `/sign-in/social` with an `idToken` body signs in, and can create a user, with no callback round trip (`api/routes/sign-in.mjs` → `handleOAuthUserInfo`), so it is refused (S8, below); `/verify-email` creates a session only under `emailVerification.autoSignInAfterVerification`, which stays unset (H2). The plugin's hold keys on `user.twoFactorEnabled`, so a **passkey-only** enrolled user (`second_step_at` set, `twoFactorEnabled` false) is held on no path, `/sign-in/email` included; and `/callback/:id` under the widened matcher is measured on the matcher only, not end to end (unmeasured; the route-policy test measures it with a stubbed IdP).

**Decided: the hold is added, as two pieces, both in `packages/auth/src/second-step.ts`.**
1. **TOTP users: widen twoFactor's own matcher** to `SIGN_IN_PATHS = { /sign-in/email, /magic-link/verify, /callback/:id }`. `createAuth` finds the plugin's after-hook by behaviour: the single hook whose matcher answers true for `/sign-in/email` and false for a sentinel path. It throws at start unless exactly one hook matches, then wraps it as `ctx => original(ctx) || SIGN_IN_PATHS.has(ctx.path)` (S10). The plugin's own handler then deletes the new session, sets its `two_factor` cookie (trusted-device cookie honoured) and the user finishes at the existing no-session `/two-factor/verify-totp` or `/verify-backup-code`, the flow `/sign-in/email` already uses. One second-step flow, not two. No session exists before the second step, which is stricter than a pending mark that `withTenant` must refuse.
2. **Passkey-only users: our after-hook** on the same three paths. When `ctx.context.newSession` is set, `user.twoFactorEnabled` is false and `user.secondStepAt` is set, it deletes that session, expires the session cookie and answers `{ secondStepRequired: 'passkey' }` (a redirect to `/sign-in/second-step` for the two GET paths). The user completes with `/passkey/verify-authentication`, which creates its own session. `secondStepAt` is a BetterAuth `user.additionalFields` entry, `input: false`, in the `fields` map.

Patching `matcher` depends on the plugin's internal shape, which is why the version is pinned. The test asserts, against the pinned version, that the matcher is a function, that it answers true for each of `SIGN_IN_PATHS`, and that an enrolled TOTP user and an enrolled passkey-only user each leave `/sign-in/email`, `/magic-link/verify` and `/callback/:id` with no session row and no session cookie. If an upgrade changes the hook so that the search finds none or several, `createAuth` throws at start (fail closed); it never runs unheld. **`/sign-in/social` with an `idToken` body is refused (400)** by the before-hook, because it skips state and PKCE (S8); POLY-122 reopens it.

## R1. Module layout of `packages/auth`

| File | Holds |
|---|---|
| `src/index.ts` | the public surface: `createAuth`, `authOptions`, `handleAuthRequest`, `loadSession`, `requireRecentAuth`, `listSessions`, `revokeSession`, `AUTH_ROUTES` |
| `src/options.ts` | `authOptions(input): BetterAuthOptions`, the one exported configuration the app and every test use (A-34). `input` = `{ secret, baseURL, tlsMode, google?, github?, sendMagicLink }`; apps/web builds it from `loadConfig()`. auth may not import config (layers.json), so nothing in auth reads the environment |
| `src/routing-pool.ts` | `createRoutingPool()` (R2) |
| `src/route-policy.ts` | `AUTH_ROUTES`, `USER_INSERTING`, `SIGN_IN_PATHS`, the `hooks.before` built from them (R3) |
| `src/second-step.ts` | the matcher widening and the passkey-only after-hook (M1) |
| `src/handler.ts` | `handleAuthRequest(request)` (R4) |
| `src/session.ts` | `loadSession`, `requireRecentAuth`, `listSessions`, `revokeSession` (R5) |
| `src/user-hooks.ts` | the `databaseHooks.user` create/update hooks: the wrapper assertion (criterion 12), the image rule (R7), the idToken-dropping account hook |

Pinned options (criterion 2), all in `options.ts`, no other: `account.encryptOAuthTokens: true`; `databaseHooks.account.create.before` and `update.before` drop `idToken`; `twoFactor({ allowPasswordless: true, trustDeviceMaxAge: 30 * 86400 })`, `skipVerificationOnEnable` unset, no `otpOptions`; `user.deleteUser.enabled` false; `emailAndPassword: { enabled: true, revokeSessionsOnPasswordReset: true }`; no bearer plugin; `session.freshAge: 30 * 86400`; `session.expiresIn: 7 * 86400` and `session.updateAge: 86400` (C-02, 7 days idle), with the 30-day absolute cap enforced by us (R5, S14); `session.cookieCache` off (a revoked session must stop at once, R5); `session.additionalFields.recentAuthAt` and `user.additionalFields.secondStepAt`, both `input: false`; `rateLimit: { enabled: true, storage: 'memory' }` (single process, so a rolled-back request never erases its own counter, P8); `advanced.backgroundTasks` unset and `disableCSRFCheck` / `disableOriginCheck` unset; `trustedOrigins: [new URL(baseURL).origin]` exactly; SvelteKit `csrf.checkOrigin` left on (S12); `emailVerification.autoSignInAfterVerification` unset (H2). A test asserts each of these on the built options. `better-auth`, `@better-auth/passkey` and `kysely` (BetterAuth's peer, never imported by our code) are pinned exact: 1.7.18, 1.7.18, 0.29.8.

## R2. The routing pool over `db/auth`

`packages/db/src/context.ts` keeps the client in its AsyncLocalStorage store (`{ kind, client }`, not the kind alone), and `db/auth` exports `currentClient(): { kind: Kind; client: AuthClient } | null`. Under `withSystem` the routing pool's `connect()` and `query()` throw `AuthUnderSystemJob`: BetterAuth never runs as a job principal or on the worker pool (P4). The type `pg.PoolClient` is re-exported from db as an opaque `AuthClient` type, so packages/auth imports no `pg`, type imports included.

`createRoutingPool()` in auth returns a pg-Pool-shaped object (`connect`, `query`, `end` no-op). BetterAuth gets it as `database:` and builds its own Kysely `PostgresDialect` from it (measured on 1.7.18 in POLY-76 (b′): an object with `connect()` is taken as a pool). **Criterion 10 is amended**: the pool comes from `db/auth`; the dialect is built inside better-auth from that pool; packages/auth constructs no `PostgresDialect` and imports neither `pg` nor `PostgresDialect`.

- `currentClient()` set: `connect()` returns a lease on that client. Its `query` rewrites `BEGIN…`, `COMMIT` and `ROLLBACK` (case-insensitive, trailing `;` allowed) to `SAVEPOINT ba_<n>`, `RELEASE SAVEPOINT ba_<n>` and `ROLLBACK TO SAVEPOINT ba_<n>` with a per-request depth counter, names unique per depth; a `ROLLBACK` becomes `ROLLBACK TO SAVEPOINT ba_<n>` followed by `RELEASE SAVEPOINT ba_<n>` (P6). `release()` returns the lease, never the client.
- **Revoked at the end of the transaction (P3)**: `inTransaction` marks the store closed before `COMMIT`/`ROLLBACK`; any later `query` or `connect` on a lease throws `TransactionClosed`, so a late BetterAuth task cannot run on a backend another request has checked out. The store carries a `live` flag cleared in `finally` before `release()`, and `currentClient()` on a dead store throws `TransactionEnded`; it does not return null, which would fall through to the plain pool (S3).
- **Closed grammar (S4)** and **opaque client (S5)**, as seceng's file states them: only the five bare control statements are rewritten; `SAVEPOINT` / `RELEASE` / `ROLLBACK TO` pass through; every other transaction-control form throws. `AuthClient` exposes `query` only, and `pool.query()` shares the lease queue.
- **A silent rollback is an error (P2)**: `inTransaction` in `packages/db/src/context.ts` checks the `COMMIT` result. A `command` of `ROLLBACK` (an aborted transaction) throws `TransactionAborted` and is never reported as success.
- **Serialisation**: one lease at a time per request; a second `connect()` waits on the first lease's `release()`. A wait over 5 s throws `RoutingPoolContention` (a BetterAuth query on the outer handle while its own transaction is open would otherwise deadlock). Test: two concurrent `connect()` inside one `withTenant` never interleave statements, and the second resolves only after the first releases (unmeasured until that test).
- `currentClient()` null: `connect()` and `query()` go to `authPool()` from `db/auth`, poly_app, no GUC. Test (P7): a backend that served a `withTenant`, checked out next on the plain path, reads `app.user_id` and `app.session_id` empty.

## R3. `AUTH_ROUTES` in `src/route-policy.ts`

```ts
type RouteClass = 'open' | 'enrolment' | 'step-up' | 'blocked';
type Rule = { class: RouteClass; insertsUser?: true; realDomainOnly?: true; whenSession?: RouteClass };
export const AUTH_ROUTES: Readonly<Record<string, Rule>>; // path template, exactly as BetterAuth's endpoint `path`
export const USER_INSERTING: ReadonlySet<string>;          // derived: every path with insertsUser
```

- The 47 paths of ARCH §3.1c, each in exactly one class. `whenSession` carries the two split paths: `/two-factor/verify-totp` is open without a session and enrolment with one; `/two-factor/verify-backup-code` is open without one and refused with one.
- `insertsUser: true` on `/sign-up/email`, `/callback/:id` and `/magic-link/verify`. `/sign-in/social` carries no flag, since its idToken branch is refused (S8). Code-read on 1.7.18: among the plugins we install, `createUser` / `createOAuthUser` is reached only from `api/routes/sign-up.mjs`, `callback.mjs`, `sign-in.mjs` (via `oauth2/link-account.mjs`) and `plugins/magic-link`; passkey creates no user (U1). The test asserts each of the three creates a user inside the wrapper (criterion 11). A grep test over the pinned dist covers `createUser`, `createOAuthUser`, `createSession` and `setSessionCookie`, and fails, naming the path, on any session-creating path not classified per S9.
- **Normalisation (R1)**: the before-hook classifies `ctx.path`, the template BetterAuth's router matched, so router normalisation is the router's own. The handle's HTTP pre-check answers 404 for every path that matches no `AUTH_ROUTES` template as well as for the blocked class (S7). It matches with the router's own template matcher, or an equivalent, after normalising the pathname (percent-decoded, repeated `/` collapsed, trailing `/` dropped, query stripped, lower-cased) and refuses any match on a blocked template. The test sends each blocked path in those variants and with a wrong method, and expects 404 from both layers.
- `realDomainOnly: true` on `/sign-in/social`, `/callback/:id` and `/link-social`: 404 when `tlsMode === 'private-ca'` (R4). `/get-access-token`, `/refresh-token` and `/account-info` are blocked in both modes (R2). `/list-accounts` stays open, and the test asserts its body carries no token field.
- An unlisted path and a blocked path both throw `APIError('NOT_FOUND')`. The blocked class applies when `ctx.request` is set (HTTP); the enrolment and step-up classes apply on both paths.
- **Enrolment class in this issue: refused for a user with no `second_step_at`** (403 `second_step_required`). The grant it would check is POLY-89's table; until it lands, nobody enrols, which fails closed. With `second_step_at` set, it takes the step-up check.
- **Invitation check (U2)**: `databaseHooks.user.create.before` calls `claimInvitation(tx, { email, token })` from `@poly/tenancy`, inside the wrapper's transaction, on every user-creating path. `token` is the body's `invitationToken` on `/sign-up/email` and null on the OAuth and magic-link paths, which match by verified email. `/sign-up/email` with no `invitationToken` is also refused early by the before-hook (403 `invitation_required`). In this issue `claimInvitation` is a stub that throws `InvitationRequired` (so production refuses every sign-up until POLY-87 implements it); the user-creating tests (criterion 11) `vi.mock` that one export and nothing else, so the configuration under test stays the exported one.

## R4. `handleAuthRequest(request)`, the `withContextFreeTx` wrapping

In `src/handler.ts`, called from `hooks.server.ts` for every `/api/auth/*` request after the handle's own blocked-class 404:
1. Load the session in process on the plain pool (`currentClient()` null).
2. A live session: run `auth.handler(request)` inside `withTenant(sessionUserId(user.id), session.id, …)`.
3. No session and the path is in `USER_INSERTING`: run it inside `withContextFreeTx`.
4. Otherwise: run it on the plain pool.

**Commit only on success (P1)**: inside either transaction, the callback throws a `RollbackWith(response)` sentinel when `auth.handler` returns status ≥ 400, or a 3xx whose `Location` is BetterAuth's error page (`/api/auth/error` or the configured `onAPIError.errorURL`). `handleAuthRequest` catches the sentinel after the rollback and returns the response, so the caller sees BetterAuth's answer and nothing is committed. Test: a request that writes and then fails (the guard-refused first TOTP verify in POLY-89, simulated here with a trigger that raises on the second write) leaves no row.

`user-hooks.ts`, `databaseHooks.user.create.after`: if `currentClient()?.kind !== 'withContextFreeTx'`, throw `SignUpOutsideTransaction`; it opens nothing of its own (criterion 12). It does nothing else here: the new-user step and `provisionPerson` at sign-up are POLY-87's. Criterion 11's test, per listed route, asserts the user row's `xmin` equals the `txid_current()` the wrapper recorded, and that the hook saw `kind === 'withContextFreeTx'`. A signed-in `/callback/:id` that would create a user runs under `withTenant`, so the hook throws: fail closed.

## R5. The session loader, step-up, Settings → Sessions

`loadSession(request): Promise<null | { userId: SessionUserId; sessionId: string; shell: ShellSession; setCookie: string[] }>` in `src/session.ts`:
- `auth.api.getSession({ headers, returnHeaders: true })` in process; the refreshed `Set-Cookie` headers come back in `setCookie`.
- Then `withTenant(userId, sessionId, tx => provisionPerson(tx))`. On a `23505` whose `constraint === 'entity_self_user_id_unique'`, retry once in a fresh `withTenant`; that call finds the Person and returns `created: false`. A second 23505, or any other error, is logged through the injected logger (error code and constraint only, never the token or email, E1) and rethrown. There is no loop, and no retry on any sign-up path (criterion 13).
- `shell` is `ShellSession` (`apps/web/src/lib/shell/session.ts`) built field by field: `{ user: { id, name, image }, expiresAt }`. The type moves to `packages/auth` and apps/web re-exports it, since auth cannot import web.

`requireRecentAuth(session)`: passes when `0 ≤ now − recentAuthAt ≤ 300 s`, with `now` the database's `now()` and `recentAuthAt` read from the session row on each call, so a stamp in the future is refused (W1, S14); otherwise `APIError(403, { code: 'step_up_required' })`. It is called from the before-hook for the step-up class. Tests set `recent_auth_at` directly as the superuser at 4 and 6 minutes and with none; POLY-89 writes it in production, from its step-up and first-enrolment definers, bound to the requesting session (W2). No route in this issue sets it: the no-session `/two-factor/verify-totp` at sign-in creates a new session and never stamps it.

**The 30-day absolute cap (S14)**: `loadSession` and step 1 of `handleAuthRequest` treat a session with `createdAt + 30 days ≤ now` as signed out. They delete the row on the plain pool and expire the cookie before `auth.handler` runs.

`listSessions(tx)` and `revokeSession(tx, id)` take the `withTenant` Tx. BetterAuth's `session` table carries no RLS (ARCH §3.1c), so both filter `user_id = app.current_user_id()` in SQL. The list returns `{ id, userAgent, ipAddress, createdAt, updatedAt, current }` and never `token`. Revoke deletes by `id AND user_id`; zero rows answers 404. Revoking any session other than the current one calls `requireRecentAuth()` first (S13). Revoking the current one is sign-out. Test: user B cannot list or revoke A's session.

## R6. `hooks.server.ts` and `locals.session`

`handle = sequence(auth, theme)`. `auth`:
- `/api/auth/*`: blocked-class 404 here first, before calling `handleAuthRequest`.
- Every other request: `loadSession`; set `event.locals.session = shell` (no token); append `setCookie` to the response.
- Signed out on a route other than `/sign-in*`, `/healthz` and the `/api/auth/*` tree: 303 to `/sign-in?next=<path>`. `next` is honoured only when it starts with `/` and its second character is neither `/` nor `\`; otherwise it becomes `/` (S12). `/sign-in` is a minimal page in this issue (an email + password form posting to BetterAuth); its design is POLY-88's.

The root `+layout.server.ts` projection already exists (POLY-128). This issue fills `locals.session`. The test asserts that the serialised page data and the SSR HTML contain neither the session token nor the session id (S1), and that the only auth header forwarded is the refreshed `Set-Cookie` (S2).

## R7. Avatars from our own origin (criterion 15)

`user-hooks.ts` `databaseHooks.user.create.before` and `update.before` set `image` to null, and `/update-user` refuses any non-null `image`: until avatar upload ships, null is the only accepted value (S16b). An OAuth provider's picture URL is therefore never stored. The upload follow-up brings back a same-origin rule, parsed with `new URL(image, baseURL)` and compared by origin. The sidebar shows initials when `image` is null. The CSP is not widened. Avatar upload is a follow-up.

## R8. Schema this issue adds (packages/db)

Migration `0004_auth_second_step.sql`, generated with Drizzle Kit and registered as POLY-102 requires:
- `two_factor` (id, user_id FK, secret, backup_codes, verified) and `passkey` (BetterAuth 1.7.18's columns), snake_case, with every timestamp `timestamptz`.
- `user.second_step_at timestamptz` and `user.two_factor_enabled boolean NOT NULL DEFAULT false`; `session.recent_auth_at timestamptz`.
- Grants per ARCH §3.1c: poly_app gets SELECT, INSERT, UPDATE and DELETE on `two_factor` and `passkey`; on `user`, no UPDATE of `second_step_at`; on `session`, no UPDATE of `recent_auth_at` (it is written only by POLY-89's definers). INSERT is withheld on both columns as well (S16a). The builder measures whether 1.7.18 names them in its INSERT: if it does not, use column-level grants; if it does, add a `BEFORE INSERT` trigger that forces both to null for poly_app. pgTAP covers either choice.

`authFields` gains `twoFactor` and `passkey`. Criterion 8's test deletes one entry and sees `createAuth` refuse to start. The triggers (`sync_second_step`, the grant guards, `own_person_exempt`) stay POLY-89's.

## R9. Frontend builder: not needed (item 3)

Settings → Sessions is one `+page.server.ts` (load + revoke action, on R5) and a plain `+page.svelte` table using the shell's existing tokens. `/sign-in` is one form. The sidebar avatar already renders `ShellSession`. All of it is in backend-lead-86's reach, so no frontend-lead is spawned. DESIGN has no Sessions or Sign-in screen; their design is a follow-up for ux-designer, and these pages are placeholders until then.

## R10. CI placement (item 4)

| Suite | Job, step | Needs |
|---|---|---|
| `packages/auth/src/*.test.ts`, pure: `AUTH_ROUTES` shape, class totals, image rule, matcher patch present | `unit`, per-package turbo step | none |
| `tests/db/auth-routing-pool.test.ts`, `auth-route-policy.test.ts` (both TLS modes), `auth-signup-wrap.test.ts`, `auth-session.test.ts` (concurrent first load, sessions list/revoke, step-up) | `db`, the existing battery step (`tests/db/**` already included) | Postgres, poly_app |
| `apps/web/src/hooks.server.test.ts` (extended) | `unit`, per-package | none |
| `apps/web/tests/e2e/shell-signed-in.spec.ts` | `unit`, the existing e2e step | Postgres: a Playwright `globalSetup` reusing `tests/db/helpers/pg.ts` (Docker on the runner), migrates, signs one user up in process and saves `storageState` |

No new top-level job. `infra/ci/changes.mjs` adds `/^packages\/auth\//` to the `db` filter, because the battery imports auth. ARCH §3.1c names the route-policy test `packages/auth/src/route-policy.test.ts`; it moves to `tests/db/auth-route-policy.test.ts`, since it needs Postgres, and ARCH is amended.

Expected delta (unmeasured): `db` +20 to 35 s (scrypt sign-ups at about 80 ms each, roughly 120 of them across both modes, plus the migration clone), which lands at 113 to 148 s against the 150 s target and the 180 s budget. `unit` +25 to 45 s (the e2e Postgres container, image build if uncached, migrate). Guard: if the `db` job runs over 150 s on the PR, the builder reports it at gate 3 with the per-file times. The first remedy is one `cloneMigrated()` database per file, never a new job.

## R11. POLY-85 Open 1 (the loaded `Secret` to the pool): not here

This issue adds `currentClient()` to `context.ts` and does not edit `connection.ts` or `pool.ts`. Open 1 is a startup wiring change (web and worker pass `loadConfig()`'s `Secret` to `configure()`). It goes to POLY-88, which owns web startup. Lead to place.

## Paths beyond the current `paths:` (item 5)

`packages/db/**` (context.ts, auth.ts, schema/auth.ts, migrations 0004 + meta), `packages/tenancy/**` (the `claimInvitation` stub), `infra/ci/changes.mjs`, `infra/ci/generated.json` (if 0004 needs a pair entry), `apps/web/playwright.config.ts`, `.github/workflows/ci.yml` (only if the e2e step needs a Docker cache for the pgtap image; no new job).

## Criteria amended in place

6 (the measurement result and the shape of the hold), 7 (the test paths), 10 (where the dialect comes from), 11 (the `xmin` assertion).

## Follow-ups (lead to file after the merge)

1. ux-designer: Sign-in and Settings → Sessions screens in DESIGN; this issue ships placeholders.
2. Avatar upload to our own origin (R7).
3. Resend mailer for `sendMagicLink`: apps/web passes one that answers 503 until it exists.
4. POLY-88: POLY-85 Open 1 (R11).
5. POLY-89: the enrolment class's grant check replaces this issue's flat refusal (R3); `recent_auth_at` writers.
6. POLY-87: the real `claimInvitation`, the new-user step and `provisionPerson` at sign-up.
7. POLY-122: ID-token sign-in under its own review (S8).
8. SECURITY C-02 text, depending on S17's `__Host-` cookie measurement; seceng edits it at the verdict if needed.

## Addendum 1 (gate 2, qa-engineer-86 @ bfb3b84)

1. **R4's `xmin` assertion is replaced.** BetterAuth inserts the user inside a savepoint (R2), so `xmin` holds the subtransaction id, never the wrapper's top-level xid. `txid_current()` inside a subtransaction returns the top-level id. So the test's AFTER INSERT trigger records `txid_current()`, and the test compares it with the `txid_current()` seen inside the wrapper. Criterion 11 is amended to match.
2. **`AuthUnderSystemJob` (P4) gets a pure unit test** in `packages/auth/src/routing-pool.test.ts`, with `currentClient` from `@poly/db/auth` mocked to report `kind: 'withSystem'`. `connect()` and `query()` must both throw. A database test waits for the first job target (POLY-85 Open 3); this is not a gap at the verdict.
3. The calling conventions in `tests/db/helpers/auth.ts` (the optional `auth` instance as the second argument, and `authOptions` reading `authFields` at call time) are the seam's shape. The builder conforms to them, or changes the helper header and reports the change at gate 3.

