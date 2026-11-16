---
id: POLY-89d
title: Second step build
status: done
milestone: POLY-M1
parent: POLY-89
blocked_by: [POLY-89c]
assignee: backend-lead
paths: [process/cairn/issues/POLY-89.md, process/cairn/reviews/POLY-89/**, process/cairn/issues/POLY-89d.md, packages/**, apps/**, layers.json, eslint.config.js, scripts/layers/**, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .gitignore, docs/INFRA/**]
stage: execute
estimate.cost_usd: "20.00"
estimate.gate_cycles: 3
actual.cost_usd: "8.1486"
actual.tokens: 50727876
actual.gate_cycles: 0
actual.wall_clock: null
ratio: "0.41"
labels: [auth, security]
priority: null
pr: null
created: 2026-11-16
updated: 2026-11-16
---

backend-lead builds POLY-89 to the ruling and qa's tests: migrations, `packages/auth` hooks, tenancy gates, the operator reset.

## Acceptance criteria

- [ ] Every qa test for POLY-89 passes without editing a test; a test believed wrong goes back to qa.
- [ ] No new poly_app grant on BetterAuth's tables; every definer reads the user from `app.current_user_id()`.
- [ ] The first-verify session rotation can insert its session (the `recent_auth_at` gap from POLY-148).
- [ ] seceng's blocking findings from the build review are fixed.