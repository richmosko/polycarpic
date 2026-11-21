---
id: POLY-137d
title: Auth follow-ups build
status: todo
milestone: POLY-M1
parent: POLY-137
blocked_by: [POLY-137c]
assignee: backend-lead
paths: [process/cairn/issues/POLY-137.md, process/cairn/reviews/POLY-137/**, process/cairn/issues/POLY-137d.md, packages/**, apps/**, layers.json, eslint.config.js, scripts/layers/**, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .gitignore, bin/**, infra/postgres/**, infra/compose/**, docs/INFRA/**]
stage: execute
estimate.cost_usd: "18.00"
estimate.gate_cycles: 3
labels: [auth, security]
priority: null
pr: null
created: 2026-11-21
updated: 2026-11-21
---

backend-lead builds to qa's red tests and the ruling.

## Acceptance criteria

- [ ] Every row of POLY-137's criteria for this loop is built as ruled; no grant beyond the ruling's list.
- [ ] The deploy-gate check refuses when the 24-hour hold or the method-change email is missing.
- [ ] qa's suite is green without any test being changed by the builder.