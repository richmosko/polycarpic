---
id: POLY-153c
title: Handle entry tests
status: done
milestone: POLY-M1
parent: POLY-153
blocked_by: [POLY-153b]
assignee: qa-engineer
paths: [process/cairn/issues/POLY-153.md, process/cairn/reviews/POLY-153/**, process/cairn/issues/POLY-153c.md, tests/**, apps/web/tests/e2e/**, apps/web/src/**/*.test.ts, infra/ci/**, packages/**/*.test.ts, apps/**/*.test.ts]
stage: execute
estimate.cost_usd: "16.00"
estimate.gate_cycles: 4
actual.cost_usd: "11.0276"
actual.tokens: 71301541
actual.gate_cycles: 0
actual.wall_clock: null
ratio: "0.69"
labels: [security, auth]
priority: null
pr: null
created: 2026-11-18
updated: 2026-11-18
---

qa writes the failing tests from the ruling, then measures the build green.

## Acceptance criteria

- [ ] A test plan at `process/cairn/reviews/POLY-153/test-plan.md` maps every POLY-153 criterion to a test, each with what makes it red.
- [ ] The tests are shown red before the build (`red-run.md`), including the forgery case (a stored `handle_hash` as bytea and as hex text gets no user) and the forced handle-INSERT failure.
- [ ] One gate run on a clean tree at a single sha: vitest, db, e2e, lint and typecheck, with the db time against a same-day control on `main`.
- [ ] POLY-152's follow-ups N2 and N6 are done here.
- [ ] POLY-153's criteria are ticked with their proving tests.
