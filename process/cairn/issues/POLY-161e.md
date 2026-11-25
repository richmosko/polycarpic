---
id: POLY-161e
title: Web server image and CI
status: done
milestone: POLY-M1
parent: POLY-161
blocked_by: []
assignee: devops-engineer
paths: [process/cairn/issues/POLY-161.md, process/cairn/reviews/POLY-161/**, process/cairn/issues/POLY-161e.md, infra/**, .github/workflows/**, Dockerfile, .dockerignore, docs/INFRA/**, tests/infra/**, tests/ci/**]
stage: execute
estimate.cost_usd: "15.00"
estimate.gate_cycles: 3
actual.cost_usd: "3.1609"
actual.tokens: 18542882
actual.gate_cycles: 5
actual.wall_clock: 128
ratio: "0.21"
labels: [bloat]
priority: null
pr: null
created: 2026-11-24
updated: 2026-11-24
---

Image and CI for POLY-161: vite build in the image build stage, .dockerignore, compose and guard values if the ruling changes them, T-real's trigger, INFRA.