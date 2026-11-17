# POLY-152 — Sign-in service: security review of the ruling at `646e35ed` (seceng; §1–§4 written at `839b99a5`, §5 the delta at `e7a18a51`, §6 the delta at `646e35ed`)

**Reviewed:** `process/cairn/reviews/POLY-152/ruling.md` at `839b99a5` (R0–R11). Read against POLY-152 and its sub-issues, POLY-153, POLY-149, the POLY-148 spike record §1–§7, the POLY-89 ruling R1–R5 and its build review, `infra/compose/{prod,edge,staging}.yml`, `packages/auth/src/{session,options,recent-auth}.ts` and migration 0013. Nothing here was run: the ruling is a design, and each item below is a test qa writes red before the build.

**Verdict at `646e35ed`: ACCEPT.** §5.1's required change is in, and §6 adds two test conditions, neither a ruling change. §2 lists what the tests must cover, as amended by §5 and §6. §3 and §5.4 have the filings for the lead, and §4 a decision for the Principal.

## 1. The four points the lead asked about

### 1.1 R7 refresh: confirmed
**Ruling:** every session cookie lives until the 30-day cap. The session row enforces the 7-day idle limit, and nothing re-issues a cookie. This replaces my spike §7.6 fix, and I agree with the architect's reason. In POLY-153 page loads reach web alone, and web cannot re-issue a cookie it never sees.
- **What a stolen cookie gains: nothing.** `Max-Age` tells the browser how long to keep the cookie. An attacker who holds the value ignores it. What decides whether the value works is the row: `expires_at` (idle) and `created_at + 30 days` (cap). Both are checked server-side in BetterAuth's `getSession`, in R6.2's cap check and in `enter_auth_session` (R5). Today's 7-day `Max-Age` is no limit on a thief either.
- **What changes:** a cookie left in an idle browser stays there for up to 30 days instead of 7. It is dead after 7 idle days because its row has expired, so it reaches nothing.
- **Conditions (tests):**
  - The day-8 idle test must run through **both** doors: web's page load via R6.2's `/session`, and a direct `/api/auth` request. BetterAuth refusing and deleting a row past `expires_at` is (unmeasured), and the whole ruling rests on it.
  - `enter_auth_session` refuses an expired row in SQL, whatever BetterAuth did first.
- **Note, not blocking.** A rotation (first TOTP verify, disable, change password) inserts a new row with a new `created_at`, so the 30-day cap restarts there. Each rotation follows a password or second-factor step, so a restart is a fresh sign-in in substance. R7's rotation test records it. SECURITY then states that the cap is "30 days since the last sign-in or rotation".

### 1.2 R6 the internal `/session` listener: accepted, with tests
- **What it accepts.** Only the request's `cookie` header, filtered to BetterAuth's cookie names. The service does the signature check (`getSession`, with the secret), so the listener answers exactly what the public `/api/auth/get-session` already answers. It takes no user id, no session id and no token outside the signed cookie. **So it is not a new way to name a user.** An attacker who can reach it learns nothing the public route does not already tell them.
- **What it returns:** `{userId, sessionId, name, image, expiresAt}`, never the token, and no `Set-Cookie`.
- **Who can reach it.** Caddy joins `edge-prod` and `edge-staging` (`edge.yml:21`). The service must join `edge-prod` so that Caddy can reach the public port. A listener bound to `0.0.0.0` would then be reachable from Caddy's container by address, even though no Caddy *route* leads to it. Because of the point above this is defence in depth, not a hole. Still, the internal listener binds only to its address on the web–auth network, or to a Unix socket on a volume that only web and auth mount. Either satisfies R1.4.
- **Web, if its code is taken over,** can send any cookie to `/session`. That gives it nothing it does not already have through `enter_asserted_user` until POLY-149. Guessing a token through the listener is impossible: 256 bits, plus an HMAC.
- **Fails closed.** An unreachable service answers 503, never a session (R6.2). A test is required.

