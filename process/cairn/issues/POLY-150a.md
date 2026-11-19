---
id: POLY-150a
title: Second-step screens design
status: todo
milestone: POLY-M1
parent: POLY-150
blocked_by: []
assignee: ux-designer
paths: [process/cairn/issues/POLY-150.md, process/cairn/reviews/POLY-150/**, process/cairn/issues/POLY-150a.md, docs/DESIGN/**]
stage: plan
estimate.cost_usd: "8.00"
estimate.gate_cycles: 3
labels: [design, security]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-19
---

ux-designer completes DESIGN for the second step from what is already there (flow 5.11 and the spec's Second step section).

## Acceptance criteria

- [ ] DESIGN carries the set-up flow (`#flow-second-step`): password, emailed code, then the factor (authenticator app or passkey), with the backup codes shown once, as styled screens.
- [ ] DESIGN carries `/sign-in/second-step` for an enrolled user on a new device, with its wrong-code, locked and backup-code states, and the Confirm it's you prompt.
- [ ] The Principal has reviewed the screens before the build starts.
