---
id: POLY-49c
title: POLY-49 execute: build
status: in-progress
milestone: POLY-A
parent: POLY-49
blocked_by: [POLY-49b]
assignee: implementation-lead
paths: [scripts/cairn/otel_receiver.py, scripts/cairn/worktree_root.py, scripts/cairn/run_tests.py, scripts/cairn/ensure_metrics_worktree.py, scripts/cairn/cairn.py, process/TRACKER.md, .claude/hooks/**, process/cairn/issues/POLY-49.md, process/cairn/issues/POLY-49c.md]
stage: execute
estimate.cost_usd: "12.00"
estimate.gate_cycles: 1
labels: [cairn, telemetry]
priority: null
pr: null
created: 2026-09-25
updated: 2026-09-25
---


## Comments

### @implementation-lead — 2026-09-25

Build-green @ 6a23d2f (== origin tip, nothing further to push). Full `run_tests.py --gate green` (includes tests/workflow): 1840 tests, 108 files, 0 failures, 0 errors, 4 skipped.

Per criterion:
- POLY-7/9/25/27: code + their own tests green.
- Watchdog recreate deterministic/widened: green here; the 10x8-worker repeat count is qa's own red-gate measurement (ruling §2), not re-run separately by me.
- `--flush-now` from a linked worktree resolves the main checkout's real pidfile (worktree_root.main_checkout_root), or fails loudly naming it: green.
- 30-min/3-teammate loop, flush cadence honours the interval: the underlying mechanisms (watchdog-tick interval flush, foreign-session filter) are implemented and unit-verified; the live 30-minute loop itself isn't exercised by this test suite.
- Self-stop periodic-sweep, deterministic: rewritten per ruling §2/§4, green.
- `--status` lists every session, dead within one watchdog beat, empty live set arms self-stop: pid-only reap every tick (ruling §4), green.
- `--ensure-running` registers either way; a dead-pid entry drops within one beat: green.

Ready for qa/architect verdict.
