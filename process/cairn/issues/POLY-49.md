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

- **under-capture on the POLY-48 loop (2026-09-25):** ≈40 min, 4 roles, one flush at 21:24:40Z carrying ≈0.49M tokens total (`records: 4` per teammate role); the POLY-51 plan stage alone captured 3.0M. No flush between 20:37:05Z and 21:24:40Z although the interval is 1800 s (the 21:07 flush reported 0 lines). Either exports are not reaching the receiver or the aggregator drops them; see POLY-48's closing comment for the numbers.

## Acceptance criteria

- [ ] POLY-7, POLY-9, POLY-25, POLY-27 acceptance criteria met and closed by this PR
- [ ] Watchdog recreate test is deterministic (injected clock) or its bound is widened; 10 consecutive 8-worker runs green
- [ ] `--flush-now` from a linked worktree resolves the main checkout's pidfile, or fails loudly naming it
- [ ] A 30-minute, 3-teammate loop yields per-role token totals within the same order of magnitude as the transcript-derived backfill for the same window; the flush cadence honours the interval (a flush per 1800 s while sessions are alive)

## Comments

### @team-lead — 2026-09-25

Grouped 2026-09-25 from the POLY-26 loop's follow-ups; spec is in the body above.
