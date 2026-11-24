---
id: POLY-162c
title: Health listener in web
status: done
milestone: POLY-M1
parent: POLY-162
blocked_by: []
assignee: backend-lead
paths: [process/cairn/issues/POLY-162.md, process/cairn/reviews/POLY-162/**, process/cairn/issues/POLY-162c.md, apps/web/**, packages/*/package.json, pnpm-lock.yaml, layers.json, eslint.config.js]
stage: execute
estimate.cost_usd: "10.00"
estimate.gate_cycles: 2
actual.cost_usd: "0.5251"
actual.tokens: 1595163
actual.gate_cycles: 0
actual.wall_clock: null
ratio: "0.05"
labels: []
priority: null
pr: null
created: 2026-11-24
updated: 2026-11-24
---

G15 in apps/web: the minimal public health listener (GET /api/v1/health on 3000, fixed 404 for all else) under seceng's conditions S42 (process/cairn/reviews/POLY-100/ruling.md).