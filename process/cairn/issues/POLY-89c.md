---
id: POLY-89c
title: Second step tests
status: done
milestone: POLY-M1
parent: POLY-89
blocked_by: [POLY-89a]
assignee: qa-engineer
paths: [process/cairn/issues/POLY-89.md, process/cairn/reviews/POLY-89/**, process/cairn/issues/POLY-89c.md, tests/**, infra/ci/**, apps/web/tests/e2e/**, apps/web/src/hooks.server*.test.ts]
stage: execute
estimate.cost_usd: "14.00"
estimate.gate_cycles: 3
actual.cost_usd: "10.0115"
actual.tokens: 64110429
actual.gate_cycles: 9
actual.wall_clock: 1182
ratio: "0.72"
labels: [auth, security, bloat]
priority: null
pr: null
created: 2026-11-16
updated: 2026-11-16
---

qa-engineer writes the failing tests for POLY-89's 15 criteria from the reviewed ruling, then measures build green. New `tests/db` files get a `DB_AREAS` entry in `infra/ci/changes.mjs`.

## Acceptance criteria

- [ ] One named test or assertion per POLY-89 criterion, red for the stated reason before the build, recorded in a comment.
- [ ] Guard tests run as both poly_app and poly_auth where the ruling says the guard is role-indifferent.
- [ ] Build green measured on a clean tree at a named sha, including `tests/ci`, `tests/infra` and `tests/layers`; the suite-time delta is reported against a same-day control on main.
- [ ] POLY-89's criteria are ticked with their proving tests.