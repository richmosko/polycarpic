# POLY-153 — Web enters by handle: verdict (architect)

**Gate sha:** `13af0fad`. Read against the ruling at `0cd43441`, with my confirmations on POLY-153 of qa's red-run calls (`1c317102`) and of the build's judgment calls (`4008607d`, where (a) went back to R5.1). Everything after `13af0fad` up to this verdict is docs and issue files only (`git diff --stat 13af0fad HEAD`: ARCH, SECURITY, six issue files, `gate.md`, `build-review.md`).

**Verdict: APPROVE.** No blocking finding.

## 1. The six criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| C1 | `enter_session(handle)` hashes in Postgres; a stored hash is refused; it refuses a second marker, poly_worker cannot run it, and extended mode covers poly_auth's pools | PASS | `session-handle-enter` (the stored hash as bytea, `\x…`, hex and base64url; the token; the id: one refusal, no marker); pgTAP 10 (one overload, EXECUTE poly_app only, plants biting: `gate.md`). Read by me: 0015 `enter_session` hashes with `sha256(convert_to(...))`, refuses with one message, marks kind `session`, slides after the marker |
| C2 | No column equals a live handle; deleting a session kills its handle in that transaction | PASS | `session-handle-enter` (a per-row text scan of `public` and `app`); the cascade is tested on sign-out, revoke, rotation and the cap. Read by me: the FK is `ON DELETE CASCADE` |
| C3 | Sessions, revoke and step-up are definers on the marker's session; `loadSession` and `SessionUserId` are out of web | PASS | `session-handle-definers` (T3: kinds `web` and `auth` refused); eslint fixtures `35-web-handle-entry`; `web-no-betterauth-sql`. Read by me: `web.ts` and `web/sessions.ts` use only `withSession`; `requireRecentAuth` calls `app.step_up_fresh()` on the request's transaction |
| C4 | BetterAuth's cookies are `__Secure-` with `Path=/api/auth`; the handle is `__Host-` with `Path=/`; web never receives BetterAuth's cookies | PASS | `session-handle-paths` (every Set-Cookie on the paths); e2e Chromium `handle-cookie.spec`, run under the R7.4 revoke. Read by me: `options.ts:120–122` |
| C5 | Session and handle commit together on the four no-session paths; a forced handle-INSERT failure leaves no session | PASS | `session-handle-signin` (a raising trigger and a skipping one, on email, magic link, callback, passkey and sign-up: 5xx, no cookie, no row); pgTAP 10 pins the deferred trigger, with plants for dropped, disabled and immediate |
| C6 | The interim `/session` call is removed | PASS | Read by me: no `AUTH_INTERNAL_*`, `web-auth`, `handleSessionRequest` or `loadSessionFromService` in `apps`, `packages/auth`, `packages/config/src` or `infra/compose` at the gate sha, except `check.ts:162`, which refuses the three variables |

Counts from qa's clean-tree run at `13af0fad` (`gate.md`): db 902/0/0; e2e 57/0/0 under the R7.4 revoke; lint and typecheck clean; db +7 s against a same-day control on `main` (one control run, two tip runs; a reading, not a distribution).

## 2. The rulings, against the build

| Ruling | Built as ruled? | Note |
|---|---|---|
| R1 table | Yes | `poly_backup` reads it through `pg_read_all_data`. R1's "no login role" is meant for the runtime roles, and R12 already counts a backup reader's hashes. ARCH states it so |
| R2 grants | Yes | pgTAP 08 and 10, both ways |
| R3 attach | Yes | exact call, false for a gone or handled session |
| R4 enter | Yes | see N1 below |
| R5 plugin and deferred check | Yes | after (a): a hold clears the handle; `/get-session` skipped; a 23514 at COMMIT is a 500 with no cookie |
| R6 definers | Yes | each requires kind `session` |
| R7 web, R7.4 revoke | Yes | `revoke-target.ts` throws unless the lookup finds exactly one `(uuid, uuid)` function; `e2e-revoke-scope` keeps the revoke out of migrations, `roles.sql`, `tests/db`, `tests/ci`, `infra` and `.github`; the pins test shows poly_app still holds the grants on the migrated chain |
| R8 cookies, R9 listener, R10 harness, R11 order | Yes | the seed signs in through `handleAuthRequest`; the storageState keeps each cookie's own path |

