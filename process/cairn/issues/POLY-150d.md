---
id: POLY-150d
title: Second-step screens tests
status: todo
milestone: POLY-M1
parent: POLY-150
blocked_by: []
assignee: qa-engineer
paths: [process/cairn/issues/POLY-150.md, process/cairn/reviews/POLY-150/**, process/cairn/issues/POLY-150d.md, tests/**, apps/web/tests/e2e/**, infra/ci/**, packages/**/*.test.ts, apps/**/*.test.ts]
stage: execute
estimate.cost_usd: "9.00"
estimate.gate_cycles: 5
labels: [design, security]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-19
---

qa writes the failing tests from the ruling and measures the gate.

## Acceptance criteria

- [ ] A browser test shows an enrolled user held at `/sign-in` until the second step passes.
- [ ] A browser test enrols a user end to end against the real handler.
- [ ] `test-plan.md`, `red-run.md` and `gate.md` are written; POLY-150's criteria are ticked with their proving tests.
