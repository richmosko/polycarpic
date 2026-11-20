---
id: POLY-150d
title: Second-step screens tests
status: done
milestone: POLY-M1
parent: POLY-150
blocked_by: []
assignee: qa-engineer
paths: [process/cairn/issues/POLY-150.md, process/cairn/reviews/POLY-150/**, process/cairn/issues/POLY-150d.md, tests/**, apps/web/tests/e2e/**, infra/ci/**, packages/**/*.test.ts, apps/**/*.test.ts]
stage: execute
estimate.cost_usd: "9.00"
estimate.gate_cycles: 5
actual.cost_usd: "26.5382"
actual.tokens: 190058404
actual.gate_cycles: 0
actual.wall_clock: null
ratio: "2.95"
labels: [design, security]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-19
---

qa writes the failing tests from the ruling and measures the gate.

## Acceptance criteria

- [x] A browser test shows an enrolled user held at `/sign-in` until the second step passes.
- [x] A browser test enrols a user end to end against the real handler.
- [x] `test-plan.md`, `red-run.md` and `gate.md` are written; POLY-150's criteria are ticked with their proving tests.
