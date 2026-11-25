# POLY-160c gate (qa-160)

Tip read: tests `22f37c87`, build `200d3bc3` (devops-160), `9537df46` (backend-160). "Green" = the test passes on the build; "red" = shown red on the named base or mutant (`red-run.md`). Nothing here is a verdict: seceng-160 and the architect rule at their gates.

## 1. Result of the suites on the tip

| Suite (CI's exact command) | Result |
|---|---|
| `tests/infra/ops`, three discover patterns | 606 tests; 3 red at `74f9054e` = `stuck_end` faults, since fixed by devops-160's `200d3bc3` (its count: green). **Re-run on the final tip still owed** (see 5) |
| `vitest run -c tests/infra/vitest.config.ts` | 668 passed, 3 skipped, 0 failed (671) at `e65307c0` |
| `vitest run -c tests/ci/vitest.config.ts` | 743 / 743 |
| `vitest run tests/layers` | 568 / 568 |
| `vitest run -c tests/config/vitest.config.ts` | 100 passed, 15 skipped |
| `packages/db`, `apps/{web,auth,worker}` unit (playwright specs excluded: not vitest's) | 440 / 440 |
| `tests/db`: web-server (32), wrappers C20/C21, auth-service-main (9), worker-mail-jobs (9) | green on `9537df46`; red by mutant (client `error` line removed; `survive()` a no-op) |
| `host.test.ts` R6/R7 box cases | 9 / 9 on the build; red on the `7613d4e9` scripts |
| T-real, local privileged container | 26 / 26, 412 s; C28 red on the mutant "Compose check above `recover`"; the restart case red on `survive()` a no-op |
| CI run 45559878210 on `88482c31` | green: guard, cairn, changes, provision, db, unit, image, deploy-real; red: lint (the R7 pin, fixed at `e65307c0`). Run 45561301953 on `e65307c0` was in progress when written |

## 2. Suite time: the delta against a same-day control

Control = CI run 45538719357 (03:15 UTC, POLY-161's last green PR run: main's content before this loop). Tip = run 45559878210 (06:20 UTC, `88482c31`). Same day, same runner class; one run each, so only a large delta means anything.

| Job | Control | Tip | Delta | Reading |
|---|---|---|---|---|
| deploy-real | 458 s (7:38) | 558 s (9:18) | +100 s | the two new cases; limit 15 min: 62 % used. Local container: 412 s for all 26 tests |
| db | 306 s | 359 s | +53 s | new web down/up (5.5 s memo wait + up to 60 s), outage and wrapper cases; plausible, within one-run noise |
| unit | 439 s | 442 s | +3 s | none |
| provision | 245 s | 211 s | −34 s | none (noise) |
| image | 324 s | 624 s | **+300 s** | **not explained**: no test added to that job; cold build cache is the first guess. Needs a second run before it is called noise or a regression |
| lint | 420 s | 338 s | not comparable | that job failed early on the R7 pin |

Per rule, one or two runs do not decide: the `image` job is the one to re-measure (run 45561301953, `e65307c0`).

## 3. Every ruled item

Status: **T** = tested, green on the build, mutant named in `red-run.md`; **P** = partly tested (what is missing is named); **O** = open, no test; **N/A** = not testable by qa.

### R1
| Item | Status | Where |
|---|---|---|
| R1.1 who clears the mark; Ctrl-C keeps it | T | `recover_checks` Ctrl-C; `recover_edge` Ctrl-C; second signal inside the unwind/recovery: **O** |
| R1.2 `stand_down` (plain Docker, `keep_ref`, `not-stopped`) | T | `standdown` (3 services stopped, Postgres not, no `down`/`rm`, `keep_ref`, failed stop); `ps` read-back by a second `ps`: **O** |
| R1.3a absent mark | T | every non-mark case |
| R1.3b restore first; quarantined `current`; lifted line | T | `recover_checks`, shown red on the plain-search mutant |
| R1.3c failed restore: stand-down, no quarantine, `stuck` | T | `standdown` ten polls; stuck cases |
| R1.3d malformed mark: restore, then `state`, mark kept | T | empty, truncated, junk. Unreadable (not malformed) mark and the `help_lines` text with the `sudo rm` command: **O** |
| R1.3e mark names `current`: settle, never quarantined | T | `recover_checks` (twice) |
| R1.3f no `current`: stand down, prod's Caddy back | P | staging only; prod's Caddy: **O** |
| R1.3g record not on disk keeps the mark | T | `standdown` |
| R1.3h unlink | T | by the cases above |
| R1.4 stuck: different digest deploys; final alert order | T | `FinalAlert` (3 cases); edge form of `current-quarantined`: **O**; edge `not-stopped` form was red on `ddf0cc61`, devops-160's fix owed a green run; "same digest and no candidate ends `rollback-unhealthy`, exit 1": **O** |
| R1.5 position: Compose, token, `previous`, `transient-since`; unreadable `edge.env`; unmounted data volume | P | Compose, `previous`, `transient-since` T; token, `edge.env`, unmounted volume: **O** |
| R1.6 Compose mismatch uses the saved pair only if env equal | P | `recover` mismatch case (the fake's fresh render equals the saved: `keep=True`-dropped and tampered-pair mutants are **not** reached); S36 variant T |
| R1.7 work directory after `recover` | T | `mkdtemp` ENOSPC |
| R1.8 signals SIGHUP/SIGTERM, handlers put back | T | `standdown` (first deploy); stderr closed, double signal, edge: **O** |
| R1.9 `rollback` by hand with a mark (project, edge), exit 1 | T | `recover_edge`; "a second `rollback` then does what it says": **O** |
| R1.10 `fsync` file, replace, `fsync` directory | T | `test_release_records` (red/green) |
| R1.11 quarantine idempotent | T | same |
| R1.12 status 08 | T | 2 red + 1 positive guard |
| R1.13 no container writes state | N/A | by the guard's own tests, unchanged |

### R2
| Item | Status |
|---|---|
| R2.1 `commit` and the re-read | T (before and after write; put-back failing too: **O**) |
| R2.2 `settle` idempotent, steps each in `try`, edge differences | P (link fails then next run settles: T; prod `images.env`, `first-attempt`, `interrupted`, prune: **O**) |
| R2.3 nothing unwinds after the commit | T (link failure; unreadable `interrupted`); `edge-probe-baseline` alert in its own `try`: **O** |
| R2.4 `rollback`: `previous == current` exit 4, `rollback-pointers` | T (project); edge form: **O** |
| R2.5 first deploy whose settle fails | N/A (POLY-165) |

### R3, R4
| Item | Status |
|---|---|
| R3 `held-<name>` after `up`, unjudged, lifts with another bundle, never touches another digest | T at the unit (`test_release_records`); `test_deploy_retry` `unjudged` trigger green on the build |
| R4.1 `check-config` client timeout vs exit code (124 included) | T for one service; "each service" and 120 s per call: **O** |
| R4.2 `rel.log` in transient, `busy`, after `up` | P (transient only; `busy` and `clear_transient` never raising: **O**) |
| R4.3 | N/A |

### R5 (pool)
All T: unit per pool, canaries, once per client, 10 s bound, `close()` clearing it; process (web down/up), auth and worker outage, C20/C21 (before COMMIT, mid-query); literal restart in T-real. **C21 "during COMMIT" cannot be timed** (see `red-run.md`; seceng-160 rules whether the two cases stand).

### R6, R7
R6 T (five invocations, `CDPATH`, text pins). R7: absent, good, link, non-empty T. "not root-owned" and "group- or other-writable" home: **O**. `provision.sh --stage database` stopping on `render-path` with nothing changed: **O** (needs the Postgres derivative, `tests/infra/provision/pg.ts`; one planted link in a `STAGE` run is the case).

### R8 (docs)
N/A for qa: INFRA §4.4–4.6, the runbook lines, ARCH §8.1, SECURITY C-83 and R-32 are the owners'. qa checks only that the ruling's Ctrl-C line is run once on the box (POLY-104).

### The 13 changes and the delta's 2
| # | Status |
|---|---|
| 1 stops, mark kept on a failed restore with a `current` | T |
| 2 edge's Caddy stopped | T |
| 3 a different digest may go while stuck | T |
| 4 saved pair: hash, guard bytes, tampered pair, tampered tree of `current` | **O** (the fake's fresh render equals the saved; needs a render hook plus a tampered file; the S36 split covers the hash and sidecar on the unwind) |
| 5 `rollback` with a mark, both forms | T |
| 6 pointer write failing; automatic restore refuses a quarantined pointer; unreadable quarantine file bans nothing | P (pointer failing and quarantined `current` T; unreadable file: **O**) |
| 7 quarantine idempotent | T |
| 8 edge says it recovered on stderr; same, lower, absent; tampered tree of `current` | P (tags T; stderr line, tampered tree **O**) |
| 9 C20, C21 | T, but "at COMMIT" is not timed |
| 10 `CDPATH` | T |
| 11 link, not root-owned, writable, not empty | P (link, non-empty) |
| 12 T-real SIGKILL then mismatched Compose | T (local: red on the mutant, green on the build; CI wall time above) |
| 13 prod backup (POLY-165) | N/A |
| delta 1 R1.6 saved pair must not bring old settings back | T for S36 (unwind) and the `restart`-key positive case; the pinned-Compose-mismatch variant needs a render that differs: **O** |
| delta 2 R1.9 exit 1 | T |
| S36 (ENOSPC, allowlist changed) | T (`unwind_more` (a), `s36_env`); edge's `edge.env` allowlist form: **O** |
| R1.3b lift | T |
| both exemptions | T, `red-run.md` |

## 4. Deviations and judgement calls for seceng-160

1. **T-real does not assert the `db.connection_lost.*` lines** the ruling's S names. An idle client at the restart is dropped by the pool with no line (R5, `survive`'s idle path); only a checked-out one reports. Not decidable from outside; the unit, web, auth, worker and wrappers cases cover the reported path.
2. **C20/C21 lose the connection at the client socket**, not by `pg_terminate_backend`: `tests/ci` bars cluster-wide verbs in the parallel project and pins `SERIAL`.
3. **The `unjudged` trigger** (saved render bytes changed after the candidate's `up`) is a harness construction; it reaches `unjudged` on the build (green) but I did not show the old code red for the same reason.
4. **Positive guards that are green on the old build** (named in `red-run.md`) turn red only on their mutants; each mutant is named, but the ones that need a build edit were not all run (only `_held`, `survive`, and the Compose-above-`recover` mutants were).
5. The fake `docker ps/inspect/stop` is mine; Postgres is never in `stop_log` because the fake has no Postgres container under the label filter used.

## 5. Owed before a verdict

(a) the open items above marked **O** (qa can write most in one pass; say which are wanted); (b) `tests/infra/ops` re-run on the final tip with counts; (c) a second CI run to settle the `image` job's +300 s; (d) the C28/restart wall time from CI's `deploy-real` (558 s whole job at `88482c31`).
