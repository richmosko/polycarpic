# POLY-142 gate 3: QA legs at 09165dc

## 1. Full db battery on the branch (`vitest run -c tests/db/vitest.config.ts`, the CI battery step's command)

3 runs, all rc 0: 446 passed + 2 expected fail = 448, 0 failed, 0 skipped. The builder's count matches (446 + 2).
Control on main at the merge base (558caf6): 412 passed + 2 expected fail = 414. Delta +34 tests: operator-invite 22, wrappers +4 operator tests and +7 matrix pairs, pgTAP 06, CI-map and dockerfile pins.

## 2. Timing guard (ruling R7: cap +9 s on the battery step, n = 3 alternating branch/control, same machine, same hour)

| run | branch wall | control wall |
|---|---|---|
| 1 | 57 s | 52 s |
| 2 | 57 s | 50 s |
| 3 | 56 s | 50 s |
| median | 57 s | 50 s |

Delta +7 s wall at the median (vitest's own Duration, run 1 each: 54.2 s vs 50.7 s, +3.5 s). Inside the +9 cap, no cut needed. `tests/db/operator-invite.test.ts` file time is 12.4 s (12.55, 12.39, 12.42 s), above the ruling's 7 s estimate; the parallel group absorbs it, which is why the battery grows by 3.5-7 s. Local Docker, not CI hardware: the CI job median is the lead's number to read after the PR's first run.

## 3. Web e2e, whole suite once

`pnpm exec turbo run e2e` (not `--affected`): 52 passed, 0 failed (22.4 s).

## 4. Red-gate caveat discharged

Every test that failed at import now reaches its assertions: 448/448. Two spot mutations on the built code, each turned the named test red and nothing else, then reverted (tree clean):
- the link also written to stderr: only C7 "the token goes nowhere else" fails;
- the origin read from `BETTER_AUTH_URL` before `io.origin`: only C6/C9 "through the image dispatcher ... PUBLIC_ORIGIN" fails.
Every title still ends with its `[red if: ...]` mutation.

## Notes

- The control worktree sat under `.claude/worktrees/qa-142-ctl` and is removed after this gate.
- No `.github/workflows` diff, as ruled.
