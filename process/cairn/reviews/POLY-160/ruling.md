# POLY-160a ruling: deploy follow-ups (staging gates only)

Architect. Read at `d07cd4a1`. Scope: the Principal's cut (last scope comment of `POLY-160.md`). H3, H6's glob, H7, H8, H10, U1–U3 are POLY-165's.

## M. Measured

Probes ran on the existing harness (`tests/infra/ops`, fakes for Docker and GitHub), `python3 -W ignore temp/probe_h.py`; the pool on a real local Postgres 17 with
`pg_ctl -m fast restart` (pg 8.23.1, pg-pool 3.14.0; Node 26 here, the image's Node not used). No containers. The probes live in my worktree's `temp/` and are not evidence qa may reuse: qa writes its own red.
Two of my first commands were refused as too complex by the worktree guard; I split them (files with the Write tool, each command alone).

| # | Case | Today |
|---|---|---|
| M1 | mark present, Compose differs (R1) | `refused render-env`, 0 new ups, mark kept |
| M2 | mark present, token missing (R2) | `refused token`, 0 new ups, mark kept |
| M3 | mark present, ENOSPC on every `rel` write | `refused internal`, 0 new ups, **no alert** |
| M4 | mark present, ENOSPC at `mkdtemp` | the exception escapes the tool; 0 new ups, no alert |
| M5 | Ctrl-C in the health wait, staging (R4) / edge | candidate up, **mark gone, no alert**, both |
| M6 | mark present but empty | `refused state`, 0 new ups: the bad release stays |
| M7 | `link_current` fails in `_healthy` (H2) | old release up, `current` names the **new**, new digest quarantined |
| M8 | saving `current` fails after `previous` was saved | old up, `previous == current`: the real previous is lost |
| M9 | saved render altered after `up` (`unjudged`, H4) | three polls: 2 ups each, never quarantined |
| M10 | mark names the running `current`, twice | the running digest is **quarantined** |
| M11 | transient while `rel.log` raises | escapes; no `transient-since`, no alert |
| M12 | `check-config` times out | `refused check-config`, **quarantined** |
| M13 | pool, no listener: idle / checked out / in a query | process dies, all three |
| M14 | `pool.on('error')` alone | idle survives; checked out and in-query still die |
| M15 | M14 plus `pool.on('connect', c => c.on('error', …))` | all three survive; in-flight query rejects `57P01`, the next on that client rejects "not queryable", the pool drops it and the next `pool.query` works |
| M16 | `docker compose --project-directory /nonexistent … ps`, `ps -q`, `exec -T` (5.7.0, macOS) | same exit and text as `/`: H6's doubt does not reproduce. On the box's 5.7.1: (unmeasured) |
| M17 | CI `deploy-real`, run 45538719357 (2026-11-25) | 7 min 38 s wall of a **15-minute** limit; it is its own job, no longer the image job |

By reading, not run: `state/deploy` files are written with no `fsync`, and a new name is not covered by ext4's replace-via-rename flush, so a power cut can lose or empty the mark (M6 is what an empty one does).

## R. The ruling

Build order: **R1, R2, R3, R4** (one sequence, same functions, one commit each), then R6, R7; R5 independent.

### R1 (H1) the mark is kept by default; recovery comes first — `lib/deployer.py`, `lib/edge.py`, `lib/release.py`, `status/08_deploy.py`

1. **Three places clear `in-progress`:** the end of a finished `unwind` (quarantine line on disk; as today, whether or not the restore was healthy, so a fix-forward is never blocked) and the end of `settle` (R2); the end of a good `recover`. The two `finally` blocks that unlink it, and `run["held"]`, are removed. Nothing else clears it, so Ctrl-C, `SystemExit` and a raise inside the unwind keep it.
2. **`recover(project, ctx, cur)`** replaces `_handle_interrupted`. Order inside:
   a. mark absent (`FileNotFoundError` only) → return. Present, whatever it holds or whether it can be read, means interrupted.
   b. with a `cur`: restore it (`restore`, or `edge.restore`), `except Exception` → not ok. With no `cur` nothing is restored (the rerun of `first-deploy` tries again, as today). **No write, log, alert, token, network or Compose-version call precedes the restore.**
   c. not ok → alert and log `rollback-unhealthy`, each in its own `try`; stderr; `_Stop(1)`; mark kept.
   d. mark unreadable or not one digest → `Refusal("state")`, mark kept (restored every poll until the operator removes the file; a no-op `up`).
   e. mark names `cur` → `settle` (R2); no `interrupted`, no quarantine. Settle fails → `_Stop(1)`, mark kept.
   f. else alert `interrupted` and log, each in its own `try`; then the record: second time for this digest → quarantine, first → `interrupted` file. **The record not on disk → stderr, `_Stop(1)`, mark kept** (else a full disk retries the candidate every poll).
   g. unlink the mark.
3. **Position.** `_deploy_checked`: `require_data_mount` → load `current` → `recover` → then today's order: Compose version (strict), token, `tokenexp`, `previous`, `transient-since`, the rest. `edge._run`: `owned_by_prod` → `require_data_mount` → load `current` → `recover` → `check_edge_env`, Compose version, `previous`, the rest. The data mount stays first (F13: restoring onto an unmounted volume starts a fresh cluster); so does `ensure_shared` (a loosened state directory means the pointers cannot be trusted). A damaged `current` is `state`: there is nothing safe to restore.
4. **The work directory** is made after `recover` (inside the run's handler, path kept in `run["work"]`, removed in `locked`'s and `edge.deploy`'s `finally`), so M4 is `internal` with the restore done. `rel.clear_incoming` may stay first (it ignores errors).
5. **On any non-`Exception` leaving `locked` / `edge.deploy` with the mark present:** best-effort `alert interrupted`, stderr `deploy: interrupted; run the same command again`, re-raise. The wrapper is outside every other handler, so a Ctrl-C inside the unwind is covered too.
6. **`rel.write` fsyncs the temp file before `os.replace`, and the directory after it, the directory's `OSError` ignored** (a raise after the replace would report a written file as unwritten).
7. **`status` 08:** mark present, no `alert`, and (project is `edge`, or no `current`) → RED `interrupted or running; run the command again`. Nothing polls those two. `alert` still wins; a project with a `current` and a timer is unchanged.

### R2 (H2) one commit point — `lib/deployer.py`, `lib/edge.py`, `commands/rollback.py`

1. **`commit(project, ctx, cur, new, run)`**, used by `_healthy` and `edge._promote`: compute the tree hash first; save `previous`; save `current`; set `run["committed"] = True`. If either save raises: re-read `current`; it names the new digest → committed; else put `previous` back best-effort and raise (the unwind restores the old).
2. **`settle(project, ctx, rdir, digest) -> bool`**, idempotent, each step in its own `try`: link; prod `images.env`; `first-attempt`; `interrupted` when it names this digest; prune (its failure does not count). All good → clear the alert, then the mark, `_note healthy`, True. Else alert `records`, stderr, **mark kept**, False. Edge: link, prune and the rest; no `images.env`, no `first-attempt`.
3. **After the commit nothing unwinds.** `_internal`, the `Refusal` handlers (both modules) and any post-commit raise check `run["committed"]`: alert `records`, exit 1, mark kept; the next run's R1.2e finishes it. The `edge-probe-baseline` alert after `_healthy` goes in its own `try`.
4. **`rollback`, project and edge:** `previous` naming the same digest as `current` is "no previous release", exit 4. A pointer write that fails also raises the alert `rollback-pointers` (best-effort) and says to free space and run `rollback` again; `rollback.py` uses `deployer.link_current`.
5. A first deploy whose settle fails still leaves the timers off and a rerun `already-deployed`: that is H3, POLY-165. Not worsened here.

### R3 (H4) — `lib/deployer.py`, `lib/edge.py`

Every exit after the candidate's first `up` that is not healthy and not committed quarantines: `reason = err.name` for a `Refusal`, quarantine flag or not; `unhealthy` otherwise. Pre-`up` refusals are unchanged.

### R4 (H5) — `lib/deployer.py`, `lib/edge.py`

1. `check-config` timeout: 120 s; a **client timeout** is `check-config-timeout` (alert, exit 1, **no quarantine**, tried next poll). An exit code, 124 included, is `check-config` and quarantines as today: told apart by the timeout, not the number. `oneoff-stuck` unchanged.
2. `rel.log` in both `Transient` handlers, in `busy`, and every `rel.log` after the first `up` becomes `_note`.
3. The double crash on the running digest is R1.2e. `deploy-real-undo.sh` in the trigger is already done (POLY-162).

### R5 (pool) — `packages/db/src/pool.ts` only; backend-lead

```ts
function survive(pool: pg.Pool): pg.Pool {
  pool.on('error', () => undefined);                                  // an idle client's: the pool has already removed it
  pool.on('connect', (c) => { c.on('error', () => undefined); });     // a checked-out client's: its queries reject, release() drops it
  return pool;
}
```
Each of the four constructors becomes `survive(new pg.Pool({ …, Client: ExtendedClient, … }))`, the literal kept in place (the seam scan counts four). **Nothing is logged here:** pg-pool sets `err.client`, which holds the password. The failure is seen where it matters: the query rejects and health answers unreachable. The `uncaughtException` handlers stay as they are. No connect timeout, no retry. `connect` fires in the same tick the idle listener is swapped out, so there is no gap (pg-pool read; M15).

### R6 — `infra/provision.sh`

`here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)` goes directly above `cd /` (as `provision-check.sh` has it), top level; the three later resolutions (compose version, units, roles) use `$here`; no other `BASH_SOURCE` remains.

### R7 (H6) — `infra/provision-check.sh`, `infra/provision.sh`

One `rh` variable per script: the render home if it is a directory, else `/`, as `compose.opts` does; used at all four call sites. `--env-file /dev/null` stays on each. M16 says today's form works; this stops it resting on Compose's tolerance.

### R8 — INFRA (devops), ARCH §8.1 (architect, at the verdict), SECURITY C-83 and R-32 (seceng)

INFRA §4.4: R1–R4 replace the matching sentences ("Failure handling", "The record": `in-progress` lasts until an unwind or settle finishes; a malformed mark restores first; `check-config-timeout`; `records`). §4.5: the pre-migration backup is named once (Order and the step list). §4.6: manual rollback restores, then quarantines; the poll retries an interrupted restore.
Runbook line, `edge-deploy` row: "After Ctrl-C, a dropped connection or a power cut, run `edge-deploy` again with the same tag, not `rollback edge`: rollback would quarantine the good release. With the tag that was running before, it only recovers (the recovery is before any network call). Interrupting the same tag twice bans it; cut the next `edge-<n>`." §8.6 says the same for `rollback staging` while `in-progress` exists: wait one poll first, unless the poll says `rollback-unhealthy`.

## S. Test seams

- **Deploy:** `Hang`, `Helpers` (`tests/infra/ops/test_deploy_unwind.py`) and `EdgeBase`; `world.raise_cmd={"exec": KeyboardInterrupt()}` with `hang_from`; `world.compose_versions`; `patch(write=, put=, log=, alert=, quarantine=)`; `tempfile.mkdtemp`; `world.up_marks` and `compose_log` for "the last `up` names `render-<12 hex>.json` of the old digest". Names qa may call: `deployer.recover(project, ctx, cur)`, `deployer.commit(project, ctx, cur, new, run)`, `deployer.settle(project, ctx, rdir, digest)`. State: `in-progress` and `interrupted` stay `sha256:<64 hex>\n`; no new file. New alert names: `records`, `rollback-pointers`, `check-config-timeout`. No new log event. New tests go in `test_deploy_recover.py` (R1), `test_deploy_commit.py` (R2), `test_deploy_retry.py` (R3, R4); `test_status.py` for R1.7.
- **Pool, unit:** `packages/db/src/pool-errors.test.ts`, no database: for each of the four pools, `pool.emit('error', new Error('x'), {})` does not throw, and after `pool.emit('connect', c)` with `c = new EventEmitter()`, `c.emit('error', …)` does not throw.
- **Pool, process:** one case in the existing `tests/db/web-server.test.ts` (`startWeb({proxy: true})`; the proxy gains `down()` that closes the sockets and refuses, and `up()` on the same port): health 200, `down()`, health unreachable, `up()`, health 200, same pid, no `process.crash`. No new `tests/db` file.
- **Pool, literal restart:** T-real, `1-web-served.test.ts`, last case: wait until `pg_stat_activity` shows `poly_app`, `poly_auth` **and** `poly_worker` at once (ask health and auth to make them; mail drain runs every 30 s and idle clients live 10 s; fail after 90 s, never skip), `docker restart` the Postgres container, then web's health is 200 within 60 s and `State.StartedAt` and `RestartCount` of web, auth and worker are unchanged 15 s later. (That staging's worker in T-real has a mailer: unmeasured; if not, qa says so at red.)
- **Provision:** in the dry-run box, `cd /repo/infra && bash provision.sh …` and `cd /repo && bash infra/provision.sh …` both reach their first file reads; argv of the fake `docker` for R7 with and without the render home.

## V. Assertions that would pass a wrong build

| Test | Mutation that must turn it red |
|---|---|
| R1 and R2 (Compose, token) | Compose check, then token, moved back above `recover` (one mutant each) |
| ENOSPC on every write, mark present: the old release's `up` happened | alert moved above the restore |
| `mkdtemp` ENOSPC, mark present | work directory made before `recover` |
| Ctrl-C keeps the mark, staging and edge; the next run restores | `finally: unlink` put back, in each module (two mutants) |
| Ctrl-C **inside the unwind's restore** keeps the mark and alerts | the wrapper placed inside `_deploy` beside the handlers |
| Edge: the rerun's first `up` is the old render, before any `gh` or `git` call | `recover` after `_release` |
| Empty, garbage and unreadable mark: restored, then `state`, mark kept | `Refusal` before the restore |
| Record not on disk: mark kept, the candidate is not upped in that run or the next | unlink the mark regardless |
| Restore failed: mark kept, no candidate `up` | unlink before checking `ok` |
| Unmounted data volume with a mark: zero `up`, mark kept | `recover` above `require_data_mount` |
| Mark == `current`, twice: not quarantined; link and alert settled | the e-branch deleted |
| `fsync` called on the temp file before `os.replace` | `fsync` removed; a directory `fsync` that raises must not fail the write (second mutant: not ignored) |
| `link_current` fails: the new release stays up, `current` new, not quarantined, exit 1, RED; the next run settles and clears | `committed` not set; and settle clearing the mark on failure |
| Saving `current` raises **before** and **after** writing | the re-read removed; `previous` not put back |
| A `Refusal` after commit (unreadable `interrupted`) does not unwind | the `Refusal` handler's `committed` check dropped |
| `previous == current` → rollback exit 4, no `up` (project, edge) | the check dropped, each |
| `unjudged` after `up`: second poll makes 0 ups | quarantine only when the flag is set |
| `check-config` client timeout: no quarantine; exit 124: quarantined | told apart by the code |
| Transient and `busy` with `log` raising: exit 0, `transient-since` written | `rel.log` put back |
| Finished unwind with an unhealthy restore clears the mark; the next **new** digest is tried | mark kept there |
| status: mark, no alert, edge and no-`current` RED; with a `current` unchanged | the condition dropped either way |
| Pool unit, per pool | `survive` removed from one pool; `on('connect')` line removed; `on('error')` line removed |
| Web restart case | `on('error')` removed |
| T-real restart | the `pg_stat_activity` precondition removed is **not** caught by product mutants: qa shows it red once with `survive` removed |
| Relative provision path | `here=` below `cd /` |
| R7 absent home | the fallback removed |

Traps: "exit is 1" passes every wrong build; assert the last `up`'s render, the mark, `current`, the quarantine line and the alert, all five. A planted mark with no prior `up` of the candidate cannot show a restore *replaced* anything: the R4 cases must go through a real interrupted run.

## G. Standing guards this trips (seceng rules up front)

| Guard | What happens |
|---|---|
| `packages/db/src/pg-seam-scan.test.ts` | four literal `new pg.Pool({… Client: ExtendedClient` kept: **green as ruled**. A factory would break it: not allowed. Adding "each is wrapped in `survive(`" to it is qa's |
| `layers.json`, `tests/layers`, eslint | no import added, no new module or subpath: green |
| `tests/ci/db-areas`, `changes.mjs` | no new `tests/db` file; `pool.ts` is already in the `deploy` and `db` keys: green. `tests/db/helpers` turns on `e2e` and all db areas |
| `tests/infra/ops/test_lint.py` (argv, `shell=`), `release.EVENTS` | no new child, no new event: green |
| `tests/infra/ops/test_deploy_budget.py`, `test_deploy_oneoff.py` | pin migrate's 30 minutes, not `check-config`'s 600 s (searched by name): green |
| `test_deploy_unwind.py` (S32, G6), `test_deploy_hang.py` F2/S33, `test_deploy_compose_version.py` | by reading they hold as ruled; any edit to an existing assertion is listed at red for seceng |
| `tests/infra/deploy-wiring`, `provision-wiring`, shellcheck, `edge-net`/`host` box tests | read text in `provision.sh` that stays: green (unmeasured) |
| `deploy-real-sweep` | the restart case must print no environment or container logs into the step |
| gitleaks | no secret-shaped fixture is needed anywhere here |

**Exemptions asked for: none.** New exposure for seceng to judge: two swallowed `error` events (R5, nothing logged); restoring before the Compose version is checked (R1.3; the guard still judges, as in a rollback); a malformed mark restoring `current` (R1.2d).

## C. Verdict checklist (pre-registered)

1. M1–M12 each reversed, from the committed tests, red-first at a named sha. 2. Every mutant in V recorded red, or equivalent with the reason. 3. `grep`: `in-progress` is unlinked in exactly `unwind`, `settle`, `recover`; no write or child before the restore in `recover`. 4. `rel.log` after the first `up` and in the transient and busy paths: none raw. 5. `BASH_SOURCE` once in `provision.sh`; every compose call in both scripts names `rh` and `/dev/null`. 6. Four `survive(new pg.Pool(`; no logging in `pool.ts`. 7. T-real green with the restart case, precondition shown; `deploy-real` wall time recorded against 15 minutes and a same-day control (M17: 7 min 38 s); provision job too. 8. INFRA §4.4–4.6, the runbook lines, ARCH §8.1, SECURITY C-83 and R-32 match the code; no history in them. 9. seceng's verdict at the exact sha; its conditions each answered. 10. CI's exact commands green; `tests/ci` run.

## O. Owners

devops-engineer: `infra/ops/**`, `infra/provision.sh`, `infra/provision-check.sh`, `docs/INFRA/**`. backend-lead: `packages/db/src/pool.ts`. qa-engineer: every test file, `tests/db/helpers/web-server.ts`, T-real. seceng: `docs/SECURITY/**`. architect: `docs/ARCH/**`. **No file is shared** between builders; the two builds can run in parallel.

## L. For the lead

1. **H4 quarantines even a box fault** (`unjudged`), and there is no clear command: the next build replaces it. Recommend yes; the alternative is up and rollback every five minutes.
2. **`recover` blocks new deploys while the old release cannot be restored** (mark kept, RED every poll); the way out is `rollback`. An ordinary unhealthy unwind does not block. Recommend keeping both, as today.
3. **`check-config-timeout` at 120 s is retried without limit**, holding the shared lock up to about 3 minutes per poll, RED. Recommend yes.
4. **status's extra RED line (R1.7)** is not in the gate text; a dropped SSH session during `edge-deploy` is otherwise silent. Recommend yes, four lines.
5. **The literal restart test sits in T-real** (about a minute, unmeasured). Recommend yes: it is the only place auth and the worker run for real.
6. **Criterion 2 names the image job's 20 minutes;** T-real is its own job with 15. Amended in place, with 1 and 3, to the Principal's cut.
