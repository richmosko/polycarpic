---
id: POLY-149e
title: Revocation deploy gate and cost
status: done
milestone: POLY-M1
parent: POLY-149
blocked_by: []
assignee: devops-engineer
paths: [process/cairn/issues/POLY-149.md, process/cairn/reviews/POLY-149/**, process/cairn/issues/POLY-149e.md, infra/**, docs/INFRA/**, tests/infra/**, tests/db/gate-check.test.ts, tests/db/gate-check-membership.test.ts, tests/db/vitest.config.ts, tests/ci/db-areas.test.ts, tests/ci/db-harness.test.ts]
stage: execute
estimate.cost_usd: "4.00"
estimate.gate_cycles: 3
actual.cost_usd: "2.2818"
actual.tokens: 11376394
actual.gate_cycles: 4
actual.wall_clock: 73
ratio: "0.57"
labels: [security, auth, bloat]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-19
---

devops updates the deploy-gate check and INFRA, and measures the auth container.

## Acceptance criteria

- [x] INFRA §7.1 step 16's check passes on the revoked schema and refuses when the revocation, the growing lock or the record is missing, or when a login role can write to the record. Each refusal is shown to fail.
- [x] INFRA §2.2 and §7.5 state the current state.
- [x] The auth container's RSS at idle and under the e2e suite is recorded against ARCH §7.3.
