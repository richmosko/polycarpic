---
id: POLY-25
title: otel_receiver H3 endpoint/port agreement check never runs: OTEL_* vars do not reach hook-spawned processes
status: backlog
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P3
pr: null
created: 2026-09-24
updated: 2026-09-24
---


## Comments

### @team-lead — 2026-09-24

From the POLY-10 gate-1 ruling (architect, scripts/cairn/design/telemetry-attribution.md @ 3d83a20, M6/M7): the harness applies `OTEL_*` from `.claude/settings.json` → `env` to its own OTel SDK only; neither tool subshells nor hook-spawned processes see them (measured `ps eww` on the live receiver). So the receiver's H3 check (endpoint/port agreement, gated on `OTEL_EXPORTER_OTLP_ENDPOINT`) never executes and TRACKER's H1 ("env block reaches hook-spawned subprocesses") is false. POLY-10 corrects the doc; this issue is the code: make the H3 check read its expected endpoint from the settings file (or a cairn config key) rather than the environment, with a test.
