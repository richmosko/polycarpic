---
id: POLY-152
title: Sign-in service process
status: in-review
milestone: POLY-M1
parent: null
blocked_by: [POLY-148, POLY-89]
assignee: backend-lead
paths: [process/cairn/issues/POLY-152.md, process/cairn/reviews/POLY-152/**, apps/auth/**, apps/web/**, apps/worker/**, packages/**, infra/**, tests/**, layers.json, eslint.config.js, scripts/layers/**, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .gitignore, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, docs/DESIGN/**, bin/**]
labels: [security, auth]
priority: P1
pr: https://github.com/richmosko/polycarpic/pull/133
created: 2026-11-17
updated: 2026-11-17
---

Loop 1 of stage 2 (split from POLY-149 on 2026-11-17; the Principal confirmed the split). BetterAuth, the auth secret and every grant on BetterAuth's tables move to a third process, `polycarpic auth`, on its own login role poly_auth, served on the same origin at `/api/auth/*`. Sign-up (POLY-87) and the second-step guards (POLY-89) and their fixtures move from poly_app to poly_auth transactions here. Web still enters by the stage-1 definer until POLY-153; poly_app's grants are revoked in POLY-149. Design source: `process/cairn/reviews/POLY-145/pricing.md` §1 block S and `process/cairn/reviews/POLY-148/spike.md`; the architect rules from the spike.

## What the spike changed (POLY-148, `process/cairn/reviews/POLY-148/spike.md`; the architect rules from it)

- **H's mechanism:** option 1 (a second cookie, `__Host-poly_handle`) works on all 13 session paths with one plugin that must be last in `plugins[]`. Option 2 is not needed (seceng's ruling, §7). About 1 loop-day (guess), with one test per session path; six of the paths are beyond the list POLY-148 started with (§1 H).
- **S's grant list:** poly_auth needed a tenancy write grant (`entity INSERT`), so **the price is re-opened**: the Person insert moves into a definer first. About +0.5 loop-day (guess).
- **The sign-in pages do not move** (Principal, `process/DECISIONS.md` 2026-11-15). No DESIGN change.
- **The dev and e2e harness work:** 0.5–1 loop-day (guess); the seeded `storageState` must carry the handle cookie and its `app.session_handle` row (§4).
- **Cookie scope:** passed. BetterAuth's cookies become `__Secure-` with `Path=/api/auth`; the handle stays `__Host-` with `Path=/` (§1 C, §7.9). The sibling-subdomain trade-off is accepted for a single-family install and stated in SECURITY.
- **Needs a ruling: refresh.** In the spike nothing re-issues either cookie on refresh, a regression from today: a user active every day is signed out after 7 days (§7.6). seceng's fix is that the service re-issues both within the 30-day cap.

## Acceptance criteria

- [x] `polycarpic auth` runs from the app image as poly_auth, with the auth secret mounted for it alone. A rendered-compose test checks that no other service (web, worker, operator, staging) mounts it (seceng #17). Caddy routes `/api/auth/*` to it on the app origin, and a test shows web's handle refuses that tree. — tests/infra/auth-service.test.ts: "#17 prod.yml / staging.yml: no service but auth mounts the auth secret, an OAuth secret or poly_auth's password", "auth mounts … no other database password", the `@auth` Caddy matcher and "no route reaches the internal port"; packages/config/src/auth-service.test.ts: "forbidden for every service but auth"; apps/web/src/hooks.server.authtree.test.ts and hooks.server.auth.test.ts: "/api/auth/* … -> 404"; tests/db/auth-service-main.test.ts: "the public listener answers /api/auth/ok 200 and nothing else"
- [x] poly_auth's grants are catalog-exact: today's poly_app grants on `user`, `session`, `account`, `verification`, `two_factor` and `passkey`, EXECUTE on the sign-up definers, and nothing on tenant tables beyond what the spike lists. A pgTAP test pins the full list (seceng #16). The sign-up stamp's role check names poly_auth only, not poly_app (`0007:139`; spike §7.5). — tests/db/pgtap/08_poly_auth_grants.sql: "effective: poly_auth holds no table privilege outside the list", "… no column privilege …", "executes no function outside the sixteen", "granted: routine_privileges lists exactly the sixteen functions" (shown to bite by the 8 planted grants in tests/db/pgtap.test.ts); tests/db/auth-service-grants.test.ts: "A2 the sign-up stamp names poly_auth only", "poly_app after 0014 differs from 0013 by exactly the twelve EXECUTE removals"
- [x] **No tenancy write grant on poly_auth (spike §7.2, required).** A `provision_person()` definer does the Person insert that `provisionPerson` does directly today; poly_auth holds no INSERT on `entity` and no policy on `entity`, `membership`, `entity_type` or `invitation`. — tests/db/auth-provision-person.test.ts: "B3 refusals" (exact call, second call, auth and web markers, no EXECUTE for poly_app/worker/operator), "C3 poly_auth holds no tenancy write", "R3 … provisions the Person" and "a forced failure after the Person rolls back"; tests/db/pgtap/08_poly_auth_grants.sql: "no policy names poly_auth except tx_identity_own"; tests/db/pgtap/09_poly_govern_grants.sql
- [x] **The service enters by its own session (spike §7.2 finding A, required).** A definer such as `app.enter_auth_session(token)` checks a live `session` row and writes the marker from it; poly_auth is never granted `enter_asserted_user`. A catalog test pins that. — tests/db/auth-enter-session.test.ts: "R5 the exact call enters from a live session row", "B2 … a token that is not a live row writes no marker", "#18 the full stage-1 refusal set"; tests/db/pgtap/08_poly_auth_grants.sql: "pinned absent: enter_asserted_user, enter_job, has_role …"
- [x] `recent_auth_at` is stripped in a `session.create.before` hook, not granted (spike §7.4); settled together with POLY-89's rotation item. — tests/db/pgtap/08_poly_auth_grants.sql: "pinned absent: INSERT and UPDATE on session.recent_auth_at (R4)"; tests/db/second-step-gates.test.ts: "a session INSERT that names recent_auth_at is refused by the column grant, and one that omits it gets NULL"; tests/db/auth-session.test.ts: "input: false: no request body sets recentAuthAt"
- [x] The session and its handle commit together on the sign-in paths that have no session yet (email, magic link, OAuth callback, passkey sign-in); a forced handle-INSERT failure leaves no session row (spike §7.8). — tests/db/auth-signin-tx.test.ts: "F1 a failure after the session INSERT leaves no session row and sets no cookie, on each path" (/sign-in/email, /magic-link/verify, /callback/:id, /passkey/verify-authentication, the held verify-totp and verify-backup-code) (handle half on POLY-153)
- [x] The 30-day cap clears the session cookie at the path it was set on; `handler.ts` hardcodes `Path=/` today (spike §7.7). — tests/db/auth-refresh.test.ts: "C7 the cap's clearing cookie carries the Path, Secure, SameSite and HttpOnly BetterAuth set it with"; tests/db/auth-internal-session.test.ts: "a session used daily is refused on day 30 and its row deleted"
- [x] Refresh behaves as the architect rules (see above), with a test for a session refreshed after day 6. — tests/db/auth-refresh.test.ts: "C8 the cookie lives to the cap" (Max-Age within 60 s of 30 days) and "a request on day 6 slides expires_at to at least day 13, and a page on day 8 answers 200 with no new cookie"; tests/db/auth-internal-session.test.ts: "day 6 of 7: the row slides" and "day 8 idle" through both doors; packages/auth/src/cookie-lifetime.test.ts
- [x] Sign-up (POLY-87) and the second-step guards (POLY-89) run in the service's transactions, and every existing auth test passes as poly_auth. — tests/db/second-step-gates.test.ts, second-step-challenge.test.ts, auth-new-user-step.test.ts, auth-signup-invite.test.ts, auth-signup-wrap.test.ts and auth-session.test.ts run as the real poly_auth (the IN ROLE poly_app fixture is gone; "POLY-152 handleAuthRequest runs as poly_auth, not poly_app" in auth-session.test.ts); gate run af6f69de: tests/db 753/753 over 34 files (process/cairn/reviews/POLY-152/red-run.md)

## Estimate

6.5–8.5 loop-days (S 4–5, POLY-89 retarget 2–3, seceng's checks #16–#19 +0.5; from POLY-149's estimate)

## Comments

### @team-lead — 2026-11-17

Feature started. Branch: `feature/poly-152-sign-in-service`. Split from POLY-149 with the Principal's confirmation (2026-11-17): this loop is the service (S) and the POLY-89 retarget; POLY-153 is web entering by handle; POLY-149 is the revocation and docs.

### @team-lead — 2026-11-17

Reading of criterion 6 for this loop (ruling R9, e7a18a51): the handle is POLY-153's, so this loop proves the one-transaction rule on the session-creating paths with a test plugin whose forced failure leaves no session row. The handle half, cookie scope (seceng #19) and the removal of the interim `/session` call are now criteria on POLY-153.

### @architect — 2026-11-17

Layer boundaries for the build, checked against `layers.json` at the branch tip and backend-lead-152's contract note. The ruling at 646e35ed stands; this clarifies R1.8 and R6 and changes no security claim.

1. **`apps/auth` imports no `db` beyond `db/startup`: confirmed.**
   - That is R1.8's allow list: `config`, `config/log`, `db/startup`, `auth`.
   - The service reaches `@poly/db/auth` (`withAuthSession`, `withSignInTx`, `authPool`) only through `@poly/auth`, whose own allow list already holds `db/auth`.
   - The role and schema checks go through `db/startup` (`assertRole('poly_auth')`, `schemaStatus` gaining `'auth'`).
   - The `authPool` seatbelt (refuses unless `DATABASE_USER === 'poly_auth'`) is adopted. Web cannot reach that pool: web's allow list has no `db/auth`.
2. **`@poly/auth/web` cannot reach `session.ts` as it stands, and `loadSession` leaves the root: confirmed.**
   - `loadSession` (the internal `/session` client), `requireRecentAuth` (web's plain poly_app query, R6.3), `listMySessions` and `revokeMySession` live in web-only files under `packages/auth/src/web/`. Those files may import `@poly/db`, `@poly/db/session` and `@poly/tenancy` only.
   - The service side is `handleSessionRequest(request, auth)`, exported from the root for `apps/auth/src/main.ts`.
   - The layer check works per package, not per subpath, so it cannot stop `web/*` importing `better-auth` or `@poly/db/auth`. R1.8's boundary test is the guard. It must resolve **transitively** from `apps/web`'s entry points and from `packages/auth/src/web.ts`, and fail on `better-auth`, `@better-auth/*`, `@poly/db/auth` or any file outside `packages/auth/src/web*`.
3. **`layers.json` needs these entries.** All are in POLY-152d's paths.
   - New package `"auth-app": { "dir": "apps/auth", "name": "@poly/auth-app", "layer": 6, "subpaths": [], "allow": ["config", "config/log", "db/startup", "auth"] }`.
   - `auth.subpaths` becomes `["./web"]`, with `exports["./web"]` in `packages/auth/package.json`.
   - `web.allow` swaps `auth` for `auth/web`.
   - `reservedLiterals`: `enter_auth_session` → `["packages/db/src/context.ts"]`, and `provision_person` → the one tenancy file that names it.
   - No `confined` entry is needed: only `@poly/auth` holds `db/auth`.

No security change: the auth secret is read only by `apps/auth` through `@poly/config`, and nothing above gives web or any other package a path to it, to BetterAuth or to the poly_auth pool.

### @architect — 2026-11-17

Ruling on the owner grant in 0014 at 6fb0d4be (line 57): `GRANT SELECT (id, name, signup_txid) ON public."user" TO poly_govern`.

**It is not a grant beyond R3 in effect, but it is written wider than it is. Narrow the statement to `GRANT SELECT (name) ON public."user" TO poly_govern`, as R3 states.**
- poly_govern has held `SELECT (id, email, email_verified, signup_txid)` on `user` since 0007:11, for `accept_invitations`' "created by this transaction" check. 0013:10 added `two_factor_enabled, second_step_at, email`. So `id` and `signup_txid` in line 57 re-grant what poly_govern already holds; Postgres records the privilege once, and the catalog is the same either way.
- The only privilege the line adds is `name`, which R3 already lists. `provision_person` reads `user.name` for the Person's name, and `id` and `signup_txid` for the check.
- Why narrow it anyway: written as it stands, a reader of 0014 concludes that the check needed a new grant. If 0007's grant were ever narrowed, this line would silently keep the columns alive. With `(name)` alone each column has one grant, in the migration whose definer first needed it, and a comment can point the check at 0007:11.
- The other ways were weighed and are not better:
  - poly_authz owns `enter_new_user`, which already reads `signup_txid` (0007:7), but it holds no write on `entity` and must not, because it is the readers' role.
  - Reusing `enter_new_user`'s check by calling it is impossible, because the marker already exists by then.
  - Fewer columns is not possible: the Person needs the name.

**What poly_govern's definers could newly read on a caller's behalf: `user.name`, of any user** (the table has no RLS), and nothing else. The only definer that reads it is `provision_person`. It reads only the marker's own user, created in this transaction, and returns the new entity's id, never the name. No other poly_govern definer selects `name`, and a NOLOGIN owner's grant cannot be used except through its definers. Its one caller, poly_auth, already reads `user.name` directly, and so does poly_app. **No login role gains a read.**

Build: amend line 57 to `(name)` with that comment, in 0014 (not yet merged, so editing it is safe). A pgTAP line pins poly_govern's column privileges on `user` to exactly `id, email, email_verified, signup_txid, two_factor_enabled, second_step_at, name` for SELECT, and `signup_txid, two_factor_enabled, second_step_at` for UPDATE.

### @architect — 2026-11-17

Ruling on the two build findings at 25fb2661 (backend-lead-152's findings items 6, 9, 10 and 11). This corrects R9 and R1.8 in place; the rest of ruling 646e35ed stands.

**(a) The second-step lockout: keep BetterAuth's 10, correct the ruling's "five".**
- POLY-89's ruling promised no TOTP or backup-code lockout count. Its "5th wrong entry" (R2) is the emailed enrolment code, a different counter in `app.email_challenge`. The "five" in R9's test was mine, unmeasured, and wrong.
- What stands: 1.7.18 locks the `two_factor` row at `accountLockout.maxFailedAttempts`, default 10 (code-read, verify-two-factor.mjs:121). It was measured that five refusals leave the count at 5 and no `locked_until`.
- No option is set. Setting `accountLockout` could replace its other defaults (the lock duration) rather than merge with them (unmeasured). Lowering the count also makes it cheaper for someone who already has the password to lock the user out. 10 tries against a 6-digit code are well inside NIST 800-63B's limit of 100.
- The R9 test becomes, on one held sign-in, all inside `withSignInTx`:
  - 9 refusals: `failed_verification_count = 9`, `locked_until` NULL;
  - the 10th: `locked_until > now()`;
  - an 11th try with the **right** code is refused and creates no session;
  - the same for backup codes.
  The test records `locked_until - now()` and does not assert it. A pin bump that changes the default then fails the test instead of passing silently.
- For seceng: whether to accept 10 or require a lower count with a measured option.

**(b) Layers: the checker follows ARCH, the name comes from layers.json.**
1. **Subpath-only allows are valid.** ARCH §2 already says an entry naming the package grants its index only, and a subpath is importable by a package whose list names it. It does not require the base, and `check.mjs:39`'s `!v.allow.includes(baseOf(a))` is stricter than ARCH.
   - backend-lead drops that clause (`scripts/layers/**` is in POLY-152d's paths).
   - qa adds two cases to `tests/layers/check.test.ts`: `web → auth/web` with no `auth` passes the checker; and the import lint refuses `import '@poly/auth'` from `apps/web`. The second is what makes a subpath-only allow mean "not the index".
   - `auth-app → db/startup` without `db` is then valid as well.
2. **Package names.** `apps/auth` stays, with the layers key `auth-app` and the name `@poly/auth-app`.
   - qa changes `relative-structure.test.ts` to: every package's `package.json` name equals the `name` layers.json gives its `dir`; every name is unique and starts with `@poly/`.
   - `layers.json`, which ARCH makes the authority, then fixes the name, and the workspace collision cannot recur.
3. **ARCH §2.2 lands before build green, not at the verdict.** `check.test.ts` reads §2.2's `data-consumes`, so gate 3 needs it. I edit it when you release me, current state only:
   - a new row `apps/auth`: polycarpic auth, the sign-in service, as poly_auth; consumes `config config/log db/startup auth`; owner backend-lead / devops-engineer;
   - `packages/auth`: the row text says it runs in the sign-in service, and gains the public subpath `./web` (web's session client); consumes unchanged;
   - `apps/web`: consumes swaps `auth` for `auth/web`.
   - The other §3.1c, §3.3 and §7 lines stay for the verdict, as the ruling says.

### @architect — 2026-11-17

Correction to my comment of f16e92d1, part (a), from qa's measurement at 454660da (`auth-signin-tx`, `red-run.md`, better-auth 1.7.18). It replaces that part's test shape and its NIST sentence; the rest of (a) stands: no `accountLockout` option is set.

**There are two counters, both measured.**
- **Per hold: 5 wrong codes.** A hold is the two-factor cookie's `verification` row. Its 6th try answers 400 `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE` without counting against the factor. The hold is then dead: a 7th try, even with the right code, is `INVALID_TWO_FACTOR_COOKIE`. The user signs in with the password again.
- **Per factor: 10 wrong codes, across holds.** `two_factor.failed_verification_count` survives each hold. The 10th refusal sets `locked_until` to about 900 s ahead, and while it is set, the right code is refused and creates no session. So reaching the lock takes two password sign-ins.
- **The count resets when the lock lapses.** The first wrong code after `locked_until` passes clears the lock and sets the count to 1 (10 → 1, measured on both the TOTP and the backup-code paths).
- **The resulting budget** is 5 tries per password sign-in and 10 per factor per 900 s, about 960 a day against a six-digit code. That is gated by the password and by the in-memory rate limit on the sign-in routes.
- My f16e92d1 sentence that 10 is "well inside NIST 800-63B's limit of 100" is withdrawn. NIST's limit is on consecutive failures without a reset, and this counter resets every 900 s. Whether the budget is acceptable, or needs a measured lower `maxFailedAttempts` or a longer lock, is seceng's call; neither option changes R9.

**R9's test shape.** In place of "on one held sign-in":
- two holds, opened by two password sign-ins, give 9 refusals → count 9, no lock;
- the 10th → `locked_until` about 900 s ahead;
- an 11th try with the right code is refused and creates no session;
- the same for backup codes;
- plus qa's per-hold test: 5 refusals, then the 6th is `TOO_MANY_ATTEMPTS` and the count stays 5.

**R9's commit rule does not change.**
- The dead hold's answer is a 400, so it commits under the rule like any refusal below 500. What it may write is the same allowed set: `verification` (the hold row deleted or left spent) and the two `two_factor` columns. Since it does not count, the measured case is a write to `verification` only, or nothing.
- **The statement-log write-set test must also run on the 6th answer**, not only on counted refusals. A dead hold that wrote anywhere else would fail it, as for any refusal.
- If that answer ever rolled back, the hold would survive and allow more tries. The per-hold test catches that: the 7th try must still be `INVALID_TWO_FACTOR_COOKIE`.
- The reset is BetterAuth's own unmarked write to the same two columns, which POLY-89's carve-out (R3 #5) already allows. Nothing new is written.

### @team-lead — 2026-11-17

PR opened: https://github.com/richmosko/polycarpic/pull/133. Gate sha af6f69de (qa clean-tree run, seceng ACCEPT, architect APPROVE). Awaiting CI and the Principal's merge decision.
