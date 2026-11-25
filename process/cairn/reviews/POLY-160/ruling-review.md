# POLY-160b: seceng's ruling review

## Conditions written before the ruling

Read at `d07cd4a1`: `deployer.py`, `edge.py`, `compose.py`, `stack.py`, `dirs.py`, `rollback.py`, `first_deploy.py`, the parts of `release.py` and `compose_guard.py` a restore uses, the systemd units, `provision.sh` at its path lookups, `pool.ts`, `context.ts`, `extended-client.ts`, and pg-pool's listener lines (grep). **Ran nothing.** Everything below is by reading. "Mark" is the state file `in-progress`; `interrupted` is the first-time memory beside it.

### H1: recovery after an interrupted deploy (the gate)

| # | A fix must guarantee | Test shown red on | A wrong fix |
|---|---|---|---|
| C1 | With the mark present, the restore of `current` runs before the Compose check (warn only), the token, `tokenexp`, every network call, `previous`, `transient-since`, `edge.env` and the tag rules. Still ahead of it, and only these: the lock, `ensure_shared`, the data mount, `owned_by_prod` (edge) and reading `current` | R1, R2 and their edge forms; a malformed `previous`; a malformed `transient-since`; mutant: each check put back first | Moving the data-mount check behind it: `up` with the volume unmounted starts a fresh cluster on the unencrypted root disk. Recovery that asks GitHub, or that ups `previous` or the candidate |
| C2 | After a good restore the refused check still refuses: no candidate is looked up or started under a wrong Compose or without a token. The exit is not 0 | R1 then: no `up` but `current`'s, and `render-env` | "Warn only" leaking from the restore to the candidate's path |
| C3 | No write precedes the restore. Today `mkdtemp(work-)` (in `locked` and `edge.deploy`, outside every handler), the alert, log, quarantine and `interrupted` all do. Each record after it is in its own `try` | `ENOSPC` on every write in turn, `mkdtemp` included: old release back each time | Wrapping the block in one `try`: the first failure drops the rest |
| C4 | The mark is cleared only by a finished unwind (restore answered True and its quarantine line, if any, is on disk), by a healthy run, or by a recovery that answered True. Any other exit keeps it: every `BaseException`, a second Ctrl-C **during** the unwind or the recovery, in `_deploy` and in `edge.deploy`. An unwind whose restore answered **False** keeps it too, where there is a `current` (today `unwind` clears it whatever the restore said) | R4; edge's R4; Ctrl-C inside `up`, the health wait, the unwind's restore and the recovery; `rollback-unhealthy`, then the next poll tries again. Mutant: `except Exception` alone | Clearing in a `finally` guarded by a flag the interrupt can skip |
| C5 | The mark is on disk before the first `up`: file fsync, rename, directory fsync. `release.write` fsyncs nothing, and a power cut is the gate's own case. Same for `current` and the quarantine line | The recorded call order (fsync before `up`); mutant: no fsync | Relying on rename alone |
| C6 | An empty, malformed or unreadable mark **is an interruption**: `current` is restored first, then `state` is raised. Only the quarantine needs the digest. Today it refuses `state` and the bad release runs | Empty, truncated, junk and unreadable marks, each with the candidate running | Treating malformed as absent (a power cut then loses the mark) |
| C7 | The mark cannot wedge or be forged. State directories stay root-owned 0755; no container mounts them (name the guard rule). Forging it needs root, and buys a re-`up` of `current` and one quarantine line. A restore that fails is retried every poll, alert RED, **and is not counted as a second interruption**: today poll 2 of a failing restore quarantines, and every later poll appends a line. At the 1 MiB read cap the file stops parsing and the project is stuck in `state` (about five weeks of polls, by arithmetic). Quarantine is idempotent per digest and reason | Ten polls of a failing restore: no quarantine line. A restore that then works: mark gone, the same digest tried once more | A retry limit after which the mark is dropped |
| C8 | Mark equal to `current`'s digest (a crash after the pointers): never quarantined on that account, even twice; `current` is brought up and waited healthy; unfinished promotion (link, `images.env`) is finished; then the mark goes. Health is **measured again**, not inferred from the pointer | Two crashes after the pointer write; the same where that release is now unhealthy | Clearing the mark without a health wait: it trusts H2's wrong `current` |
| C9 | No `current` (a first deploy cut short): the ruling says what becomes of the never-healthy release. The gate's words cover it, and today the mark is cleared with the candidate left running. I accept stopping the candidate's `web`, `auth` and `worker` (Postgres stays). Leaving it running, RED with the mark kept and the operator told, is an accepted risk and needs an approver on record. On prod, Caddy goes back to edge's `current`, as the unwind does (prod's part may go to POLY-165 if said) | Cut in `first-deploy staging`, then a rerun | Any `down`, `rm -v` or `--remove-orphans`. A mark that blocks the rerun of `first-deploy` for good |
| C10 | The recovery is the normal restore: owned-safely, tree hash, guard, `pull never`, health. Nothing is relaxed for being a recovery, but for what C-a to C-d below allow | A tampered tree of `current`, with a mark: not upped, `rollback-unhealthy`, mark kept | A fast path that ups the saved render without `judge` |
| C11 | `edge-deploy` with the mark recovers before it uses its tag, also when the tag equals or is below `current`'s, and says on stderr that it recovered. On `rollback-unhealthy` the exit is non-zero, and no later alert or `clear_alert` in that run hides it | `edge-deploy` with the same tag, a lower tag and an absent Release, each after R4 | Recovery placed inside the candidate branch |
| C12 | `rollback` by hand with a mark present is defined. Today it quarantines `current` (the good release) and ups `previous`. Preferred: refuse, naming `edge-deploy` or the poll; or recover and stop | Mark present, `rollback staging` and `rollback edge`: the good digest is not quarantined | Runbook text alone while the command does harm |

