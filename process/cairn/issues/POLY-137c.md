---
id: POLY-137c
title: Auth follow-ups tests
status: done
milestone: POLY-M1
parent: POLY-137
blocked_by: [POLY-137b]
assignee: qa-engineer
paths: [process/cairn/issues/POLY-137.md, process/cairn/reviews/POLY-137/**, process/cairn/issues/POLY-137c.md, tests/**, apps/web/tests/e2e/**, infra/ci/**, packages/**/*.test.ts, apps/**/*.test.ts]
stage: execute
estimate.cost_usd: "18.00"
estimate.gate_cycles: 4
actual.cost_usd: "4.9831"
actual.tokens: 40235220
actual.gate_cycles: 7
actual.wall_clock: 171
ratio: "0.28"
labels: [auth, security, bloat]
priority: null
pr: null
created: 2026-11-21
updated: 2026-11-21
---

qa writes the failing tests from the ruling, then measures the build green.

## Acceptance criteria

- [x] A test plan at `process/cairn/reviews/POLY-137/test-plan.md` maps every row of this loop's criteria to a test, each with what makes it red.
- [x] The tests are shown red before the build (`red-run.md`); each refusal asserts its SQLSTATE and message and has a positive case.
- [x] One gate run on a clean tree at a single sha: vitest, db, e2e, lint, typecheck, `tests/ci`, `tests/infra` and `tests/layers`, with the db time against a same-day control on `main`.
- [x] POLY-137's rows for this loop are ticked with their proving tests.