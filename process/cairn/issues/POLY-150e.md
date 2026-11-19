---
id: POLY-150e
title: Second-step screens build
status: todo
milestone: POLY-M1
parent: POLY-150
blocked_by: []
assignee: frontend-lead
paths: [process/cairn/issues/POLY-150.md, process/cairn/reviews/POLY-150/**, process/cairn/issues/POLY-150e.md, apps/web/**, packages/**, layers.json, eslint.config.js, scripts/layers/**, package.json, pnpm-lock.yaml]
stage: execute
estimate.cost_usd: "12.00"
estimate.gate_cycles: 6
labels: [design, security]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-19
---

frontend-lead builds the screens to DESIGN and the ruling until qa's tests are green.

## Acceptance criteria

- [ ] The set-up screens and `/sign-in/second-step` are built in web and replace the `/settings/second-step` placeholder.
- [ ] The screens match DESIGN's styled screens in light and dark, and work by keyboard alone.
- [ ] lint and typecheck exit 0.
