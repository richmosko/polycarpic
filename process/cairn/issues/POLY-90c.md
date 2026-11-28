---
id: POLY-90c
title: Founder gate tests
status: done
milestone: POLY-M1
parent: POLY-90
blocked_by: []
assignee: qa-engineer
paths: [process/cairn/issues/POLY-90.md, process/cairn/reviews/POLY-90/**, process/cairn/issues/POLY-90c.md, tests/**, infra/ci/**]
stage: execute
estimate.cost_usd: "12.00"
estimate.gate_cycles: 3
actual.cost_usd: "7.9987"
actual.tokens: 32968901
actual.gate_cycles: 4
actual.wall_clock: 366
ratio: "0.67"
labels: [bloat]
priority: null
pr: null
created: 2026-11-27
updated: 2026-11-27
---

Failing tests for POLY-90 from the ruling (ARCH §3.1b Tests: the gate, founder and 1 → 2 items), each asserting SQLSTATE and message with a positive case per guard; the build-green gate and the mutant table.