### 1.3 My Q3 and "poly_auth reads no tenant table"
- **poly_auth reads no tenant table: yes, as I need it.** R2's table list is "exactly … and nothing on any other table". The #16 test compares the catalog with the list in both directions, so every ledger, entity and invitation table is covered without being named. `has_role`, `visible_entities` and `owner_count` are pinned absent. My draft's B3 attack is closed by this: a token read by poly_auth enters as the victim, but that marker reaches no tenant row.
- **Q3 (POLY-89 writers leave poly_app now): deferral accepted, with one filing.** R8 keeps poly_app's EXECUTE on the nine functions until POLY-149. What that leaves open in between: a stolen poly_app password can name a victim and, within 5 minutes of the victim's own step-up, flip the second factor off. That is POLY-89's C-c case, already stated in R-2. The deferral is acceptable because the deploy gate (DECISIONS 2026-11-16) keeps real household data off any deployment until POLY-149 merges, so the open window holds no one's data. **But POLY-149's revocation criterion today names only BetterAuth's tables and the `enter_*` functions, not these nine** (§3 filing F2). After POLY-153, poly_app should EXECUTE only `second_step_required` and POLY-153's own session definers.

### 1.4 Open question 1: an uneditable record of sign-ins (for the Principal)
Plain-language brief: §4.

## 2. Attack list the tests must cover (qa maps each to a named test)

