---
id: POLY-149b
title: Revocation security review
status: todo
milestone: POLY-M1
parent: POLY-149
blocked_by: []
assignee: seceng
paths: [process/cairn/issues/POLY-149.md, process/cairn/reviews/POLY-149/**, process/cairn/issues/POLY-149b.md, docs/SECURITY/**, process/cairn/issues/POLY-137.md, process/cairn/issues/POLY-139.md]
stage: plan
estimate.cost_usd: "7.00"
estimate.gate_cycles: 2
labels: [security, auth]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-19
---

seceng reviews the ruling before tests and the build at the gate sha, and owns SECURITY's edits.

## Acceptance criteria

- [ ] `ruling-review.md` accepts the ruling at an exact sha, or lists required changes.
- [ ] `build-review.md` accepts the build at the gate sha.
- [ ] SECURITY R-2 is re-worded to its residual and never retired; the backup-code item is removed; T-18, A-31, A-39, C-84 and the secrets table state the current state only.
