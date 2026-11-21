---
id: POLY-138c
title: Caddy and edge tests
status: done
milestone: POLY-M1
parent: POLY-138
blocked_by: [POLY-138b]
assignee: qa-engineer
paths: [process/cairn/issues/POLY-138.md, process/cairn/reviews/POLY-138/**, process/cairn/issues/POLY-138c.md, tests/**, infra/ci/**]
stage: execute
estimate.cost_usd: "8.00"
estimate.gate_cycles: 3
actual.cost_usd: "17.1722"
actual.tokens: 108459096
actual.gate_cycles: 9
actual.wall_clock: 110
ratio: "2.15"
labels: [ops, security, bloat]
priority: null
pr: null
created: 2026-11-21
updated: 2026-11-21
---

qa writes the failing tests from the ruling, then measures the build green.

## Acceptance criteria

- [x] A test plan at `process/cairn/reviews/POLY-138/test-plan.md` maps every POLY-138 criterion to a test, each with what makes it red.
- [x] The tests are shown red before the build (`red-run.md`), including a container test that a forged `X-Forwarded-For` arrives as one entry and a test that `SHOW server_version` matches the image tag.
- [x] One gate run on a clean tree at a single sha: `tests/infra`, `tests/ci`, `tests/layers`, `tests/image`, lint and typecheck, with the image-build time reported against a same-day control on `main`.
- [x] POLY-138's criteria are ticked with their proving tests.