**Checks #16 to #19**
| # | Check | Where in the ruling | The test |
|---|---|---|---|
| 16 | poly_auth's grants are catalog-exact | R2 | pgTAP, both directions, over table, column, function, policy and role membership. A missing or an extra privilege fails. It includes `pg_auth_members` (poly_auth is in no role) and the role's attributes (NOSUPERUSER … NOBYPASSRLS). |
| 17 | The auth secret is mounted for auth alone | R1.3, R1.4 | Rendered `prod.yml` and `staging.yml`. Only `auth` mounts the auth secret and the OAuth secrets. **Also:** `auth` mounts no database password except poly_auth's, and above all not poly_app's (code execution in the service plus poly_app's password = `enter_asserted_user` = any user, which undoes R5). `loadConfig` refuses `AUTH_SECRET_FILE` and the OAuth files for every service except `auth`. |
| 18 | The entry definer is safe | R5 | For `enter_auth_session`, the full stage-1 set: the exact call passes; `SELECT app.enter_auth_session($1), 1`, the subquery form, the literal form and a superuser `DO … SET LOCAL ROLE poly_auth` form are each refused; a second marker is refused; an entry after a write is refused; poly_app, poly_worker and poly_operator are refused by permission; a two-statement string is refused on **each** of poly_auth's pools (the plain pool and the routing pool). |
| 19 | BetterAuth's cookies are scoped to `/api/auth` and web never receives them | not here (R7) | Moves to POLY-153 with the handle. Filing F1. |

**SQL as poly_app (web): must not widen**
- **A1.** A diff of poly_app's privileges before and after 0014 is empty. In particular, poly_app holds no EXECUTE on `enter_auth_session` or `provision_person`.
- **A2.** The sign-up stamp: a user insert as poly_app gets a NULL stamp, and `enter_new_user` refuses it (R2).
- **A3.** Every existing R-2 test still passes unchanged. That is the "same as today" claim in R11.

**SQL as poly_auth, or its stolen password (the service)**
- **B1.** No tenant reach through a victim's token. As poly_auth: read another user's `session.token`, enter with it, then try `entity`, `membership`, `invitation`, `audit_event` and one ledger table. Each is refused by permission.
- **B2.** No naming a user. `enter_auth_session` with a token that has no row, an expired token, a capped token or NULL: each writes no marker (R5).
- **B3.** `provision_person`:
  - refused under an `auth` marker and a `web` marker;
  - refused for a user not created in this transaction;
  - refused on a second call in one sign-up;
  - refused when not the exact call;
  - no EXECUTE for poly_app or poly_worker.
- **B4.** The POLY-89 refusal paths run as the real poly_auth, which comes from `roles.sql` (the `IN ROLE poly_app` fixture is gone):
  - turning the flag on or off without a grant or a step-up;
  - a write to `recent_auth_at`;
  - a factor marked verified without a grant;
  - deleting the last method;
  - a marked `backup_codes` change without a step-up.
- **B5.** The forge cases through `enter_auth_session` (R8): (b) is refused at entry; (a) and (c) each enter with another real session's token, and every guard still refuses. The fourth case passes by design, and its test is named as passing by design.
- **B6.** `app.email_challenge` and `app.enrolment_grant` are unreadable by poly_auth. Without this, poly_auth could read an emailed code and enrol a factor for a victim.
- **B7.** pg_hba accepts poly_auth only by scram, and only from the app network.

**A read of the auth secret**
- **D1.** `cookieCache` stays `enabled: false` (`options.ts:82`), and a test pins it. With the cache on, the secret alone forges a `session_data` cookie that BetterAuth trusts without reading the database.
- **D2.** Neither the secret nor a session token appears in the service's log or error output: run the existing canary log test with the `auth` service added.

**The routes and the internal listener**
- **E1.** Through Caddy, `/session`, `/api/session`, `/api/auth/../session` and the spike's 9 spellings never reach the internal listener.
- **E2.** The internal listener binds to its address on the web–auth network or to a socket, not `0.0.0.0` (unit test on the configured bind address). The rendered compose shows that `caddy` and `worker` are not on that network and that it publishes no `ports:`.
- **E3.** The listener answers 204 to each of these:
  - no cookie;
  - a cookie with a valid token and a bad signature;
  - an unsigned raw token;
  - extra headers such as `x-user-id`, and any query string, which change nothing.
  The 200 body has exactly the five keys and never the token, and the listener sets no `Set-Cookie`. Any other path or method answers 404.
- **E4.** Web, reached directly (Caddy bypassed), answers 404 on `/api/auth/*`. Nothing under `apps/web` resolves `better-auth` or `@poly/auth` (R1.8).
- **E5.** When the service is down, a web page answers 503 and grants no session.

**Commit together, the cap, refresh**
- **F1.** R9's forced failure on all six paths leaves no `session` row and sets no cookie. Five refused codes still lock the factor.
- **F2.** The cap's clearing cookie carries the path it was set with (R7).
- **F3.** R7's six clock tests. The day-8 idle test runs through both doors (§1.1).

## 3. Filings for the lead (no ruling change)
- **F1. Seceng #19 on POLY-153: placed at `8129f982`.** POLY-153 now carries cookie scope (#19), the handle half of the commit-together test and the removal of the interim `/session` call. Nothing left to file.
- **F2. POLY-149's revocation criterion must name the POLY-89 functions.** poly_app's EXECUTE on the nine functions R2 grants to poly_auth leaves. After POLY-153, poly_app keeps only `second_step_required` and POLY-153's session definers. The catalog test pins that set.
- **F3. SECURITY R-24 now covers every OAuth callback**, not only a first sign-in, because R9 holds the transaction across the provider exchange on every callback. The idle-in-transaction timeout and the rate limit on POLY-137 are the bound; POLY-137's text should say "every callback". I will check R-24's wording at the build review.

## 4. Brief for the Principal: a sign-in record nobody can erase (architect's open question 1)

**What goes wrong.** The sign-in service is the part of the app that decides who is signed in. Suppose someone breaks into it, by a software bug or by stealing its database password. They can sign in as any family member, look at that person's finances, and then delete the sign-in. Afterwards nothing shows it happened: the person's "Your sessions" list is clean, and the sign-in emails that would warn them do not exist yet (POLY-137). Reading data leaves no other trace, so a quiet snoop leaves nothing behind.

**The options.**
- **(a) Accept it and say so.** Costs nothing to build. Our security document states that a break-in to the sign-in service can be erased. Day to day nothing changes. If it ever happens, you would not know.
- **(b) Keep a sign-in record that the sign-in service cannot edit or delete.** The database itself writes one line for every new sign-in: who, when, from which address and browser. The sign-in service can add lines but not change or remove them. About half a day of work (the architect's guess). Day to day you see nothing; it costs one small row per sign-in. A later Settings screen can show the history. Its limits:
  - Someone who steals the sign-in service's master key *and* reuses a session that is already open creates no new sign-in, so no new line appears.
  - Someone with full control of the database server itself could still erase it.
- **(c) Copy the record off the server as well** (for example, to the backup storage). That protects against the database-server case too, but needs log shipping that doesn't exist yet. More than a day; not priced.

**Recommendation: (b), added to POLY-149, so that it is in place before any real household data is deployed.** It turns "no trace" into "a trace the attacker cannot remove" in most cases, for half a day of work and no daily cost. Revisit (c) when off-site logging arrives.

Refs: ruling.md R11 and open question 1 @ 839b99a5; SECURITY R-2; POLY-137 (sign-in emails); POLY-149; DECISIONS 2026-11-16 (deploy gate).

## 5. Delta at `e7a18a51`

Read: `git diff 839b99a5 e7a18a51 -- process/cairn/reviews/POLY-152/ruling.md` (R0, R2, R6.2, R7, R8, R10, R11 and open questions 4–5), plus `packages/db/sql/roles.sql:86-88` for the default privileges. The lead's four asks, against this sha:

| Ask | At `e7a18a51` | Result |
|---|---|---|
| 1. R7 refresh | Unchanged apart from the #19 sentence | **Confirmed**, as in §1.1, with the same conditions |
| 2. R6.2 the listener | Its contract is stated: the signed cookie is the only input; 404 to anything else; a bare, hex or wrongly signed token gets 204 | **The contract is accepted.** The bind is not stated (§5.1): **required change** |
| 3. Q3 and the tenant reads | R8 revokes the nine POLY-89 EXECUTEs and the three sign-up definers from poly_app in 0014. R2: no privilege of any kind, SELECT included, outside the allowed eight | **Both are in, as I need them** |
| 4. The sign-in record | Open question 1 unchanged | §4 stands: recommend (b) on POLY-149 |

### 5.1 Required: state where the internal listener listens (R6.2)
R6.2 says the listener is "reachable only on the network web and auth share" and that Caddy has no *route* to it. Neither sentence says what the listener binds to.
- **Why it matters.** Caddy sits on `edge-prod` and `edge-staging` (`edge.yml:21`). The service must join `edge-prod` so that Caddy can reach its public port. A listener on `0.0.0.0` is then reachable by address from Caddy's container, and from anything else that ever joins `edge-prod`, whatever Caddy's routes say.
- **Not a hole today.** The contract above makes the listener equal to the public `get-session`, so what it reaches is the same. But the ruling relies on reachability ("reachable only on"), and that claim is untrue unless the bind makes it true.
- **The addendum (one or two lines):**
  - the internal listener binds only to the service's address on the web–auth network, or to a Unix socket on a volume that only web and auth mount; never `0.0.0.0` or `::`;
  - that network is `internal: true`, and `caddy`, `worker`, `operator`, `migrate` and every staging service are not on it;
  - it publishes no `ports:`.
- **Tests:** §2 E2, as written there (the bind address in a unit test; network membership and no `ports:` in the rendered compose). A live probe from the Caddy container waits on the first `docker compose up` (POLY-97); until then that half is (unmeasured).

### 5.2 New in R8: the twelve revocations, checked
- **What a stolen poly_app password loses:** drawing or confirming an emailed code; flipping the second factor (its UPDATE column grant was never poly_app's, and the definer is now gone); finishing a sign-up. My §1.3 C-c case (flipping the factor off within 5 minutes of the victim's step-up) is closed for poly_app.
- **What it keeps, correctly stated in R11:** `enter_asserted_user`, BetterAuth's tables, and the unmarked factor writes, the D1 backup-code copy among them, until POLY-149.
- **Fails closed, with one condition for the tests.** The guard triggers are invokers, so a guard that calls a helper (`check_factor_removal`, `take_recent_auth_stamp`, `consume_passkey_grant`) now raises "permission denied" for poly_app. R8 accepts any `42501`. Each refusal test must also assert that nothing was written, not only the error code: a permission error and a guard refusal look the same in the result, and only the unchanged row proves the write failed.
- **Unmeasured (R8 says so):** that web calls none of the twelve. The measurement is that web's whole test suite and e2e pass at the green sha with the revocations in place. If anything in web needs one, the build reports it and does not re-grant it (R2's rule applies to poly_app too).
- **§2 A1 changes:** the before/after diff of poly_app's privileges shows exactly the twelve EXECUTE removals and nothing else (R8's test), not an empty diff.

