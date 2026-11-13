---
id: POLY-146
title: Identity hardening
status: in-review
milestone: POLY-M1
parent: null
blocked_by: []
assignee: backend-lead
paths: [process/cairn/issues/POLY-146.md, process/cairn/reviews/POLY-146/**, packages/auth/**, packages/config/**, packages/db/**, packages/tenancy/**, apps/worker/**, infra/compose/**, infra/lint/**, infra/postgres/**, tests/**, scripts/layers/**, layers.json, eslint.config.js, package.json, apps/*/package.json, packages/*/package.json, pnpm-lock.yaml, bin/polycarpic, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, process/cairn/issues/POLY-137.md, process/cairn/issues/POLY-97.md, process/cairn/issues/POLY-98.md]
labels: [security, auth]
priority: P1
pr: https://github.com/richmosko/polycarpic/pull/126
created: 2026-11-13
updated: 2026-11-13
---

These are the cheap fixes from POLY-145's decision (option a+, `process/cairn/reviews/POLY-145/pricing.md`), landed ahead of stage 1. Each one closes a hole that exists under every identity design:
- BetterAuth stores password-reset and magic-link tokens in the clear (`threat-model.md`). This item moves here from POLY-137.
- The worker is given the auth secret and never uses it (`current-state.md` §8.1).
- The operator CLI shares poly_worker's credential, so a worker compromise can issue invitations.

The CLI moves to its own login role, poly_operator, which holds only EXECUTE on `app.issue_operator_invitation`. It runs from a one-shot compose service under its own profile, as `migrate` does, so the operator password is never mounted into the worker. Identity is still asserted by web and worker; stage 1 changes that.

## Acceptance criteria

- [x] `verification.storeIdentifier` and the magic-link plugin's `storeToken` are set to hashed in `packages/auth/src/options.ts`. A test shows the stored value of a reset token and of a magic-link token is not the emailed value, and that each still verifies once. A value read from `verification` and presented at `/reset-password` or `/magic-link/verify` is refused (seceng #1). — packages/auth/src/options.test.ts and tests/db/auth-route-policy.test.ts: POLY-146 reset and magic-link tokens are stored hashed
- [x] `AUTH_SECRET_FILE` is required for web alone (`packages/config/src/registry.ts:17`). The worker service in `infra/compose/prod.yml` and `staging.yml` mounts no auth secret, and the compose lint refuses one. — tests/config/check-config.test.ts and tests/infra/lint.test.ts: POLY-146 AC2 / worker mounts auth_secret rows
- [x] A LOGIN role poly_operator exists in `packages/db/sql/roles.sql`, with the same attribute hygiene as the others. It holds CONNECT, USAGE on `app`, and EXECUTE on `app.issue_operator_invitation`, and nothing else. pgTAP checks its grants catalog-exactly. — tests/db/pgtap/06_operator_invitation.sql: C13 (POLY-146 AC3) and A1.2 rows; 01_roles.sql
- [x] poly_worker no longer holds EXECUTE on `app.issue_operator_invitation`. pgTAP 06's C12 is updated to name the new role. — tests/db/pgtap/06_operator_invitation.sql: C12 and POLY-146 AC4 rows; tests/db/operator-invite.test.ts: definers.json
- [x] `withOperatorTx` runs on a pool configured from the operator's own `DATABASE_*` settings, never the worker pool. In a worker process it fails closed. — tests/db/operator-invite.test.ts: POLY-146 AC5 the operator has its own pool
- [x] `polycarpic cli user invite` runs in a one-shot `operator` compose service (its own profile, its own secret file, `restart: "no"`). No long-running service has the operator password: web, worker, and the staging web and worker. A test asserts that against the rendered prod and staging compose files (seceng #2). — tests/infra/lint.test.ts: operator-one-shot and secret-matrix rows, POLY-146 repo compose files
- [x] `pg_hba.prod.conf` and `pg_hba.staging.conf` admit poly_operator from the app subnet with scram. — tests/infra/lint.test.ts: pg_hba poly_operator admitted rows
- [x] The existing operator-invite tests (`tests/db/operator-invite.test.ts`, pgTAP 06) pass against the new role. — tests/db/operator-invite.test.ts and tests/db/pgtap/06_operator_invitation.sql: behaviour rows as poly_operator
- [x] SECURITY reflects the current state in C-01, C-84, R-2, R-12 (its plain-token sentence comes out) and the secrets table, and in the T1 row of the data-classification table (seceng #3). INFRA §7.5 names the operator service. ARCH §7 names the role. — docs/SECURITY/index.html 1.9.19 (81a9a9dd, seceng), docs/INFRA/index.html 1.3.10 (b5a37021, devops-engineer), docs/ARCH/index.html 1.15.22 (2eaa54b1, architect): no automated test; each owner wrote its doc and the lead read every changed passage against the ruling

## Notes

- POLY-98 (the `polycarpic-ops` wrapper) targets the `operator` service, not the worker.
- POLY-137 loses its hashed-token item to this issue.

## Estimate

1.5–2 loop-days, 1 loop (M; pricing.md (a+))

## Comments

### @team-lead — 2026-11-13

Feature started. Branch: `feature/poly-146-identity-hardening`.

### @architect — 2026-11-13

Ruling addendum 1 (seceng review): the operator service logs to driver none and operator-one-shot requires it (T-99); C13 gains effective-privilege rows; the pre-connect check is a seatbelt. See process/cairn/reviews/POLY-146/ruling.md.

### @team-lead — 2026-11-13

PR opened: https://github.com/richmosko/polycarpic/pull/126. QA verdict pass (07c22000), security review pass (81a9a9dd). Awaiting the Principal's review and merge.
