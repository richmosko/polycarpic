---
id: POLY-138d
title: Caddy and edge build
status: todo
milestone: POLY-M1
parent: POLY-138
blocked_by: [POLY-138c]
assignee: devops-engineer
paths: [process/cairn/issues/POLY-138.md, process/cairn/reviews/POLY-138/**, process/cairn/issues/POLY-138d.md, infra/**, docs/INFRA/**, .dockerignore, Dockerfile, renovate.json, .github/**, .gitignore]
stage: execute
estimate.cost_usd: "8.00"
estimate.gate_cycles: 3
labels: [ops, security]
priority: null
pr: null
created: 2026-11-21
updated: 2026-11-21
---

devops-engineer builds to qa's red tests and the ruling.

## Acceptance criteria

- [ ] Every POLY-138 criterion is built as ruled.
- [ ] Nothing in the image build disables Go checksum verification.
- [ ] INFRA is updated for what this loop changes.
- [ ] qa's suite is green without any test being changed by the builder.