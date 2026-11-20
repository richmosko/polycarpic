---
id: POLY-150j
title: Second-step deploy gate and runbook
status: done
milestone: POLY-M1
parent: POLY-150
blocked_by: []
assignee: devops-engineer
paths: [process/cairn/issues/POLY-150.md, process/cairn/reviews/POLY-150/**, process/cairn/issues/POLY-150j.md, infra/**, docs/INFRA/**, tests/infra/**, tests/db/gate-check*.test.ts, tests/ci/db-areas.test.ts, infra/ci/changes.mjs]
stage: execute
estimate.cost_usd: "4.00"
estimate.gate_cycles: 3
actual.cost_usd: "1.0373"
actual.tokens: 4011237
actual.gate_cycles: 2
actual.wall_clock: 212
ratio: "0.26"
labels: [design, security]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-19
---

devops extends the deploy-gate check and INFRA for what POLY-150 adds.

## Acceptance criteria

- [x] `infra/postgres/gate-check.sql` gains the rows the ruling names (Addendum 5: the sync triggers and body pin, `complete_step_up`, the three step-up triggers; `app.my_second_step()` in poly_app's function count). Each refusal is shown to fail with a planted fault.
- [x] INFRA §7.1 step 16 lists them, and states that the 24-hour delay and method-change emails (POLY-137) are a condition of the first deploy with real household data.
- [x] INFRA's `reset-mfa` runbook says how the operator checks who is asking before running it.
