---
id: POLY-149
title: Stage 2 revocation and docs
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-148, POLY-89, POLY-152, POLY-153]
assignee: backend-lead
paths: [process/cairn/issues/POLY-149.md, process/cairn/reviews/POLY-149/**, apps/auth/**, apps/web/**, apps/worker/**, packages/**, infra/**, tests/**, layers.json, eslint.config.js, scripts/layers/**, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .gitignore, bin/**, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, docs/DESIGN/**]
labels: [security, auth]
priority: P1
pr: null
created: 2026-11-13
updated: 2026-11-19
---

Stage 2 of POLY-145's decision (`process/cairn/reviews/POLY-145/pricing.md` §1 blocks S, E, H and D). BetterAuth, the auth secret and every grant on BetterAuth's tables move to a third process, `polycarpic auth`, on its own login role poly_auth, served on the same origin at `/api/auth/*`. Web enters a transaction only by handing the database a session handle. The database holds just a hash of that handle and checks it in `app.enter_session`; the interim definer from stage 1 is revoked. Once this ships, SQL injection in web, a stolen poly_app password and a read of the database at rest each reach no user, or only the requesting user. Code execution in web still reaches the users active while it runs (`comparison.md` §1). Because POLY-89 lands first, its guards and their fixtures move from poly_app to poly_auth transactions here.

Split on 2026-11-17 (the Principal confirmed): the service is POLY-152, web entering by handle is POLY-153, and this issue is the last PR of stage 2: the revocation, the docs and the running-cost measurement. The deploy gate (`process/DECISIONS.md`, 2026-11-16) lifts when this issue's PR merges. The spike's changes are carried on POLY-152 and POLY-153.

## Acceptance criteria

Ticks by qa at the gate sha ff6e2a94 (`process/cairn/reviews/POLY-149/gate.md`); each criterion's proving test is named in `process/cairn/reviews/POLY-149/test-plan.md`.

**Revocation (one migration)**
- [x] poly_app holds no grant on any BetterAuth table and no EXECUTE on any `enter_*` except `enter_session`. A catalog test pins poly_app's complete EXECUTE set on `app` functions after the revocation, not only the `enter_*` ones (seceng F2, `process/cairn/reviews/POLY-152/ruling-review.md` §5).

**Growing second-step lock (deploy gate; `process/DECISIONS.md` 2026-11-17)**
- [x] On a fake clock, consecutive locks of one factor last 15, 30, 60, 120, 240, 480 and 960 minutes, then 1440 minutes for every later one (±1 minute), on the TOTP path and the backup-code path. Each lock is reached by 10 counted wrong codes, as today.
- [x] Only a correct TOTP or backup code resets the doubling: after one, the next lock lasts 15 minutes. A lock that lapses, a passkey sign-in, a password reset or a new session leaves the doubling where it was.
- [x] While a lock is in force the right code is refused and creates no session, on both paths, at every lock length.
- [x] The doubling state lives in the database, so restarting `auth` leaves it unchanged (test: a restart between two locks).
- [x] The database refuses any write that shortens or clears `locked_until` while it is in the future, and any write to the doubling state, except BetterAuth's lock and lazy-clear writes as the guard computes them, a correct-code reset, and `reset-mfa`. pgTAP pins it: no login role holds a direct privilege on the doubling state. A test as poly_auth tries `UPDATE two_factor SET locked_until = NULL` during a lock and is refused.
- [x] A passkey sign-in still passes the second step during a lock, and `polycarpic cli user reset-mfa` still works on a locked user.
- [x] Each assertion above is shown red against the current chain (BetterAuth defaults) before the build.

**Sign-in record (deploy gate; `process/DECISIONS.md` 2026-11-17)**
- [x] Every committed `session` INSERT leaves exactly one row in an append-only record: user id, session id, `created_at` from the database clock, `ip_address` and `user_agent` copied from the new row. An AFTER INSERT trigger owned by a NOLOGIN definer role writes it, from `NEW` only, so no caller supplies a value. This covers every sign-in path, rotations included.
- [x] As poly_auth: insert a session, delete it, commit. The record row remains. A rolled-back insert leaves none.
- [x] No login role (poly_app, poly_auth, poly_worker, poly_operator, poly_migrator, poly_backup) holds INSERT, UPDATE, DELETE or TRUNCATE on the record, checked by effective has_*_privilege, both ways, as pgTAP 08 does. UPDATE, DELETE and TRUNCATE are also refused by a trigger, even for the owner. A deletion path for retention runs only as a NOLOGIN purge owner (see the next item).
- [x] Retention: rows older than 400 days, and a deleted account's rows, are removed only by the purge path (a NOLOGIN owner, as `app.purge_tx_identity`). No other delete exists.
- [x] Each counted second-step refusal (one that raises `failed_verification_count`, TOTP or backup code) adds one record row of kind second-step failure: user id, time, address, browser.
- [x] Each lock adds one record row of kind second-step lock, with the lock's length.
- [x] A request without a valid held sign-in (no cookie, or a dead hold's 6th try) adds no row.
- [x] No column of the record holds the code that was typed (a test types a known code and searches every column for it).
- [x] As poly_auth, no record row of any kind can be changed or deleted (the same effective-privilege and trigger checks as above).
- [x] No login role reads the record in this issue. A later Settings screen gets its own grant review.
- [x] INFRA §7.1 step 16's check also refuses when the growing lock or the record is missing (devops; see seceng's note). Proof: `tests/db/gate-check.test.ts` and `gate-check-membership.test.ts`, 94 tests with every plant refused (87 + 7 at the gate sha); INFRA 1.3.16.

**D: docs**
- [x] ARCH §2.2, §3.1, §3.1c, §3.3 and §7; SECURITY R-2 re-worded to its residual, never retired (seceng #15). The residual stays: the sign-in service can create any session, code execution in web reaches the users active while it runs, and the worker's reach lasts until POLY-64's scoping lands. Also T-18, A-31, A-39, C-84 and the secrets table; INFRA §2.2 and §7.5. All of them state the current state only. Proof: ARCH 1.21.0, SECURITY 1.13.0, INFRA 1.3.16; `process/cairn/reviews/POLY-149/verdict.md` and `build-review.md`.
- [x] SECURITY R-2's backup-code item (POLY-89 D1: copied backup codes plus a planted magic link sign in as any authenticator-app user) is removed when the revocation lands; the residual names the sign-in service's write access to factor rows. Proof: SECURITY 1.13.0; `build-review.md` §5.
- [x] Running cost measured: the RSS of the auth container at idle and under the e2e suite, recorded against ARCH §7.3. Proof: `process/cairn/reviews/POLY-149/r7-auth-memory.md` (idle 128 MiB, e2e peak 130 MiB); ARCH §7.3.

## Estimate

1–1.5 loop-days for this issue (D). Stage 2 as a whole: 11.5–15.5 loop-days over 3 loops (POLY-152 6.5–8.5, POLY-153 3–4.5).

## Comments

### @team-lead — 2026-11-15

Follow-ups from POLY-148 (merged via PR #129) added above; source: `process/cairn/reviews/POLY-148/spike.md` (§1, §2, §6 and seceng's reading in §7).

### @team-lead — 2026-11-16

Deploy gate (Principal, 2026-11-16; `process/DECISIONS.md`): no real household data is deployed before this issue's last PR, the revocation, has merged. Staging with test data (POLY-97) may go ahead. Backup codes stay on in POLY-89, and the copy risk they carry closes at the same PR.

### @team-lead — 2026-11-16

From the POLY-89 loop (merged 2026-11-17, PR #131). The poly_auth test fixture is created IN ROLE poly_app, so it does not model this stage's narrower role; replace it with the real role here (seceng, 2026-11-16).

### @team-lead — 2026-11-18

From POLY-152's close: INFRA §7.1 step 16 (the deploy-gate check) must also refuse when the growing lock or the sign-in record is missing, or when any login role can write to the record. devops-engineer adds it once this issue's ruling names the objects (seceng asked on 2026-11-18; criterion already listed above).

### @team-lead — 2026-11-19

From the POLY-153 loop (`process/cairn/reviews/POLY-153/`). Two additions to this issue:
- **F1 (seceng, ruling-review §5):** the sign-in record is written inside `app.attach_session_handle` or by a trigger on it, not by service code, so the sign-in service cannot skip a line.
- **N1 (seceng build-review §4; architect's verdict §4):** `app.enter_session`'s slide rewrites the session row on every page load in the last 6 days before the 30-day cap. Require the new `expires_at` to be greater than the old before writing, with a qa test that a slide at the cap writes nothing.

### @team-lead — 2026-11-19

Feature started. Branch: `feature/poly-149-stage-2-revocation-and-docs`. Stages: POLY-149a (ruling), b (security review), c (tests), d (build), e (deploy gate and cost), f (verdict).
