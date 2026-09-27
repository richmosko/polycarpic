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

- [ ] The PT-* window-collision lines are explained (which process, which root) and a test pins `--ingest` from a linked worktree computing `milestone_windows` against the main checkout's `process/cairn/` (amended at gate 1: the root was never wrong — ruling §1)
- [ ] Both flaky receiver tests are deterministic (explicit trigger); 10 consecutive `run_tests.py -j 8` runs of the two modules green, plus mutations M2a/M2b (amended at gate 1 — ruling §2)
- [ ] A test pins the `_otel_cutoff` one-second boundary with a named mutation
- [ ] `_branch_at` reuses its lookup list across calls (or the ruling records why not) — ruling §4 records why not; no code change

## Comments

### @team-lead — 2026-09-27

Feature started. Branch: `feature/poly-59-telemetry-follow-ups`. Promoted straight from backlog (user, 2026-09-27); user pre-cleared the merge once green.

### @architect — 2026-09-27

Gate 1 ruling: `process/reviews/POLY-59/ruling.md`. AC1: the PT-* lines are this checkout's own pre-scrub tree (db906a0's 16 milestone ids, exact match), not a mis-anchor; qa pins the worktree→main-checkout windows root with a new test, implementation-lead corrects the `main()` `--repo-root` comment. AC2: status flake = heartbeat write after `utime` (fix: SIGSTOP the daemon + 1.5 s adversarial wait); grace flake = out-file read between `server_close` and the flush (fix: wait for pidfile gone). AC3: fractional-second straddle test. AC4: no change, measured (59 calls × 130 µs, bounded by the cutoff). ACs 1/2/4 amended in place. Checklist M1–M3b in ruling §5.
