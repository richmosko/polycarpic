---
id: POLY-160c
title: Deploy follow-ups tests
status: done
milestone: POLY-M1
parent: POLY-160
blocked_by: []
assignee: qa-engineer
paths: [process/cairn/issues/POLY-160.md, process/cairn/reviews/POLY-160/**, process/cairn/issues/POLY-160c.md, tests/**, packages/db/src/**/*.test.ts, packages/db/tests/**, infra/ci/**, .github/workflows/**, package.json, pnpm-lock.yaml, apps/*/tests/**, apps/*/src/**/*.test.ts]
stage: execute
estimate.cost_usd: "15.00"
estimate.gate_cycles: 3
actual.cost_usd: "12.6416"
actual.tokens: 86288570
actual.gate_cycles: 0
actual.wall_clock: null
ratio: "0.84"
labels: []
priority: null
pr: null
created: 2026-11-24
updated: 2026-11-24
---

Failing tests first for POLY-160, each shown red on its fault; T-real green with its CI time recorded against the 20-minute limit; the gate.