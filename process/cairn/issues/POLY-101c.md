---
id: POLY-101c
title: Route-policy row tests
status: done
milestone: POLY-M1
parent: POLY-101
blocked_by: []
assignee: qa-engineer
paths: [tests/ci/**, packages/auth/src/**, process/cairn/reviews/POLY-101/**, process/cairn/issues/POLY-101.md, process/cairn/issues/POLY-101c.md, tests/db/auth-route-policy.test.ts]
stage: execute
estimate.cost_usd: "4.00"
estimate.gate_cycles: 1
actual.cost_usd: "2.6410"
actual.tokens: 11020942
actual.gate_cycles: 1
actual.wall_clock: 32
ratio: "0.66"
labels: []
priority: null
pr: null
created: 2026-11-25
updated: 2026-11-25
---

Failing tests for POLY-101 first: the filter and workflow pins, and the acceptance proof (a BetterAuth bump with an unclassified route fails; classified passes). Red run recorded; build-green measurement; criteria ticked.