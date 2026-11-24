---
id: POLY-100g
title: Deploy health listener
status: todo
milestone: POLY-M1
parent: POLY-100
blocked_by: []
assignee: backend-lead
paths: [process/cairn/issues/POLY-100.md, process/cairn/reviews/POLY-100/**, process/cairn/issues/POLY-100g.md, apps/web/**]
stage: execute
estimate.cost_usd: "8.00"
estimate.gate_cycles: 2
labels: []
priority: null
pr: null
created: 2026-11-23
updated: 2026-11-23
---

The minimal public health listener in apps/web, to the POLY-100 ruling's row for it (Principal, 2026-11-24, option A): GET /api/v1/health from the existing handleHealth on 0.0.0.0:3000 and a fixed 404 for everything else, with seceng's conditions. Replaced by the real server (see the web-server issue); it never runs beside it.