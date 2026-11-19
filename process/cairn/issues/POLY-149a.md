---
id: POLY-149a
title: Revocation ruling
status: todo
milestone: POLY-M1
parent: POLY-149
blocked_by: []
assignee: architect
paths: [process/cairn/issues/POLY-149.md, process/cairn/reviews/POLY-149/**, process/cairn/issues/POLY-149a.md, docs/ARCH/**]
stage: plan
estimate.cost_usd: "6.00"
estimate.gate_cycles: 2
labels: [security, auth]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-19
---

The architect rules the design for POLY-149 before any test is written: the revocation migration, the growing second-step lock, the sign-in record (written by the database, per F1), the N1 slide fix, and the migration order.

## Acceptance criteria

- [ ] A ruling at `process/cairn/reviews/POLY-149/ruling.md` covers every criterion of POLY-149 and names each database object, so devops can write the deploy-gate check against them.
- [ ] It says whether the loop ships as one PR or is split, with a cost for each part.
- [ ] seceng has reviewed the ruling at an exact sha before tests start.
