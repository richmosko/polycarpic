---
id: POLY-150i
title: Confirm it's you route build
status: done
milestone: POLY-M1
parent: POLY-150
blocked_by: []
assignee: backend-lead
paths: [process/cairn/issues/POLY-150.md, process/cairn/reviews/POLY-150/**, process/cairn/issues/POLY-151.md, process/cairn/issues/POLY-150i.md, packages/**, apps/auth/**, infra/**, layers.json, eslint.config.js, scripts/layers/**, package.json, pnpm-lock.yaml]
stage: execute
estimate.cost_usd: "9.00"
estimate.gate_cycles: 5
actual.cost_usd: "5.2793"
actual.tokens: 29280694
actual.gate_cycles: 0
actual.wall_clock: null
ratio: "0.59"
labels: [design, security]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-19
---

backend-lead builds the re-check route and its definer to the ruling until qa's tests are green.

## Acceptance criteria

- [x] A passed re-check writes `recent_auth_at` through a definer; poly_app gets no new grant on BetterAuth's tables.
- [x] An enrolled user can add and remove a method after the 5-minute window, proved in `tests/db` through the real handler.
- [x] A failed or replayed re-check leaves `recent_auth_at` unchanged.
- [x] lint and typecheck exit 0.
