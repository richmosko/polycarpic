# POLY-147 R7 — cost of the identity marker

Measured by qa-147. Harness: `tests/db/bench/` (`marker-measure.bench.ts`, own vitest config; not part of the suite).

## Setup

- Host: Apple M1 Max, 10 cores, macOS (Darwin 25.6.0, arm64). Everything on one machine, nothing else heavy running.
- Server: one Docker container, image `polycarpic-pgtap:7958605b474b`, PostgreSQL 17.12 (Debian, aarch64); container psql 17.12; host psql 14.24 (admin only; no `\bind` in the bench). Same container and port for every run.
- Control: `origin/main` @ 33faf77f64f68dad4850854acf6e07eefb3803ae, with `tests/db/bench/` copied in. Branch: `feature/poly-147-identity-marker` @ 71ba981376958a0a6fe66b5380dc92a748f4a5dd.
- Per run, per case: fresh database migrated by that tree; 1 user. Case S: 20 entities + 20 owner memberships. Case L: 2,000 of each (seeded as superuser with `session_replication_role = replica`, then ANALYZE). `configure({ app, max: 1 })`.
- Body: `withTenant(uid, sid, tx => tx.execute(sql\`SELECT count(*) FROM public.entity\`))`; 50 warm-ups discarded; CHECKPOINT; read `pg_current_wal_lsn()`; 1,000 sequential timed transactions (`performance.now()` around each); LSN again. WAL bytes per tx = `pg_wal_lsn_diff` / 1,000.
- Six runs, alternating control then branch, 2026-11-15.

## All lines (JSON per run and case, in run order)

| run | tree | case | p50 ms | p95 ms | WAL B/tx |
|---|---|---|---|---|---|
| 1 | control | S | 1.485 | 1.845 | 0 |
| 1 | control | L | 2.661 | 3.112 | 0 |
| 1 | branch | S | 1.807 | 2.539 | 231.1 |
| 1 | branch | L | 2.462 | 3.12 | 596 |
| 2 | control | S | 1.528 | 2.33 | 0 |
| 2 | control | L | 2.684 | 4.063 | 0 |
| 2 | branch | S | 1.644 | 2.007 | 231.1 |
| 2 | branch | L | 2.39 | 3.747 | 231.1 |
| 3 | control | S | 1.447 | 1.704 | 0 |
| 3 | control | L | 2.675 | 4.043 | 0 |
| 3 | branch | S | 1.648 | 2.123 | 231.1 |
| 3 | branch | L | 2.354 | 3.387 | 231.1 |
| 4 | control | S | 1.434 | 1.725 | 239.7 |
| 4 | control | L | 2.737 | 4.177 | 0 |
| 4 | branch | S | 1.648 | 1.989 | 231.1 |
| 4 | branch | L | 2.359 | 3.301 | 231.1 |
| 5 | control | S | 1.589 | 2.066 | 0 |
| 5 | control | L | 2.774 | 4.363 | 0 |
| 5 | branch | S | 1.644 | 1.978 | 231.1 |
| 5 | branch | L | 2.403 | 3.725 | 231.1 |
| 6 | control | S | 1.446 | 1.693 | 0 |
| 6 | control | L | 2.709 | 4.023 | 433.5 |
| 6 | branch | S | 1.648 | 2.039 | 359.4 |
| 6 | branch | L | 2.399 | 3.348 | 368.4 |

## Medians and deltas (median of six per side)

| case | metric | control | branch | delta | threshold | verdict |
|---|---|---|---|---|---|---|
| S | p50 ms | 1.466 | 1.648 | +0.182 | not gated | n/a |
| S | p95 ms | 1.785 | 2.023 | +0.238 | <= 5 ms | PASS |
| S | WAL B/tx | 0.000 | 231.100 | +231.100 | <= 1024 B | PASS |
| L | p50 ms | 2.697 | 2.394 | -0.302 | not gated | n/a |
| L | p95 ms | 4.053 | 3.367 | -0.686 | <= 5 ms | PASS |
| L | WAL B/tx | 0.000 | 231.100 | +231.100 | <= 1024 B | PASS |

**Result: both thresholds hold in both cases (no fallback needed).**

## Reading

- The marker costs one small WAL record per request, the row insert: 231.1 bytes per transaction in 9 of 12 branch lines. The other three (359.4, 368.4, 596) carry background WAL, as the control lines below do. The median, 231.1 B, is under a quarter of the 1 KB limit.
- Control shows 0 WAL per transaction in 10 of 12 lines, as a read-only transaction should. Two control lines (239.7 in run 4 case S, 433.5 in run 6 case L) include WAL from something else on the server (autovacuum or checkpointer activity while the LSN was read): the harness reads the server-wide LSN. Medians absorb it; the raw lines are above, not edited.
- Latency: p95 rises by well under a millisecond on the small case. On case L the branch is faster than the control at both p50 and p95 (unmeasured explanation: the new `current_user_id()` is a keyed lookup of one marker row per query, where the old form read a setting and cast it at every policy check; the plans were not compared). The L result is the check seceng asked for: no per-row evaluation cost shows.
- Not measured: concurrent load, a cold cache, or the purge's cost (it runs only with the worker's first job loop).

