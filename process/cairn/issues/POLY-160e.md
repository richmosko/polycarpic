---
id: POLY-160e
title: Pool error listener
status: todo
milestone: POLY-M1
parent: POLY-160
blocked_by: []
assignee: backend-lead
paths: [process/cairn/issues/POLY-160.md, process/cairn/reviews/POLY-160/**, process/cairn/issues/POLY-160e.md, packages/db/**, packages/*/package.json, apps/*/package.json, pnpm-lock.yaml, layers.json, eslint.config.js]
stage: execute
estimate.cost_usd: "4.00"
estimate.gate_cycles: 2
labels: []
priority: null
pr: null
created: 2026-11-24
updated: 2026-11-24
---

Every pool in packages/db handles a client error, idle or checked out, so a Postgres restart does not take web, auth or the worker down.