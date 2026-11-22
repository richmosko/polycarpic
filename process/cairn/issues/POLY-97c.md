---
id: POLY-97c
title: Provisioning tests
status: done
milestone: POLY-M1
parent: POLY-97
blocked_by: [POLY-97b]
assignee: qa-engineer
paths: [process/cairn/issues/POLY-97.md, process/cairn/reviews/POLY-97/**, process/cairn/issues/POLY-97c.md, tests/**, infra/ci/**, .github/workflows/**, package.json, pnpm-lock.yaml]
stage: execute
estimate.cost_usd: "15.00"
estimate.gate_cycles: 3
actual.cost_usd: "4.8518"
actual.tokens: 20069451
actual.gate_cycles: 0
actual.wall_clock: null
ratio: "0.32"
labels: [ops, infra]
priority: null
pr: null
created: 2026-11-22
updated: 2026-11-22
---

Stage sub-issue of POLY-97; the acceptance text is in process/cairn/reviews/POLY-97/ruling.md.

## Comments

### @qa-engineer-97 — 2026-11-22

tests red (gate 2): 181 new tests (105 vitest dry run, 70 Python, 6 CI wiring green by construction); 175 red, each for its own missing behaviour. test-plan.md (rows, contract pins) and red-run.md in process/cairn/reviews/POLY-97/. 3 existing postgres.test.ts tests fail on this Mac with or without my files (pre-existing).
