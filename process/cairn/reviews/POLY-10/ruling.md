# POLY-10 gate-1 ruling — receiver watchdog survival, `--status` health, teammate attribution

Architect, 2026-09-24. Scope: `scripts/cairn/otel_receiver.py` + its tests + `process/TRACKER.md` → telemetry.
Nothing here changes `.claude/settings.json` (user-only commits) or the SessionStart/SessionEnd hook lines.

## Measurements this ruling rests on

| # | What | Command / predicate | Result |
|---|---|---|---|
| M1 | Why the watchdog died | read `_watchdog_loop` + `ensure_metrics_worktree.main` | `live_session_ids()` returns `{}` when `.sessions/` is absent, so a swap window reads as a *drained registry*; the grace timer arms, elapses, and `os.open(.closing, O_CREAT\|O_EXCL)` raises `FileNotFoundError`, uncaught → thread dead, `serve_forever` still listening |
| M2 | Swap window length | `ensure_metrics_worktree.main` | rename-aside → `git fetch origin metrics` (network) → `worktree add` → restore `.sessions/` by `shutil.move`. Unbounded by the network; routinely > the 10 s grace |
| M3 | Teammate header fields | first 50 records of all 19 transcripts under `~/.claude/projects/<slug>--claude-worktrees-*/`, keys `agentSetting`/`agentName` only | 19/19 carry `agentSetting` (roster name) at record index ≤ 3; inside `_ROLE_SCAN_LIMIT` = 50 |
| M4 | Worktree dir ≠ identity | same scan | `poly-1-git-identity/` holds 3 transcripts of 3 different agents → identity must come from the session's own transcript, never the dir name |
| M5 | Sibling-scan cost | `glob(<slug>--claude-worktrees-*/<id>.jsonl)`, miss, ×100 | 0.09 ms/call (45 project dirs on this machine) |
| M6 | Env scope, tool subshell | `env` in this teammate's Bash | `CLAUDE_CODE_ENABLE_TELEMETRY` present; 0 `OTEL_*` vars |
| M7 | Env scope, hook-spawned process | `ps eww` on the live receiver (pid 2556, spawned by the SessionStart hook), var names only | `CLAUDE_CODE_ENABLE_TELEMETRY` present; 0 `OTEL_*` vars |

## (a) AC1 — watchdog failure mode: both, layered

**Ruling: an absent registry dir is *unknown*, never *empty*; and any other watchdog exception exits the whole receiver loudly.**

1. **Absent `sessions_dir` → hold.** At the top of each tick, `sessions_dir.is_dir()` false ⇒ the tick is a no-op for the
   lifecycle: cancel any armed `shutdown_deadline`, do not reap, do not touch `ever_nonempty`. Rationale: PT-86 §0 —
   every lifecycle choice breaks toward *not stopping*; a swap window read as "drained" is a false stop.
2. **Do not recreate during the window.** `mkdir` of `.sessions/` inside `process/cairn/metrics/` mid-swap makes the path
   non-empty and fails `git worktree add` (M2). The restore step brings `.sessions/` back by move.
3. **Recreate after a bound.** If the dir stays absent ≥ `REGISTRY_ABSENT_RECREATE_SECONDS` (60 s; module constant,
   overridable by a test kwarg on `serve`), recreate it with `mkdir(parents=True, exist_ok=True)`, rewrite the
   `NUDGE_CAPABLE` and `.transcripts-dir` markers, and log one stderr line: `watchdog: registry dir absent 60s, recreated
   <path>`. The registry is then empty with `ever_nonempty` unchanged — sessions re-register on their next SessionStart;
   an empty registry that stays empty self-stops through the normal grace path (acceptable: a restart is one hook away).
4. **`.closing` race.** The `O_EXCL` open catches `FileNotFoundError` alongside `FileExistsError` → `continue` (dir
   vanished between the check and the open — same as step 1).
5. **Belt: no thread death, ever.** The loop body is wrapped: any `BaseException` other than the normal `return` paths
   prints `watchdog: fatal <ExcType>: <msg>` + traceback to stderr, then runs the §5 shutdown sequence it already owns
   (`httpd.shutdown()`, `server_close()`, `_do_flush()` best-effort, `_compare_and_delete_pidfile`) and sets a
   `watchdog_failed` flag so `serve()` returns and `main` exits **non-zero (3)**. The next SessionStart's
   `--ensure-running` respawns. Recovery of the *known* failure (1–4) is in-process; the *unknown* one fails closed.

**Forbidden state (the invariant a test pins):** `listener accepting` ∧ `watchdog thread not alive`. Never observable
for longer than one shutdown sequence.

## (b) AC2 — `--status` fields

`--status` is a separate process, so liveness crosses by file, the pattern `.transcripts-dir` already uses (no HTTP
control/health endpoint — PT-86 addendum A.2 withdrew that surface; a read-only GET would reopen the cross-repo question).

- Watchdog writes `<sessions_dir>/.watchdog-heartbeat` (ISO timestamp), throttled to once per second, skipped silently
  while the dir is absent. `_do_flush` writes `<sessions_dir>/.last-flush` = `<iso> <lines>`, on every flush incl. no-op
  flushes (a no-op flush proves the flush path runs). Both are dotfiles → already skipped by `live_session_ids`.
- New lines, after `out-file:`: `watchdog: alive|stale|absent (last beat <iso>)` — `alive` iff heartbeat age ≤
  `5 s`; `absent` = no file (old daemon, or never started). `last-flush: <iso> (<n> lines)` or `last-flush: never`.
- Exit codes: `0` running ∧ watchdog alive; `1` not running (unchanged); **`2` running ∧ watchdog not alive** — the
  forbidden state is scriptable, not just printed. Existing line order and the `running:` line stay byte-stable.

