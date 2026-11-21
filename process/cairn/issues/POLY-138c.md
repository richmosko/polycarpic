---
id: POLY-138c
title: Caddy and edge tests
status: todo
milestone: POLY-M1
parent: POLY-138
blocked_by: [POLY-138b]
assignee: qa-engineer
paths: [process/cairn/issues/POLY-138.md, process/cairn/reviews/POLY-138/**, process/cairn/issues/POLY-138c.md, tests/**, infra/ci/**]
stage: execute
estimate.cost_usd: "8.00"
estimate.gate_cycles: 3
labels: [ops, security]
priority: null
pr: null
created: 2026-11-21
updated: 2026-11-21
---

qa writes the failing tests from the ruling, then measures the build green.

## Acceptance criteria

- [ ] A test plan at `process/cairn/reviews/POLY-138/test-plan.md` maps every POLY-138 criterion to a test, each with what makes it red.
- [ ] The tests are shown red before the build (`red-run.md`), including a container test that a forged `X-Forwarded-For` arrives as one entry and a test that `SHOW server_version` matches the image tag.
- [ ] One gate run on a clean tree at a single sha: `tests/infra`, `tests/ci`, `tests/layers`, `tests/image`, lint and typecheck, with the image-build time reported against a same-day control on `main`.
- [ ] POLY-138's criteria are ticked with their proving tests.