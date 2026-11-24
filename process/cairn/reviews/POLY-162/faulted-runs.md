# T-real: the new assertions shown red on a fault (qa-162)

Real Linux (privileged Ubuntu 24.04 container, Docker 29.1.3, Compose 5.7.1), branch tip 9b0b9015 for the tests. Each fault is injected into a copy of the test inside the container (never committed), run with `--bail 0`. Unfaulted baseline: run 5, 3 files, 17/17.

| Assertion | Fault injected | Result |
|---|---|---|
| B2 worker `RestartCount` 0 | the worker's host process killed with `kill -9` (restart policy fires), after the healthy check | red: `the worker restarted: expected '1' to be '0'` |
| B2, first try | `docker kill` | not a fault: Docker treats a manual kill as a stop, no restart, `RestartCount` stays 0; the model was changed to the process dying by itself |
| B3 exact container set | an extra container labelled as the project's `operator` service | red in part 1 and part 2: `expected [ Array(5) ] to deeply equal [ 'auth', 'postgres', 'web', 'worker' ]` |
| B4 hostile directory unreadable | the caller directory made 0755 | red: `the caller directory: expected '755 root:root' to be '700 root:root'` |
| B4 no operator / planted / migrate | the extra `operator` container (B3's fault) | red: `a operator container exists` |
| B6 reason, `up` line, window | candidate web that crashes at start | NOT red: the tool waits the whole window (≥120 s) and rolls back `unhealthy`; the candidate was started. A crash at start is the same case, not a missed one |
| B6 lower bound (≥ 120 s) | the installed tool's `HEALTH_WAIT` cut from 120 to 3 | red, but on `deploy: rollback-unhealthy` (the restored release cannot be healthy in 3 s), so the lower-bound line itself did not fire. The bound is not shown on its own |
| B6 first stub (run 1 of the loop) | candidate `web check-config` never exits | red: `refused check-config` instead of `rolled-back` (the test reads the tool's own last line) |

Nothing here changes what ships. The B6 lower bound stands as an assertion without its own red; say so in the verdict.
