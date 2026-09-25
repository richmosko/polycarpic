---
id: POLY-49
title: Receiver hardening (grouped)
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

Grouped fix loop for the OTel receiver and its metrics worktree (user decision 2026-09-25: small fixes in one area ride one loop). One PR closes every member.

**Members** (each keeps its own file and criteria): POLY-7, POLY-9, POLY-25, POLY-27.

**Carried here, not filed separately:**
- **watchdog-test flake:** `test_otel_receiver_watchdog_attribution.WatchdogRecreatesAfterAbsentBoundTests.test_watchdog_recreates_after_absent_bound` missed its 0.5 s recreate bound once under the 8-worker full run (POLY-26 red gate, 2026-09-25), clean on 4 reruns.
- **flush from a worktree:** `otel_receiver.py --flush-now` run from a teammate worktree finds no pidfile and does nothing silently (observed by architect and qa in the POLY-26 loop).

## Acceptance criteria

- [ ] POLY-7, POLY-9, POLY-25, POLY-27 acceptance criteria met and closed by this PR
- [ ] Watchdog recreate test is deterministic (injected clock) or its bound is widened; 10 consecutive 8-worker runs green
- [ ] `--flush-now` from a linked worktree resolves the main checkout's pidfile, or fails loudly naming it

## Comments

### @team-lead — 2026-09-25

Grouped 2026-09-25 from the POLY-26 loop's follow-ups; spec is in the body above.
