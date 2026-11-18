# POLY-152 — Sign-in service process: ruling (architect)

**Basis.**
- Branch `feature/poly-152-sign-in-service` @ 319b127e. better-auth and @better-auth/passkey 1.7.18; no pin changes.
- The spike record `process/cairn/reviews/POLY-148/spike.md` (28 PASS, 4 FAIL, 4 REPORT at checks `9fda8f8d`), seceng's reading in its §7, and the POLY-89 ruling `process/cairn/reviews/POLY-89/ruling.md` (R1–R8). The tree as read today: `packages/auth/src/{handler,session,user-hooks,routing-pool,recent-auth}.ts`, `packages/db/src/context.ts`, `packages/tenancy/src/index.ts`, migrations 0001–0013, `packages/db/sql/roles.sql`, `apps/web/src/hooks.server.ts`, `tests/db/helpers/second-step.ts`.
- Live measurements by backend-lead-152 on 2026-11-17: pinned 1.7.18, the migrated chain on the `tests/db` docker harness, `authOptions` as shipped plus one probe plugin, `log_statement=all` where noted. Four things were measured:
  - the session cookie as an after-hook sees it (R7);
  - what a refused second-step code writes (R9);
  - `getSession` on an expired row (R7);
  - `getSession` with an unsigned or wrongly signed token (R6.2).
- seceng-152's review (`ruling-review.md`), with the conditions of its §5 adopted in place.
- Criteria are C1–C9 in POLY-152's order. seceng's attack checks are #16–#19.

**Tags.** "(spike)" means measured in POLY-148. "(code-read)" means read, not run. "(unmeasured)" means qa's red test or backend-lead's live run measures it first; nothing below drops a control on an unmeasured claim.

## R0. What this loop is, and what it is not

This loop stands up `polycarpic auth` on poly_auth and moves BetterAuth, its secrets and the sign-up and second-step writes into it. Web stops running BetterAuth. **For poly_app it narrows only the definers web no longer calls** (R8): poly_app keeps its grants on BetterAuth's tables and `app.enter_asserted_user` until POLY-149, and web still enters by `enter_asserted_user`. Web entering by handle (the handle cookie, `app.session_handle`, `app.enter_session`, cookie path scoping) is POLY-153. The revocation and the docs are POLY-149.

## R1. The process and its mounts (C1)

1. **Entry.** `apps/auth/src/main.ts`, run from the app image as `polycarpic auth` (dispatched like `polycarpic cli`). It builds the one BetterAuth instance with `createAuth(authOptions(...))` and serves two listeners:
   - **public** (Caddy → `/api/auth/*`): `handleAuthRequest` and nothing else; any other path is 404;
   - **internal** (compose network only; Caddy has no route to it): `GET /session`, R6.2.
