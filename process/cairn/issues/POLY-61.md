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

### @architect — 2026-09-27

Gate 1 ruling: `process/reviews/POLY-61/ruling.md`. R1 seam: `.engine-fingerprint` JSON marker in `.sessions/`, computed once at `serve()` entry over otel_receiver.py, backfill_tokens.py, cairn.py, worktree_root.py and cairnlib/ via `cairnlib.watch.engine_fingerprint`; rewritten unchanged on registry recreate. R2 `--status` line `engine: current|stale (<names>)|unknown (…)`, compared against the recorded paths. R3 exit 3 = running + engine stale (precedence 1>2>3>0). R4 `--ensure-running` warns on stderr and never restarts. R5 merge-pr text verbatim. R6 `_sigcont_if_alive`. Tests T1–T5, one named mutation each (M1–M5); guards G1–G5.

### @architect — 2026-09-27

Gate 4 verdict — **PASS** (checklist from ruling.md @ 67a9021, run once on a scratch copy of 8b8fb28).

| Axis | Result | Evidence |
|---|---|---|
| R1 seam: marker once at serve() entry, recreate rewrites the held dict | pass | 8b8fb28 |
| R2 status line after last-flush:, compares recorded paths | pass | 8b8fb28 |
| R3 rc 3, precedence 1>2>3>0, unknown leaves rc unchanged | pass | 8b8fb28 |
| R4 ensure-running warns on both already-live returns, no restart | pass | 8b8fb28 |
| R5 merge-pr sentences verbatim | pass | 8b8fb28 |
| R6 `_sigcont_if_alive`, swallows ProcessLookupError only | pass | 8b8fb28 |
| G1 `grep -c 'hashlib\|st_mtime_ns' otel_receiver.py` = 0 | pass (0) | 8b8fb28 |
| G2 six receiver modules via run_tests.py | pass: 115 tests OK, 46.2 s wall | 8b8fb28 |
| G3 `scripts/cairn/cairnlib/` in merge-pr SKILL.md ≥ 1 | pass (1) | 8b8fb28 |
| G4 M1 drops cairnlib source → T1 red | pass, note: T3 also red (T3 makes the engine stale by editing cairnlib, so the fixture overlaps with M1). Does not block | 8b8fb28 |
| G4 M2 recompute at recreate → T2 red only | pass | 8b8fb28 |
| G4 M3 drop R4 print → T3 red only | pass | 8b8fb28 |
| G4 M4 missing marker = stale → T4 red only | pass | 8b8fb28 |
| G4 M5 drop except → T5 errors with ProcessLookupError; restored → OK | pass | 8b8fb28 |
| G5 new module wall ≤ 45 s | 4.66 s | 8b8fb28 |

Scratch setup needed `.claude/settings.json` and `.gitignore` copied beside `scripts/` for hardening/self_stop to run; this is harness scope, not a defect.