**What moving recovery ahead of the two checks newly exposes.**
- **The token: nothing.** The restore makes no network call and takes no token. Test: no `gh`, `git` or registry call before the restore.
- **The Compose version: yes, bounded.** An unpinned Compose now renders and ups `current` with nobody asking, once per poll while the mark lasts. `rollback` already does so by hand. The input passed verification, the guard and health, so nobody outside gains a new reach.
  - **C-a.** The render stays isolated and judged.
  - **C-b.** A render made by an unpinned Compose does not replace `current`'s saved pair, which backup, uploader and cli read later.
  - **C-c.** A mismatch can also make the judge refuse (the fixed point, a new default key), and then the bad release stays after all. The ruling says what happens. I accept falling back to `current`'s saved pair when its sha256 holds and its bytes pass the installed guard; if that refuses too, RED with the mark kept. Upping bytes no check passed is not acceptable.
  - **C-d.** R1's test uses a Compose that **changes the render**, not a fake version string alone.
- **Reboot: not new.** `unless-stopped` starts the candidate at boot until the poll (up to 6 minutes by the timer's settings). State it; no change required.

### H2: a wrong `current` after a failed save

| # | A fix must guarantee | Test shown red on | A wrong fix |
|---|---|---|---|
| C13 | After any exit of `_healthy` or edge's `_promote`, the running release and `current` agree, or the mark is kept and the next run makes them agree. A digest the run quarantined is neither `current` nor `previous` after it | Each write and the link of `_healthy` and `_promote` failing in turn; then a later failed release, and a manual `rollback`: neither ups a quarantined digest | Putting back `current` only: `previous` was overwritten with `cur`, so `rollback` restores the running release and quarantines it. Deleting a pointer (the next run reads "not deployed") |
| C14 | If the put-back also fails (the disk is still full), it is not read as C8's crash of a good release. Simplest: one atomic commit point (`current`), last of the needed writes, and nothing after it can trigger an unwind | Save fails, put-back fails, next run: the refused digest is not restored as good | Two states that look the same on disk |
| C15 | An automatic restore whose pointer names a quarantined digest does not up it silently: RED, named | `current` quarantined, mark present | Silent `up` |

H3 stays with POLY-165; the fix must not enable timers early nor make a first deploy's failed save look healthy.

### H4, H5

| # | A fix must guarantee | Test shown red on | A wrong fix |
|---|---|---|---|
| C16 | After `up`, a refusal that does not quarantine is not repeated without limit for the same digest. The hold is bound to the digest, shows RED in `status`, lifts for another digest, another bundle, or one documented command. It never blocks recovery | `unjudged` after `up`: polls two and three make no `up` of the candidate; a new digest deploys | Quarantine for good on a box fault (bans a good, perhaps security, release). A hold that clears the alert |
| C17 | A timed-out `check-config` (124) is a named refusal with no quarantine, its container gone before the lock is released; a non-zero exit still quarantines. The total has a ceiling well under the unit's 90 minutes (today 4 × 600 s), and the slow digest does not block a newer one | 124 for each of the four services; exit 1; a container that will not go stays `oneoff-stuck` | Treating 124 as success, or skipping `check-config` |
| C18 | No record in an exception handler can raise: `rel.log` in both `Transient` handlers, `busy`, `clear_transient`. A full disk ends in an alert attempt and stderr, never a silent exit | `ENOSPC` on `deploy.log` alone, and on every file | `except: pass` with no other sign |
| C19 | Double crash: C7 and C8 | - | - |

### The pool listener

| # | A fix must guarantee | Test shown red on | A wrong fix |
|---|---|---|---|
| C20 | All four pools (one constructor helper), and each client **while checked out** (pg-pool removes its own listener at checkout), have an `error` listener for the client's whole life | Idle: backends terminated. Checked out: terminated inside `withSession` with **no query in flight** (one in flight rejects and may hide the fault). Every pool, red without each listener | A process-wide handler that carries on; a listener on the pool only |
| C21 | Nothing is hidden. A lost client is destroyed, not reused. The caller gets an error, **also when the loss is at COMMIT**: never the result, and nothing is retried. Health is 503 while the database is down and 200 after, so a deploy onto a dead pool still rolls back | Terminate before and during COMMIT; Postgres stopped: 503, then back; the next checkout carries no identity | Swallow and go on; a health route that reads a cached answer; a retried write |
| C22 | Logged through the service's logger: pool name, error type and SQLSTATE only. **Never the error object**: pg-pool sets `err.client`, which holds the connection's password, and pg's `detail` quotes values. No `console`. Bounded lines in an outage | A canary password and a canary `detail` in every sink; a line count over a 60 s outage | `console.error(err)`, or a serializer that walks own properties |
| C23 | `process.crash` still ends the process on any other uncaught error; startup (guard, zone, config) still refuses as now; a wrong password is not softened | A planted throw exits 1; a refused start refuses | Widening the crash handler |
| C24 | `migrate.ts`'s own clients are out of scope (one shot): say so. The worker's schedule goes on after an outage, and a failed run is recorded as failed. Restart Postgres under real web, auth and worker: same pids, health back | The real processes; red if the worker's loop dies with the first failure | - |

### Paths, H6, docs

| # | A fix must guarantee | Test shown red on | A wrong fix |
|---|---|---|---|
| C25 | `provision.sh` resolves its own directory once, before `cd /`, absolute, with `CDPATH` unset and `--`; every lookup uses it; one that cannot be resolved stops before any change | `bash provision.sh`, `./provision.sh`, `infra/provision.sh`, with `CDPATH` set; a planted `/deploy/compose-version` is not read | Dropping `cd /` (the caller's directory and its `.env` decide again, G11), or trying two places |
| C26 | On a box with no render home, provision and provision-check give a true answer, never "absent" read as a pass; a render home that is a link, not empty or wrongly owned is refused (as `dirs.peek`). `--env-file /dev/null` stays on every call; provision-check creates nothing | No render home; one holding a `.env`; a link | Falling back to the caller's directory, or `mkdir` without the owner and mode checks |
| C27 | INFRA §4.4 to §4.6 match the code. Runbook: after Ctrl-C in `edge-deploy`, run `edge-deploy` again, not `rollback`; the line has been **run** once | - | - |
| C28 | T-real: a deploy killed (SIGKILL) after `up`, with a Compose mismatch at the next poll, and one by SIGINT, on real Docker; time recorded. If the budget does not allow both: SIGKILL with the mismatch there, SIGINT on the harness, said so | Red on the unfixed code | Fakes only: what Docker leaves running is H1's whole point |

**Accepted risk.** Two items may need one: C9's second form, and C1's residue (a restore that itself fails leaves the new release running, RED, mark kept, tried each poll; no attacker causes it from outside, it takes an interruption and a broken `current`). R-32 closes only when C1 to C12 are shown. A residue left gets its own row, with an approver on record first.
