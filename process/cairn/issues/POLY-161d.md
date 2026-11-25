---
id: POLY-161d
title: Web server build
status: done
milestone: POLY-M1
parent: POLY-161
blocked_by: []
assignee: frontend-lead
paths: [process/cairn/issues/POLY-161.md, process/cairn/reviews/POLY-161/**, process/cairn/issues/POLY-161d.md, apps/web/**, packages/config/src/check.ts, packages/config/src/**, packages/*/package.json, pnpm-lock.yaml, package.json, layers.json, eslint.config.js, scripts/layers/**]
stage: execute
estimate.cost_usd: "20.00"
estimate.gate_cycles: 3
actual.cost_usd: "2.0954"
actual.tokens: 10719416
actual.gate_cycles: 3
actual.wall_clock: 75
ratio: "0.10"
labels: []
priority: null
pr: null
created: 2026-11-24
updated: 2026-11-24
---

Build for POLY-161 in apps/web: the production server on 3000, health on the real server, the stand-in listener removed, the startup zone check.