## 3. Architectural review: drift and missed integration points

- **No drift.**
  - Web's runtime path is `withSession` only. `withTenant` and `SessionUserId` remain in `db` for tests until POLY-149, which is how ARCH states it.
  - Web and the service no longer talk to each other; the hop per page load added by POLY-152 is gone.
- **Interim by design, each with its exit (POLY-149):**
  - poly_app's EXECUTE on `enter_asserted_user`;
  - poly_app's grants on BetterAuth's six tables;
  - `withTenant` and the brand.
- **Not run by anyone:** the live Caddy probe and a real-domain TLS run (POLY-97, as before).

## 4. Findings (none blocking)

| # | Finding | Owner |
|---|---|---|
| N1 | `enter_session`'s slide rewrites the same `expires_at` on every page load once the cap is within 6 days (seceng). A performance item only, unmeasured, with nothing deployed. **File, don't fix here:** reopening the build after a green gate costs a full gate re-run for a one-line change. The fix (slide only when the new value is greater) fits POLY-149's migration, which touches the same definers, with a qa test that a slide at the cap writes nothing | lead, file on POLY-149 |
| F1 | A sign-in from a browser that carries a live session should end that session in the same transaction (seceng). Hygiene; clearing the cookie is enough for this loop | lead, POLY-139 |
| F2 | SECURITY's Open Risks row for the `__Secure-` sibling-subdomain plant, for the Principal's approval (seceng) | lead, POLY-149 |
| F3 | seceng's ruling-review F1: the POLY-149 sign-in record is written in `attach_session_handle`, or by a trigger on `app.session_handle`, not by service code | lead, POLY-149 |
| F4 | seceng's ruling-review F2: a data-only `pg_restore --disable-triggers` skips the deferred check; the restore runbook must bring `session_handle` with `session`, or drop all sessions | lead, POLY-97 or INFRA §8.10 |

## 5. Checked myself, and taken from others

- **Myself, at `13af0fad`:**
  - read `0015_session_handle.sql` whole against R1–R6 and R11;
  - read `hooks.server.ts`, `packages/auth/src/{web,session-handle,recent-auth,options,handler}.ts` and `withSession` in `context.ts`;
  - read `revoke-target.ts`, the revoke lines in `serve.ts` and the sign-in in `e2e-auth.ts`;
  - grepped for the removed listener, its variables and network, and for `withTenant` and `db/session` in runtime code;
  - confirmed the diff after the gate is docs only.
- **From qa** (`gate.md`): every count, the db timing and all the plants.
- **From seceng** (`build-review.md` @ ba91405c): the attack review, the hold ruling, N1, F1 and F2.

## 6. Docs

ARCH 1.20.0 states the current state, interim items marked as such:
- §2.1: seven wrappers; web enters only by `withSession`; the lint and SQL boundary; `withTenant` and the brand kept for tests.
- §2: the `db`, `auth`, `apps/auth` and `apps/web` rows.
- §3.1c: the cookies and the session handle; the step-up check by `step_up_fresh`; the sign-in gate in the entry transaction.
- §3.3:
  - five ways in, `enter_session` added;
  - the session-id proof rule;
  - `app.session_handle`, `attach_session_handle` and the deferred check;
  - the three Sessions definers;
  - poly_app's role line.
- §4.1: the request diagram.
- §7: the sign-in service with one listener.

Three lines that POLY-152 left out of date are corrected (confirm-code's marker, the helper set per role, the routing-pool test's role). SECURITY 1.11.0 is seceng's.
