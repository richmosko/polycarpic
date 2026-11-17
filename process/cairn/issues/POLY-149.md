---
id: POLY-149
title: Stage 2 revocation and docs
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-148, POLY-89, POLY-152, POLY-153]
assignee: backend-lead
paths: [process/cairn/issues/POLY-149.md, apps/auth/**, apps/web/**, packages/auth/**, packages/db/**, packages/config/**, packages/tenancy/**, infra/compose/**, infra/caddy/**, infra/lint/**, infra/postgres/pg_hba.*.conf, tests/db/**, tests/layers/**, apps/web/tests/e2e/**, layers.json, eslint.config.js, package.json, pnpm-lock.yaml, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, docs/DESIGN/**]
labels: [security, auth]
priority: P1
pr: null
created: 2026-11-13
updated: 2026-11-17
---

Stage 2 of POLY-145's decision (`process/cairn/reviews/POLY-145/pricing.md` §1 blocks S, E, H and D). BetterAuth, the auth secret and every grant on BetterAuth's tables move to a third process, `polycarpic auth`, on its own login role poly_auth, served on the same origin at `/api/auth/*`. Web enters a transaction only by handing the database a session handle. The database holds just a hash of that handle and checks it in `app.enter_session`; the interim definer from stage 1 is revoked. Once this ships, SQL injection in web, a stolen poly_app password and a read of the database at rest each reach no user, or only the requesting user. Code execution in web still reaches the users active while it runs (`comparison.md` §1). Because POLY-89 lands first, its guards and their fixtures move from poly_app to poly_auth transactions here.

Split on 2026-11-17 (the Principal confirmed): the service is POLY-152, web entering by handle is POLY-153, and this issue is the last PR of stage 2: the revocation, the docs and the running-cost measurement. The deploy gate (`process/DECISIONS.md`, 2026-11-16) lifts when this issue's PR merges. The spike's changes are carried on POLY-152 and POLY-153.

## Acceptance criteria

**Revocation (one migration)**
- [ ] poly_app holds no grant on any BetterAuth table and no EXECUTE on any `enter_*` except `enter_session`. A catalog test pins poly_app's complete EXECUTE set on `app` functions after the revocation, not only the `enter_*` ones (seceng F2, `process/cairn/reviews/POLY-152/ruling-review.md` §5).

**D: docs**
- [ ] ARCH §2.2, §3.1, §3.1c, §3.3 and §7; SECURITY R-2 re-worded to its residual, never retired (seceng #15). The residual stays: the sign-in service can create any session, code execution in web reaches the users active while it runs, and the worker's reach lasts until POLY-64's scoping lands. Also T-18, A-31, A-39, C-84 and the secrets table; INFRA §2.2 and §7.5. All of them state the current state only.
- [ ] SECURITY R-2's backup-code item (POLY-89 D1: copied backup codes plus a planted magic link sign in as any authenticator-app user) is removed when the revocation lands; the residual names the sign-in service's write access to factor rows.
- [ ] Running cost measured: the RSS of the auth container at idle and under the e2e suite, recorded against ARCH §7.3.

## Estimate

1–1.5 loop-days for this issue (D). Stage 2 as a whole: 11.5–15.5 loop-days over 3 loops (POLY-152 6.5–8.5, POLY-153 3–4.5).

## Comments

### @team-lead — 2026-11-15

Follow-ups from POLY-148 (merged via PR #129) added above; source: `process/cairn/reviews/POLY-148/spike.md` (§1, §2, §6 and seceng's reading in §7).

### @team-lead — 2026-11-16

Deploy gate (Principal, 2026-11-16; `process/DECISIONS.md`): no real household data is deployed before this issue's last PR, the revocation, has merged. Staging with test data (POLY-97) may go ahead. Backup codes stay on in POLY-89, and the copy risk they carry closes at the same PR.

### @team-lead — 2026-11-16

From the POLY-89 loop (merged 2026-11-17, PR #131). The poly_auth test fixture is created IN ROLE poly_app, so it does not model this stage's narrower role; replace it with the real role here (seceng, 2026-11-16).
