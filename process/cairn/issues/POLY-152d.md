---
id: POLY-152d
title: Sign-in service build
status: backlog
milestone: POLY-M1
parent: POLY-152
blocked_by: [POLY-152c]
assignee: backend-lead
paths: [process/cairn/issues/POLY-152.md, process/cairn/reviews/POLY-152/**, process/cairn/issues/POLY-152d.md, packages/**, apps/**, layers.json, eslint.config.js, scripts/layers/**, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .gitignore, bin/**]
stage: execute
estimate.cost_usd: "26.00"
estimate.gate_cycles: 3
labels: [security, auth]
priority: null
pr: null
created: 2026-11-17
updated: 2026-11-17
---

backend-lead builds the service, its role, the definers and the retarget of sign-up and the second-step guards.

## Acceptance criteria

- [ ] Every qa test for POLY-152 passes without editing a test; a test believed wrong goes back to qa.
- [ ] Any claim about BetterAuth's behaviour that the build rests on comes from a live run, not a source read.
- [ ] Lint, tsc, svelte-check and the layer check are clean.