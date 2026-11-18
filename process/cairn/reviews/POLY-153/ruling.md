# POLY-153 — Web enters by handle: ruling (architect)

**Basis.**
- Branch `feature/poly-153-web-enters-by-handle` @ 4cf108ca. better-auth and @better-auth/passkey 1.7.18; no pin changes.
- The spike record `process/cairn/reviews/POLY-148/spike.md` (§1 H and C, §4, §7), `process/cairn/reviews/POLY-145/pricing.md` §1 blocks E and H, POLY-152's ruling (R5, R6, R7, R9) and verdict, and `process/DECISIONS.md` from 2026-11-13.
- The tree as read today: `packages/auth/src/{handler,cookie-lifetime,session,web,recent-auth,options,route-policy,second-step}.ts`, `packages/auth/src/web/sessions.ts`, `apps/auth/src/*`, `apps/web/src/hooks.server.ts`, `packages/db/src/context.ts`, migrations 0011 and 0014, `apps/web/tests/e2e/serve.ts`, `tests/db/helpers/{e2e-auth,second-step}.ts`, the spike's `checks/check-handle.mjs`.
- Criteria are C1–C6 in POLY-153's order.

**Tags.** "(spike)" means measured in POLY-148. "(152)" means measured live in POLY-152 by backend-lead-152. "(code-read)" means read, not run. "(unmeasured)" means qa's red test measures it first; nothing below drops a control on an unmeasured claim, and a red test that contradicts one reopens this ruling (re-issued whole), it is not worked around.

## R0. What this loop is, and what it is not

Web enters every transaction by `app.enter_session(handle)`, where the handle is the `__Host-poly_handle` cookie and the database holds only its SHA-256. Web stops calling the service's `/session` listener and stops calling `enter_asserted_user`. BetterAuth's cookies move to `__Secure-` and `Path=/api/auth`.

**Not here (POLY-149):** revoking poly_app's EXECUTE on `enter_asserted_user` and its grants on BetterAuth's tables; dropping `enter_asserted_user`, `withTenant` and the `SessionUserId` brand from `packages/db`; the sign-in record; the growing lock; every doc but ARCH. This loop leaves all of poly_app's existing grants as they are. It only adds the four EXECUTEs in R2.

## R1. `app.session_handle` (C1, C2)

```
app.session_handle (
  session_id  uuid PRIMARY KEY REFERENCES public.session(id) ON DELETE CASCADE,
  handle_hash bytea NOT NULL UNIQUE CHECK (pg_catalog.octet_length(handle_hash) = 32),
  created_at  timestamptz NOT NULL DEFAULT pg_catalog.now()
)
```
- Owner poly_owner. RLS enabled and forced. `REVOKE ALL … FROM PUBLIC`. Granted to **poly_authz only**: SELECT, INSERT, with policies `session_handle_read FOR SELECT TO poly_authz USING (true)` and `session_handle_attach FOR INSERT TO poly_authz WITH CHECK (true)`. No UPDATE or DELETE grant to anyone. `BEFORE TRUNCATE … app.refuse_truncate()`, as on `tx_identity`.
- **No login role holds any privilege on it**: not poly_app, poly_auth, poly_worker or poly_operator. The spike gave poly_auth SELECT and INSERT; R3's definer removes both, so a hash can come only from a backup or a superuser.
- **One handle per session, for life.** The primary key is the session; a second handle for a session is refused. A handle dies only with its session, by the cascade, in the same transaction as the session's DELETE (sign-out, revoke, a rotation's delete of the old row, the cap). That the cascade runs with no privilege of the deleting role on `session_handle` is (unmeasured): the test deletes a session as poly_auth (sign-out) and as poly_authz (R6 revoke) and checks the handle row is gone in that transaction.
- **Stored form.** `handle_hash = sha256(convert_to(handle, 'UTF8'))`, computed only inside R3 and R4. No column anywhere holds the plain handle (C2; the spike's data-only `pg_dump` held none, spike §1 H).

## R2. Grants, catalog-exact (all roles)

| Role | Gains in this loop | Pinned absent |
|---|---|---|
| poly_app | EXECUTE `app.enter_session(text)`, `app.my_sessions()`, `app.revoke_my_session(uuid)`, `app.recent_auth_ok()` | anything on `app.session_handle`; EXECUTE `attach_session_handle`, `session_needs_handle` |
| poly_auth | EXECUTE `app.attach_session_handle(uuid, text)` | anything on `app.session_handle`; EXECUTE `enter_session`, the three session definers, `enter_asserted_user` (unchanged) |
| poly_worker, poly_operator | nothing | all of the above |
| poly_authz (owner) | SELECT, INSERT on `app.session_handle`; on `public.session` SELECT `(recent_auth_at, user_agent, ip_address, updated_at)` added to its 0014 columns, UPDATE `(expires_at, updated_at)`, DELETE; SELECT `(id, name, image)` on `public."user"`; EXECUTE `app.current_session_id()` | INSERT on `public.session`; any tenant table |

- poly_auth gains **no tenancy grant** and still holds no `enter_asserted_user` (standing constraints). poly_app gains **nothing on BetterAuth's tables**.
- pgTAP 08 (poly_auth, granted and effective, both ways) gains the one EXECUTE. A new pgTAP block does the same for poly_app's four EXECUTEs and the absence of `session_handle` privileges for every login role. **A build that finds a list short does not add the grant**: it reports the failing statement to me (POLY-152 R2's rule).
- N2 (filed on this issue) lands with it: 08's planted list gains `GRANT poly_app TO poly_auth` and the `WITH INHERIT FALSE, SET TRUE` form.

