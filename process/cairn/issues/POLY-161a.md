---
id: POLY-161a
title: Web server ruling
status: done
milestone: POLY-M1
parent: POLY-161
blocked_by: []
assignee: architect
paths: [process/cairn/issues/POLY-161.md, process/cairn/reviews/POLY-161/**, process/cairn/issues/POLY-161a.md, docs/ARCH/**]
stage: plan
estimate.cost_usd: "12.00"
estimate.gate_cycles: 2
actual.cost_usd: "5.1101"
actual.tokens: 8151604
actual.gate_cycles: 3
actual.wall_clock: 12
ratio: "0.43"
labels: [bloat]
priority: null
pr: null
created: 2026-11-24
updated: 2026-11-24
---

Ruling for POLY-161: how the production SvelteKit server is built into the image and mounted on 3000, the startup order (zone check before listen), what replaces the stand-in listener, the limits it keeps, and T-real against the new image. With the pre-registered verdict checklist.