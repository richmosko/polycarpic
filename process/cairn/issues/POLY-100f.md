---
id: POLY-100f
title: Deploy migrate preflight
status: todo
milestone: POLY-M1
parent: POLY-100
blocked_by: []
assignee: backend-lead
paths: [process/cairn/issues/POLY-100.md, process/cairn/reviews/POLY-100/**, process/cairn/issues/POLY-100f.md, packages/db/**]
stage: execute
estimate.cost_usd: "12.00"
estimate.gate_cycles: 2
labels: []
priority: null
pr: null
created: 2026-11-23
updated: 2026-11-23
---

The migrate-runner role preflight in packages/db to ruling R11 (process/cairn/reviews/POLY-100/ruling.md): migrate and --plan exit 2, applying nothing, when poly_backup holds any grant beyond CONNECT or owns any object.