### 5.3 New in R2: no reads outside the eight, checked
- **Accepted.** The ruling also lists what each definer granted to poly_auth reads on its behalf. None returns a tenant row; under an `auth` marker every sign-up definer except `claim_invitations` refuses. That is the §2 B1 test, and R2 now names it.
- **One condition on how the #16 test reads the catalog.** `information_schema.role_table_grants` and `routine_privileges` list grants made *to the role*. They do not show what poly_auth gets through `PUBLIC`. `roles.sql:86-88` revokes PUBLIC's EXECUTE on functions created by eight owner roles, but not on functions created by any other role, and not on what extensions create. So the test also runs `has_table_privilege('poly_auth', …)`, `has_column_privilege`, `has_sequence_privilege` and `has_function_privilege` over every relation, sequence and function in `public`, `app` and `drizzle`, and asserts true exactly for the allowed list. That way a grant through PUBLIC also fails CI. pg_catalog is out of scope; the stage-1 revoke of the 17 functions that run a SQL string already covers its dangerous part.
- **Non-blocking:** R11 says that poly_auth entering as a victim it has read can draw a code and enrol a factor for a user who has no second step. That is visible to the user (a factor they did not add appears in Settings), and poly_auth could already do it through its direct DML. SECURITY's R-2 residual for the sign-in service should say it.

