---
id: POLY-90c
title: Founder gate tests
status: in-progress
milestone: POLY-M1
parent: POLY-90
blocked_by: []
assignee: qa-engineer
paths: [process/cairn/issues/POLY-90.md, process/cairn/reviews/POLY-90/**, process/cairn/issues/POLY-90c.md, tests/**, infra/ci/**]
stage: execute
estimate.cost_usd: "12.00"
estimate.gate_cycles: 3
labels: []
priority: null
pr: null
created: 2026-11-27
updated: 2026-11-27
---

Failing tests for POLY-90 from the ruling (ARCH §3.1b Tests: the gate, founder and 1 → 2 items), each asserting SQLSTATE and message with a positive case per guard; the build-green gate and the mutant table.