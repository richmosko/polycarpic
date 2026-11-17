---
id: POLY-152c
title: Sign-in service tests
status: done
milestone: POLY-M1
parent: POLY-152
blocked_by: [POLY-152b]
assignee: qa-engineer
paths: [process/cairn/issues/POLY-152.md, process/cairn/reviews/POLY-152/**, process/cairn/issues/POLY-152c.md, tests/**, apps/web/tests/e2e/**, apps/web/src/**/*.test.ts, infra/ci/**, packages/**/*.test.ts, apps/**/*.test.ts]
stage: execute
estimate.cost_usd: "16.00"
estimate.gate_cycles: 3
actual.cost_usd: "15.6558"
actual.tokens: 109774804
actual.gate_cycles: 7
actual.wall_clock: 73
ratio: "0.98"
labels: [security, auth, bloat]
priority: null
pr: null
created: 2026-11-17
updated: 2026-11-17
---

qa writes the failing tests for POLY-152 from the ruling and seceng's attack list, then measures green on a clean tree.

## Acceptance criteria

- [ ] A test plan maps each of POLY-152's 9 criteria and each attack-list item to a named test.
- [ ] The tests are red before the build for the right reason, with the run recorded.
- [ ] Every existing auth and second-step test runs as the real poly_auth role; the fixture created IN ROLE poly_app is gone.
- [ ] A clean-tree run is green at the sha handed to seceng, with counts per suite and the db suite's time against a same-day control on main.