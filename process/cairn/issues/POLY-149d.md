---
id: POLY-149d
title: Revocation build
status: todo
milestone: POLY-M1
parent: POLY-149
blocked_by: []
assignee: backend-lead
paths: [process/cairn/issues/POLY-149.md, process/cairn/reviews/POLY-149/**, process/cairn/issues/POLY-149d.md, packages/**, apps/**, layers.json, eslint.config.js, scripts/layers/**, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .gitignore, bin/**]
stage: execute
estimate.cost_usd: "12.00"
estimate.gate_cycles: 8
labels: [security, auth]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-19
---

backend-lead builds to the ruling until qa's tests are green.

## Acceptance criteria

- [ ] The revocation migration, the growing lock, the sign-in record with its purge path, and the N1 slide fix are built as ruled.
- [ ] The e2e harness's own revoke (`revoke-target.ts`) is removed or reduced to an assertion, as the ruling says.
- [ ] lint and typecheck exit 0.