## (c) AC5 — attribution fix shape: sibling scan, one shared path resolver

**Ruling: scan the repo's own worktree sibling dirs; do not record transcript paths at registration.**

- New `_transcript_path_for(session_id, transcripts_dir) -> Optional[Path]`: `transcripts_dir/<id>.jsonl` if a file, else
  the first file matching `transcripts_dir.parent / f"{transcripts_dir.name}--claude-worktrees-*" / f"{id}.jsonl"`,
  else `None`. The suffix is derived with `backfill_tokens._transcript_dir_slug(repo_root / ".claude" / "worktrees")`
  minus the repo slug, not hard-coded, so a slug rule change moves both.
- **Used by all three consumers**, not just the role resolver: `_resolve_role_from_session`, `_transcript_is_stale`,
  and `--status`'s dead/dead-pending label. Latent PT-86 defect found here: today a teammate's transcript is never found,
  so `_transcript_is_stale` returns True for every teammate — the "two independent signals" reap guarantee is one
  signal for every teammate. Fixing role alone would leave that.
- Why not registration-time paths: the session file's plain-int format is read by *running* old daemons, which skip a
  malformed entry → invisible session → premature self-stop; a sidecar adds a second lifecycle to keep coherent; and
  it only helps sessions started after the upgrade. The glob costs 0.09 ms per miss (M5), runs only on a cache miss.

**Invariants that must hold (PT-87):** reads only `<session_id>.jsonl` by exact name — no directory listing of transcript
contents, never another session's file; anchored prefix `<slug>--claude-worktrees-` (the trailing `-` excludes
`<slug>-old`-style neighbours of another project); scan window unchanged (`_ROLE_SCAN_LIMIT`, exactly the two header
fields via the imported `_scan_header_fields`); the path is derived per lookup and never stored or logged; a miss is
still `subagent-unattributed`, uncached. The lead (main checkout slug) still resolves to `team-lead`.

## (d) AC3 — smoke test shape

`subprocess` launch of `otel_receiver.py` (the real CLI, not `serve()` in-thread) with `--port <ephemeral>` (bind a
socket to port 0, read the port, close it), `--out-file <tmp>/token-usage.jsonl`, `--transcripts-dir <tmp>/transcripts`
holding one fixture transcript for the fixture session id, a temp `--repo-root`/pidfile so nothing touches the real
metrics dir, and `CLAUDE_CODE_ENABLE_TELEMETRY=1` in the child env. Poll `_port_is_listening` (≤ 5 s). One real
`urllib.request` POST to `/v1/metrics` with an OTLP-JSON body (existing fixture) carrying `session.id`, then SIGUSR1
(flush) or `--flush-now`, poll the out-file ≤ 5 s. Assert exactly one new line with `source: "otel"`, the fixture's
token count, and the fixture's role. SIGTERM in `finally`; assert exit and pidfile removed. No sleeps without a poll.

## (e) AC4 — `settings.json` → `env` scope (verification, not a bug)

M6 + M7: the harness applies `OTEL_*` from `env` to **its own OTel SDK only**; neither tool subshells nor hook-spawned
processes see them. `CLAUDE_CODE_ENABLE_TELEMETRY` *is* exported to both. TRACKER.md line "The OTEL_* variables … are
not visible in Bash subprocesses" is correct and gains "or in hook-spawned processes (measured 2026-09-24, POLY-10)".
**Correction required:** TRACKER.md H1 ("the `env` block reaches hook-spawned subprocesses") and H3 ("If the variable is
unset, H1 already declined") are false as written: in the real hook path `OTEL_EXPORTER_OTLP_ENDPOINT` is always unset
while H1 passes, so the H3 port/endpoint agreement check never runs. The doc must say so; code change to H3 is out of
POLY-10 scope (bubble-up: follow-up issue).

## (f) Tests qa writes (red first)

1. `test_watchdog_holds_when_sessions_dir_absent` — in-thread `serve`, grace 0.3 s, one registered session; rename
   `.sessions` aside for 2 s (≫ grace); assert thread alive, port listening, pidfile present; rename back; still up.
2. `test_watchdog_recreates_after_absent_bound` — recreate bound 0.5 s via kwarg; remove dir; assert dir + markers
   recreated and one `recreated` stderr line; thread alive.
3. `test_closing_open_enoent_is_not_fatal` — monkeypatch `os.open` to raise `FileNotFoundError` once at the marker;
   thread alive afterwards.
4. `test_watchdog_fatal_exits_receiver` — subprocess; inject a raise via a test-only env hook or kwarg on the path; assert
   process exits code 3 within 5 s, port freed, pidfile gone, stderr has `watchdog: fatal`. Sampled invariant across
   tests 1–4: never (listening ∧ ¬watchdog alive) beyond the shutdown sequence.
5. `test_status_reports_watchdog_and_last_flush` — alive → exit 0 + both lines; heartbeat file aged 10 s → `stale`, exit 2;
   no `.last-flush` → `last-flush: never`.
6. `test_smoke_http_export_lands_otel_line` — (d).
7. `test_role_resolves_from_worktree_sibling_transcript` — captured teammate fixture (header records only, scrubbed; no
   message content) placed under `<tmp>/<slug>--claude-worktrees-x/<id>.jsonl` → `architect`; same id in the main slug
   dir → `team-lead` path unchanged; `<slug>-old/<id>.jsonl` → `subagent-unattributed` (anchor test).
8. `test_transcript_is_stale_finds_worktree_transcript` — fresh sibling transcript + dead pid → `dead-pending`, not reaped.
