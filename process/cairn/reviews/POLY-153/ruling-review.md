# POLY-153 — Web enters by handle: security review of the ruling at `6c31284f` (seceng-153)

**Reviewed:** `process/cairn/reviews/POLY-153/ruling.md` at `6c31284f` (R0–R13, open questions 1–6). This is the newer sha; it adds R13 and open question 6 to `d40d6c48`. Read against POLY-153's six criteria (C1–C6), my attack checklist H1–H7, the POLY-148 spike §1 H and C, §4 and §7, my POLY-152 reviews, migrations 0011, 0013 and 0014, `packages/auth/src/{handler,session,web}.ts`, `packages/auth/src/web/sessions.ts`, `packages/tenancy/src/index.ts`, `apps/web/src/hooks.server.ts` and `infra/postgres/postgresql.{prod,staging}.conf`. Nothing was run: this is a design, and each item below is a test qa writes red before the build.

**Verdict: ACCEPT, on one required change (§2.1).** The change is two lines in R7.2 and R7.4. I check it at the addendum's sha; it does not reopen the rest. §3 lists the test conditions qa adds. §4 answers open questions 1, 2, 4 and 6, plus the lead's question 3. §5 has two filings, one on POLY-149. No risk needs the Principal.

## 1. H1–H7 and C1–C6

| Item | Ruled in | Result |
|---|---|---|
| H1 a stored hash replayed (C1) | R4: one overload `enter_session(text)`, hashed inside, a format check that sends a base64url hash through a second hash, one refusal message; R3: the handle is CSPRNG output, independent of `session.token` | **Holds.** The test list covers the stored hash as bytea, `\x…`, hex and base64url, plus the token and the session id. |
| H2 a handle minted for an existing session | R1: no login role holds anything on `app.session_handle`; R3: the definer refuses a session that already has a handle; R5.2: no session commits without one; `UPDATE(id, user_id)` on `session` pinned absent | **Holds, by a different mechanism from the stamp I asked for** (§4, Q6). |
| H3 a handle outliving its session; the slide | R1 cascade, tested per delete; R4 checks expiry and the cap itself and slides within the cap; R5.1 the handle is never logged | **Holds.** R4 says what slides `expires_at` on web activity: `enter_session`, at most once a day, never past the cap. |
| H4 web receives BetterAuth's cookies (C4) | R8: prefix `__Secure-better-auth`, `Path=/api/auth` on all six cookies (spike §1 C); a Chromium test that a page request carries no `better-auth` cookie | **Holds.** |
| H5 a session without a handle (C5) | R5.2 the deferred check, no role exempt; R5.3 the real INSERT forced to fail on the four paths and sign-up; the plugin pinned last | **Holds.** The deferred check makes C5 structural on paths nobody listed. |
| H6 the interim listener (C6) | R9: deleted, its env refused by `loadConfig`, the network gone, `GET /session` 404 | **Holds.** N1 dropped, correctly. |
| H7 the marker's `session_id` as proof | R4 kind `session`; R6's three definers require it; POLY-89's guards unchanged | **Holds** (§4, Q2). |
| C2 no column equals a live handle | R1 stored form; the query test | Holds. |
| C3 Sessions, revoke and step-up as definers; `loadSession` and the brand out of web | R6, R7.3 | Holds, but web still reads a BetterAuth table (§2.1). |

## 2. Findings

### 2.1 Required: web still reads `public."user"`, and R7.4's revoke leaves it out
- **How it works.** R7.2 keeps `provisionPerson(tx)` in web, now under a `session` marker. `packages/tenancy/src/index.ts:40` reads `public."user".name` as poly_app to name the Person. R7.4's harness revoke lists `session`, `account`, `verification`, `two_factor` and `passkey`, but not `user`. So the e2e run would pass while web still needs SELECT on a BetterAuth table.
- **Why it matters.** POLY-149's criterion is "poly_app holds no grant on any BetterAuth table". R7.4 is presented as the proof that web needs none of them. As written it proves that for five of the six, and POLY-149 would find the sixth at the revocation.
- **What an attacker reaches meanwhile:** nothing new. poly_app already holds SELECT on `user`. This is about the measurement and POLY-149, not today's exposure.
- **Change (two lines):** R7.2 passes the name from `enter_session`'s returned row to `provisionPerson` (it is the marker user's own name, already read by poly_authz), so web's SQL names no BetterAuth table. R7.4 adds `public."user"` to the revoke. R6's boundary grep adds `public."user"` to its list of names web's SQL must not contain.

