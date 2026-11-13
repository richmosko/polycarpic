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
updated: 2026-11-13
---

Stage 2 of POLY-145's decision (`process/cairn/reviews/POLY-145/pricing.md` §1 blocks S, E, H and D). BetterAuth, the auth secret and every grant on BetterAuth's tables move to a third process, `polycarpic auth`, on its own login role poly_auth, served on the same origin at `/api/auth/*`. Web enters a transaction only by handing the database a session handle. The database holds just a hash of that handle and checks it in `app.enter_session`; the interim definer from stage 1 is revoked. Once this ships, SQL injection in web, a stolen poly_app password and a read of the database at rest each reach no user, or only the requesting user. Code execution in web still reaches the users active while it runs (`comparison.md` §1). Because POLY-89 lands first, its guards and their fixtures move from poly_app to poly_auth transactions here.

It is likely to land as three PRs: S, then E with H, then the revocation and the docs. The lead may file them as sub-issues.

## What the spike may change

- **H's mechanism:** option 1 (a second cookie) or option 2 (an adapter rewrite), and its price.
- **S's grant list:** if poly_auth needs a tenancy write grant, the sign-up provisioning moves into definers first, and the price is re-opened.
- **Whether S also serves `/sign-in` and `/sign-up`** (the Principal decides from the spike record): if yes, add a DESIGN change and the spike's measured size.
- **The dev and e2e harness work**, sized by the spike.
- **Cookie scope:** if the spike's cookie-scope item passes, BetterAuth's cookies are path-scoped to `/api/auth`, and a test shows web's request handler never receives them (seceng #19).

## Acceptance criteria

**S: the sign-in service**
- [ ] `polycarpic auth` runs from the app image as poly_auth, with the auth secret mounted for it alone. A rendered-compose test checks that no other service (web, worker, operator, staging) mounts it (seceng #17). Caddy routes `/api/auth/*` to it on the app origin, and a test shows web's handle refuses that tree.
- [ ] poly_auth's grants are catalog-exact: today's poly_app grants on `user`, `session`, `account`, `verification`, `two_factor` and `passkey`, EXECUTE on the sign-up definers, and nothing on tenant tables beyond what the spike lists. A pgTAP test pins the full list (seceng #16). The sign-up stamp's role check names poly_auth (`0007:139`).
- [ ] Sign-up (POLY-87) and the second-step guards (POLY-89) run in the service's transactions, and every existing auth test passes as poly_auth.

**E and H: web enters by handle**
- [ ] `app.enter_session(handle)` hashes the handle, finds a live session that is not expired and is under the 30-day cap, writes the marker, and returns the shell projection. Expired, revoked, unknown, and copied-from-the-database values each yield no marker. As in stage 1 (seceng #18): `enter_session` refuses when a marker already exists, poly_worker cannot execute it, and the extended-mode test also covers poly_auth's pools.
- [ ] No column in the database equals a live cookie's handle, checked by query in the test. Deleting a session kills its handle in the same transaction.
- [ ] Settings → Sessions, revoke and `requireRecentAuth` are definers that read the marker's session. `loadSession` and the `SessionUserId` brand are removed from web.

**Revocation (one migration)**
- [ ] poly_app holds no grant on any BetterAuth table and no EXECUTE on any `enter_*` except `enter_session`. A catalog test pins this.

**D: docs**
- [ ] ARCH §2.2, §3.1, §3.1c, §3.3 and §7; SECURITY R-2 re-worded to its residual, never retired (seceng #15). The residual stays: the sign-in service can create any session, code execution in web reaches the users active while it runs, and the worker's reach lasts until POLY-64's scoping lands. Also T-18, A-31, A-39, C-84 and the secrets table; INFRA §2.2 and §7.5. All of them state the current state only.
- [ ] Running cost measured: the RSS of the auth container at idle and under the e2e suite, recorded against ARCH §7.3.

## Estimate

11.5–15.5 loop-days, 3 loops (M; S 4–5, E 2–3, H 1–1.5, D 1–1.5, POLY-89 retarget 2–3, seceng's check #16–#19 +0.5; the spike may change S and H)
