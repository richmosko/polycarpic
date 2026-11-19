---
id: POLY-149c
title: Revocation tests
status: todo
milestone: POLY-M1
parent: POLY-149
blocked_by: []
assignee: qa-engineer
paths: [process/cairn/issues/POLY-149.md, process/cairn/reviews/POLY-149/**, process/cairn/issues/POLY-149c.md, tests/**, apps/web/tests/e2e/**, infra/ci/**, packages/**/*.test.ts, apps/**/*.test.ts]
stage: execute
estimate.cost_usd: "16.00"
estimate.gate_cycles: 9
labels: [security, auth]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-19
---

qa writes the failing tests from the ruling, shows each red against the current chain, and measures the gate.

## Acceptance criteria

- [ ] `test-plan.md` maps every POLY-149 criterion to a test; `red-run.md` shows each red before the build.
- [ ] `gate.md` records green counts for every suite at one sha, with a same-day db control on main.
- [ ] The poly_auth test fixture is the real role, not one created IN ROLE poly_app.
- [ ] POLY-149's criteria are ticked, each with its proving test.
