# POLY-153 — test plan (qa-engineer-153)

Written against `ruling.md` @ 0cd43441 (R0–R13) and `ruling-review.md` (§2.1, §2.2, T1–T6). C1–C6 are POLY-153's criteria in order. "Red because" is the reason it fails on the tree today; `red-run.md` records the real first failure per file.

## Conventions

- **Refusals assert the state**: marker count / row / `xmin` before and after, plus the code (42501 is both a permission and a guard refusal). Helpers `refusedUnchanged`, `codeOf`, `msgOf` in `tests/db/helpers/second-step.ts`.
- **Every entry test sends the canonical call as poly_app in extended mode** (`SELECT * FROM app.enter_session($1)`), the plain handle as the parameter.
- **No vacuous pass.** Each guard test has a plant (a mutation run against a clone) in the `[red if: …]` title; plants for the catalog pins are executed by `tests/db/session-handle-pins.test.ts` against a fresh clone and must turn pgTAP 10 red.
- **New helper** `tests/db/helpers/handle.ts`: `sessionWithHandle(db, userId, opts) → { id, token, handle }` (inserts session and its `app.session_handle` row in one transaction as superuser; the handle is 43 base64url chars, hashed with `sha256` in SQL); `handleOf(res)` reads `__Host-poly_handle` from a Response; `enterByHandle(q, handle)`. The eight fixture files that insert `public.session` (`second-step-gates`, `second-step-challenge`, `auth-fields`, `auth-new-user-step`, `auth-route-policy`, `auth-provision-person`, `auth-service-grants`, `helpers/second-step.ts`) switch to it; they go red until 0015 exists (intended: R5.2 refuses a handle-less insert).
- New `tests/db` files get a `DB_AREAS` entry (`infra/ci/changes.mjs`) and a `TABLE` row in `tests/ci/db-areas.test.ts`. No test writes to `temp/`.
- Tests that move into a package are run with `pnpm typecheck` and `pnpm lint`, not vitest alone.

## Criteria

