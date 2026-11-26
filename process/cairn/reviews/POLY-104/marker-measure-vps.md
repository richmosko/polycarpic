# POLY-147 R7: the identity marker's cost on the VPS (run under POLY-104)

The re-run on the first staging box that POLY-97's criterion 6 moved to POLY-104. The local measurement and the method are in `../POLY-147/marker-measure.md`; this file sits with POLY-104's records, not beside it as the criterion says, because the issue's paths do not take in `reviews/POLY-147/`. Run by the lead, 2026-11-26 UTC. Raw lines: `marker-measure-vps.jsonl` (24, in run order).

## Setup

- Box: Hetzner `cx33` (4 vCPU / 8 GB), Ubuntu 24.04.5. **Staging was running on the same box.**
- Server: a throwaway `postgres:17.12` container (the digest `infra/postgres/Dockerfile` pins) on its own Docker network, with default settings. Its data sat on the root disk, **not** on the LUKS volume. It was not staging's Postgres.
- Client: a throwaway `node:26.12.0-slim` container with `postgresql-client`, `git` and `pnpm` 12.18.0 added.
- Branch `71ba9813`; control `33faf77f` (before the marker). Both ran `71ba9813`'s `tests/db/bench/`, because the current bench calls an API the control does not have. The `sha` field of every line is empty: the trees were `git archive` copies with no `.git`.
- Six runs per side, alternating, control first.
- A first attempt measured nothing: every run failed because the client image had no `git`, which the bench calls. The 24 lines are the second attempt, with no failed run.

## Medians and deltas (median of six per side)

| case | metric | control | branch | delta | limit | verdict |
|---|---|---|---|---|---|---|
| S | p95 ms | 1.084 | 2.343 | +1.259 | <= 5 ms | PASS |
| S | WAL B/tx | 0 | 231.1 | +231.1 | <= 1024 B | PASS |
| L | p95 ms | 3.836 | 3.832 | -0.004 | <= 5 ms | PASS |
| L | WAL B/tx | 0 | 231.1 | +231.1 | <= 1024 B | PASS |

**Result: both limits hold in both cases.**

## Reading

- 231.1 B per transaction on the branch in 9 of 12 branch lines, as in the local run. The other three (392.6, 370.1, 370.7) are higher, and three control lines are above 0 (363.6, 138.8, 123.6): the harness reads the server-wide WAL position.
- The p95 cost on case S is larger than in the local run (+1.259 ms against +0.238 ms) and still a quarter of the limit. Why was not examined.
- Not measured: concurrent load, a cold cache, data on the LUKS volume.
