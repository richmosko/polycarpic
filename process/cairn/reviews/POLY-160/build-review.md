# POLY-160b: security build review (seceng)

## Verdict @ `22f37c87`: **CHANGES 7** (3 product, 4 evidence)

**Read:** `git diff 7613d4e9..22f37c87`: every product line (`infra/ops`, both provision scripts, `packages/db`, the three `main.ts`), INFRA's delta, all new and changed tests named in the diff but `test_status.py`, and `red-run.md`. `web-server.ts`'s helper change was not read. **Ran:** `docker stop --time 1` on a name that does not exist (Docker 29.9.3, flag check only); no suite, no mutant. CI 45561301953 (`e65307c0`) was still running when I read it: cairn, changes, guard and provision green, the rest pending. Red and mutant results are qa's word.

The design is built as ruled in shape, and H1's main path holds by reading: mark kept by default, recovery before the checks, one commit point, nothing unwinds after it. The faults are at the edges. The larger gap is evidence: many of the ruling's V rows have no test.

### Product

| # | Owner | Finding | Required |
|---|---|---|---|
| B1 | devops | **A failed recovery with an unreadable or malformed mark retries the interrupted release.** R1.4 ends that run `rollback-unhealthy`. The code compares the candidate with `stuck_digest`, which is then None, so nothing matches: `_candidate` and `edge._run` go on, and the candidate may be the very release that was cut, or a third try of it. By reading | With `stuck` and no digest, the run ends before any candidate is looked up, staging and edge. Red: junk mark, failing restore, the same digest offered: no candidate `up`, mark kept |
| B2 | devops | **Ctrl-C (SIGHUP, SIGTERM) after the commit of a first deploy stops the healthy release.** `on_interrupt` reads `run["cur"]`, which is still None inside `settle`, and stops all three (edge: Caddy). By reading. Loss of service only; nothing is exposed | No stop when `run["committed"]`. Red: interrupt inside `settle` of a first deploy, staging and edge: nothing stopped, mark kept, `current` new |
| B3 | devops | **`docker stop --time` is deprecated** (Docker 29.9.3 says so and its help no longer lists it). The engine on the box is not pinned, so when the flag goes, every stop fails. It fails closed for the record (`not-stopped`, RED), but the never-healthy release then runs: the gate's own fault | `-t 30`, the short form old and new Docker take. The fake refuses an unknown flag |

### Evidence

