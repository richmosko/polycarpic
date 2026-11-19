# POLY-153 — Web enters by handle: security review of the build at `13af0fad` (seceng-153)

**Reviewed:** the gate sha `13af0fad`, with qa's `gate.md` and `red-run.md` (both fix rounds) at `16a2fb5f`, which adds docs only on top. Read against the ruling at `0cd43441`, my `ruling-review.md` §2–§6, the architect's comments on POLY-153.md @ `4008607d`, and my early read of `b0e216cf` (items 7–9).

**Verdict: ACCEPT `13af0fad`.** No blocking finding. Two notes are not blocking (§4). §3 answers the hold question: clearing the cookie is enough, and the stronger option is a filing, not a decision the Principal needs before merge. SECURITY is updated in this loop (§5).

## 1. My own run
| Suite | Command | Result |
|---|---|---|
| the six `session-handle-*` files | `pnpm exec vitest run --config tests/db/vitest.config.ts session-handle` | 6 files, 152 passed, 0 failed |

Everything else I rely on is from qa's gate run (`gate.md`): db 902/902, e2e 57/57 under the R7.4 revoke, and every plant listed there. I re-read each plant's predicate against the ruling. I did not re-run the plants.

## 2. Line by line

### 2.1 Migration `0015_session_handle.sql` against R1–R6 and R11
| Item | Built | Result |
|---|---|---|
| R1 table | PK `session_id` FK `ON DELETE CASCADE`; `handle_hash bytea UNIQUE`, 32-byte CHECK; RLS enabled and forced; `REVOKE ALL FROM PUBLIC`; SELECT and INSERT to poly_authz, with two policies; truncate trigger | **Matches.** No UPDATE or DELETE grant to anyone. Owner poly_owner, under FORCE. |
| R4 kind | CHECK adds `session` | Matches. |
| R2 poly_authz | session SELECT `(recent_auth_at, user_agent, ip_address, updated_at)`, UPDATE `(expires_at, updated_at)`, DELETE; user SELECT `(id, name, image)`; EXECUTE `current_session_id` | **Matches.** No INSERT on session, nothing on a tenant table (pgTAP 10, with plants). |
| R3 `attach_session_handle` | exact call; NULL → 22004; format → 22023; no visible session → false; handle exists → false; insert `sha256(convert_to(…))` | **Matches.** EXECUTE poly_auth only. |
| R4 `enter_session` | exact call `SELECT * FROM app.enter_session($1)`; NULL; marker present; earlier write; format check, then the one lookup joining handle, session and user with expiry and cap; one `no live session` refusal; marker kind `session`; slide after the marker within the cap | **Matches.** EXECUTE poly_app only. A malformed value skips the lookup, which leaks only the public format. §4 N1 is about the slide. |
| R5.2 `session_needs_handle` | definer owned by poly_authz; raises 23514 if the row still exists without a handle; constraint trigger `AFTER INSERT … DEFERRABLE INITIALLY DEFERRED`; poly_owner's temporary EXECUTE revoked at the end | **Matches.** Pinned with drop, disable and immediate plants (pgTAP 10). |
| R6 three definers | each refuses unless the marker's kind is `session`; `my_sessions` returns no token or handle; `revoke_my_session` → P0002 for another user's session, 42501 `step_up_required` without a fresh stamp, DELETE scoped to the marker user | **Matches.** T3 (kinds `web` and `auth` refused) is in `session-handle-definers`. |
| `audit_membership` | maps `session` to `user` | Matches. |
| CREATE on `app` | granted to poly_authz and poly_govern for the file, then revoked | Matches. |