### 2.2 Not blocking: the deferred check carries H2, so pin it in the catalog
R3's safety rests on "every committed session has a handle", and that rests on `session_needs_handle` being present and enabled. If it is ever dropped or disabled, `attach_session_handle` becomes a way to attach a chosen handle to any session that lacks one. That is a silent web entry for poly_auth. The pgTAP block must pin the trigger: it exists on `public.session`, is a constraint trigger, `DEFERRABLE INITIALLY DEFERRED`, `tgenabled = 'O'`, with its function owned by poly_authz and executable by no login role. It needs one plant (drop or disable it) shown to fail.

### 2.3 Not blocking: SECURITY in this loop
R0 and the H6 row put every doc but ARCH on POLY-149. POLY-153b's own criterion, which is mine, is that SECURITY says what this loop changes. Once this loop merges, TB-15 (the listener) and R-2's sentence "it can send any cookie to auth's internal /session" are false, and SECURITY carries current state only. I edit those two items and add the handle (stored form, kind `session`, the cookie scope) at the build review. Nothing is retired: R-2's reach for poly_app stands until POLY-149. **Proceeding on this unless the lead rules otherwise.**

## 3. Test conditions (qa maps each to a named test; none is a ruling change)
- **T1.** The slide in R4 updates `session` while 0013's `session_11_recent_auth_fixed` trigger is on the table. That trigger fires only on `UPDATE OF recent_auth_at`, so the slide should pass (code-read). The test slides a session past `updateAge` and checks that `recent_auth_at` is unchanged and that `expires_at` never passes `created_at + 30 days`.
- **T2.** An `enter_session` whose slide runs inside a transaction that rolls back leaves `expires_at` unchanged. That is acceptable. The test only shows that no partial write survives.
- **T3.** R6's three definers each refuse a kind `web` marker (written by `enter_asserted_user` as poly_app) and a kind `auth` marker. This is the test that keeps H7 true while `enter_asserted_user` stays.
- **T4.** `attach_session_handle` called twice in one sign-in transaction for the same new session: the second returns false and leaves the first hash. With a session id from another open transaction (uncommitted): returns false.
- **T5.** The R5.1 canary covers the handle in a 500 from the plugin's "no transaction" throw: the error body and log hold no handle.
- **T6.** §2.2's catalog pin and its plant.

## 4. Open questions
- **Q1 (no superuser exemption in R5.2): confirmed.** A branch on `session_user` would be one more thing to get wrong, and it would let a fixture build a state production can never reach. The eight fixture files are the right price.
- **Q2 (the proof rule): confirmed, with T3.** The marker's `session_id` counts as proof only under kind `session`. Only R6's three definers rely on it, and POLY-89's guards are unchanged. That meets the standing constraint. Under kind `session` the id comes from a row the caller proved by holding the plain handle. Kind `web` is still poly_app's word. A side effect, which is good: web's step-up now goes through `recent_auth_ok()` and requires kind `session`, so a stolen poly_app password can no longer pass web's step-up by naming a victim's session through `enter_asserted_user`. It still holds DELETE on `session` directly until POLY-149, so R-2's wording for it stays.
- **Q3 (R7.4's harness revoke; the lead's question).** It stays a measurement as long as three things hold:
  1. The revoke lives only in `serve.ts`, never in `packages/db/sql/`, a migration, `roles.sql` or a fixture shared with `tests/db`.
  2. No catalog test, pgTAP file or deploy-gate check runs against the e2e database or cites the e2e run as evidence of the revocation. pgTAP 08 and POLY-149's catalog test keep reading the migrated chain.
  3. SECURITY and STATE say nothing is revoked.

  One way it could cross the line is §2.1: a passing e2e read as "web needs no BetterAuth grant" while it still needs `user`. With §2.1 fixed, I see no other way.
