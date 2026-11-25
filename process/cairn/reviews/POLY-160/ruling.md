# POLY-160a ruling: deploy follow-ups (staging gates only)

Architect. Read at `d07cd4a1`. Scope: the Principal's cut (last scope comment of `POLY-160.md`). H3, H6's glob, H7, H8, H10, U1–U3 are POLY-165's.

## M. Measured

Probes ran on the existing harness (`tests/infra/ops`, fakes for Docker and GitHub), `python3 -W ignore temp/probe_h.py`; the pool on a real local Postgres 17 with
`pg_ctl -m fast restart` (pg 8.23.1, pg-pool 3.14.0; Node 26 here, the image's Node not used). No containers. The probes live in my worktree's `temp/` and are not evidence qa may reuse: qa writes its own red.
Some of my commands were refused as too complex by the worktree guard; I split them (files with the Write tool, each command alone).

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
| M15 | M14 plus `pool.on('connect', c => c.on('error', …))` | all three survive; the in-flight query rejects `57P01`, the next on that client rejects "not queryable", the pool drops it and the next `pool.query` works |
| M16 | `docker compose --project-directory /nonexistent … ps`, `ps -q`, `exec -T` (5.7.0, macOS) | same exit and text as `/`: H6's doubt does not reproduce. On the box's 5.7.1: (unmeasured) |
| M17 | CI `deploy-real`, run 45538719357 (2026-11-25) | 7 min 38 s wall of a **15-minute** limit; it is its own job, no longer the image job |

By reading, not run: `state/deploy` files are written with no `fsync`, and a new name is not covered by ext4's replace-via-rename flush, so a power cut can lose or empty the mark. Plain `docker stop` on `unless-stopped` containers staying stopped over a reboot: Docker's documented behaviour (unmeasured).

## R. The ruling

Build order: **R1, R2, R3, R4** (one sequence, same functions, one commit each), then R6, R7; R5 independent. "Mark" is `in-progress`.

### R1 (H1) the mark is kept by default; recovery comes first — `lib/deployer.py`, `lib/edge.py`, `lib/release.py`, `lib/compose_guard.py`, `commands/rollback.py`, `status/08_deploy.py`

**Decided by the lead.** (D1) A first deploy cut short: the never-healthy candidate's `web`, `auth`, `worker` are stopped; Postgres stays; no `down`, `rm`, `--remove-orphans`; the mark does not block a rerun of `first-deploy`. (D2) A restore that fails: the new release's `web`, `auth`, `worker` are stopped too, RED, mark kept, retried each poll, no quarantine line per poll. (D3) On edge the candidate's Caddy is stopped the same way. (D4) A run by hand cut by power or SIGKILL is an accepted residue on staging; Ctrl-C, SIGHUP (a dropped session) and SIGTERM try the stop when there is no `current`. "No `current`" includes a first deploy that ends unhealthy without a cut.

1. **Who clears the mark:** a finished `unwind` whose restore answered True, or that had no `current` and stood down, with the quarantine line on disk; `settle` (R2); a `recover` that ends well; the fallback of R1.9. The two `finally` unlinks and `run["held"]` go. Every other exit keeps it, a second Ctrl-C inside the unwind or the recovery included, and an unwind whose restore answered False with a `current`.
2. **`stand_down(project, ctx, keep_ref=None) -> bool`.** Plain Docker, since Compose or the render may be the fault. Per service of `web`, `auth`, `worker` (edge: `caddy`): `docker ps -q --no-trunc --filter label=com.docker.compose.project=polycarpic-<p> --filter label=com.docker.compose.service=<svc>`; `docker inspect <id>`; `docker stop --time 30 <id>` (client timeout 60 s) unless its `Config.Image` equals `keep_ref`, `current`'s own reference. When it cannot tell (no `keep_ref` readable, or an image that cannot be read) it stops. Read back by a second `docker ps` with the same filters (running and restarting containers both list), never by the exit code. Each child in its own `try`, and it can never stop a record from being written; anything not shown stopped → False, retried next run, and alert `not-stopped`. Containers are left, with their logs.
3. **`recover(project, ctx, cur, run)`** replaces `_handle_interrupted`:
   a. mark absent (`FileNotFoundError` only) → return. Anything else is an interruption, readable or not.
   b. with a `cur`: restore it, `except Exception` → not ok. **No write, log, alert, token or network call comes before it**; stderr says `deploy: recovering an interrupted run`. `cur` listed in a readable quarantine file → nothing is upped, not ok, alert `current-quarantined`; an unreadable quarantine file bans nothing here. The unwind's restore has the same check.
   c. not ok → `stand_down(keep_ref)`; then alert and log `rollback-unhealthy` (or b's name), each in its own `try`; **no `interrupted`, no quarantine**; mark kept; `run["stuck"]` is the mark's digest, None when unreadable. The unwind does the same stand-down when its restore answers False, its quarantine line once.
   d. mark unreadable or not one digest (after a good restore) → `Refusal("state")`, mark kept; its `help_lines` (alert, status, stderr) name the reason and the command: `in-progress is malformed; after checking: sudo rm /var/lib/polycarpic/state/deploy/<project>/in-progress`.
   e. mark names `cur`, just waited healthy again → `settle`; never `interrupted`, never quarantined. Settle fails → `_Stop(1)`.
   f. no `cur`: `stand_down()`; prod also puts Caddy back on edge's `current`, as the unwind does. Not stopped → `_Stop(1)`, mark kept; else on to g and h, so the rerun proceeds.
   g. alert `interrupted` and log, each in its own `try`; then the record (second time for this digest → quarantine; first → the `interrupted` file). Not on disk → stderr, `_Stop(1)`, mark kept.
   h. unlink the mark.
4. **`stuck` does not wedge the project.** The run goes on to look for a candidate; a candidate equal to `stuck`, no candidate (`_Skip`), or an unreadable mark ends `rollback-unhealthy`, exit 1. A **different** digest passes every check and may deploy; its `put` overwrites the mark and a healthy end clears it. Without this, a release whose migration broke the old one could never be fixed forward. A run that started stuck and did not end healthy writes the recovery's own name as its last alert and last stderr line, so nothing from later in the run hides it: `not-stopped` when the stop was not shown (the release may still run, the worse state, and it implies the restore failed), else `current-quarantined`, else `rollback-unhealthy`. The last `stand_down` of the run is the one that counts, the unwind's included, and the unwind uses the same order; `deploy.log` carries `rollback-unhealthy` in all three.
5. **Position.** `_deploy_checked`: `require_data_mount` → load `current` → `recover` → today's order (Compose strict, token, `tokenexp`, `previous`, `transient-since`, …). `edge._run`: `owned_by_prod` → `require_data_mount` → load `current` → `recover` → `check_edge_env`, Compose, `previous`, the tag rules. Ahead of recovery only the lock, `ensure_shared` and those. A damaged `current` is `state`: nothing safe to restore. The Compose version is asked before the restore only to choose R1.6's path: warn only, any failure, timeout or refusal in asking is a mismatch. The strict check after the restore refuses as today.
6. **Which render a recovery starts.** Pinned Compose: an ordinary restore (fresh render, judged, saved when different; S36's failed-save rule as it is). Mismatch: `judge(…, restore=True, keep=True)` **never writes the pair**. Fresh bytes judged clean and equal to the saved → used. Otherwise the saved pair, only if its hash holds, its bytes pass the installed guard now, **and every service's `environment` in it equals the fresh plain render's, key and value**. That render is what reads the sources, and they are exactly: the literals in the release's compose file, the release's `images.env`, `/etc/polycarpic/edge.env` (edge only), and the files each service's `env_file` names, which the guard holds to the policy's `env_files`. No fresh plain render, no raw render, no pair, or any miss → not ok (3c). Isolation, tree hash, ownership, `--pull never`, health: as any restore.
7. **The work directory** is made after `recover`, inside the handler, path in `run["work"]`, removed in the outer `finally`.
8. **Signals.** Outermost wrapper in `locked` and `edge.deploy`, outside every handler: on a non-`Exception` with the mark present: with no `current`, `stand_down`; then best-effort alert `interrupted`, stderr `deploy: interrupted; run the same command again`, re-raise. `SIGHUP` and `SIGTERM` raise `SystemExit` for the length of the run (main thread only; the old handlers put back on every path), so a dropped session takes Ctrl-C's path; a second signal inside the stop keeps the mark. stdout and stderr may be gone by then: the stderr line is best-effort and cannot stop the stop, the alert or the re-raise. SIGKILL and power loss keep the mark (D4); the next run recovers.
9. **`rollback` by hand with a mark** (project, edge): recover first. Good → stderr `recovered; nothing rolled back`, exit 1, nothing quarantined but by 3g; a second `rollback` then does what it says. Not good → the ordinary rollback to `previous`; a healthy end clears the mark.
10. **`rel.write`** fsyncs the temp file, replaces, fsyncs the directory. Errors raise: before `up` that is a refusal; R2's re-read covers a raise after the replace.
11. **`rel.quarantine` is idempotent** per digest, reason and bundle id.
12. **`status` 08:** mark present, no `alert`, and (edge, or no `current`) → RED `interrupted or running; run the command again`.
13. No container can write the state directories: the guard's `guard-mount` refuses a source the policy does not name, and no policy entry names `state/deploy`. After a reboot `unless-stopped` starts the candidate until the first poll (up to 6 minutes); unchanged.

### R2 (H2) one commit point — `lib/deployer.py`, `lib/edge.py`, `commands/rollback.py`

1. **`commit(project, ctx, cur, new, run)`**, used by `_healthy` and `edge._promote`: tree hash first; save `previous`; save `current`; `run["committed"] = True`. If either save raises: re-read `current`; it names the new digest → committed; else put `previous` back best-effort and raise (the unwind restores the old).
2. **`settle(project, ctx, rdir, digest) -> bool`**, idempotent, each step in its own `try`: link; prod `images.env`; `first-attempt`; `interrupted` when it names this digest; prune (its failure does not count). All good → clear the alert, then the mark, `_note healthy`, True. Else alert `records`, stderr, mark kept, False. Edge: no `images.env`, no `first-attempt`.
3. **After the commit nothing unwinds.** `_internal` and the `Refusal` handlers (both modules) check `run["committed"]`: alert `records`, exit 1, mark kept; the next run's 3e finishes it. The `edge-probe-baseline` alert after `_healthy` goes in its own `try`.
4. **`rollback`, project and edge:** `previous` naming `current`'s digest is "no previous release", exit 4. A pointer write that fails also raises the alert `rollback-pointers` (best-effort) and says to free space and run `rollback` again; `rollback.py` uses `deployer.link_current`.
5. A first deploy whose settle fails still leaves the timers off and a rerun `already-deployed`: H3, POLY-165. Not worsened here.

### R3 (H4) — `lib/deployer.py`, `lib/edge.py`, `lib/release.py`

After the candidate's first `up`, every unhealthy, uncommitted exit writes a quarantine line. `unhealthy`, `internal` and refusals that quarantine: as today. **A refusal that does not** (a box fault, `unjudged`): reason `held-<name>` with the bundle id as fourth field; `quarantine` and `quarantined` treat `held-` as they treat `guard-`, so it lifts with another installed bundle, and another digest is never affected. The alert stays RED until a healthy run. Pre-`up` refusals unchanged.

### R4 (H5) — `lib/deployer.py`, `lib/edge.py`

1. `check-config` client timeout 120 s each (480 s at most, plus removal). A **client timeout** is `check-config-timeout`: alert, exit 1, no quarantine, container gone first (`oneoff-stuck` unchanged). An exit code, 124 included, quarantines as `check-config`: told apart by the timeout, not the number. The next poll takes the newest candidate, so a newer digest is not blocked. On prod the pre-migration backup precedes `check-config`, so this retry would make a backup set every poll: POLY-165, before the first prod deploy; nothing is built for it here.
2. `rel.log` in both `Transient` handlers and `busy`, and every `rel.log` after the first `up`, becomes `_note`; `clear_transient` never raises. Both print one stderr line when they fail.
3. The double crash on the running digest is R1.3e. `deploy-real-undo.sh` in the trigger is done (POLY-162).

### R5 (pool) — `packages/db/src/pool.ts`, `startup.ts`, `apps/{web,auth,worker}/src/main.ts`; backend-lead

```ts
export type PoolName = 'app' | 'auth' | 'worker' | 'operator';
export interface LostConnection { pool: PoolName; type: string; code: string | undefined } // never the error itself
// the callback lives at globalThis[Symbol.for('poly.db.connectionLost')]: web's built bundle may hold its own copy of this module
export function onConnectionLost(fn: (e: LostConnection) => void): void { /* sets it; re-exported by db/startup only */ }
function survive(name: PoolName, pool: pg.Pool): pg.Pool {
  pool.on('error', () => undefined);                                      // idle: the pool has already removed the client
  pool.on('connect', (c) => { c.on('error', (e) => tell(name, c, e)); }); // the client's whole life, checked out included
  return pool;
}
```
`tell`: once per client, and at most one call per pool in 10 s; `type` is `e.name` when it matches `/^[A-Za-z]{1,40}$/` (else `unknown`), `code` when it matches `/^[0-9A-Z_]{2,20}$/` (else undefined); a callback that throws is ignored. Each constructor becomes `survive('<name>', new pg.Pool({ …, Client: ExtendedClient, … }))`, the literal kept. Each `main.ts` registers, before its first pool, a callback that logs `warn`, event `db.connection_lost.<pool>`, with a fresh `Error` carrying only that name and code in `err` (no schema change). pg-pool sets `err.client`, which holds the password, so the original never leaves `pool.ts`. The services' own lines stay: `auth.request_failed`, the worker's `job.run` with `outcome: error`, web's health at 503. No `console`, no process-wide handler change, no retry, no connect timeout. `release()` drops a client that errored (M15). A COMMIT whose connection is lost rejects and nothing is retried. `migrate.ts`'s own clients are out of scope: one shot, a crash is a failed run.

### R6 — `infra/provision.sh`

`unset CDPATH`, then `here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)` or `die … 2`, top level, directly above `cd /`; the three later resolutions use `$here`; no other `BASH_SOURCE` remains.

### R7 (H6) — `infra/provision-check.sh`, `infra/provision.sh`

One `rh` per script: no render home → `/` (as `compose.opts`); one that exists is used only as a real directory (no link), owner 0, mode 0755, empty. Otherwise `provision.sh --stage database` stops (`render-path`, nothing changed), and `provision-check.sh` reports H24 FAIL naming it and the database checks FAIL, not wait. The check creates nothing; `--env-file /dev/null` stays on every call.

### R8 — INFRA (devops), ARCH §8.1 (architect, at the verdict), SECURITY C-83 and R-32 (seceng)

INFRA §4.4: R1–R4 replace the matching sentences ("Failure handling", "The record"). §4.5: the pre-migration backup is named once. §4.6: manual rollback restores, then quarantines; "nothing else is changed" goes (the stand-down); a second `rollback` can make a quarantined digest `current`, which a later failed deploy refuses to restore (`current-quarantined`) and stops. The runbook has R1.3d's command. Code, with R1: a `first-deploy` whose digest is quarantined names that on stderr.
Runbook, `edge-deploy` row: "After Ctrl-C, a dropped connection or a power cut, run `edge-deploy` again with the same tag, not `rollback edge`. With the tag that was running before, it only recovers; recovery is before any network call. Interrupting the same tag twice bans it: cut the next `edge-<n>`." §8.6: after an interrupted run `rollback` recovers first and rolls back only if that fails. The line is run once: on the harness here, on the box in POLY-104.

## S. Test seams

- **Deploy:** `Hang`, `Helpers` (`test_deploy_unwind.py`) and `EdgeBase`; `world.raise_cmd={"exec": KeyboardInterrupt()}` with `hang_from`; `world.compose_versions`; a signal is sent from `world.on_compose` with `os.kill(os.getpid(), signal.SIGHUP)` at the candidate's `up`, and the handlers are compared before and after; `patch(write=, put=, log=, alert=, quarantine=)`; `tempfile.mkdtemp`; `compose_log` for "the last `up` names the old digest's `render-<12 hex>.json`". The fake gains `docker ps` by label, `docker inspect <id>`, `docker stop`. Names: `recover(project, ctx, cur, run)`, `stand_down(project, ctx, keep_ref=None)`, `commit(project, ctx, cur, new, run)`, `settle(project, ctx, rdir, digest)`, in `deployer`. State files unchanged (`sha256:<64 hex>\n`), no new one. New alerts: `records`, `rollback-pointers`, `check-config-timeout`, `not-stopped`, `current-quarantined`. No new log event. New files: `test_deploy_recover.py` (R1), `test_deploy_commit.py` (R2), `test_deploy_retry.py` (R3, R4); `test_status.py` for R1.12.
- **Pool, unit:** `packages/db/src/pool-errors.test.ts`, no database: for each of the four pools `pool.emit('error', new Error('x'), {})` does not throw; after `pool.emit('connect', c)` with `c = new EventEmitter()`, `c.emit('error', …)` does not throw and calls the callback once, with name and code only; a canary password on `err.client` and a canary `detail` are in nothing it received, and nothing is written to stdout or stderr.
- **Pool, process:** `tests/db/web-server.test.ts` (existing; the proxy gains `down()` and `up()` on the same port): 200, `down()`, 503, `up()`, 200, same pid, no `process.crash`, line count bounded over the outage, the password in no output. A planted throw still exits 1.
- **Auth and worker, outage:** `tests/db/auth-service-main.test.ts` and `worker-mail-jobs.test.ts` (existing): with the database unreachable, auth answers an error and writes `auth.request_failed`; a job run writes `job.run` with `outcome: error`; both go on, and the next works.
- **C20, C21:** `tests/db/wrappers.test.ts` (existing): backend terminated inside `withSession` with no query in flight, before COMMIT and during it: an error, never the result; the next checkout carries no identity.
- **Pool, literal restart:** T-real `1-web-served.test.ts`, last case: wait until `pg_stat_activity` shows `poly_app`, `poly_auth` **and** `poly_worker` at once (ask health and auth to make them; mail drain runs every 30 s, idle clients live 10 s; fail after 90 s, never skip), `docker restart` the Postgres container, then health is 200 within 60 s and `State.StartedAt` and `RestartCount` of the three are unchanged 15 s later; the worker's next `job.run` is `ok`; each of the three wrote its own `db.connection_lost.*` line, web's for a **page's** query (the bundle's own copy of `pool.ts`). (That T-real's worker has a mailer: unmeasured.)
- **T-real, C28:** `2-rollback.test.ts`, before the rollback poll, on release 2: `deploy staging` SIGKILLed after its `up` line, the installed bundle's `compose-version` edited, `deploy staging` again: release 1's digests healthy, `render-env`, exit 1, no mark. The file is put back and `interrupted` removed. SIGINT stays on the harness.
- **Provision:** in the dry-run box `bash provision.sh`, `./provision.sh`, `infra/provision.sh`, each also with `CDPATH` set and a planted `/deploy/compose-version`, reach their first file reads from the real directory; the fake `docker`'s argv for R7 with no render home, a good one, a link, one holding `.env`.

## V. Assertions that would pass a wrong build

| Test | Mutation that must turn it red |
|---|---|
| Mark with wrong Compose, missing token, malformed `previous`, malformed `transient-since`, unreadable `edge.env` | each check moved back above `recover` (one mutant each) |
| Unpinned Compose whose render **differs**: old release up from its saved pair, pair bytes unchanged, then `render-env`, no candidate `up` | `keep=True` dropped; the strict check dropped after a recovery |
| `edge.env` (and an env file) changed since the save: pinned Compose → Caddy up with the **new** value; mismatched → not upped with the old one, stood down | the saved pair used under the pinned version; the `environment` comparison dropped |
| `docker stop` exits 0 and the container is listed still running or restarting: `not-stopped`; another project's containers untouched | the second listing dropped; the project label dropped |
| `rollback` that only recovered exits 1 | exit 0 |
| Saved pair tampered under that Compose; tree of `current` tampered: not upped, stood down, mark kept | `_saved_pair`'s hash check dropped; the tree hash skipped |
| ENOSPC on each write in turn and on all, mark present: the old release's `up` happened | alert moved above the restore |
| `mkdtemp` ENOSPC, mark present | work directory made before `recover` |
| Ctrl-C in `up`, the health wait, the unwind's restore and the recovery keeps the mark, staging and edge; the next run restores | `finally: unlink` put back, each module; the wrapper placed beside the handlers |
| Edge: old render first, before any `gh` or `git`, with the same tag, a lower one, an absent Release | `recover` after the tag rules or `_release` |
| Empty, truncated, junk, unreadable mark: restored, then `state`, mark kept | `Refusal` before the restore |
| Restore failed, interrupted run and unwind both: mark kept, the candidate's three stopped, Postgres not, no `down` or `rm` | `stand_down` skipped, each; `keep_ref` ignored (an unhealthy **current** container is stopped too) |
| Ten polls of a failing restore: no quarantine line; then it works: mark gone, the digest tried once | the record moved above the restore |
| Stuck: same digest and no candidate → `rollback-unhealthy`, exit 1; another digest deploys; a later refusal does not hide it | the stuck check dropped; `_Stop` in 3c; the last alert dropped |
| First deploy cut by Ctrl-C (stopped on the way out), found cut by a planted mark, and ended unhealthy uncut: stopped; the rerun of `first-deploy` ends healthy | `stand_down` missing in each; mark kept in 3f |
| SIGHUP and SIGTERM during `first-deploy` and `edge-deploy`, no `current`: stopped, alert `interrupted`, mark kept, handlers put back; the same with stderr closed | the SIGHUP handler removed; the SIGTERM handler removed; not put back; the stderr write unguarded |
| Ctrl-C or SIGHUP inside `stand_down`: mark kept, the next run stops | the mark cleared before the stop |
| Edge: restore False, and no edge `current`: the candidate's Caddy stopped; `current`'s kept | the edge service list empty |
| `docker stop` fails: `not-stopped`, RED, mark kept | its answer ignored |
| Record not on disk: mark kept, candidate not upped in that run or the next | unlink regardless |
| Unmounted data volume with a mark: zero `up`, mark kept | `recover` above `require_data_mount` |
| Mark == `current`, twice: not quarantined, link settled; the same when it is now unhealthy: mark kept | 3e deleted; 3e without the health wait |
| `current` quarantined with a mark: no `up`, named RED | the check dropped |
| `rollback` by hand with a mark: good restore → nothing quarantined; failed → `previous` up, mark gone (project, edge) | the recover call dropped, each |
| `fsync` file, replace, `fsync` directory, before `up` | either `fsync` removed |
| Quarantine twice, same reason: one line | idempotence dropped |
| `link_current` fails: new release stays up, `current` new, not quarantined, exit 1, RED; the next run settles and clears | `committed` not set; settle clearing the mark on failure |
| Saving `current` raises **before** and **after** writing; put-back fails too: a later run never ups the refused digest | the re-read removed; `previous` not put back |
| An unreadable `interrupted` after the commit does not unwind | the `Refusal` handler's `committed` check dropped |
| `previous == current` → rollback exit 4, no `up` (project, edge) | the check dropped, each |
| `unjudged` after `up`: polls two and three 0 ups; a new digest deploys; another bundle lifts it | held only when the flag is set; `held-` not lifted |
| `check-config` client timeout, each service: no quarantine; exit 124 and exit 1: quarantined | told apart by the code |
| Transient and `busy` with `log` raising: exit 0, `transient-since` written, a stderr line | `rel.log` put back |
| Unwind with **no** `current` clears the mark after the stand-down | mark kept there |
| status: mark, no alert: edge and no-`current` RED; with a `current` unchanged | the condition dropped either way |
| Pool unit, per pool | `survive` removed from one pool; either `on(…)` line removed; a `console.error(err)` in either; the error object passed to the callback; the 10 s bound removed; the callback held in a module variable (web, page query) |
| Real pool in `wrappers.test.ts`: terminated with no query in flight, and at COMMIT | the `connect` line removed |
| Auth and worker each write their own error line in an outage | the error line removed from each |
| Web down and up | `on('error')` removed; a cached health answer |
| T-real restart | shown red once with `survive` removed |
| Relative provision path, `CDPATH` | `here=` below `cd /`; `unset CDPATH` removed |
| R7's four homes | the fallback removed; the link check removed |

Traps: "exit is 1" passes every wrong build; assert the last `up`'s render, the mark, `current`, the quarantine line and the alert, all five. A planted mark with no prior `up` of the candidate cannot show that a restore replaced anything: the R4 cases go through a real interrupted run.

## G. Standing guards this trips (seceng rules up front)

| Guard | What happens |
|---|---|
| `packages/db/src/pg-seam-scan.test.ts` | four literal `new pg.Pool({… Client: ExtendedClient` kept: green. A factory would break it: not allowed. "Each is wrapped in `survive(`" is qa's addition |
| `layers.json`, `tests/layers`, eslint | `db/startup` is already importable by the three apps; no module or subpath added: green. `onConnectionLost` must not join `db`'s index. The log schema needs no change: the event name fits its pattern, `err` is declared (unmeasured) |
| `tests/ci/db-areas`, `changes.mjs` | no new `tests/db` file; `pool.ts` already in `deploy` and `db`: green. `tests/db/helpers` turns on `e2e` and all db areas |
| `test_lint.py` (argv, `shell=`), `release.EVENTS` | new children are list argv; no new event: green |
| `test_deploy_oneoff.py`, `test_deploy_budget.py` | pin migrate's 30 minutes, not `check-config`'s 600 s (searched by name): green |
| `test_deploy_unwind.py`, `test_deploy_hang.py`, `test_deploy_edge.py` | **some change**: an unwind whose restore fails with a `current` keeps the mark and stops services; a `docker stop` the fake does not know. Every edit to an existing assertion is listed at red for seceng |
| `deploy-wiring`, `provision-wiring`, shellcheck, box tests | the text they read in `provision.sh` stays: green (unmeasured) |
| `deploy-real-sweep` | the new cases print no environment and no container logs |
| gitleaks | no secret-shaped fixture is needed; the pool canaries are plain words, never `NAME=value` |

**Exemptions asked for: none.** New exposure for seceng to judge: `docker stop` as root on this project's labelled containers; restoring before the Compose check (R1.5, R1.6); a malformed mark restoring `current`; a different digest deploying while stuck (R1.4).

## A. seceng's conditions, each answered

| Cond. | Where |
|---|---|
| C1, C2 | R1.3, R1.5; residue closed by D2 (R1.3c) |
| C3 | R1.3b, R1.3g, R1.7 |
| C4 | R1.1, R1.8 |
| C5 | R1.10 |
| C6 | R1.3a, R1.3d |
| C7 | R1.3c, R1.11, R1.13 |
| C8 | R1.3e |
| C9 | D1: R1.3f, R1.8; prod's Caddy on a failed prod restore is POLY-165 |
| C10, C-a to C-d | R1.6; V's Compose rows |
| C11 | R1.5, R1.3b's line, R1.4 |
| C12 | R1.9 |
| C13, C14 | R2; a re-read that also fails leaves `current` new **and quarantined**, which R1.3b refuses, so it is not read as C8's crash |
| C15 | R1.3b |
| C16 | R3 |
| C17 | R4.1 |
| C18 | R4.2, R1.3g |
| C19 | C7, C8 |
| C20, C21, C22 | R5, S |
| C23, C24 | R5, S; the worker's schedule already records a failed run and goes on (`schedule.ts`) |
| C25, C26 | R6, R7 |
| C27, C28 | R8, S |

The review's 13 changes: 1, 2 → R1.1 to R1.3, D1 to D3; 3 → R1.4; 4 → R1.6; 5 → R1.9; 6 → R1.3b, R2.4; 7 → R1.11; 8 → R1.3b, R1.4, V; 9 → S, V; 10 → R6; 11 → R7; 12 → S, C.7; 13 → R4.1 (POLY-165). The delta read's two: R1.6, R1.9; its "at build" items: R1.2, R5, R8, S.

## C. Verdict checklist (pre-registered)

1. M1–M12 each reversed, by committed tests, red-first at a named sha. 2. Every mutant in V recorded red, or equivalent with the reason. 3. By grep: the mark is unlinked in exactly `unwind`, `settle`, `recover` and R1.9; nothing but the listed reads precedes the restore. 4. No raw `rel.log` after the first `up` or in the transient and busy paths. 5. `BASH_SOURCE` once in `provision.sh`; every compose call in both scripts names `rh` and `/dev/null`. 6. Four `survive('<name>', new pg.Pool(`; no logger or `console` in `pool.ts`; no raw error reaches a callback. 7. T-real green with the restart and SIGKILL cases; `deploy-real` wall time against 15 minutes and a same-day control (M17); the provision job too. 8. INFRA §4.4–4.6, the runbook lines, ARCH §8.1, SECURITY C-83 and R-32 match the code; no history in them. 9. seceng's verdict at the exact sha, C1–C28 each answered. 10. CI's exact commands green; `tests/ci` run.

## O. Owners

devops-engineer: `infra/ops/**`, `infra/provision.sh`, `infra/provision-check.sh`, `docs/INFRA/**`. backend-lead: `packages/db/src/pool.ts`, `startup.ts`, `apps/{web,auth,worker}/src/main.ts`. qa-engineer: every test file, `tests/db/helpers/web-server.ts`, T-real. seceng: `docs/SECURITY/**`. architect: `docs/ARCH/**`. **No file is shared** between builders; the two builds can run in parallel.

## L. For the lead

Decided (`process/DECISIONS.md`, 2026-11-25): (1) a box fault after `up` holds the digest until another bundle is installed (R3); (2) a failed recovery stops the release, keeps the mark and lets a different digest deploy; (3) `check-config-timeout` at 120 s is retried without a ban on staging; (4) `status`'s RED line; (5) the Postgres restart runs in T-real; (6) T-real is measured against its own 15 minutes; the hand-run residue (D4) is accepted for staging. POLY-165, by name, before the first prod deploy: boot-time recovery for the two hand-run commands; the backup set per retried poll; whether R3's lift is enough for prod; prod's Caddy when a prod restore fails.

Open: **T-real gains two cases**, the Postgres restart (about 2 minutes) and the SIGKILL with a mismatched Compose (about 2 to 4), both unmeasured, on 7 min 38 s of 15. If the job passes 13 minutes, raise the limit rather than drop a case; that edits `ci.yml`, and is yours.