## R3. The handle is issued by `app.attach_session_handle(p_session uuid, p_handle text)` (C1, C5)

- Owner poly_authz; SECURITY DEFINER; `SET search_path = ''`; EXECUTE poly_auth only. Returns `boolean`.
- In order:
  1. not exactly `SELECT app.attach_session_handle($1, $2)` → 42501 (0011's check; injected SQL cannot bind parameters);
  2. either argument NULL → 22004; `p_handle !~ '^[A-Za-z0-9_-]{43}$'` → 22023;
  3. no visible `session` row with `id = p_session` → return **false** (a held sign-in already deleted it);
  4. a handle row for `p_session` already exists → return **false** (refresh: the session keeps its handle);
  5. insert `(p_session, sha256(convert_to(p_handle,'UTF8')))`; return **true**.
- **Why this is safe from poly_auth.** At rest every committed session has a handle (R5's deferred check), so step 4 refuses every committed session, including a victim's. The only sessions it can attach to are ones created in the caller's own transaction. So SQL as poly_auth can mint a web entry only by creating a new session row, which the POLY-149 sign-in record will log. It cannot read a hash (R1).
- **This is my answer to seceng H2's "session created by this transaction".** Step 4 plus R5.2 gives the same result as a per-row stamp: a session that has no handle and is visible to the caller can only be one created in the caller's own transaction, since another transaction's uncommitted row is invisible and every committed row has a handle. It needs no new column on BetterAuth's table and no xid arithmetic across savepoints. The per-session uniqueness seceng asks for is the primary key on `session_id`. If seceng still wants an explicit stamp, see open question 6.
- **Pinned with it (H2):** poly_auth holds no `UPDATE (id)` or `UPDATE (user_id)` on `session`, so it cannot re-point a session that has a handle to a victim. 0014 grants neither; pgTAP 08 keeps it so.
- **Tests:**
  - attach to a committed session that has a handle → false, and its handle is unchanged;
  - attach as poly_app or poly_worker → permission denied;
  - a direct INSERT into `app.session_handle` as each login role → permission denied;
  - a session inserted as poly_auth with no handle attached → the commit fails 23514.
- **The handle is independent of the BetterAuth token.** It is 32 bytes from the CSPRNG (R5.1) and is never derived from `session.token`. A role that reads tokens (poly_auth, or poly_app until POLY-149) therefore cannot compute any handle.

## R4. `app.enter_session(p_handle text)` (C1)

- Owner poly_authz; SECURITY DEFINER; `SET search_path = ''`; EXECUTE poly_app only.
- `RETURNS TABLE (xid text, user_id uuid, session_id uuid, name text, image text, expires_at timestamptz)`. **Canonical call `SELECT * FROM app.enter_session($1)`**; the exact-call check compares against that text.
- Refuses, in this order, with 0011's codes:
  1. not exactly the canonical call → 42501;
  2. `p_handle` NULL → 22004;
  3. a marker already present → 42501; any earlier write in the transaction → 42501;
  4. `p_handle !~ '^[A-Za-z0-9_-]{43}$'`, or no row joining `session_handle` on `handle_hash = sha256(convert_to(p_handle,'UTF8'))` to a `session` with `expires_at > now()` and `created_at + interval '30 days' > now()` → 42501, **one message, `no live session`, for every case**.
- Then: inserts the marker `(xid, user_id, session_id, kind 'session')` from that row; **then** slides: if `expires_at <= now() + interval '6 days'` (more than a day since the last slide, BetterAuth's `updateAge`), `UPDATE public.session SET expires_at = least(now() + interval '7 days', created_at + interval '30 days'), updated_at = now()` for that id (POLY-152 R7; the slide never passes the cap). **This is what slides the row on web activity** (seceng H3): page loads no longer reach the service, so without it a user active only on web pages would be signed out at day 7. The owner's grant is exactly `UPDATE (expires_at, updated_at)` (R2), and the write is always after the marker insert, so the first-write check is unaffected. It never deletes a capped row; a capped session is refused and the service deletes it on its next request.
- Returns one row: the xid as text, the user and session, `user.name`, `user.image`, and `expires_at` after the slide.
- **Hashing is inside Postgres only.** Web sends the plain cookie value and never computes or sends a hash (spike §7.1, H.forgery, required). `enter_session(text)` is the only overload, and no function that takes a hash is executable by any login role.
- **Tests (H1), as poly_app with the canonical call:**
  - the stored `handle_hash` as a bytea parameter, as `\x…` text, as bare hex, and as base64url (43 characters, so it passes the format check and is hashed again);
  - BetterAuth's `session.token` and `session.id`;
  - an expired, a capped, a revoked and an unknown handle.
  
  Each yields no marker, and each error is the same `no live session` refusal, never the exact-call one. Also tested: a second marker refused; an earlier write refused; NULL refused; poly_worker, poly_operator and poly_auth have no EXECUTE; the extended-mode two-statement test on poly_app's pool and both poly_auth pools.
- **The marker's `session_id` under kind `session` is proof of a session**: the definer derived it from a live row the caller proved by holding the plain handle. R6's three definers rely on it **only when `kind = 'session'`**. It is **not** proof under kind `web`, which `enter_asserted_user` still writes from poly_app's word until POLY-149. **POLY-89's guards are not changed** and still treat `current_session_id()` as narrowing only; whether they may rely on kinds `session` and `auth` once kind `web` is gone is POLY-149's to rule.
- The kind CHECK becomes `('web', 'signup', 'auth', 'session') OR system:*`; `app.audit_membership()` maps `session` to actor `user`.
- **The 30-day cap is now in three places** (`recent-auth.ts`, `enter_auth_session`, `enter_session`); the existing pin test covers all three.

## R5. Every session commits with its handle (C1, C5)

1. **The plugin.** The handle is set by a second after-hook in the existing last plugin, `cookieLifetime()` (POLY-152 R7: "POLY-153's handle hook joins the same plugin"), in a new file `packages/auth/src/session-handle.ts`. `hooks.after = [lifetime, handle]`, both with matcher `() => true`. It stays last in `plugins[]`, with a test that pins it last.
   - Last is required: dispatch runs `options.hooks.after` (the passkey hold) first, then plugin hooks in array order, so as the last plugin it sees the final `ctx.context.newSession` (spike §1 H). A `() => true` matcher accepts `widenTwoFactorMatcher`'s sentinel path, so it is not counted as a sign-in hold (code-read, `second-step.ts:23`).
   - When `newSession` is set: generate 32 random bytes (`crypto.randomBytes`), base64url without padding (43 chars), and call `SELECT app.attach_session_handle($1, $2)` on `currentClient()` (the request's transaction). **No transaction → throw** (a 500, fail closed). On `true`, append `__Host-poly_handle=<v>; Path=/; HttpOnly; Secure; SameSite=Lax`, plus `Max-Age` only if the session-token `Set-Cookie` in the same response carries a positive `Max-Age`, and then the same value (the 30-day-cap rule, R7 of POLY-152; `rememberMe: false` gives neither cookie a `Max-Age`). On `false`, set nothing.
   - **The handle appears only in the `Set-Cookie` header and the `Cookie` header (H3).** It is never in a URL, a JSON body, a log line, an error or an exception message. Postgres parameter logging is already off (`log_parameter_max_length[_on_error] = 0`). The existing canary log test gains the handle: a sign-in and a page load with log capture on, then no line contains it.
   - **Clearing.** When the response carries a session-token `Set-Cookie` with `Max-Age=0` (sign-out, revoke of the current session), append `__Host-poly_handle=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`. `handleAuthRequest`'s cap branch appends the same clearing cookie.
2. **The deferred check.** `CREATE CONSTRAINT TRIGGER session_needs_handle AFTER INSERT ON public.session DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.session_needs_handle()`. The function is owned by poly_authz, SECURITY DEFINER, with no EXECUTE for any login role. At commit it raises 23514 (`a session needs its handle`) if the session row still exists and has no handle row. **No role is exempt**, superuser fixtures included (R10).
   - It makes C5 structural on every path, listed or not: a session can never commit without its handle, and a held sign-in whose session was created and deleted in one transaction passes.
   - `SET CONSTRAINTS … IMMEDIATE` only makes it fire sooner, which refuses the insert; no runtime role can disable it.
   - That a deferred constraint trigger sees the hold's delete and the handle insert made under BetterAuth's savepoints is (unmeasured); the held sign-in tests measure it.
3. **The four no-session sign-in paths** already run in one transaction of ours (code-read, `handler.ts`): `/sign-in/email` and `/passkey/verify-authentication` in `withSignInTx`; `/magic-link/verify` and `/callback/:id` in `withContextFreeTx`, as `USER_INSERTING`. Nothing changes there. **Test (C5):** a BEFORE INSERT trigger on `app.session_handle` that raises, planted by the test superuser. On each of the four paths and on `/sign-up/email`: the answer is 5xx; no `Set-Cookie` of either cookie; no `session` row for the user; the trigger dropped afterwards. Then the same with the plugin's attach call stubbed out (no insert): the commit fails 23514 and no session row stays.

**The 13 session paths (spike `check-handle.mjs`), each one test as poly_auth through `handleAuthRequest`:**

| Spike id | Path | Expected |
|---|---|---|
| email, magic-link, oauth-callback, sign-up, passkey-sign-in | sign-in / sign-up | new handle; `sha256` maps to the new session; `enter_session` as poly_app yields it |
| second-factor-totp, backup-code | `/two-factor/verify-totp`, `/verify-backup-code` after a hold | as above; the held request set no handle and left no handle row |
| totp-first-verify-rotation, two-factor-disable, change-password (`revokeOtherSessions`), passkey-register-session (`createSession: true`) | rotations | new handle for the new session; the old handle refused by `enter_session` |
| refresh | an `/api/auth` request after `updateAge` | no handle `Set-Cookie`; the existing handle still enters |
| sign-out | `/sign-out` | handle row gone in that transaction; handle cookie cleared |

Plus: TOTP and passkey holds set no handle cookie and leave no handle row.

## R6. Settings → Sessions, revoke and step-up are definers (C3)

All owned by poly_authz, SECURITY DEFINER, `SET search_path = ''`, EXECUTE poly_app only. Each refuses 42501 unless the marker exists with `kind = 'session'`.
- `app.my_sessions() RETURNS TABLE (id uuid, user_agent text, ip_address text, created_at timestamptz, updated_at timestamptz, current boolean)`: the marker user's sessions, `current = (id = current_session_id())`. It returns **no token and no handle**.
- `app.recent_auth_ok() RETURNS boolean`: the marker session's `recent_auth_at` is `<= now()` and `>= now() - interval '300 seconds'` (`step_up_fresh`'s predicate, which poly_app no longer holds after POLY-152 R8).
- `app.revoke_my_session(p_id uuid) RETURNS void`: not the marker user's → P0002. Not the current session and not `recent_auth_ok()` → 42501 with message `step_up_required`. Otherwise `DELETE FROM public.session WHERE id = p_id AND user_id = current_user_id()`; the handle goes by cascade. Web maps P0002 → 404 and 42501 → 403 `step_up_required`. Revoking the current session also clears the handle cookie.
- `packages/auth/src/web/sessions.ts` becomes calls to these three; its SQL on `public.session` is removed. **Web sends no SQL that names `public.session`, `public.account`, `public.verification`, `public.two_factor`, `public.passkey` or `app.session_handle`**; the boundary test greps the files reachable from `apps/web`.
- **Service side.** `packages/auth`'s `requireRecentAuth(sessionId)` becomes `SELECT app.step_up_fresh()` on the request's transaction (poly_auth holds it). That every caller runs inside `withAuthSession` is (unmeasured); the step-up route tests measure it, and outside one the answer is false, so it fails closed.

## R7. Web (C3, C6)

1. **`withSession(handle, fn)`** in `packages/db` (root export, kind `withSession`, the poly_app pool). Its setup is the one statement `SELECT * FROM app.enter_session($1)`; `store.marked` is the row's `xid`, and the S6 pre-COMMIT check applies. `fn` receives `(tx, shell)`. A 42501 from the entry statement throws `NoLiveSession`. Extended mode only; the extended-mode test covers it and poly_auth's pools (the attach call).
2. **`hooks.server.ts`.** It reads only `__Host-poly_handle`. If the cookie is absent → 303 to `/sign-in`. Otherwise one transaction, `withSession(handle, …)`: `provisionPerson(tx)` (it survives, now under a `session` marker, with today's retry-once on the unique race), then `app.second_step_required()`. `NoLiveSession` → clear the handle cookie, then 303 to `/sign-in`. The 503 "service unavailable" branch is removed. `event.locals.session = shell` and `event.locals.handle = handle`. `locals.identity` is removed.
3. **Removed from web:** `loadSession`, `loadSessionFromService`, `completeSession`, `setAuthInternalOrigin`, the `SESSION_COOKIE` filter, every `withTenant` call and every `sessionUserId` import. `listMySessions`, `revokeMySession` and `myLandingEntity` take the handle and run in `withSession`. **eslint** refuses, in `apps/web/**` and `packages/auth/src/web*`: `@poly/db/session`, the import names `withTenant` and `sessionUserId`, and (N3) `better-auth` and `@better-auth/*`. The layer fixtures gain one failing case each.
4. **Proof that web needs neither `enter_asserted_user` nor BetterAuth's tables.** In the e2e harness only, after seeding and before web starts, `serve.ts` runs as superuser: `REVOKE EXECUTE ON FUNCTION app.enter_asserted_user(uuid, uuid) FROM poly_app; REVOKE ALL ON public.session, public.account, public.verification, public.two_factor, public.passkey FROM poly_app;`. Every e2e spec must pass under it. This is a test-only measurement for POLY-149; **no migration revokes anything in this loop**.

## R8. Cookie scope (C4)

- `authOptions`: `advanced.cookiePrefix = '__Secure-better-auth'`; `advanced.defaultCookieAttributes = { secure: true, sameSite: 'lax', path: '/api/auth', httpOnly: true }`; `useSecureCookies` stays false. These are fixed in `authOptions`, not `AuthInput`. The spike measured that these two settings give all six of BetterAuth's cookies `__Secure-`, `Path=/api/auth`, Secure, HttpOnly and SameSite=Lax, and that OAuth state, the two_factor hold, the passkey challenge and sign-out all finish (spike §1 C).
- The handle stays `__Host-poly_handle`, `Path=/`.
- **`SameSite=Lax` on the handle** holds only while web's GET routes change nothing and every state change is a POST behind SvelteKit's origin check. Revoke in R6 is a form action (POST); no new GET route in this loop writes. `cookieCache` stays off, and a test pins it.
- **Tests:**
  - every BetterAuth `Set-Cookie` across R5's 13 paths has the prefix and the path;
  - the cap's clearing cookie carries `Path=/api/auth` (C7 of POLY-152, now with the real path);
  - **in Chromium (e2e), after a real sign-in, a request to a web page carries `__Host-poly_handle` and no cookie whose name contains `better-auth`** (spike §1 C, browser item d, measured in the spike);
  - `hooks.server` ignores a valid BetterAuth cookie sent to web by hand: no handle means 303.
- The accepted cost (spike §7.9) is that a sibling subdomain can plant a same-name `__Secure-` cookie (login CSRF at `/api/auth`). SECURITY states it at POLY-149.

## R9. The interim `/session` listener is removed (C6)

- Deleted: `apps/auth/src/internal.ts`; the internal listener in `main.ts` (the service has one listener, the public one); `internalBind` and its env (`AUTH_INTERNAL_HOST`, `AUTH_INTERNAL_PORT` and the socket variant) in `bind.ts`; `handleSessionRequest` and the in-process `loadSession` in `packages/auth/src/session.ts`; `AUTH_INTERNAL_URL` from web's config; the `web-auth` network and auth's fixed address in `prod.yml` and `staging.yml`.
- Tests: `loadConfig('web')` and `loadConfig('auth')` refuse `AUTH_INTERNAL_URL`, `AUTH_INTERNAL_HOST` and `AUTH_INTERNAL_PORT` as forbidden; the rendered compose has no `web-auth` network and auth exposes one port; `GET /session` on auth's public listener answers 404. The tests of the removed listener go with it.
- **N1 is dropped**: the address it would tie no longer exists.

## R10. The dev and e2e harness (criterion of 153a)

- **Seeding signs in through the service's code path.** `tests/db/helpers/e2e-auth.ts`'s `signIn` sends `POST <origin>/api/auth/sign-in/email` through `handleAuthRequest` on the poly_auth pool, with an `x-forwarded-for` and an `origin` header. It no longer calls `auth.api.signInEmail`, which bypasses `handleAuthRequest` and so runs outside any transaction of ours (code-read). The plugin then issues the handle and inserts its `app.session_handle` row in the sign-in transaction; R5's deferred check would refuse the old call.
- **`storageState`** takes every `Set-Cookie` with its own attributes: `__Secure-better-auth.session_token` at `Path=/api/auth`, `__Host-poly_handle` at `Path=/`, both `secure`, `httpOnly`, `sameSite: 'Lax'`, domain `localhost`. Today's hard-coded `path: '/'` goes. The second seeded sign-in, the one the Sessions spec revokes, goes the same way.
- `serve.ts` drops the `AUTH_INTERNAL_*` env, then applies R7.4's revokes after seeding.
- **Fixtures that insert `public.session` by SQL** insert its handle row in the same transaction: one helper, `sessionWithHandle(userId, opts) → { id, token, handle }`, in `tests/db/helpers`, used by every such insert (eight files, code-read). R5's check refuses a fixture that does not. Web-entry tests then enter with that handle.
- **Dev.** The Vite proxy is unchanged (`/api/auth` → the service). A browser sign-in sets both cookies. Chromium stores `__Secure-` and `__Host-` cookies over loopback HTTP (spike §4, measured on `127.0.0.1`; today's e2e on `localhost` already relies on `__Host-`). WebKit and Firefox are not run.

## R11. Migration order

1. **`0015_session_handle`** (custom), as poly_owner, in this order:
   1. the table, its RLS, its truncate trigger, and the poly_authz grants and policies (R1);
   2. the kind CHECK (R4);
   3. poly_authz's added grants on `session` and `user`, and EXECUTE `current_session_id` (R2);
   4. `SET ROLE poly_authz`: `attach_session_handle`, `enter_session`, `session_needs_handle`, `my_sessions`, `recent_auth_ok`, `revoke_my_session`; for each, REVOKE FROM PUBLIC, then the R2 grant;
   5. `SET ROLE poly_govern`: `audit_membership` with `session`;
   6. `SET ROLE poly_owner`: the constraint trigger on `public.session`. Ends on poly_owner.
2. `packages/db/sql/definers.json` lists the six functions with their owner and EXECUTE lists.
3. Nothing is deployed, so no session needs a back-filled handle.

## R12. What an attacker reaches at the end of this loop

- **As poly_app:** the same as after POLY-152, because `enter_asserted_user` and the BetterAuth table grants stay until POLY-149. It gains no way to use a stored hash: `enter_session` hashes what it is given (C1).
- **As poly_auth:** it cannot read a handle hash and cannot attach a handle to any committed session. It reaches web as a user only by creating a session, which is a new row and will be on POLY-149's record. With code execution in the service, it sees the plain handles of the sessions it issues, by design.
- **A backup reader** holds hashes, which no function accepts as a handle.

## R13. seceng's attack checklist (seceng-153, H1–H7), where each is ruled

| Item | Ruled in | Disagreement |
|---|---|---|
| H1 stored hash replayed | R4 (plain-handle definer, one overload, tests), R3 (handle independent of the token) | none |
| H2 handle minted for an existing session | R1 (no login role holds anything on the table), R3 (definer, PK on `session_id`, `UPDATE(id, user_id)` pinned absent), R5.2 | by mechanism only: a deferred check in place of a stamp (open question 6) |
| H3 handle outliving its session; the slide | R1 (cascade, tested on each delete), R4 (cap and expiry checked in the definer; `enter_session` slides within the cap), R5.1 (never logged), C2 query (R1) | none |
| H4 web receives BetterAuth's cookies | R8 | none |
| H5 session without a handle | R5 (deferred check, the real INSERT forced to fail, the plugin pinned last, holds), R3 (refresh keyed on session id) | none |
| H6 interim listener | R9 | none. The SECURITY TB-15 and R-2 text is POLY-149's docs |
| H7 session_id as proof | R4 (kind `session`; POLY-89 guards unchanged), R6 (the three definers require kind `session`; revoke checks the owner), R7.3 (`withTenant` unreachable from web) | none |

## Open questions (for seceng unless marked; none blocks the tests)

1. **R5.2 has no superuser exemption**, so eight fixture files change (about +0.25 loop-day, a guess). An exemption keyed on `session_user` being a superuser would grant no runtime role anything. I rule against it so that the check has no branch. Confirm.
2. **R4's proof rule.** The marker's `session_id` is relied on only under kind `session`, and only by R6's three definers. Confirm that this, plus the explicit "POLY-89 guards unchanged", meets the standing constraint.
3. **R7.4's harness revoke** is a measurement, not POLY-149's revocation. Lead to confirm it does not cross that line.
4. **R3 generates the handle in Node** and sends it once to the definer. A definer-generated handle would keep it out of Node until the cookie is written, but it adds a random source in SQL (no migration installs pgcrypto; code-read). I prefer Node; confirm.
5. **ARCH** (§3.1c, §3.3, §7, the `packages/auth` row of §2) is edited at the verdict, not before. The ruling contradicts none of it, except the interim items it marks as interim.
6. **H2's stamp versus R5.2's deferred check.** I use the deferred "every session commits with its handle" check, together with step 4's "no handle yet", in place of a per-session stamp (R3). It needs no change to BetterAuth's table, and it also makes C5 structural. A stamp (`session.created_txid`, set by a trigger) would work too, but it has to compare a 32-bit `xmin`-style id across BetterAuth's savepoints, or add a column BetterAuth's adapter must ignore. Accept the equivalence, or name the stamp you want.