- **Q4 (handle generated in Node): confirmed.** `crypto.randomBytes(32)` is the platform CSPRNG. Postgres has no 256-bit random source without pgcrypto, which we do not install, and `gen_random_uuid()` gives 122 bits. Code execution in the service sees the handles it issues either way (R12). Generating in SQL would only keep the value out of a heap that already holds the auth secret.
- **Q6 (stamp versus the deferred check): the equivalence is accepted.** A handle-less session visible to the caller can only be one inserted in the caller's own transaction: another transaction's uncommitted row is invisible, and R5.2 refuses any commit that leaves one. poly_auth's remaining route is to DELETE a victim's session and INSERT a new one, even with the same `id`, since it holds `INSERT(id)`. That is a new session row, which is the reach R12 already states, not a silent attach. The condition is §2.2's pin.

## 5. Filings for the lead
- **F1 (POLY-149, the sign-in record).** After this loop the web-entry credential is created in exactly one place, `app.attach_session_handle`. The record that no login role can change (DECISIONS 2026-11-17) should be written there, or by a trigger on `app.session_handle` INSERT, not by the service's code. SQL as poly_auth can skip code, but it cannot skip the definer. Then every session that can enter web leaves a line, including one minted by injected SQL. R12's "will be on POLY-149's record" holds only if the record is written that way.
- **F2 (INFRA, a note for POLY-97 or §8.10).** A data-only `pg_restore --disable-triggers` skips R5.2's check. A restore must bring `app.session_handle` with `public.session`, or drop all sessions, so that no handle-less session survives one. This is not urgent: nothing is deployed, and a full restore creates the trigger after loading consistent data.

## 6. The replacement ruling at `0cd43441`

Read: `git diff 6c31284f 0cd43441 -- process/cairn/reviews/POLY-153/ruling.md`, plus INFRA §7.1 step 16's gate query and `packages/tenancy/src/index.ts:40`. **Verdict: ACCEPT `0cd43441`.** No finding.

| Check | At `0cd43441` | Result |
|---|---|---|
| §2.1 web reads no BetterAuth table | R7.2: `provisionPerson(tx, shell.name)`, the name from `enter_session`'s row, `'Person'` on NULL or empty; R6's grep adds `public."user"`; R7.4 revokes all six tables | **Met.** The name web passes is the marker user's own, and `entity`'s insert policy still pins `self_user_id = current_user_id()`, so a caller-chosen name reaches only the caller's own Person. That is the same as today. |
| §2.2 the catalog pin | R5.2: the trigger exists, is a constraint trigger, `DEFERRABLE INITIALLY DEFERRED`, `tgenabled = 'O'`; its function is owned by poly_authz and executable by no login role (granted and effective); two plants (dropped, disabled) each shown to fail | **Met**, as asked. |
| Q3 condition 1: only in `serve.ts` | R7.4.1 | **Met.** |
| Q3 condition 2: no check reads the e2e DB; the real gate still fails | R7.4.2, naming INFRA §7.1 step 16 | **Met.** I read the gate query. It counts poly_app's privileges on the six tables and on every `enter_*` except `enter_session`. On the migrated schema after this loop, poly_app still holds `enter_asserted_user` and its table grants, so the gate still prints a number above 0 and fails, as it must until POLY-149. |
| Q3 condition 3: nothing claims a revocation | R7.4.3 | **Met.** My SECURITY edits at the build review will say nothing was revoked (R0, §2.3). |

Also in this sha: R0 now places SECURITY's current-state items (TB-15, R-2's `/session` sentence, the handle) in this loop at my build review; §3's T1–T6 bind as tests; open questions 1–6 are closed as I answered them. Nothing else in the ruling changed.
