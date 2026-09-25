---
id: POLY-49
title: Receiver hardening (grouped): H3 endpoint check, recreate holds while metrics parent absent, ensure_metrics_worktree tests, watchdog-test flake, leading-* paths YAML
status: todo
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P3
pr: null
created: 2026-09-25
updated: 2026-09-25
---


## Comments

### @team-lead — 2026-09-25

Grouped fix loop (user decision 2026-09-25). One PR closes every member. Members: POLY-7, POLY-25, POLY-27, POLY-9.

Additional acceptance criteria carried here, not filed separately:
- **watchdog-test flake:** `test_otel_receiver_watchdog_attribution.WatchdogRecreatesAfterAbsentBoundTests.test_watchdog_recreates_after_absent_bound` missed its 0.5 s recreate bound once under the 8-worker full run (POLY-26 red gate, 2026-09-25), clean on 4 reruns. Widen the bound or make it deterministic (inject the clock).
- **flush from a worktree:** `otel_receiver.py --flush-now` run from a teammate worktree finds no pidfile and does nothing silently; it should resolve the main checkout's pidfile or fail loudly (observed by architect and qa this loop).
