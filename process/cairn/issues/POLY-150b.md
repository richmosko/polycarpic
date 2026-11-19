---
id: POLY-150b
title: Second-step screens ruling
status: todo
milestone: POLY-M1
parent: POLY-150
blocked_by: []
assignee: architect
paths: [process/cairn/issues/POLY-150.md, process/cairn/reviews/POLY-150/**, process/cairn/issues/POLY-150b.md, docs/ARCH/**]
stage: plan
estimate.cost_usd: "5.00"
estimate.gate_cycles: 2
labels: [design, security]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-19
---

The architect rules how web's screens reach the sign-in service before any test is written.

## Acceptance criteria

- [ ] A ruling at `process/cairn/reviews/POLY-150/ruling.md` names each route and page, which sign-in service endpoint each step calls, how the browser tests get an emailed code with no mailer, and how they run behind a proxy that sets the client address.
- [ ] It says what of the Confirm it's you prompt is built here and what waits for POLY-151.
- [ ] seceng has reviewed the ruling at an exact sha.