### 2.2 The plugin and the cookies (R3, R5, R8)
- `session-handle.ts`: `randomBytes(32)` as base64url, never derived from the token. The attach statement is the exact text. No request transaction → throw, so the answer is a 500. A false result sets no cookie. Max-Age is copied only from a positive session-token Max-Age. The handle appears only in `Set-Cookie`. **Matches R5.1.**
- Clearing: the handle is cleared whenever the session-token cookie in the same response carries `Max-Age=0`, with no exception for a hold (the architect's correction (a)). The cap branch in `handler.ts` clears both cookies. Tested at `session-handle-paths.test.ts:118-133, :172`.
- `/get-session` never attaches, and it stays `blocked` in `route-policy.ts:60` (the architect's condition).
- A 23514 at COMMIT gives a 500 with a generic body. The log line carries the path, never the handle (T5).
- `options.ts`: `cookiePrefix '__Secure-better-auth'`, `defaultCookieAttributes { secure, sameSite: 'lax', path: '/api/auth', httpOnly }`, `cookieCache` off. **Matches R8.** In Chromium, `handle-cookie.spec.ts` shows that a page request carries the handle and no `better-auth` cookie, and that a hand-planted BetterAuth cookie at `/` does not sign web in.
- `recent-auth.ts`: `requireRecentAuth` is `SELECT app.step_up_fresh()` on the request's own transaction, false without one. It fails closed (R6, service side).

### 2.3 Web (R7)
- `hooks.server.ts` reads only `__Host-poly_handle`. It enters through `withSession` and runs `provisionPerson(tx, row.name)` and the gate in one transaction. On `NoLiveSession` it clears the cookie and answers 303. The 503 branch is gone.
- `provisionPerson` no longer reads `public."user"` (§2.1 of my ruling review, met).
- `withSession` sends the canonical text and maps 42501 to `NoLiveSession`. Settings → Sessions calls the three definers, and revoking the current session clears the cookie.
- eslint refuses `@poly/db/session`, `withTenant`, `sessionUserId`, `better-auth` and `@better-auth/*` in web (fixtures `35-web-handle-entry`). `web-no-betterauth-sql.test.ts` refuses the six table names and `app.session_handle`.
- R9: `apps/auth/src/internal.ts` is gone, and `loadConfig` refuses the three `AUTH_INTERNAL_*` variables (`check.ts:162`). No `web-auth` network or `AUTH_INTERNAL` remains under `infra/` or `apps/` outside tests.

### 2.4 R7.4: the revoke stays in the harness
- The revoke appears only in `apps/web/tests/e2e/serve.ts:70-76`. `tests/ci/e2e-revoke-scope.test.ts` fails if the text appears in a migration, `roles.sql`, `tests/db`, `tests/ci`, `infra` or `.github`, and if the catalog lookup finds 0 or 2 functions or a wrong signature.
- It covers all six tables. `REVOKE ALL ON TABLE` also removes column privileges (PostgreSQL REVOKE docs), so the column grants of 0001 and 0005 go too.
- Nothing in the migrated chain revokes anything. INFRA §7.1 step 16's gate still fails on the real schema (`ruling-review.md` §6). My SECURITY edits say nothing was revoked.

### 2.5 Expectations changed (gate.md's list)
Items 7–9 as in my early read at `b0e216cf`: each matches the ruling and loosens nothing. The one-entry `proconfig` pin I asked for is in, with its plant (pgTAP 10 `not ok 23`). Two more:
- `second-step-gates` N1: poly_app gains the four R2 EXECUTEs.
- `permission-matrix.json`: `app.session_handle` added as unlisted for every runtime role.

Both match R1 and R2.

## 3. The hold question: is clearing the handle cookie enough?

**Yes.** The earlier session's row does not have to die for this loop to be safe. The stronger option is hygiene, which I file (§6, F1).

**What happens.** A is signed in on a shared browser. B starts a sign-in there and stops at the second step. Since `60c2a0bf` the hold clears both of A's cookies, so that browser is signed out of web and of `/api/auth`. A's session row stays in the database until its 7-day idle limit, and A sees it in Settings → Sessions. BetterAuth does not end a browser's earlier session when a new sign-in starts (code-read). The same happens when B's sign-in succeeds: B's handle replaces A's cookie, and A's row stays.

**What an attacker reaches: nothing new.** The leftover row can be used only by someone who already holds a copy of A's handle. A copy can come from code running in web or in the service, or from someone who read the cookie off A's machine earlier. Such a person could use it whether or not B ever signed in. That is the ordinary "a stolen cookie works until the session ends" property, and it is exactly what happens when A closes the browser without signing out. No column stores the handle, and a backup holds only its hash (TB-15). So nothing in the database lets anyone rebuild it.

**The stronger option.** Any sign-in from a browser that already carries a live session cookie ends that earlier session in the same transaction. That deletes the row, and the handle goes with it by cascade. It closes the copied-handle window in the shared-browser case. It costs about a quarter of a loop-day (a guess): a few lines in `handleAuthRequest` on the sign-in paths, plus tests. Daily cost: none. Side effect: signing in again on your own browser also ends your previous session there, which is what a user expects. It needs no ruling change in this loop.

**Recommendation:** merge as built, and file the stronger option on POLY-139 (sign-in and sessions screens), where "sign in as someone else" lives. Plain-language version for the Principal, if the lead wants to relay it: *"When someone else starts signing in on a shared browser, the first person is now signed out of that browser. Their old session still exists on the server for up to 7 days and shows in their Sessions list. Only someone who had already stolen that browser's cookie could use it, the same as if they had just closed the window. We can make a new sign-in end the old session outright, for about a quarter-day of work (a guess). I recommend doing that with the sessions screens rather than now."*

## 4. Notes (not blocking)
- **N1. The slide writes on every page load in a session's last 6 days before the cap.** Once `created_at + 30 days` is within 6 days, `expires_at` is already at the cap and `v_expires <= now() + 6 days` stays true. So each `enter_session` rewrites the same value. This is not a security issue. It costs one row write and its WAL per request for the final 6 days (unmeasured). Fix: also require the new value to be greater than the old one. Owner: backend-lead, any later loop, or POLY-143 if it shows in timing.
- **N2. SECURITY's Open Risks should carry the `__Secure-` sibling-subdomain plant** (spike §7.9) with the Principal as approver. I stated the fact in TB-2 now. The risk row and its approval go with POLY-149's docs.

## 5. SECURITY (1.11.0)
Edited to the current state, with no history:
- **TB-2:** the cookie scope, the handle cookie, when it is set and cleared, `SameSite=Lax`'s condition, and the subdomain plant.
- **TB-15:** now web → Postgres through `app.enter_session`: the stored form, no privileges, the one refusal, kind `session`, the slide, attach only for a new session, the three Sessions definers. The internal listener is gone. The diagram edge is updated to match.
- **C-86:** kind `session`; the `enter_session` definer; "the session id is proof only under kind `session`"; 0015 under "Lives at".
- **R-2:** the `/session` sentences are replaced, in the read-of-tokens item and in the code-execution item. "Target" now names only what POLY-149 removes. R-2's reach for poly_app is unchanged: nothing is retired.
- **§5 `/get-session`:** the stale SvelteKit `handle` and in-process wording is corrected.

## 6. Filings for the lead
- **F1 (POLY-139):** a sign-in from a browser that carries a live session ends that session in the same transaction (§3).
- **F2 (POLY-149):** the Open Risks row for the `__Secure-` sibling-subdomain plant, for the Principal's approval (N2). This is in addition to my ruling-review F1, the sign-in record written in `attach_session_handle`.