| C / item | Test | File | Red because |
|---|---|---|---|
| C1 R4 plain handle | `enter_session` as poly_app with a live handle: marker kind `session` for the row's user and session, returns `(xid,user_id,session_id,name,image,expires_at)` | `tests/db/session-handle-enter.test.ts` | no `app.enter_session` |
| C1 H1 forgery (required) | the stored `handle_hash` as bytea param, `\x…` text, bare hex, base64url(43): each yields no marker and the one `no live session` 42501 (never the exact-call message); also `session.token`, `session.id` | same | no definer |
| C1 | expired, 30-day-capped, revoked (deleted), unknown, NULL (22004), malformed (short, long, bad alphabet): no marker, same message | same | no definer |
| C1 | second marker refused; earlier write refused; non-canonical shapes (second select item, subquery, literal, CTE, superuser `DO` with `SET LOCAL ROLE poly_app`) refused 42501; each asserts marker count unchanged | same | no definer |
| C1 | poly_worker, poly_operator, poly_auth: no EXECUTE (permission denied) | same | no definer |
| C1 | extended-mode two-statement string refused on poly_app's pool and on both poly_auth pools (plain pool, routing pool) | same + `tests/db/auth-routing-pool.test.ts` | no definer |
| C1 T1 | a slide past `updateAge` leaves `recent_auth_at` unchanged (0013 trigger), `expires_at` = least(now+7d, created+30d), never past the cap | same | no definer |
| C1 T2 | a rolled-back entry leaves `expires_at` and the marker table unchanged | same | no definer |
| C1 kind | kind CHECK accepts `session`, refuses an unknown kind; `audit_membership` maps `session` to actor `user` | same | CHECK lacks it |
| C1 R4 | the 30-day cap appears in `recent-auth.ts`, `enter_auth_session`, `enter_session` with the same number | same | no third copy |
| C1 R3/T4 | `attach_session_handle` on a committed session that has a handle → false, hash unchanged; twice in one transaction on a new session → second false, first hash kept; a session id from another open transaction → false; bad format 22023; NULL 22004; non-exact call 42501 | `tests/db/session-handle-attach.test.ts` | no definer |
| C1 R3 | attach as poly_app / poly_worker / poly_operator: permission denied; direct INSERT, UPDATE, DELETE, SELECT on `app.session_handle` as each login role: permission denied | same | no table |
| C1 R5.2 | a session inserted as poly_auth with no handle → commit fails 23514; with its handle passes; a session created and deleted in one transaction passes; superuser insert also refused (no exemption) | same | no trigger |
| C1 H2 | poly_auth holds no `UPDATE (id)` / `UPDATE (user_id)` on `session` (executed, not only catalog) | `tests/db/pgtap/10_session_handle.sql` | n/a today (passes; pin) |
| C2 | query: no column of any table in `public`/`app` equals a live handle (scan `row_to_json` text of every table, hex and base64 of the hash included, after a real sign-in) | `tests/db/session-handle-enter.test.ts` | no handle exists |
| C2 | delete a session as poly_auth (sign-out) and as poly_authz-path revoke: its handle row is gone in the same transaction (**unmeasured claim 1**) | `tests/db/session-handle-attach.test.ts` | no table |
| C2 R1 | table shape: owner poly_owner, RLS enabled and forced, 32-byte CHECK, UNIQUE, PK on session id, truncate refused, second handle for a session refused | `tests/db/pgtap/10_session_handle.sql` | no table |
| C2 R2/T6 | grants catalog-exact for the new surface, granted and effective, all five login roles: poly_app four EXECUTEs, poly_auth one, nothing on `session_handle` for anyone but poly_authz; poly_authz column grants; poly_app / poly_auth do not hold `attach_session_handle` / `session_needs_handle` as listed | `tests/db/pgtap/10_session_handle.sql`, `08_poly_auth_grants.sql` (16→17 EXECUTE list, `attach_session_handle`) | functions and grants absent |
| T6 / §2.2 | catalog pin: `session_needs_handle` exists on `public.session`, `tgconstraint <> 0`, deferrable initially deferred, `tgenabled='O'`; function owned by poly_authz, executable by no login role. Plants: trigger dropped; trigger disabled — each run on a fresh clone and shown to fail pgTAP 10 | `tests/db/pgtap/10_session_handle.sql`, `tests/db/session-handle-pins.test.ts` | no trigger |
| N2 | 08's planted-grant list gains `GRANT poly_app TO poly_auth` and `GRANT poly_app TO poly_auth WITH INHERIT FALSE, SET TRUE`; each must fail the role-membership check | `tests/db/pgtap/08_poly_auth_grants.sql` (+ plant runner) | list short (this is the test that was missing; shown to fail by its plant) |
| N6 | stale comment at `second-step-gates.test.ts:2-3` rewritten | `tests/db/second-step-gates.test.ts` | doc-only |
| C3 R6 | `my_sessions()`: the marker user's rows only, `current` flag right, columns exactly the six, no token, no handle; `recent_auth_ok()` true/false at 0, 299, 301 s and NULL; `revoke_my_session`: other user's id → P0002 with the target row unchanged, non-current without fresh auth → 42501 `step_up_required`, current session without fresh auth passes, delete cascades the handle | `tests/db/session-handle-definers.test.ts` | no definers |
| C3 T3 / H7 | each of the three definers refuses a kind `web` marker (`enter_asserted_user` as poly_app) and a kind `auth` marker; rows unchanged | same | no definers |
| C3 | the three definers: owner, search_path, EXECUTE poly_app only (poly_auth, poly_worker, poly_operator denied) | same + pgTAP 10 | no definers |
| C3 service | `requireRecentAuth` runs `app.step_up_fresh()` on the request's transaction; fresh stamp true, stale false, **outside a session transaction false (fails closed)** (**unmeasured claim 3**: every caller sits inside `withAuthSession`, measured by the step-up route tests: passkey register, two-factor enable/disable, change-password) | `tests/db/second-step-flow.test.ts` (extended), `packages/auth/src/recent-auth.test.ts` | reads `session.recent_auth_at` directly |
| C3 web | web sends no SQL naming `public.session`, `.account`, `.verification`, `.two_factor`, `.passkey`, `."user"` or `app.session_handle`: grep over every file reachable from `apps/web` (import graph walk) | `tests/layers/web-no-betterauth-sql.test.ts` | `sessions.ts`, `tenancy` name `public."user"` |
| C3 web | `loadSession`, `loadSessionFromService`, `completeSession`, `setAuthInternalOrigin`, `SESSION_COOKIE`, `withTenant`, `sessionUserId` absent from `apps/web/src` and `packages/auth/src/web*` | `tests/layers/web-no-betterauth-sql.test.ts` | present |
| C3 lint | eslint refuses `@poly/db/session`, `withTenant`, `sessionUserId`, `better-auth`, `@better-auth/*` in `apps/web/**` and `packages/auth/src/web*`; one failing fixture each | `tests/layers/` fixtures (existing eslint fixture harness) | rules absent |
| C3 db | `withSession(handle, fn)`: setup is the single `enter_session` statement, kind `withSession`, `store.marked` is the returned xid, `NoLiveSession` on 42501, extended mode, fn gets `(tx, shell)`; exported from the root of `@poly/db` | `packages/db/src/with-session.test.ts`, `tests/db/session-handle-enter.test.ts` | no export |
| C3 web hooks | cookie absent → 303 `/sign-in`; valid BetterAuth cookie only → 303; `NoLiveSession` → clear handle cookie then 303; no 503 branch; name comes from the returned row (`provisionPerson` called with it; empty/NULL → `Person`); `locals.session`, `locals.handle` set, `locals.identity` gone | `apps/web/src/hooks.server.test.ts` (+ `.auth`, `.authtree`, `.gate` retargeted) | still loads by cookie |
| C3 tenancy | `provisionPerson(tx, name)` takes the name and runs no `public."user"` SELECT | `packages/tenancy/src/index.test.ts` | reads the table |
| R7.4 | e2e harness revokes after seeding (`serve.ts`): `enter_asserted_user` EXECUTE and ALL on the six BetterAuth tables from poly_app; every existing spec passes under it. Conditions: the revoke is only in `serve.ts`; `tests/ci` greps that no file under `packages/db/sql`, migrations, `roles.sql`, `tests/db/**` contains the REVOKE | `apps/web/tests/e2e/serve.ts`, `tests/ci/e2e-revoke-scope.test.ts` | harness lacks it (revoke present = e2e red until web changes) |
| C4 R8 | `authOptions` fixes `cookiePrefix`, `defaultCookieAttributes` (`secure`, `lax`, `/api/auth`, httpOnly) and not through `AuthInput`; `cookieCache` off | `packages/auth/src/options.test.ts` | defaults used |
| C4 | every BetterAuth Set-Cookie over the 13 paths has the `__Secure-` prefix and `Path=/api/auth`; the cap's clearing cookie carries `Path=/api/auth` | `tests/db/session-handle-paths.test.ts`, `tests/db/auth-refresh.test.ts` | prefix `better-auth.` and `Path=/` |
| C4 | e2e Chromium: after a real sign-in a page request carries `__Host-poly_handle` and no cookie whose name contains `better-auth` | `apps/web/tests/e2e/handle-cookie.spec.ts` | web gets BetterAuth's cookie |
| C4 | hooks ignore a BetterAuth cookie sent by hand: 303 | `apps/web/src/hooks.server.test.ts` | loads by it |
| C5 R5.1 | plugin: `cookieLifetime()` carries two after-hooks `[lifetime, handle]`, both `() => true`; last in `plugins[]` (pinned); handle code in `session-handle.ts` | `packages/auth/src/session-handle.test.ts`, `cookie-lifetime.test.ts` | no hook |
| C5 | cookie attributes: `__Host-poly_handle`, `Path=/`, HttpOnly, Secure, SameSite=Lax; `Max-Age` only when the session cookie has a positive one and then equal; `rememberMe:false` none; cleared with `Max-Age=0` when the session cookie is cleared and in the cap branch | `tests/db/session-handle-paths.test.ts` | no cookie |
| C5 | **13 paths** as poly_auth through `handleAuthRequest`: email, magic-link, oauth-callback, sign-up, passkey-sign-in (new handle, sha256 maps to new session, `enter_session` yields it); TOTP and backup-code after a hold (hold sets no handle, leaves no row); the four rotations (new handle; old handle refused); refresh (no Set-Cookie of the handle, existing handle still enters); sign-out (row gone in the transaction, cookie cleared); TOTP/passkey hold sets none | same | no handle |
| C5 R5.3 | BEFORE INSERT trigger on `app.session_handle` that raises, planted by superuser, on email, passkey, magic-link, callback, sign-up: 5xx, no Set-Cookie of either cookie, no session row; trigger dropped after. Then attach stubbed out: commit fails 23514, no session row stays (**unmeasured claim 2** among them: created-and-deleted held sign-in commits) | `tests/db/session-handle-signin.test.ts` | no table/trigger |
| C5 | plugin with no request transaction throws (500, fail closed); the 500 body and log hold no handle (T5) | `tests/db/session-handle-signin.test.ts` | no plugin |
| H3 canary | a sign-in and a page load with log capture: no line contains the handle; the handle appears in no JSON body, URL or error | `tests/db/session-handle-signin.test.ts`, `packages/config/src/log-seceng.test.ts` | no handle |
| C6 R9 | `loadConfig('web')`, `('auth')` refuse `AUTH_INTERNAL_URL`, `AUTH_INTERNAL_HOST`, `AUTH_INTERNAL_PORT` (forbidden) | `packages/config/src/auth-service.test.ts` | allowed today |
| C6 | rendered compose (prod, staging): no `web-auth` network, auth exposes exactly one port, no fixed address | `tests/infra/auth-service.test.ts` | network present |
| C6 | `GET /session` on auth's public listener: 404; `apps/auth/src/internal.ts` and `handleSessionRequest` gone; `bind.ts` has no `internalBind` | `tests/db/auth-service-main.test.ts`, `apps/auth/src/bind.test.ts`, `tests/layers/auth-service.test.ts` | listener present; `auth-internal-session.test.ts` deleted with it |
| C6 | web no longer imports `@poly/auth/web`'s `loadSession`; its `web.test.ts` cases for the listener go | `packages/auth/src/web.test.ts` | present |
| R10 | `e2e-auth.ts` `signIn` posts through `handleAuthRequest` with `x-forwarded-for` and `origin`; storageState carries both cookies with their own paths (`/api/auth`, `/`), `secure`, `httpOnly`, `Lax` | `tests/db/helpers/e2e-auth.ts`, `apps/web/tests/e2e/serve.ts`; guarded by `tests/db/session-handle-harness.test.ts` | calls `auth.api.signInEmail` |
| R11 | `definers.json` lists the six functions with owner and EXECUTE; REVOKE FROM PUBLIC before GRANT; 0015 applies on the 0014 chain; definers' `search_path=''` | `tests/db/auth-service-grants.test.ts`, existing `matrix.test.ts`, `tests/db/helpers/definers.ts` | not listed |
| R0 | nothing in this loop revokes poly_app: poly_app keeps `enter_asserted_user` and its BetterAuth grants on the migrated chain (control) | `tests/db/session-handle-pins.test.ts` | passes today; must stay green |
| Pin | N1 dropped (ruling Q): no test | — | — |

## Unmeasured claims (measured first, before the red run is trusted)

1. Session delete removes its handle row with no privilege of the deleting role on `session_handle` (cascade): `session-handle-attach.test.ts` as poly_auth and as poly_authz.
2. The deferred check passes when a held sign-in creates and deletes its session in one transaction: `session-handle-signin.test.ts`.
3. Every caller of `step_up_fresh` runs inside a session transaction: the step-up route tests in `second-step-flow.test.ts`.

Claims 1 and 2 need the 0015 objects, so they cannot be measured on the tree as it stands. `red-run.md` measures them on a throwaway prototype of 0015 in a scratch clone (never committed) so a contradiction reaches the lead before the build.

## As built

(Filled in at the gate: the final file list and counts.)
