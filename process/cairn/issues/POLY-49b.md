---
id: POLY-49b
title: POLY-49 execute: red tests
status: done
milestone: POLY-A
parent: POLY-49
blocked_by: [POLY-49a]
assignee: qa-engineer
paths: [scripts/cairn/tests/**, process/cairn/issues/POLY-49.md, process/cairn/issues/POLY-49b.md]
stage: execute
estimate.cost_usd: "7.00"
estimate.gate_cycles: 1
labels: [cairn, telemetry, tests]
priority: null
pr: null
created: 2026-09-25
updated: 2026-09-25
---


## Comments

### @qa-engineer — 2026-09-25

Tests-red gate verdict — PASS, pinned to e106214.

- run_tests.py --gate finish @ e106214: 1840 tests, 108 files, 8 workers, 39.2s — OK (skipped=4).
- tests/workflow (7 files, narrowed run) @ e106214: 75 tests — OK.
- Full POLY-49b lane (11 files: test_ensure_metrics_worktree.py, test_yaml_parser.py, test_otel_receiver*.py x5, test_run_tests.py, test_worktree_metrics_path_resolution.py, test_test_run_hooks.py, test_estimation.py, test_receiver_flush_drop.py) @ e106214: 356 tests — OK, every red case from 366c705 through 6a23d2f now green.
- Flake proof, 10 consecutive runs each @ e106214: test_otel_receiver_watchdog_attribution.py at -j 8 — 10/10 OK (16 tests each). test_otel_receiver_self_stop.py at -j 4 — 10/10 OK (37 tests each).
