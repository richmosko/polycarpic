# POLY-152 — test plan (qa-engineer)

Written against `ruling.md` @ 646e35ed (R0–R11) and `ruling-review.md` §2, §5.2, §5.3, §6. C1–C9 are POLY-152's criteria in order; #16–#19 and A/B/D/E/F are seceng's attack items. A row names the test and the file; "red because" is the reason it fails today (checked when the red run is recorded in `red-run.md`).

## Conventions (seceng's conditions, applied everywhere)

- **Refusal tests assert the row**: each captures the target row (or the table's row count / `xmin`) before and after, and checks it unchanged, as well as the error code (a permission error and a guard refusal are both `42501`). Helper: `expectRefusedUnchanged` in `tests/db/helpers/second-step.ts`.
- **Refusals run as both roles** (poly_auth by token, poly_app by `enter_asserted_user`; poly_app expects any `42501`), positives as poly_auth only (R8).
- **Real role.** The `poly_auth IN ROLE poly_app` fixture (`createAuthRole`/`dropAuthRole`, `api.ts`'s `DROP ROLE poly_auth`) is deleted. `poly_auth` comes from `roles.sql`; its harness password is set in `setRolePasswords` (`LOGIN` gains it). Every in-process `handleAuthRequest` suite builds its pool with `configure({ auth: dbEnv('poly_auth', db) })` (ASSUMED key name; reconciled in `tests/db/helpers/auth.ts` only).
- SERIAL: the two second-step files leave SERIAL (no cluster-wide fixture left); `vitest.config.ts` SERIAL list and `tests/ci/db-areas.test.ts` follow.
- New `tests/db` files are added to `DB_AREAS.auth` (`infra/ci/changes.mjs`) and to `TABLE` in `tests/ci/db-areas.test.ts`.

## Criteria

| C | Test (name) | File | Red because |
|---|---|---|---|
| C1 service + mounts | `rendered compose: only auth mounts AUTH_SECRET_FILE / OAUTH_* / poly_auth's password; auth mounts no other db password (#17)` | `tests/infra/auth-service.test.ts` | no `auth` service in `prod.yml`/`staging.yml` |
| C1 | `loadConfig refuses AUTH_SECRET_FILE and OAUTH_*_SECRET_FILE for web, worker, operator, migrate; auth requires them; RESEND_API_KEY_FILE for auth and worker, forbidden for web` | `packages/config/src/auth-service.test.ts` | no `auth` service in the registry |
| C1 | `Caddyfile routes /api/auth and /api/auth/* to auth, nothing else; no route to the internal port; the 9 spellings of /session never match` (E1) | `tests/infra/auth-service.test.ts` | no `@auth` matcher |
| C1 | `web answers 404 to /api/auth and /api/auth/* , listed or not, Caddy bypassed (E4)` | `apps/web/src/hooks.server.test.ts` | web serves the tree today |
| C1 | `nothing under apps/web resolves better-auth, @better-auth/*, @poly/auth root; layers.json has auth-app and auth/web subpath` (R1.8) | `tests/layers/auth-service.test.ts` | layers lack `auth-app` |
| C1 | `polycarpic auth exits non-zero unless current_user = poly_auth / AUTH_SECRET_FILE reads / migrations at head` (R1.2) | `tests/db/auth-service-main.test.ts` | `apps/auth` absent |
| C1 | `public listener serves only handleAuthRequest, other paths 404; internal listener serves only GET /session` | `tests/db/auth-service-main.test.ts` | same |
| C1 (E2) | `internal listener's bind is the service address or a unix socket, never 0.0.0.0 / ::` ; `rendered compose: web–auth network internal:true, caddy/worker/operator/migrate/staging not on it, auth publishes no ports:` | `apps/auth/src/bind.test.ts`; `tests/infra/auth-service.test.ts` | no module / no service |
| C2 grants catalog-exact (#16) | `poly_auth's granted privileges equal the R2 list, both ways: role_table_grants, role_column_grants, routine_privileges, pg_policies.roles, pg_auth_members; attributes NOSUPERUSER…NOBYPASSRLS; in no role` | `tests/db/pgtap/08_poly_auth_grants.sql` | role absent |
| C2 (#16 effective) | `effective privileges over public, app, drizzle: has_table/column/sequence/function_privilege true exactly for the allowed list; a probe grant through PUBLIC is caught` | same | role absent |
| C2 | `no privilege of any kind, SELECT included, on any table or view outside the allowed eight (enumerates all of public and app); email_challenge and enrolment_grant unreadable (B6); no policy names poly_auth beyond tx_identity_own` | same | role absent |
| C2 | `pinned absent EXECUTE: enter_asserted_user, enter_job, has_role, visible_entities, owner_count, second_step_required, issue_operator_invitation, reset_second_step, purge_tx_identity; poly_app and poly_worker cannot execute enter_auth_session or provision_person` | same | role absent |
| C2 | pgTAP 01 (roles) and 03 (hygiene) gain poly_auth: five login roles, attributes, no membership, plpgsql USAGE absent | `tests/db/pgtap/01_roles.sql`, `03_role_hygiene.sql` | role absent |
| C2 (B7) | `pg_hba: poly_auth scram only, from the app network only` | `tests/infra/auth-service.test.ts` (reads `infra/postgres` hba) | no line |
| C2 (A1, §5.2) | `poly_app's privilege set after 0014 differs from before by exactly the twelve EXECUTE removals (snapshot taken from the 0013 chain)` | `tests/db/auth-service-grants.test.ts` | nothing removed |
| C2 (A2) | `a user INSERT as poly_app stamps NULL; enter_new_user refuses it; as poly_auth the stamp is set` | `tests/db/auth-service-grants.test.ts` | stamp names poly_app |
| C3 provision_person (B3) | `exact-call refusal; refused under web and auth markers; refused for a user not created by this transaction; second call refused; refused when not the exact call; no EXECUTE for poly_app/poly_worker; poly_auth holds no INSERT on entity, no policy on entity/membership/entity_type/invitation` — each asserting entity and membership counts unchanged | `tests/db/auth-provision-person.test.ts` | no definer |
| C3 | `sign-up as poly_auth yields user + Person + owner membership + accepted invitation in one transaction; a forced failure after the Person rolls all back` | `tests/db/auth-provision-person.test.ts` | runs as poly_app |
| C3 (B1) | `as poly_auth: read another user's session.token, enter with it, SELECT each of entity, membership, invitation, audit_event, notification, entity_type, one ledger table → 42501; call each granted definer, none returns a tenant row` | `tests/db/auth-service-tenant-reach.test.ts` | role absent |
| C4 enter_auth_session (#18, B2) | `exact call passes; ", 1" form, subquery form, literal form, superuser DO … SET LOCAL ROLE form each refused; second marker refused; entry after a write refused; NULL / unknown / expired / capped token each write no marker; two-statement string refused on poly_auth's plain pool and routing pool; poly_app, poly_worker, poly_operator refused by permission; kind CHECK accepts 'auth'; audit_membership maps auth→user` | `tests/db/auth-enter-session.test.ts` | no definer |
| C4 | `poly_auth holds no enter_asserted_user (catalog)` | `tests/db/pgtap/08_poly_auth_grants.sql` | role absent |
| C4 | `30-day cap constant in recent-auth.ts equals the definer's interval` | `tests/db/auth-enter-session.test.ts` | no definer |
| C4 | `withAuthSession(token, fn): kind withAuthSession, exported on @poly/db/auth only, routing pool treats it as withTenant; handleAuthRequest enters by it` | `tests/db/auth-routing-pool.test.ts` (extended), `tests/layers/auth-service.test.ts` | no wrapper |
| C5 recent_auth_at | `sessionCreateBefore returns recentAuthAt undefined; no login role has INSERT/UPDATE on the column; the first-verify and disable rotations commit` — as poly_auth | `tests/db/second-step-gates.test.ts` (retargeted), `tests/db/auth-session.test.ts` | runs as fixture role |
| C6 one transaction (F1) | `test plugin throws after the session INSERT, last in plugins[]: on each of the six paths no session row, no Set-Cookie` | `tests/db/auth-signin-tx.test.ts` | no `withSignInTx` |
| C6 | `a refused TOTP / backup code five times still locks the factor` (both paths) | `tests/db/auth-signin-tx.test.ts` | rolled back today under withSignInTx contract |
| C6 (§6.1) | `after each refused code, on both paths: hold row keeps identifier and value; expires_at no later than the original hold lifetime (else recorded); no other verification row added; every deleted verification row had expires_at < now() except the hold; backup_codes untouched; 6th attempt fails after the lock` | `tests/db/auth-signin-tx.test.ts` | same |
| C6 | `a refusal's statement log (log_statement=all) shows writes only to verification and two_factor.failed_verification_count/locked_until` | `tests/db/auth-signin-tx.test.ts` | same |
| C6 | `held sign-in creates and deletes its session inside the one transaction; a 5xx rolls back the whole request` | `tests/db/auth-signin-tx.test.ts` | same |
| C7 cap cookie | `the cap's clearing cookie carries the Path/Secure/SameSite/HttpOnly BetterAuth set; with Path=/api/auth configured through AuthInput it carries that path, never a literal Path=/` (F2) | `tests/db/auth-session.test.ts` | handler hardcodes `Path=/` |
| C8 refresh (F3) | clock tests: day 0 Max-Age within 60 s of 30 d; day 6 request slides expires_at to ≥ day 13; day-8 page 200 with no new cookie; no request after day 0 → day-8 page redirects; daily-use session refused on day 30 and row deleted; day-10 rotation Max-Age from new created_at (recorded); `rememberMe:false` no Max-Age | `tests/db/auth-refresh.test.ts` | cookie is 7 d |
| C8 (§1.1) | `day-8 idle through BOTH doors: the internal /session and a direct /api/auth request; expired row refused and deleted; enter_auth_session refuses an expired row in SQL regardless` | `tests/db/auth-refresh.test.ts`, `tests/db/auth-enter-session.test.ts` | no service |
| C8 | `cookie-lifetime plugin: last in plugins[], matcher accepts every path (() => true), no-op when newSession/responseHeaders absent, no Set-Cookie added on /get-session` | `packages/auth/src/cookie-lifetime.test.ts` | no plugin |
| C8 | `web relays no cookie (setCookie relay removed)` | `apps/web/src/hooks.server.test.ts` | relay present |
| C9 existing suites as poly_auth | the nine `auth-*` and four `second-step-*` suites change role: pool from poly_auth, fixtures marker via `enter_auth_session`; the fixture role and its SERIAL entries are gone | `tests/db/*.test.ts`, `tests/db/helpers/{api,auth,second-step}.ts`, `vitest.config.ts` | poly_auth not in roles.sql |
| C9 (B4) | refusal paths as the real role, both roles, row unchanged: flag on/off without grant or step-up; write to recent_auth_at; factor verified without grant; delete last method; marked backup_codes change without step-up | `tests/db/second-step-gates.test.ts` | as above |
| C9 (B5) | forge cases: (b) no-row session refused at entry; (a), (c) real other token still refused by every guard; (d) passes by design, named so | `tests/db/second-step-gates.test.ts` | as above |
| C9 | poly_app's refusal half of R8: a guard calling a helper raises 42501 for poly_app, row unchanged; poly_app still holds `second_step_required` | `tests/db/second-step-gates.test.ts` | helpers still executable |
| C9 | web's full suite and e2e pass at the green sha (R8 unmeasured claim) | `apps/web` vitest + e2e at gate 3 | gate-3 run |

## Remaining attack-list items

| Item | Test | File |
|---|---|---|
| #19 | not this loop (POLY-153, `8129f982`) | — |
| A3 | every pre-existing R-2 test (`identity-marker`, `second-step-*` poly_app halves) passes unchanged | existing files |
| D1 | `cookieCache.enabled === false` pinned | `packages/auth/src/options.test.ts` |
| D2 | canary: neither the secret nor a session token appears in the auth service's log or error output; `auth` added to the canary list | `packages/config/src/log-seceng.test.ts`, `tests/db/auth-service-main.test.ts` |
| E1 | Caddy matcher over `/session`, `/api/session`, `/api/auth/../session` and the spike's 9 spellings never resolves to the internal listener | `tests/infra/auth-service.test.ts` |
| E3 | internal listener: 204 for no cookie, valid token + bad signature, bare token, hex token, empty signature, another token's signature; extra headers (`x-user-id`) and any query string change nothing; 200 body has exactly `userId, sessionId, name, image, expiresAt`, no token; no Set-Cookie; any other path or method 404; bad-signature requests neither delete nor slide the row | `tests/db/auth-internal-session.test.ts` |
| E5 | service down → web `loadSession` answers 503, never a session, never a redirect | `packages/auth/src/web.test.ts` |
| R6.2 | `@poly/auth/web` imports neither better-auth nor `@poly/db/auth`; sends only the filtered cookie, 2 s timeout | `packages/auth/src/web.test.ts`, `tests/layers/auth-service.test.ts` |
| R7 e2e | sign-up, sign-in, second-step flows through the service (Vite proxy, `serve.ts` starts auth first) | `apps/web/tests/e2e/*.spec.ts` (existing, run at gate 3) |
| R10 | `definers.json` lists `enter_auth_session`, `provision_person`; REVOKE FROM PUBLIC before GRANT; migration 0014 applies on the 0013 chain | `tests/db/auth-service-grants.test.ts`, existing `tests/db/matrix.test.ts` |

## Not testable before the build / unmeasured (recorded, not dropped)

- A live probe from the Caddy container to the internal port: waits for POLY-97 (ruling).
- Rotation `Max-Age` (day 10): the test records the value.
- "Nothing beyond the R2 list is needed": the poly_auth run of every auth test is the measurement.
- Contract names the tests assume and `tests/db/helpers` isolates: `configure({ auth })`, `withAuthSession`/`withSignInTx` on `@poly/db/auth`, `apps/auth/src/{main,bind}.ts`, `packages/auth/src/{cookie-lifetime,web}.ts`. A name that differs changes only the helper.

## As built (addendum at the gate; the plan above is the intent, this is the file list)

Added to the plan since it was written, each with its file:

| Item | Test | File |
|---|---|---|
| Transitive web boundary (architect c36bf83e) | scan from every web file and `packages/auth/src/web.ts` for `better-auth`, `@better-auth/*`, `@poly/db/auth` and any auth file outside `web*`; shown to fail on 7 planted imports and on a two-hop plant in the real tree | `tests/layers/auth-service.test.ts` |
| Service startup and listeners | `startAuthService`: both listeners, path limits, three startup refusals, secret absent from logs (D2) | `tests/db/auth-service-main.test.ts` |
| poly_govern's grants (architect 9f6dd25a, seceng §7) | exact column and policy pin on `user`, `entity`, `entity_type`, with 8 planted-change proofs | `tests/db/pgtap/09_poly_govern_grants.sql`, `tests/db/pgtap.test.ts` |
| poly_auth grant pin shown to bite | 8 planted grants fail 08; clean control | `tests/db/pgtap.test.ts` |
| Layer checker and names (architect f16e92d1) | subpath-only allow cases; web lint fixtures; names read from layers.json | `tests/layers/check.test.ts`, `fixtures/34-web-auth-subpath/`, `tests/layers/relative-structure.test.ts` |
| Lockout (seceng §8, §9; architect 322c6174) | 9 refusals no lock, 10th locks 900 s ± 60, 11th with the right code refused; per-hold cap of 5; the 6th answer's write set and commit; counter-only-goes-up; lapse resets the count (recorded) | `tests/db/auth-signin-tx.test.ts` |
| TOTP window (seceng) | t ± 30 s accepted, t ± 60 s and t ± 90 s refused; clock controlled | `tests/db/auth-signin-tx.test.ts` |
| e2e with the service up | seed signs in through a repo helper; `apps/auth` started before `vite preview` | `apps/web/tests/e2e/serve.ts`, `tests/db/helpers/e2e-auth.ts` |
| Web, config, bind, cookie-lifetime, web client | unit suites | `apps/web/src/hooks.server.*.test.ts`, `packages/config/src/auth-service.test.ts`, `apps/auth/src/bind.test.ts`, `packages/auth/src/{cookie-lifetime,web}.test.ts` |

Written differently from the plan: D2 (secret not in the service's log) is in `auth-service-main`, not the config canary file. Seceng #19 stays with POLY-153.
