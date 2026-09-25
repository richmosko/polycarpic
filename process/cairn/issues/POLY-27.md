---
id: POLY-27
title: otel_receiver watchdog: recreate-after-60s must hold while the metrics parent dir is absent (mid-swap mkdir -p breaks git worktree add)
status: backlog
milestone: POLY-A
parent: POLY-49
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P3
pr: null
created: 2026-09-24
updated: 2026-09-25
---


## Comments

### @team-lead — 2026-09-24

Gap in the POLY-10 ruling, found by the architect at review (POLY-10.md @ 10040ad): the recreate step after `REGISTRY_ABSENT_RECREATE_SECONDS` uses `mkdir(parents=True)`, which can recreate `process/cairn/metrics/` itself while `ensure_metrics_worktree.py` has it swapped aside, making the path non-empty and failing `git worktree add` (ruling M2). Fix: recreate only when `sessions_dir.parent` exists; otherwise keep holding. Narrow today: the swap runs once per checkout (metrics is already a worktree here), and only after ≥60 s absent. One test: parent absent past the bound → no mkdir, still holding.
