---
id: POLY-152
title: Sign-in service process
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-148, POLY-89]
assignee: backend-lead
paths: [process/cairn/issues/POLY-152.md, process/cairn/reviews/POLY-152/**, apps/auth/**, apps/web/**, apps/worker/**, packages/**, infra/**, tests/**, layers.json, eslint.config.js, scripts/layers/**, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .gitignore, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, docs/DESIGN/**]
labels: [security, auth]
priority: P1
pr: null
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

- [ ] `polycarpic auth` runs from the app image as poly_auth, with the auth secret mounted for it alone. A rendered-compose test checks that no other service (web, worker, operator, staging) mounts it (seceng #17). Caddy routes `/api/auth/*` to it on the app origin, and a test shows web's handle refuses that tree.
- [ ] poly_auth's grants are catalog-exact: today's poly_app grants on `user`, `session`, `account`, `verification`, `two_factor` and `passkey`, EXECUTE on the sign-up definers, and nothing on tenant tables beyond what the spike lists. A pgTAP test pins the full list (seceng #16). The sign-up stamp's role check names poly_auth only, not poly_app (`0007:139`; spike §7.5).
- [ ] **No tenancy write grant on poly_auth (spike §7.2, required).** A `provision_person()` definer does the Person insert that `provisionPerson` does directly today; poly_auth holds no INSERT on `entity` and no policy on `entity`, `membership`, `entity_type` or `invitation`.
- [ ] **The service enters by its own session (spike §7.2 finding A, required).** A definer such as `app.enter_auth_session(token)` checks a live `session` row and writes the marker from it; poly_auth is never granted `enter_asserted_user`. A catalog test pins that.
- [ ] `recent_auth_at` is stripped in a `session.create.before` hook, not granted (spike §7.4); settled together with POLY-89's rotation item.
- [ ] The session and its handle commit together on the sign-in paths that have no session yet (email, magic link, OAuth callback, passkey sign-in); a forced handle-INSERT failure leaves no session row (spike §7.8).
- [ ] The 30-day cap clears the session cookie at the path it was set on; `handler.ts` hardcodes `Path=/` today (spike §7.7).
- [ ] Refresh behaves as the architect rules (see above), with a test for a session refreshed after day 6.
- [ ] Sign-up (POLY-87) and the second-step guards (POLY-89) run in the service's transactions, and every existing auth test passes as poly_auth.

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
