---
id: POLY-162a
title: Deploy test: tests
status: done
milestone: POLY-M1
parent: POLY-162
blocked_by: []
assignee: qa-engineer
paths: [process/cairn/issues/POLY-162.md, process/cairn/reviews/POLY-162/**, process/cairn/issues/POLY-162a.md, tests/**, apps/web/tests/**, infra/ci/**, .github/workflows/**, package.json, pnpm-lock.yaml]
stage: execute
estimate.cost_usd: "45.00"
estimate.gate_cycles: 4
actual.cost_usd: "8.1587"
actual.tokens: 54569913
actual.gate_cycles: 0
actual.wall_clock: null
ratio: "0.18"
labels: []
priority: null
pr: null
created: 2026-11-24
updated: 2026-11-24
---

Tests for POLY-162: the G15 listener test, G13/G14 pins shown red on the fault, and T-real (tests/infra/deploy-real) passing end to end on real Linux, with its CI step and timing.