2. **Startup checks.** It exits non-zero unless `SELECT current_user` is `poly_auth`, `AUTH_SECRET_FILE` reads, and `drizzle.__drizzle_migrations` is at the expected head (the existing startup check).
3. **Secrets.** The config registry gains a service `auth`. `AUTH_SECRET_FILE` and the OAuth client secrets (`OAUTH_GOOGLE_SECRET_FILE`, `OAUTH_GITHUB_SECRET_FILE`) are **for `auth` alone and forbidden for every other service**. `RESEND_API_KEY_FILE` moves from web to `auth`, and the worker keeps it for its own mail. Web's `loadConfig('web')` refuses `AUTH_SECRET_FILE` as forbidden. The `auth` service gets its own `poly_auth` database password file; web keeps poly_app's.
4. **Compose (POLY-152e).** Service `auth`, the app image, `command: auth`, the secrets above mounted for it alone. The rendered-compose test (seceng #17) renders `prod.yml` and `staging.yml` and fails if web, worker, operator, migrate or any staging service mounts the auth secret, an OAuth secret or poly_auth's password. The internal listener is on a network that web and auth share and the worker does not.
5. **Caddy.** `@auth path /api/auth /api/auth/*` → `auth:<public port>`; everything else, `/sign-in` and `/sign-up` included, → web (DECISIONS 2026-11-15: the pages stay in web). No Caddy route reaches the internal port.
6. **Web refuses the tree.** `hooks.server.ts` answers 404 to `/api/auth` and `/api/auth/*` for every path, listed or not; web holds no BetterAuth instance. Test: with Caddy bypassed, web answers 404 to `/api/auth/sign-in/email` and `/api/auth/ok`.
7. **Dev and e2e.** Vite `server.proxy` and `preview.proxy` send `/api/auth` to the service; web's internal session URL points at the service's internal listener. Playwright's `serve.ts` starts the service before `vite preview` and waits for `/api/auth/ok` and `/healthz`. The seeded `storageState` is unchanged this loop (the BetterAuth cookie keeps `Path=/`, R7).
8. **Layers.** `layers.json` gains `auth-app` (`apps/auth`, allow `config`, `config/log`, `db/startup`, `auth`). `packages/auth` gains a subpath `web` (R6.2); web's allow list swaps `auth` for `auth/web`. A boundary test fails if anything under `apps/web` resolves `better-auth`, `@better-auth/*` or `@poly/auth` (the root).

## R2. poly_auth's grants, catalog-exact (C2, C3, C4)

**Role** (`roles.sql`, run before `migrate`): `poly_auth` LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS, member of no role, CONNECT on the database, USAGE on schemas `public`, `app`, `drizzle`. No plpgsql USAGE (the PUBLIC revoke covers it). pg_hba: scram from the app network only, as poly_app.

**Tables** — exactly poly_app's grants on BetterAuth's tables today (0001, 0005), and nothing on any other table:

| Table | Privileges |
|---|---|
| `public."user"` | SELECT; INSERT (id, name, email, email_verified, image, two_factor_enabled, created_at, updated_at); UPDATE (name, email, email_verified, image, updated_at) |
| `public.session` | SELECT; DELETE; INSERT (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id); UPDATE (expires_at, token, updated_at, ip_address, user_agent) |
| `public.account`, `public.verification`, `public.two_factor`, `public.passkey` | SELECT, INSERT, UPDATE, DELETE |
| `app.tx_identity` | SELECT, with `tx_identity_own` extended `TO … poly_auth` |
| `drizzle.__drizzle_migrations` | SELECT |

**Not granted, pinned absent:** `session.recent_auth_at` INSERT or UPDATE (R4); `user.two_factor_enabled` UPDATE and `user.second_step_at` anything but SELECT.

**No tenant reach, reads included (C3, seceng B1).** poly_auth holds **no privilege of any kind, SELECT included**, on any table or view outside the six BetterAuth tables, `app.tx_identity` and `drizzle.__drizzle_migrations`. That covers every tenant table that exists (`entity`, `membership`, `entity_type`, `invitation`, `notification`, `audit_event`) and every one a later migration adds. It also covers `app.email_challenge` and `app.enrolment_grant`. No policy on any of those tables names poly_auth. The catalog test enumerates every table in `public` and `app` and fails on any grant to poly_auth outside the allowed eight, so a new tenant table cannot leak to it by default (default privileges grant nothing to poly_auth).

The reason this is stricter than "no writes": poly_auth must SELECT `session.token`, so SQL as poly_auth can enter as any user who has a live session, with no new session row (R11). That entry must reach no tenant data. **What the definers read on its behalf**, and so all that such an entry yields:
- `enter_new_user`, `claim_invitations`, `accept_invitations`, `provision_person`: they read `user` (signup stamp, email, verified), `invitation` and `entity.self_user_id`. Every one except `claim_invitations` refuses unless the user was created by this transaction, so under an `auth` marker each refuses. `claim_invitations` runs before any marker and matches by the invitation token's hash and email; it returns nothing, and it is the same for poly_auth as it is for poly_app today.
- The POLY-89 readers and writers: they read the marker user's own `second_step_at`, factor rows, challenge and grant rows, and memberships and invitations only to compute `own_person_exempt`. They return a boolean, an emailed code (`issue_email_challenge`), or nothing. None returns a tenant row.
- Test (seceng B3): as poly_auth, read another user's `session.token`, enter with it, then SELECT from each tenant table → permission denied. Also call each granted definer and show that none returns a tenant row.

**EXECUTE**, and nothing else:
- readers: `app.current_user_id()`, `app.current_session_id()`;
- sign-up: `app.enter_new_user(uuid)`, `app.claim_invitations(bytea, text)`, `app.accept_invitations(bytea)`, **`app.provision_person()`** (R3);
- entry: **`app.enter_auth_session(text)`** (R5);
- POLY-89, the set poly_app holds today minus the sign-in gate: `app.step_up_fresh()`, `app.enrol_proof(text)`, `app.enrolment_grant_live()`, `app.check_factor_removal(uuid, text, uuid)`, `app.set_two_factor_enabled(boolean)`, `app.consume_passkey_grant()`, `app.take_recent_auth_stamp(uuid)`, `app.issue_email_challenge(text)`, `app.confirm_email_challenge(text)`.

**Pinned absent EXECUTE:** `enter_asserted_user`, `enter_job`, `has_role`, `visible_entities`, `owner_count`, `second_step_required`, `issue_operator_invitation`, `reset_second_step`, `purge_tx_identity`. And the converse: poly_app and poly_worker never EXECUTE `enter_auth_session` or `provision_person`.

**The test (seceng #16).** A pgTAP file compares poly_auth's privileges with the lists above, both ways: a missing or an extra privilege fails. It reads them twice:
  - granted to the role: `information_schema.role_table_grants`, `role_column_grants`, `routine_privileges`, `pg_policies.roles` and `pg_auth_members`;
  - **effective, which includes what PUBLIC gives**: `has_table_privilege`, `has_column_privilege`, `has_sequence_privilege` and `has_function_privilege` for poly_auth over every relation, sequence and function in `public`, `app` and `drizzle`. It asserts true exactly for the allowed list.

  pg_catalog is out of scope. pgTAP 01 and 03 gain poly_auth. **A build that finds the list short does not add the grant**: it reports the failing statement to me and the ruling is re-issued whole. The read grants the spike needed beyond this list (`entity`, `membership`, `entity_type`, `invitation` SELECT, the `has_role` family) were for the invoker Person insert and `landingEntity`; R3 and R6 remove both from the service (unmeasured that nothing else needs them; the poly_auth run of every auth test is the measurement).

**The sign-up stamp (C2).** `app.stamp_signup_user()` (0007:139) tests `current_user <> 'poly_auth'`. From this migration a poly_app user insert gets a NULL stamp, so poly_app can no longer complete a sign-up (`enter_new_user` refuses it); a test shows that. poly_app also loses EXECUTE on the three sign-up definers in this loop (R8).

## R3. `app.provision_person()` (C3)

- Owner `poly_govern`; SECURITY DEFINER; `SET search_path = ''`; EXECUTE `poly_auth` only. Returns the new Person's `uuid`.
- Refuses (`42501`) unless all hold:
  - `current_query()` is exactly `SELECT app.provision_person()` (the 0011 check);
  - the marker exists, its `kind = 'signup'`, and its user has `signup_txid = pg_current_xact_id()` (a user created by this transaction);
  - that user has no entity with `self_user_id` = them.
- Inserts `(type_id, name, self_user_id)`: the `person` system type, `user.name` or `'Person'`, the marker's user. 0003's `check_entity` and `seat_creator` run as today and seat the owner membership for `app.current_user_id()`.
- Owner grants, added for it alone: `INSERT (type_id, name, self_user_id)` and `SELECT (id, self_user_id)` on `entity`; `SELECT (id, system_key)` on `entity_type`; `SELECT (name)` on `user`; policies `entity_provision_insert FOR INSERT TO poly_govern WITH CHECK (self_user_id = app.current_user_id())` and `entity_provision_read FOR SELECT TO poly_govern USING (self_user_id = app.current_user_id())`, and `entity_type_govern_read FOR SELECT TO poly_govern USING (system_key = 'person')`. A build that needs another owner grant reports it, as in R2.
- `userCreateAfter` calls it in place of `provisionPerson(tx)`, through a tenancy function `provisionOwnPerson(tx)` in `packages/tenancy` (the one file that names the definer). `provisionPerson` stays for web's first-load provisioning in `loadSession`, which runs as poly_app under poly_app's own entity grant (R6); POLY-153 decides whether that call survives.
- Tests: the exact-call refusal; a call under a `web` or `auth` marker refused; a second call in one sign-up refused; a sign-up as poly_auth yields user, Person, owner membership and accepted invitation in one transaction; a forced failure after the Person rolls all of them back.

## R4. `recent_auth_at` (C5)

Stays as POLY-89 R3 #3 ships it: `sessionCreateBefore` returns `recentAuthAt: undefined`, `session_10_recent_auth` stamps only the one enrolment insert, and no login role holds INSERT or UPDATE on the column. Nothing to build; the tests that pin it (the column absent from the INSERT's column list; the first-verify and disable rotations commit) run as poly_auth. A rotated session loses step-up freshness; that cost is accepted (spike §7.4).

## R5. The service's own entry: `app.enter_auth_session(p_token text)` (C4)

- Owner `poly_authz`; SECURITY DEFINER; `SET search_path = ''`; EXECUTE `poly_auth` only. Returns the xid as text, like the other `enter_*`.
- Refuses, in this order, with 0011's codes:
  - not exactly `SELECT app.enter_auth_session($1)` (42501);
  - `p_token` NULL (22004);
  - a marker already present (42501); any earlier write in the transaction (42501);
  - no `session` row with `token = p_token`, `expires_at > now()` and `created_at + interval '30 days' > now()` (42501, one message for all three).
- Writes the marker from that row: `user_id = session.user_id`, `session_id = session.id`, **kind `auth`**.
- Owner grant: `SELECT (id, user_id, token, expires_at, created_at)` on `session`.
- The migration widens `tx_identity`'s kind CHECK to `('web', 'signup', 'auth')` or `system:*`, and `app.audit_membership()` maps `auth` to actor `user` (a first factor seats claimed invitations inside an auth-marked transaction, POLY-89 R3 #12).
- **Wrapper.** `withAuthSession(token, fn)` in `packages/db`, kind `withAuthSession`, exported on `@poly/db/auth` only, on the plain pool (poly_auth in the service). The routing pool treats it as it treats `withTenant`. `handleAuthRequest` calls `withAuthSession(session.session.token, fn)` where it calls `withTenant(...)` today.
- **The token is a credential at the SQL layer.** BetterAuth stores it plain (spike, `pg_dump`). Only poly_auth may call the definer, and poly_auth can already read and write `session`, so it gains nothing; a backup reader without poly_auth's SQL cannot call it. It is not a guard input: per the standing constraint, POLY-89's guards still treat `current_session_id()` as narrowing only (R8).
- **The 30-day cap is in two places** (`recent-auth.ts` and this definer); a test pins them equal.
- Tests (catalog): poly_auth holds no `enter_asserted_user` (seceng #18's shape); poly_app and poly_worker cannot execute `enter_auth_session`; extended-mode only. Behaviour: expired, capped, unknown and NULL tokens each yield no marker; a second entry refused; an entry after a write refused.

## R6. What web does until POLY-153

1. **No BetterAuth, no secret.** `apps/web/src/lib/server/auth.ts` (`startAuth`) is deleted. Web imports only `@poly/auth/web`, which imports neither `better-auth` nor `@poly/db/auth`.
2. **The session lookup is a call to the service (seceng Q1, option c).** Today `loadSession` verifies the signed cookie with the auth secret (`session.ts:61`). From this loop the verification stays with the secret, in the service. Web never parses the cookie or looks a session up by its token. `loadSession` (in `@poly/auth/web`) sends `GET <AUTH_INTERNAL_ORIGIN>/session` with the request's `cookie` header filtered to BetterAuth's cookie names, a 2-second timeout, and nothing else.
   - The endpoint takes **no user id, session id or token parameter**: its only input is the signed cookie. It answers 404 to any other path, method or query string.
   - **Bind.** The listener binds only to the service's address on the web–auth network, or to a Unix socket on a volume that only web and auth mount. It never binds `0.0.0.0` or `::`.
     - That network is `internal: true`. `caddy`, `worker`, `operator`, `migrate` and every staging service are not on it.
     - The listener publishes no `ports:`. The public listener is the only port the service exposes on `edge-prod`.
     - Tests: the bind address in a unit test; network membership and the absence of `ports:` in the rendered compose; and a test through Caddy (`/session`, `/api/auth/../session` and the spike's 9 spellings) that never reaches it. A live probe from the Caddy container is (unmeasured) until the first `docker compose up` (POLY-97).
   - **What a database read of `session.token` buys at web:** nothing over HTTP. The service's `getSession` checks the cookie's HMAC, so a bare or hex token, or a token with a wrong signature, gets `204`. Measured live by backend-lead-152 (`auth.api.getSession` on 1.7.18 against the migrated chain, 2026-11-17): a bare token, an empty signature, a wrong-secret signature and another token's signature each return null, and none deletes or slides the row. A test sends each. With the auth secret as well (code execution in the service), the read becomes a cookie for every live session (SECURITY to state). SQL as poly_app needs no cookie, because it holds `enter_asserted_user` until POLY-149. The service runs, on its plain pool and outside any transaction of ours, exactly today's steps: `auth.api.getSession` (which slides the row), and the 30-day cap check, which deletes a capped row. It answers `200 {userId, sessionId, name, image, expiresAt}` or `204`. It returns no `Set-Cookie` (R7). Web then does what it does today: `provisionPerson` as poly_app on first load, `app.second_step_required()`, the sign-in gate, `withTenant` → `enter_asserted_user`. An unreachable service answers 503, never a redirect to `/sign-in`.
3. **Unchanged in web:** Settings → Sessions (`listMySessions`, `revokeMySession`), the step-up check web makes (`requireRecentAuth`, now a plain poly_app query in `@poly/auth/web`, not the routing pool), the landing entity, and the sign-in and sign-up pages, whose forms post to `/api/auth/*` on the same origin.
4. **This is throwaway.** POLY-153 replaces the call with `app.enter_session(handle)`. It costs about 0.25–0.5 loop-day (guess) inside this loop. The two other ways to keep web working were worse: web keeping BetterAuth and the secret fails C1 and seceng #17, and pulling the handle and `enter_session` forward undoes the split.

## R7. Refresh, and the cookies (C7, C8)

**Ruling. A session cookie lives to the 30-day cap; the row is the 7-day idle bound; nothing needs to re-issue a cookie on refresh.**
- Every `Set-Cookie` of BetterAuth's session token carries `Max-Age` = the seconds from now to `session.created_at + 30 days`, whether BetterAuth sets it at issue or re-issues it. A cookie set without `Max-Age` (`rememberMe: false`, the `dont_remember` case) stays without one. POLY-153's handle cookie follows the same rule.
- The idle bound stays server-side: BetterAuth's `expiresIn` (7 d) and `updateAge` (1 d) slide `session.expires_at` whenever the service validates the session (R6.2 and every `/api/auth` request), and an expired row is refused. That was measured live by backend-lead-152: `getSession` returns null for a row past `expires_at` and deletes it, and a row with 5 days left slides to 7. In POLY-153 `app.enter_session` takes over the slide for page loads: at most once per day, it sets `expires_at = now() + 7 days`.
- **Where.** One plugin, last in `plugins[]`, composed in `apps/auth` (`packages/auth/src/cookie-lifetime.ts`). Its after-hook rewrites the session-token `Set-Cookie`, reading `created_at` from the session it was issued for. This was measured live by backend-lead-152: the hook sees `ctx.context.responseHeaders`, `newSession.session.createdAt` and `authCookies.sessionToken`, and an in-place rewrite reaches the client (`Max-Age=2591999`). Build constraints:
  - **the hook's matcher accepts every path (`() => true`)**, and the path and `newSession` test is made inside the handler. A path-specific matcher makes `widenTwoFactorMatcher` throw at startup. A test pins the matcher shape.
  - the handler does nothing when `newSession` or `responseHeaders` is absent (as on `/get-session` and `/sign-in/magic-link`).
  - POLY-153's handle hook joins the same plugin.
- **Web relays no cookie.** The `setCookie` relay in `hooks.server.ts` is removed.

**Why not seceng's re-issue on refresh (§7.6).** It works only while the service sees the request. In POLY-153's end state page loads reach web alone, and web cannot re-issue a cookie scoped to `/api/auth` whose value it never sees. A daily user who only views pages would then still be signed out on day 7. With the cookie living to the cap, how long the browser keeps it is not the control: the row is. The cost is a dead cookie left in an idle browser until the cap; it reaches nothing, because the row has expired. seceng to confirm at the ruling review.

**The cap's clearing cookie (C7).** `handleAuthRequest`'s cap branch builds the cookie from `c.attributes`: path, `Secure`, `SameSite` and `HttpOnly` as BetterAuth set them, never a literal `Path=/`. This loop keeps BetterAuth's cookie at `Path=/` and its current name. **Cookie scope (seceng #19) lands in POLY-153**, in the same PR as the handle: the `__Secure-` prefix, `Path=/api/auth`, and a test that web never receives a BetterAuth cookie. It cannot land earlier, because web reads that cookie (through R6.2) until the handle replaces it, and `Path=/api/auth` now would sign every user out of web. The seeded e2e `storageState` changes there too. The test configures `Path=/api/auth` through `AuthInput` and shows the clearing cookie carries it.

**Tests (C8).** On a fake clock:
- sign in at day 0: `Max-Age` within 60 s of 30 days;
- a request on day 6 slides `expires_at` to at least day 13, and a page on day 8 answers 200 with no new cookie;
- with no request after day 0, the day-8 page redirects to `/sign-in`;
- a session that is used daily is refused on day 30 and its row is deleted;
- a rotation on day 10 (first TOTP verify) sets `Max-Age` to 30 days from the new row's `created_at`, as BetterAuth stamps it (unmeasured; the test records it);
- `rememberMe: false` sets no `Max-Age`.

## R8. How POLY-89 moves to poly_auth transactions (C9)

- **Guard bodies do not change.** POLY-89 R1.3 made every guard role-indifferent; the catalog test that no POLY-89 body names `poly_app` or `poly_auth` stays.
- **Marker.** Every signed-in `/api/auth` request becomes `BEGIN; SELECT app.enter_auth_session($1); …; COMMIT` as poly_auth, in place of `enter_asserted_user` as poly_app. The guards read `app.current_user_id()` and `app.current_session_id()` from that marker. The session id is now taken from a live row, but **no guard is changed to rely on it**: web's `web` markers still carry an asserted id until POLY-149, and R1.2's rule stands.
- **Definer grants move this loop (seceng Q3).** EXECUTE on the nine POLY-89 functions in R2 is granted to poly_auth and **revoked from poly_app** in the same migration. These are `step_up_fresh`, `enrol_proof`, `enrolment_grant_live`, `check_factor_removal`, `set_two_factor_enabled`, `consume_passkey_grant`, `take_recent_auth_stamp`, `issue_email_challenge` and `confirm_email_challenge`. So are the sign-up three: `enter_new_user`, `claim_invitations` and `accept_invitations`.
  - Web has no caller of any of them once it stops serving `/api/auth/*`: its step-up check reads `session.recent_auth_at` directly (R6.3), and its gate calls only `second_step_required`, which poly_app keeps.
  - Effect on a stolen poly_app password: it can no longer draw an emailed code or flip the factor flag. A direct write to a factor table as poly_app now fails at the guard's helper call, or at the guard, so it fails closed (unmeasured: poly_app's refusal half in R8 measures it).
  - It keeps the unmarked writes the guards allow without a helper (the D1 backup-code copy; failed counts). Those, its BetterAuth table grants and `enter_asserted_user` stay until POLY-149.
  - Test (seceng A3): poly_app's catalog privileges after 0014, compared with before, differ by exactly these twelve EXECUTE removals and nothing else.
  - That web calls none of the twelve is (unmeasured). The measurement is web's full suite and e2e passing at the green sha. A build that finds web needs one reports it and does not re-grant it (R2's rule).
- **Fixtures.**
  - `tests/db/helpers/second-step.ts` stops creating `poly_auth IN ROLE poly_app`; the role comes from `roles.sql` in the harness, with its own password. `helpers/api.ts`'s `DROP ROLE poly_auth` goes.
  - **Positive paths run as poly_auth**, entering by `enter_auth_session` with a seeded session's token.
  - **Refusal paths run as both roles**: poly_auth entering by token, and poly_app entering by `enter_asserted_user`, until POLY-149 removes the poly_app half. For poly_app the expected answer is any `42501`, a permission refusal included. Every refusal test, for either role, also asserts that the row it targeted is unchanged and that no row was added, because a permission error and a guard refusal look the same in the result.
  - R1.2's forge cases change shape for poly_auth: (b), a session with no row, is now refused at entry, and the test asserts that. (a) and (c) enter with another real session's token and must still refuse. The fourth case still passes by design.
  - Every in-process `handleAuthRequest` suite (`tests/db/auth-*`, `second-step-*`) runs its pool as poly_auth. A suite that only passes as poly_app is a red finding for qa, not a test to keep.
- **The sign-in carve-out** (POLY-89 R8 [C-a]: TOTP sign-in, wrong-code lockout, passkey sign-in, backup-code sign-in) runs as poly_auth, inside R9's transaction where R9 says.
- **The operator reset** (R6 of POLY-89) is unchanged: poly_operator, no marker.

## R9. Session-creating paths commit in one transaction (C6)

- These run inside `withSignInTx(fn)`, a context-free transaction of ours (no marker; poly_auth; `@poly/db/auth` only), so every row the request writes commits or rolls back together:
  - `/sign-in/email`, `/magic-link/verify`, `/callback/:id`, `/passkey/verify-authentication`;
  - and `/two-factor/verify-totp`, `/two-factor/verify-backup-code` when the request carries no session: the paths that create the session after a hold. With a session, verify-totp is the enrolment verify and runs in `withAuthSession` (R5).
- The three `USER_INSERTING` routes keep `withContextFreeTx`, which is already one transaction.
- **Commit rule.** The four first-step paths commit only on success, as `inTransaction` does today. The two second-step paths also commit a refusal below 500: the wrong-code count and the lockout must survive a refused code. They roll back on a throw or a 5xx. What a refusal writes was measured live by backend-lead-152 (`log_statement=all`, wrong TOTP and wrong backup code from a held sign-in). In order:
  1. a sweep of expired `verification` rows;
  2. a delete and re-insert of the hold's `verification` row;
  3. last, `UPDATE two_factor SET failed_verification_count = …`.
  - `backup_codes` is untouched on a refused backup code.
  - So the rule commits a refusal whose writes are only to `verification` (poly_auth's full DML, R2) and to `two_factor.failed_verification_count` and `locked_until`.
  - The test runs each refusal with statement logging and fails on a write to any other table or column. A future pin that writes elsewhere then fails the test rather than committing silently.
  - Inside `withSignInTx`, BetterAuth's own BEGIN/COMMIT around the hold-row swap become savepoints (code-read; the routing-pool test covers it).
- **Holds.** A held sign-in creates and deletes its session inside the one transaction (spike: twoFactor's hold deletes the session).
- **Tests.** This loop has no handle table, so the forced failure is a final after-hook in a test plugin, last in `plugins[]`, that throws after the session INSERT. On each of the six paths it leaves no `session` row and sets no cookie. POLY-153 repeats the test with the handle INSERT as the failing write. A refused TOTP code, run five times, still locks the factor.
- **Idle in transaction.** The OAuth callback holds its transaction across the provider's token exchange, as it does today for a first sign-in. SECURITY R-24's idle-in-transaction timeout (POLY-137) bounds it.

## R10. Migration order

1. **`roles.sql`**: `poly_auth` (R2), with CONNECT and USAGE on `public`; idempotent; run by `provision.sh` and the CI harness before `migrate`. pg_hba for the role.
2. **`0014_sign_in_service`** (custom), as `poly_owner`, in this order:
   1. poly_auth's table grants and `drizzle` USAGE and SELECT; `ALTER POLICY tx_identity_own` adding `poly_auth`;
   2. the kind CHECK on `app.tx_identity` (R5);
   3. `CREATE OR REPLACE app.stamp_signup_user()` (poly_auth only);
   4. the owner grants and policies for R3 and R5;
   5. `SET ROLE poly_authz`: `enter_auth_session`; `SET ROLE poly_govern`: `provision_person`, and `audit_membership` with `auth`;
   6. `SET ROLE poly_owner`: EXECUTE grants to poly_auth (R2), with REVOKE FROM PUBLIC first; then the twelve REVOKEs from poly_app (R8).
3. `packages/db/sql/definers.json` lists `enter_auth_session` and `provision_person`.
4. Nothing is deployed, so no data moves. The first staging deploy (POLY-97) runs `roles.sql` before `migrate` as it does today.

## R11. What an attacker reaches at the end of this loop

**As poly_app** (SQL injection in web, the poly_app password, code execution in web): **nearly the same as today.** It can still:
- name any user by `enter_asserted_user` and act as them in every tenant table;
- plant a `verification` row and sign in as anyone through the service's magic link;
- read session tokens and every BetterAuth table;
- make the unmarked factor writes (the D1 backup-code copy).

What changes:
- code execution in web no longer finds the auth secret or the OAuth client secrets, and web no longer holds the mailer key;
- poly_app can no longer finish a sign-up, draw or confirm an emailed code, or flip the factor flag (R2, R8).

**As poly_auth** (SQL injection in the service, its password, code execution in the service):
- BetterAuth's tables: everything poly_app can do on them, which is everything the service does by design. That means create a session for any user, read password hashes, TOTP secrets, backup codes and provider tokens, change a user's email, delete sessions.
- **Tenancy: nothing directly.** It holds no grant or policy on a tenant table. It cannot name a user: `enter_auth_session` needs a live session row. It cannot provision outside a sign-up.
- **Entering as a user it has read** (a live session's token, no new row) is **silent but reaches no tenant data** (R2). It reaches that user's factor state through the POLY-89 definers. Within POLY-89's guards it can, for example, draw an emailed code for a user with no second step and enrol a factor. It could already do the same with its direct DML on the factor tables. The user can see it, as a factor they did not add in Settings.
- **It reaches any user's tenant data only through web.** It must present a signed cookie at web, which needs the auth secret (code execution in the service), or create a session and sign in through the browser path. Either way web then enters as that user by `enter_asserted_user`.

**What makes that visible is weaker than seceng's §7 assumes.** The session row shows in the victim's Sessions list only while it exists, and poly_auth can DELETE it afterwards. Sign-in emails do not exist until POLY-137. No append-only record of session creation exists. See open question 1.

## Not in this loop

- The handle cookie, `app.session_handle`, `app.enter_session`, the `__Secure-` prefix and `Path=/api/auth`, the session definers for Settings → Sessions, and removing `loadSession` and `SessionUserId`: POLY-153.
- Revoking poly_app's grants on BetterAuth's tables and `enter_asserted_user`, and every doc: POLY-149.
- The ARCH lines this loop makes stale: §3.1c (the routing-pool items: which requests run inside, the role BetterAuth runs as), §3.3 (the roles list and the ways into the marker), the `packages/auth` row of §2 and §7's service list. The ruling contradicts none of them as they stand; they are edited at this loop's verdict.

## Open questions (for the lead; none blocks the tests)

1. **A durable record of session creation (Principal).** Today the only trace of a session poly_auth forged is the row it can delete. An AFTER INSERT trigger on `session` owned by `poly_govern` could append to `app.session_event` (user, session id, time, IP, user agent). No login role would hold UPDATE or DELETE on it, and Settings → Sessions would show it later. Day to day it is invisible to users, costs one row per sign-in, and is about 0.5 loop-day (guess). **Recommend: add it to POLY-149**, before the deploy gate lifts. Without it, R-2's residual should say that a forged session can be erased.
2. **Price (lead).** R6.2's interim session call adds about 0.25–0.5 loop-day (guess) to this loop, and POLY-153 throws it away.
3. **Criterion 6's wording (lead).** It names the handle, which this loop does not build. R9 tests the transaction with a test plugin and gives the handle test to POLY-153; POLY-153's criteria should carry it.
4. **Move seceng #19 to POLY-153 (lead).** Cookie scope is on no issue since the split (R7).
5. **The split stands.** Q1 is answered inside this loop by R6.2, with no handle, so there is no need to re-cut POLY-152 and POLY-153.
