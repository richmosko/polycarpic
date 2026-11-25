# POLY-160c gate (qa-160)

Final-tip read: tests `6bc343e9` on devops-160's build `5dbbfaf1` (through B1–B3) and backend-160's `9537df46`. "Green" = passes on the build; "red" = shown red on the named base or mutant (`red-run.md`, B5 table). This is evidence, not a verdict: seceng-160 and the architect rule at their gates.

## 1. Suites on this tip

| Suite (CI's exact command) | Result |
|---|---|
| `tests/infra/ops`, three discover patterns | **633 tests, 0 failed** (385 `test_deploy*`, 229 others, 19 dispatcher) |
| `vitest run -c tests/infra/vitest.config.ts` | 668 passed, 3 skipped, 0 failed (671) at `e65307c0`; the files changed since (`test_*.py`, T-real) are not in it |
| `vitest run -c tests/ci/vitest.config.ts` | 743 / 743 |
| `vitest run tests/layers` | 568 / 568 |
| `vitest run -c tests/config/vitest.config.ts` | 100 passed, 15 skipped |
| `packages/db`, `apps/*` unit | 440 / 440 (playwright specs are not vitest's) |
| `tests/db`: web-server 32, wrappers, auth-service-main 9, worker-mail-jobs 9 | green on `9537df46`; red by mutant (below) |
| `host.test.ts` R6/R7 box cases | 9 / 9 on the build; red on the `7613d4e9` scripts |
| T-real, local privileged container, tip `db8cf1c5` | **27 / 27, 502 s** (8 min 22 s; 412 s before B7); B7 red on the mutant "no stand-down in `recover`"; C28 red on "Compose check above `recover`"; the restart case red on `survive()` a no-op |
| CI 45561301953 on `e65307c0` | all green (app, cairn, changes, db, deploy-real, guard, image, lint, provision, unit) |

## 2. Suite time against a same-day control

Control 45538719357 (03:15 UTC, POLY-161's PR run) against 45559878210 (`88482c31`) and 45561301953 (`e65307c0`), the lead's figures where stated.

| Job | Control | Tip runs | Reading |
|---|---|---|---|
| deploy-real | 458 s | 558 s, 573 s; **631 s at `655fb279` (CI 45565943755, with B7): 70 % of 900 s** | +100 to +115 s: the C28, restart and (later) B7 cases; 15-minute limit: 62–64 % used before B7; the local container adds 90 s for B7, so expect about 11 minutes in CI: **re-measure** |
| db | 306 s | 359 s | +53 s: web down/up (a 5.5 s memo wait and the restart wait), outage and wrapper cases; one run |
| unit | 439 s | 442 s | none |
| provision | 245 s | 211 s | none |
| image | 324 s | 624 s, 647 s | **not like-for-like**: the control was a pull_request run whose filter skipped "Backup, uploader, restore and drill container tests" (344 s); the other image steps match (build 29 vs 27, derivatives 92 vs 105, container tests 137 vs 152) (lead's measurement) |

One or two runs decide nothing; only deploy-real is a real addition.

## 3. Every ruled item

**T** = tested, green, a mutant red (B5 table); **P** = partly (the gap named); **NB** = not built, with the reason; **N/A** = not qa's.

### R1
| Item | Status |
|---|---|
| 1 who clears the mark; Ctrl-C keeps it | T (Ctrl-C in `up`, in the health wait, in the recovery's own `up`, in the unwind's restore, edge); a second signal *inside* the stop: NB (needs a signal sent from the fake's `docker stop`; the existing wrapper catches `BaseException`, by reading) |
| 2 `stand_down` (plain Docker, `keep_ref`, `not-stopped`, another project untouched) | T; the second `ps` read-back distinct from the exit code: P (a stop that exits 0 but leaves the container running is not in the fake) |
| 3a–3c restore first, quarantined `current`, lifted line, failed restore, stuck | T |
| 3d malformed mark: restore, `state`, mark kept (empty, truncated, junk); unreadable (link) | T; the `sudo rm` help text: NB (seceng accepted INFRA's wording; not asserted) |
| 3e mark names `current`, healthy and now-unhealthy | T |
| 3f no `current`: stand down (planted mark; Ctrl-C; SIGHUP/SIGTERM; unhealthy first deploy) | T; prod's Caddy: **POLY-165 by the ruling, not built** |
| 3g record not on disk keeps the mark | T |
| 4 stuck: a different digest deploys and ends healthy, clearing mark and alert; same digest ends `rollback-unhealthy`; junk mark ends before any candidate (staging, edge); final alert order | T (edge `current-quarantined` form accepted by seceng) |
| 5 position: Compose, **token**, `previous`, `transient-since`, `edge.env`, unmounted volume | T (each, red when moved above `recover` where a mutant moves it: token, `edge.env`, unmounted: tests exist and pass on the build, their position mutants are owed, see B5) |
| 6 Compose mismatch: differing render with the pair bytes unchanged; environment differing never upped; tampered pair; tampered tree; edge allowlist both Compose cases | T |
| 7 work directory after `recover` | T |
| 8 signals SIGHUP/SIGTERM, handlers put back; interrupt after the commit stops nothing (B2) | T; stderr closed: NB |
| 9 `rollback` by hand with a mark (project, edge), exit 1, fallback | T; "a second `rollback` then does what it says": NB |
| 10 `fsync` order, errors raise | T |
| 11 idempotent quarantine | T |
| 12 status 08 | T |
| 13 containers cannot write state | N/A |

### R2, R3, R4
| Item | Status |
|---|---|
| R2.1 commit; re-read before/after write; put-back, and the put-back failing too | T |
| R2.2 `settle` | P (link failure then next run settles: T; prod `images.env`, `first-attempt`, `interrupted`, prune steps individually: NB, each is a one-line unlink/copy covered only through the whole settle) |
| R2.3 nothing unwinds after the commit; unreadable `interrupted` | T; `edge-probe-baseline` in its own `try`: NB |
| R2.4 `previous == current` exit 4, `rollback-pointers`, edge forms | T for project; edge: NB |
| R3 `held-`: unjudged, polls 2–3 up nothing, lifts with another bundle, another digest unaffected | T |
| R4.1 `check-config` timeout vs exit code 124 | T (one service; per-service accepted by seceng) |
| R4.2 transient and `busy` with `log` raising | T (transient and busy); `clear_transient` raising: NB |

### R5 (pool)
T: unit per pool; canaries; once per client; 10 s bound; `close()` clears it; web down/up (same pid, no crash, bounded log); wrappers (C20, C21 before COMMIT and mid-query); auth and worker outage; the three `db.connection_lost.<pool>` lines asserted (auth, web after a page's query; all three in T-real); red when each registration is removed and when the error object is passed on. **C21 "during COMMIT": not built.** seceng ruled the "cannot be timed" reason not accepted and set a follow-up (a proxy that forwards the client's bytes until `COMMIT` passes, then drops without relaying the answer); it is not written here, and goes to the lead's next batch in writing.

### R6, R7
R6: T (five invocations, `CDPATH`, text pins). R7: absent, good, link, non-empty home T; "not root-owned" and "group- or other-writable" home: NB (not written; each is one more box case beside the link case); `provision.sh --stage database` stopping on `render-path`: text-pinned only, accepted by seceng.

### R8 (docs)
N/A for qa. The ruling's Ctrl-C runbook line is run once on the box in POLY-104.

### The 13, the delta's 2, the rest
| # | Status |
|---|---|
| 1–3, 5, 7 | T |
| 4 saved pair: hash, bytes, environment, tampered pair and tree | T (hash and `pair_ok`: equivalent at the outcome, see B5) |
| 6 pointer write failing; quarantined `current`; unreadable quarantine file bans nothing | P (the first two T; the unreadable file: NB) |
| 8 edge recovers: tags, same/lower/absent; tampered tree | P (tags T; edge's tree check and the stderr line: NB) |
| 9 C20, C21 | T, but "at COMMIT" not built (above) |
| 10 `CDPATH` | T |
| 11 link, not root-owned, writable, not empty | P (link, non-empty) |
| 12 T-real SIGKILL then mismatched Compose | T (local red/green; CI wall time above) |
| 13 prod backup | N/A (POLY-165) |
| delta 1 saved pair must not bring old settings back | T (environment compared; the `restart`-key positive case; the edge allowlist) |
| delta 2 `rollback` exit 1 | T |
| S36 | T |
| R1.3b lift | T (red on the plain-search mutant) |
| R1.4 corrected | T |
| exemptions 1 and 2 | T, mutants in B5 |
| build review B1, B2, B3 | T (red on `200d3bc3`, green after devops-160's fixes) |
| B6 | T |
| B7 | T (local: green on the build, red on the mutant) |

## 4. Deviations and judgement calls

1. **C20/C21 lose the connection at the client socket**, not by `pg_terminate_backend` (tests/ci bars cluster-wide verbs in the parallel project): accepted by seceng.
2. **The earlier reason for not asserting `db.connection_lost.*` was wrong**: the `connect` listener is on idle clients too, so the restart is reported. T-real, auth and web now assert it.
3. **The `unjudged` trigger** (saved render bytes changed after the candidate's `up`) is a harness construction; it reaches `unjudged` on the build; its red on the old code is by the missing `held-` line.
4. **Survivor "pair_ok dropped"** is equivalent at the outcome (two later checks refuse the same inputs); named in B5.
5. **Tests that carry a build-side finding were fixed on my side twice**: first-deploy cuts hung at Postgres's own `up`; the edge allowlist hook was keyed on the raw render (devops-160 found it). Both were test faults.
6. The fake `docker ps/inspect/stop` is mine; it refuses any `docker stop` flag but `-t`/`--timeout` (B3).

## 5. Owed

(a) CI's deploy-real wall time with B7; (b) the not-built rows above, none dropped by choice: C21 "during COMMIT" (follow-up), R7's two home states, `edge-probe-baseline` and `clear_transient` raising, the prod settle steps singly, edge forms of R2.4 and the tree check, a second signal inside the stop, stderr closed, the `sudo rm` help text; (c) the position mutants for the token, `edge.env` and the unmounted volume (B5 "not mutated").