| # | Owner | Finding | Required |
|---|---|---|---|
| B4 | qa | **Ruled V rows with no test.** In the recover, stand-down and edge files I find none for: the **missing token** (R2, half of the gate); `edge.env` unreadable; a mismatched Compose whose render **differs** (C-d; the one Compose case changes the version string alone), with the pair's bytes unchanged; edge's allowlist changed since the save, both under the pinned Compose (new value comes up) and mismatched (old value never upped); tampered saved pair and tampered tree; Ctrl-C in `up`, in the unwind's restore and in the recovery; the unmounted data volume with a mark; the mark naming a `current` that is now **unhealthy**; `stuck` with the same digest offered, and a different digest that ends **healthy**; `current`'s Caddy kept on edge; `busy` with a log that raises; the put-back that fails too; an unreadable mark file (mode or link); another project's containers untouched | Each, red on its named mutant. A row that cannot be built is named, not left out |
| B5 | qa | **No mutant record for the built deploy code.** `red-run.md` has reds on the base, three fixed reds on the build, and mutants for the pool, T-real and one lift line. For the rest the docstrings name mutants; none is recorded as made | A table: mutant, test, red or equivalent with the reason, at a named sha (checklist C.2). Both exemptions' mutants included |
| B6 | qa | **Nothing asserts `db.connection_lost`.** No test outside T-real's comment names it: all three registrations can be deleted and every suite stays green. Web's built bundle (the `globalThis` slot) is unshown too. `red-run.md`'s reason is wrong for real clients: the `connect` listener is on an idle client as well, so `tell` runs | Auth's and web's outage tests assert the line (`.auth`, `.app`) with type and code only and no canary; for web after a **page's** query. The worker's registration shown by the process or T-real. Red: each registration removed; the error object passed on |
| B7 | qa, devops | **The stop has never run on real Docker.** C28 covers the restore; D1 and D2 are on fakes only, and the fake answers the label filter itself | One T-real case: a cut deploy whose restore fails (the old release's tree altered), next poll: release 2's web, auth and worker stopped by `docker ps`, Postgres running, mark kept, RED; then the tree is put back and a poll recovers. The job has room (9 min 18 s of 15, the lead's figure) |

## Ruled by name

- **C21 "during COMMIT" not shown: not accepted as "cannot be timed"; FOLLOW-UP, not a blocker.** The proxy carries plain text: forward the client's bytes until `COMMIT` passes, then drop without relaying the answer. No backend kill and no timing. The code is right by reading (the COMMIT rejects, ROLLBACK rejects, the client is destroyed, nothing is retried), and the two cases that stand go through the same path. Write it with B6 if it is cheap; else it goes to the lead's next batch, in writing.
- **C20/C21 cut at the client socket: accepted.** The listener sees the same event, and T-real's `docker restart` gives a real server shutdown.
- **T-real without the `db.connection_lost` line: accepted, once B6 asserts it elsewhere.**
- **No edge form of the `current-quarantined` stuck case: accepted.** `restore_checked`, `_stuck_records` and `stuck_end` are the same functions, and edge's `not-stopped` form runs through them.
- **`close()` clears the 10 s bound: accepted.** It runs at shutdown and in tests; no request reaches it.
- **R7's pins loosened: accepted.** The box cases carry the behaviour for the check. `provision.sh --stage database` refusing a bad home is pinned by text only; I accept that for a command run by hand, as it fails before any change.

## Conditions

| | Result |
|---|---|
| C1 | code met; **B4** (token, edge.env, unmounted) |
| C2, C3, C5, C7, C11, C13, C14, C16, C18, C23, C24 | met; each has a test, mutants **B5** |
| C4 | code met; **B4** (Ctrl-C at three more points) |
| C6 | **B1**; unreadable file **B4** |
| C8 | met; now-unhealthy **B4** |
| C9 | met but **B2**; real Docker **B7** |
| C10, C-a to C-d | code met (pinned: ordinary restore; mismatch: pair kept, environment compared); **B4** |
| C12 | met: recovers first, exit 1, falls back, mark cleared |
| C15, R1.3b's lift rule | met, both tests |
| C17 | met; a timeout of each of the four services is not separated, accepted |
| C19 | C7, C8 |
| C20, C21 | met, with the rulings above |
| C22 | code met; **B6** |
| C25, C26 | met (five invocations with a planted file; four homes) |
| C27 | INFRA matches the code; the runbook line's two behaviours run on the harness. INFRA §4.4's "an unreadable mark… restored, then refused" does not say a failed restore with one stops: after B1 |
| C28 | met and red on its mutant (qa); the stop itself **B7** |
| The 13, the delta's 2, S36 | built; #12 and the tests of #1, #4, #8 as above |
| R1.4 as corrected | met: `not-stopped`, else `current-quarantined`, else `rollback-unhealthy`; staging both, edge the first |
| Exemptions 1 and 2 | edits exactly as ruled; (b)'s key is `restart`, with the attempted save asserted; mutants **B5** |

By reading, also good: the stop is labels plus a second listing, never the exit code; `keep_ref` unreadable stops all; the pool passes no error object; `unwind` keeps the mark where the quarantine line is not on disk; `restore` passes only the judged render.

## SECURITY

R-35 (the residue, as `process/DECISIONS.md` words it) is in this commit, 1.21.2. **C-83's bullet and R-32 stay as they are** until B1 to B7 are confirmed: R-32 says a gap is open, and while the missing-token case has no test I will not write that it is closed. Both change with the delta read.
