---
id: POLY-162b
title: Deploy test: ops build
status: done
milestone: POLY-M1
parent: POLY-162
blocked_by: []
assignee: devops-engineer
paths: [process/cairn/issues/POLY-162.md, process/cairn/reviews/POLY-162/**, process/cairn/issues/POLY-162b.md, infra/**, .github/workflows/**, Dockerfile, docs/INFRA/**, tests/infra/**, tests/ci/**]
stage: execute
estimate.cost_usd: "50.00"
estimate.gate_cycles: 4
actual.cost_usd: "2.6888"
actual.tokens: 15098817
actual.gate_cycles: 2
actual.wall_clock: 4
ratio: "0.05"
labels: []
priority: null
pr: null
created: 2026-11-24
updated: 2026-11-24
---

Build for POLY-162 below the app: G13 (database creation), G14 (pinned commands and entrypoints), web's compose healthcheck, T-real's CI step switched on, and every product fault T-real finds in infra.