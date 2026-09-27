# POLY-58 gate-2 timing baseline (ruling §7)

qa-engineer, 2026-09-27, on `55fd4b2` (`scripts/cairn/` is byte-identical between
`55fd4b2` and this commit's parent `b156d14` — `git diff --stat 55fd4b2 b156d14 --
scripts/cairn/` is empty, so the measurement below stands for both shas). Machine:
Darwin, 10 logical cores (`sysctl -n hw.ncpu`).

Command: `python3 scripts/cairn/run_tests.py --gate red` (default workers = 8, the
same command CI runs, `--gate red` added only because a full run inside Claude Code
is refused without a gate declaration — PT-119). 1 warm-up run discarded, then 5
timed runs via `/usr/bin/time -p`, real seconds. Every run: 1899 tests, 110 files,
8 workers, `OK (skipped=4)` — the suite is green at the baseline, no test in this
sample failed or errored.

| Run | Real (s) |
|---|---|
| warm-up (discarded) | 46.00 |
| 1 | 45.84 |
| 2 | 46.18 |
| 3 | 45.74 |
| 4 | 46.37 |
| 5 | 45.94 |

**Before-median = 45.94 s.** min = 45.74, max = 46.37, spread = (max−min)/median =
0.63 / 45.94 = **0.0137**.

**Threshold for verdict (ruling §7):** after-median ≤ before-median × (1 +
max(0.05, spread)) = 45.94 × 1.05 = **48.24 s** (the 5% floor governs since the
measured spread, 0.0137, is below it).

The architect re-measures the same command, same protocol, at build-green for the
verdict.
