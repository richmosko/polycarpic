---
id: POLY-59
title: Telemetry follow-ups: receiver root, CI flakes, backfill (grouped)
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P3
pr: null
created: 2026-09-26
updated: 2026-09-27
---

Grouped follow-ups from the POLY-50 loop (2026-09-26): architect bubble-ups at gate 1 (208f408) and gate 4 (b5ed00f), plus two CI flakes seen the same day. One PR closes every item.

**Receiver computed milestone windows against the wrong repo root.** `process/cairn/metrics/otel_receiver.log` carries 5 lines of `milestone_windows dropped colliding milestone window(s) ['PT-0.10', … 'PT-0.9']` — project_template milestone ids, not this repo's. A receiver ran `milestone_windows` against another checkout (the template repo, or a worktree-resolver mis-anchor). Verify from the lines' neighbours in the log.

**Two receiver tests flaked once each in CI on doc-only commits, green on rerun and locally:**
- run 36277345298 (PR #23 @ 26153fb): `test_otel_receiver_watchdog_attribution…test_status_reports_watchdog_and_last_flush` — `--status` returned rc 0 with a stale heartbeat, expected 2.
- run 36278579860 (PR #24 @ 18bbecb): `test_otel_receiver_self_stop…test_a_datapoint_posted_during_the_grace_window_lands_in_the_final_flush` — the final flush never wrote `--out-file`.
Timing-sensitive; candidates for injected-clock fixes alongside POLY-49's AC2/AC5 notes.

**Backfill edges (POLY-50 verdict, non-blocking):**
- No test covers a record within one second of `_otel_cutoff`; the boundary rounding is correct but no mutation guards it.
- `_branch_at` rebuilds its lookup list per call; the full run is 0.9 s today, so only worth doing when the timeline grows.

## Acceptance criteria

- [ ] The PT-* window-collision lines are explained (which process, which root) and the receiver anchors `milestone_windows` on the main checkout's `process/cairn/`, with a test
- [ ] Both flaky receiver tests are deterministic (injected clock or explicit trigger); 10 consecutive 8-worker runs green
- [ ] A test pins the `_otel_cutoff` one-second boundary with a named mutation
- [ ] `_branch_at` reuses its lookup list across calls (or the ruling records why not)

## Comments

### @team-lead — 2026-09-27

Feature started. Branch: `feature/poly-59-telemetry-follow-ups`. Promoted straight from backlog (user, 2026-09-27); user pre-cleared the merge once green.
