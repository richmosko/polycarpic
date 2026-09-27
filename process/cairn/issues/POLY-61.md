---
id: POLY-61
title: Receiver engine-staleness self-check, SIGCONT cleanup (grouped)
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P3
pr: null
created: 2026-09-27
updated: 2026-09-27
---

Grouped follow-ups from the POLY-59 loop (2026-09-27): architect bubble-up at gate 1 (d9a966c, ruling §1) and a non-blocking nit from the gate-4 verdict (cb22427). One PR closes every item.

**The receiver cannot notice that its code on disk changed.** The daemon started 2026-09-25 19:58 (pid 4949) ran pre-POLY-50 code until 2026-09-27 18:23 and logged 167 false `['POLY-A', 'POLY-B']` collision warnings; main-branch flushes over that window were likely bucketed `main`, not `milestone:POLY-A`. The board has `cairnlib/enginesrc` (`engine_fingerprint` / `engine_is_stale`) for exactly this; the receiver has no equivalent, so a merge that touches `otel_receiver.py` or `cairnlib/` protects future processes only. `/merge-pr` restarts the daemon when `otel_receiver.py` is in the diff, but not when only `cairnlib/` changed (the POLY-50 case).

**Status-test cleanup can raise.** `test_otel_receiver_watchdog_attribution`'s `addCleanup(os.kill, pid, SIGCONT)` raises `ProcessLookupError` if the daemon has already died; it surfaces as a cleanup error, never masks a failure.

## Acceptance criteria

- [ ] `--status` reports `engine: stale` when the running receiver's engine fingerprint differs from the checkout's (`cairnlib/enginesrc` reused, not copied), with a test
- [ ] `/merge-pr` → Sync local restarts the daemon when the merged diff touches `cairnlib/` as well as `otel_receiver.py`; the skill text names both paths
- [ ] The SIGCONT cleanup tolerates an already-exited daemon (`ProcessLookupError` swallowed), with a named mutation

## Comments

### @team-lead — 2026-09-27

Feature started. Branch: `feature/poly-61-receiver-staleness-check`. Filed under the archived `POLY-A` (Bootstrap & Tooling) by the user, 2026-09-27; merge pre-cleared once green. Archived with POLY-A at close.
