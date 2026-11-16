---
id: POLY-149
title: Sign-in service (stage 2)
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-148, POLY-89]
assignee: backend-lead
paths: [process/cairn/issues/POLY-149.md, apps/auth/**, apps/web/**, packages/auth/**, packages/db/**, packages/config/**, packages/tenancy/**, infra/compose/**, infra/caddy/**, infra/lint/**, infra/postgres/pg_hba.*.conf, tests/db/**, tests/layers/**, apps/web/tests/e2e/**, layers.json, eslint.config.js, package.json, pnpm-lock.yaml, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, docs/DESIGN/**]
labels: [security, auth]
priority: P1
pr: null
created: 2026-11-13
updated: 2026-11-16
---

Stage 2 of POLY-145's decision (`process/cairn/reviews/POLY-145/pricing.md` §1 blocks S, E, H and D). BetterAuth, the auth secret and every grant on BetterAuth's tables move to a third process, `polycarpic auth`, on its own login role poly_auth, served on the same origin at `/api/auth/*`. Web enters a transaction only by handing the database a session handle. The database holds just a hash of that handle and checks it in `app.enter_session`; the interim definer from stage 1 is revoked. Once this ships, SQL injection in web, a stolen poly_app password and a read of the database at rest each reach no user, or only the requesting user. Code execution in web still reaches the users active while it runs (`comparison.md` §1). Because POLY-89 lands first, its guards and their fixtures move from poly_app to poly_auth transactions here.

It is likely to land as three PRs: S, then E with H, then the revocation and the docs. The lead may file them as sub-issues.

## What the spike changed (POLY-148, `process/cairn/reviews/POLY-148/spike.md`; the architect rules from it)

- **H's mechanism:** option 1 (a second cookie, `__Host-poly_handle`) works on all 13 session paths with one plugin that must be last in `plugins[]`. Option 2 is not needed (seceng's ruling, §7). About 1 loop-day (guess), with one test per session path; six of the paths are beyond the list POLY-148 started with (§1 H).
- **S's grant list:** poly_auth needed a tenancy write grant (`entity INSERT`), so **the price is re-opened**: the Person insert moves into a definer first. About +0.5 loop-day (guess).
- **The sign-in pages do not move** (Principal, `process/DECISIONS.md` 2026-11-15). No DESIGN change.
- **The dev and e2e harness work:** 0.5–1 loop-day (guess); the seeded `storageState` must carry the handle cookie and its `app.session_handle` row (§4).
- **Cookie scope:** passed. BetterAuth's cookies become `__Secure-` with `Path=/api/auth`; the handle stays `__Host-` with `Path=/` (§1 C, §7.9). The sibling-subdomain trade-off is accepted for a single-family install and stated in SECURITY.
- **Needs a ruling: refresh.** In the spike nothing re-issues either cookie on refresh, a regression from today: a user active every day is signed out after 7 days (§7.6). seceng's fix is that the service re-issues both within the 30-day cap.

## Acceptance criteria

**S: the sign-in service**
- [ ] `polycarpic auth` runs from the app image as poly_auth, with the auth secret mounted for it alone. A rendered-compose test checks that no other service (web, worker, operator, staging) mounts it (seceng #17). Caddy routes `/api/auth/*` to it on the app origin, and a test shows web's handle refuses that tree.
- [ ] poly_auth's grants are catalog-exact: today's poly_app grants on `user`, `session`, `account`, `verification`, `two_factor` and `passkey`, EXECUTE on the sign-up definers, and nothing on tenant tables beyond what the spike lists. A pgTAP test pins the full list (seceng #16). The sign-up stamp's role check names poly_auth only, not poly_app (`0007:139`; spike §7.5).
- [ ] **No tenancy write grant on poly_auth (spike §7.2, required).** A `provision_person()` definer does the Person insert that `provisionPerson` does directly today; poly_auth holds no INSERT on `entity` and no policy on `entity`, `membership`, `entity_type` or `invitation`.
- [ ] **The service enters by its own session (spike §7.2 finding A, required).** A definer such as `app.enter_auth_session(token)` checks a live `session` row and writes the marker from it; poly_auth is never granted `enter_asserted_user`. A catalog test pins that.
- [ ] `recent_auth_at` is stripped in a `session.create.before` hook, not granted (spike §7.4); settled together with POLY-89's rotation item.
- [ ] The session and its handle commit together on the sign-in paths that have no session yet (email, magic link, OAuth callback, passkey sign-in); a forced handle-INSERT failure leaves no session row (spike §7.8).
- [ ] The 30-day cap clears the session cookie at the path it was set on; `handler.ts` hardcodes `Path=/` today (spike §7.7).
- [ ] Refresh behaves as the architect rules (see above), with a test for a session refreshed after day 6.
- [ ] Sign-up (POLY-87) and the second-step guards (POLY-89) run in the service's transactions, and every existing auth test passes as poly_auth.

**E and H: web enters by handle**
- [ ] `app.enter_session(handle)` takes the **plain** handle and hashes it inside Postgres; web never computes or sends a hash, and a test calls it as poly_app with a stored `handle_hash` (as bytea and as hex text) and gets no user (spike §7.1 H.forgery, required). It finds a live session that is not expired and is under the 30-day cap, writes the marker, and returns the shell projection. Expired, revoked, unknown, and copied-from-the-database values each yield no marker. As in stage 1 (seceng #18): `enter_session` refuses when a marker already exists, poly_worker cannot execute it, and the extended-mode test also covers poly_auth's pools.
- [ ] No column in the database equals a live cookie's handle, checked by query in the test. Deleting a session kills its handle in the same transaction.
- [ ] Settings → Sessions, revoke and `requireRecentAuth` are definers that read the marker's session. `loadSession` and the `SessionUserId` brand are removed from web.

**Revocation (one migration)**
- [ ] poly_app holds no grant on any BetterAuth table and no EXECUTE on any `enter_*` except `enter_session`. A catalog test pins this.

**D: docs**
- [ ] ARCH §2.2, §3.1, §3.1c, §3.3 and §7; SECURITY R-2 re-worded to its residual, never retired (seceng #15). The residual stays: the sign-in service can create any session, code execution in web reaches the users active while it runs, and the worker's reach lasts until POLY-64's scoping lands. Also T-18, A-31, A-39, C-84 and the secrets table; INFRA §2.2 and §7.5. All of them state the current state only.
- [ ] SECURITY R-2's backup-code item (POLY-89 D1: copied backup codes plus a planted magic link sign in as any authenticator-app user) is removed when the revocation lands; the residual names the sign-in service's write access to factor rows.
- [ ] Running cost measured: the RSS of the auth container at idle and under the e2e suite, recorded against ARCH §7.3.

## Estimate

11.5–15.5 loop-days, 3 loops (M; S 4–5, E 2–3, H 1–1.5, D 1–1.5, POLY-89 retarget 2–3, seceng's check #16–#19 +0.5; the spike may change S and H)

## Comments

### @team-lead — 2026-11-15

Follow-ups from POLY-148 (merged via PR #129) added above; source: `process/cairn/reviews/POLY-148/spike.md` (§1, §2, §6 and seceng's reading in §7).

### @team-lead — 2026-11-16

Deploy gate (Principal, 2026-11-16; `process/DECISIONS.md`): no real household data is deployed before this issue's last PR, the revocation, has merged. Staging with test data (POLY-97) may go ahead. Backup codes stay on in POLY-89, and the copy risk they carry closes at the same PR.