### 5.4 Filings, updated
- **F1:** done at `8129f982` (see §3).
- **F2 is narrowed.** The nine leave poly_app in this loop. Left for POLY-149: its revocation criterion names BetterAuth's tables and the `enter_*` functions. Its catalog test should pin poly_app's **complete** EXECUTE set after the revocation, not only the `enter_*`: `second_step_required`, POLY-153's session definers, and whatever web still needs by then. Then no grant is left behind by default. One line on POLY-149.
- **F3:** unchanged (R-24 covers every OAuth callback; R9 is unchanged).
- **New, for SECURITY at this loop's docs (POLY-149):** R6.2's own sentence — a database read of session tokens plus the auth secret (code execution in the service) gives a working cookie for every live session.

## 6. Delta at `646e35ed`

Read: `git diff e7a18a51 646e35ed -- process/cairn/reviews/POLY-152/ruling.md` (Basis, R2, R6.2, R7, R8, R9, R11). The four measured claims are backend-lead-152's live runs, as cited in the ruling's Basis. I did not re-run them. Each is re-measured by qa's tests and by my build review.

| Change | Result |
|---|---|
| R6.2 bind and internal network (§5.1) | **In, as required:** the web–auth address or a socket, never `0.0.0.0` or `::`; `internal: true`; no `caddy`, `worker`, `operator`, `migrate` or staging service on it; no `ports:`. The probe from the Caddy container stays (unmeasured) until POLY-97, as stated. |
| R6.2 bare or wrongly signed token | Measured: each returns null, and none deletes or slides the row. That closes my draft's B4 at the HTTP layer. |
| R2 #16 effective privileges | **In, as §5.3 asked.** |
| R7 expired row measured; match-all matcher | The expired-row claim my §1.1 rested on is now measured. The matcher is not a security change. The handler must set no cookie when `newSession` is absent, and R7 states that. Condition: the matcher-shape test also asserts that no `Set-Cookie` is added on `/get-session`. |
| R8 refusals assert nothing written; the diff is exactly the twelve | **In, as §5.2 asked.** |
| R11 the factor a user did not add is visible | In. |
| R9 refusal write set | Ruled on below. |

### 6.1 R9: a refused code may commit writes to `verification`. Safe, with one test condition.
- **What is written (measured):**
  - a sweep that deletes expired `verification` rows;
  - a delete and re-insert of the hold's own `verification` row (the row that ties the `two_factor` cookie to the held user);
  - then the failed-attempt count on `two_factor`.
- **Why committing it is safe:**
  - The sweep removes only rows that are already dead. Each one was refused at use anyway.
  - The hold row grants nothing on its own. It only says that "this cookie may try a second-step code for this user". If the re-insert refreshes its expiry, each wrong code keeps the hold alive a little longer. That buys no extra guesses, because the attempt count and `locked_until` cap them, and both commit on the same refusal. The person holding that cookie already passed the password step, and could start a new hold by signing in again.
  - So committing these writes adds nothing an attacker can use. Rolling them back would be worse: it would also roll back the attempt count, and that count is the brute-force limit.
- **What must not happen, and is not covered by "writes to `verification` only":**
  - a refusal re-points the hold to another user;
  - a refusal leaves an extra verification row behind, such as a magic-link token.
  - R2's full DML on `verification` would allow either one, and the table-and-column filter in the R9 test would pass both.
- **Test condition (qa; not a ruling change):** after each refused code, on both paths:
  - the hold row keeps the same `identifier` and the same `value` (the user);
  - its `expires_at` is no later than the hold's lifetime from the original sign-in, or the test records how far it moves;
  - no other `verification` row is inserted;
  - every `verification` row deleted had `expires_at < now()`, except the hold row it re-inserts.
  - A fifth refusal sets `locked_until`, and the hold row's survival lets no sixth attempt be checked.
- **Code-read, left to the build review:** BetterAuth's inner BEGIN/COMMIT around the hold-row swap become savepoints inside `withSignInTx`. If one of them did a real COMMIT, the outer transaction's "roll back on a 5xx" would no longer cover the earlier writes. The routing-pool test covers this, and I will check it at the build.

### 6.2 Filings
F2 is on POLY-149 and F3 on POLY-137 (lead, `de945456`). Nothing new to file.
