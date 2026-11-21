---
id: POLY-138d
title: Caddy and edge build
status: done
milestone: POLY-M1
parent: POLY-138
blocked_by: [POLY-138c]
assignee: devops-engineer
paths: [process/cairn/issues/POLY-138.md, process/cairn/reviews/POLY-138/**, process/cairn/issues/POLY-138d.md, infra/**, docs/INFRA/**, .dockerignore, Dockerfile, renovate.json, .github/**, .gitignore]
stage: execute
estimate.cost_usd: "8.00"
estimate.gate_cycles: 3
actual.cost_usd: "2.1364"
actual.tokens: 11209724
actual.gate_cycles: 7
actual.wall_clock: 105
ratio: "0.27"
labels: [ops, security, bloat]
priority: null
pr: null
created: 2026-11-21
updated: 2026-11-21
---

devops-engineer builds to qa's red tests and the ruling.

## Acceptance criteria

- [x] Every POLY-138 criterion is built as ruled.
- [x] Nothing in the image build disables Go checksum verification.
- [x] INFRA is updated for what this loop changes.
- [x] qa's suite is green without any test being changed by the builder.