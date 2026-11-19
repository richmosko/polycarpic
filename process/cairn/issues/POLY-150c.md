---
id: POLY-150c
title: Second-step screens security review
status: todo
milestone: POLY-M1
parent: POLY-150
blocked_by: []
assignee: seceng
paths: [process/cairn/issues/POLY-150.md, process/cairn/reviews/POLY-150/**, process/cairn/issues/POLY-150c.md, docs/SECURITY/**, process/cairn/issues/POLY-137.md, process/cairn/issues/POLY-151.md]
stage: plan
estimate.cost_usd: "5.00"
estimate.gate_cycles: 2
labels: [design, security]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-19
---

seceng reviews the ruling before tests and the build at the gate sha.

## Acceptance criteria

- [ ] `ruling-review.md` accepts the ruling at an exact sha, or lists required changes.
- [ ] `build-review.md` accepts the build at the gate sha: no secret or code reaches web's logs or page data, the backup codes are shown once, and the pages leak nothing about whether an account exists.
- [ ] SECURITY states the current state for anything the screens change.
