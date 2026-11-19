---
id: POLY-149e
title: Revocation deploy gate and cost
status: todo
milestone: POLY-M1
parent: POLY-149
blocked_by: []
assignee: devops-engineer
paths: [process/cairn/issues/POLY-149.md, process/cairn/reviews/POLY-149/**, process/cairn/issues/POLY-149e.md, infra/**, docs/INFRA/**, tests/infra/**]
stage: execute
estimate.cost_usd: "4.00"
estimate.gate_cycles: 3
labels: [security, auth]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-19
---

devops updates the deploy-gate check and INFRA, and measures the auth container.

## Acceptance criteria

- [ ] INFRA §7.1 step 16's check passes on the revoked schema and refuses when the revocation, the growing lock or the record is missing, or when a login role can write to the record. Each refusal is shown to fail.
- [ ] INFRA §2.2 and §7.5 state the current state.
- [ ] The auth container's RSS at idle and under the e2e suite is recorded against ARCH §7.3.
