# POLY-49 gate-1 ruling — receiver hardening (grouped)

Architect, 2026-09-25. AC numbers are POLY-49's checklist in body order (AC1 members … AC7 ensure-running).
No one on the team edits `.claude/settings.json`; the settings delta in §1 is the user's to apply.

## Measurements

| # | What | Command / predicate | Result |
|---|---|---|---|
| M1 | Exports reaching :4318 | `netstat -an -p tcp` every 2 s × 150 s, count non-LISTEN `.4318` rows (server side holds TIME_WAIT ≈30 s); method validated by one own `curl` POST → 1 TIME_WAIT row | **0** with lead + 3 teammates live (all 2.1.282) |
| M2 | Aggregator state | `--flush-now` on pid 68452, read `.sessions/.last-flush` | `23:21:07Z 0` — nothing folded since the 22:31:24Z flush (also 0) |
| M3 | Harness version vs capture | `version` field of every polycarpic transcript touched in 14 h vs otel lines' `generated` | every flush with data ≤ 20:37Z comes from 2.1.280 sessions; 2.1.282 sessions (lead from 20:40Z, POLY-48/57/49 teams) produce ≈ nothing |
| M4 | Same project-settings env, two versions | scratch dir, `.claude/settings.json` env = this repo's block pointed at a scratch sink :4399, interval 3 s, `-p` + `sleep 12` | 2.1.280 → **3** exports; 2.1.282 → **0**; 2.1.282 with `settings.local.json` → 0; with `CLAUDE_CODE_ENABLE_TELEMETRY=1` in process env + OTEL_* in project settings → 0 |
| M5 | 2.1.282, OTEL_* in process env | same probe, vars exported in the shell | 3 exports; `parse_export` folds 4 points per token export; `aggregationTemporality: 1` (delta) — **receiver parses 2.1.282 payloads correctly** |
| M6 | 2.1.282, OTEL_* in user settings | `CLAUDE_CONFIG_DIR=<scratch>` whose `settings.json` holds the env block | exporter initialises (1 export before the no-login exit); a SessionStart hook there sees `CLAUDE_CODE_ENABLE_TELEMETRY`, **no** `OTEL_*` |
| M7 | Changelog | Claude Code 2.1.282 release notes | project + local settings now ignore the vars that enable export / set the endpoint (`CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_*` endpoint) |
| M8 | Why registration failed | tool-subshell `env` (2.1.282) + `ensure_running` read | `CLAUDE_CODE_ENABLE_TELEMETRY` absent → H1 `return False` runs **before** `register_session`; this session's id `02a8a28e…` absent from `.sessions/` |
| M9 | Flush cadence | read `serve` | interval flush lives only in `_on_export`; no export ⇒ no interval flush |
| M10 | Stale registry entry | `ps -p $(cat .sessions/bcc9a749…)` | pid 16425 = `claude bg-spare` (claimed spare = the session process), started 09-23 10:30, still alive; transcript idle since 05:33Z. Whether that session is live-in-background: (unmeasured) |
| M11 | `--flush-now`/`--status` from a worktree | run in this worktree | `running: False`, pidfile resolved to `<worktree>/process/cairn/metrics/` |

## 1. AC4 capture — cause and fix layer

**Cause (M1–M8):** Claude Code 2.1.282 ignores telemetry vars in repo settings, so no session since 20:40Z exports, and the same
change strips `CLAUDE_CODE_ENABLE_TELEMETRY` from hook env, so H1 declines before registering (AC6/AC7's missing sessions).
The aggregator is not dropping records (M5). 70 min → 4 records was 2.1.280 teammates' tail plus shutdown exports, not cardinality.

**Fix layer: settings (user) + receiver (defence).**

User applies (not a repo change):
- `~/.claude/settings.json` → `env` **add**: `"CLAUDE_CODE_ENABLE_TELEMETRY": "1", "OTEL_METRICS_EXPORTER": "otlp", "OTEL_LOGS_EXPORTER": "none", "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json", "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:4318"`
- `.claude/settings.json` → `env` **remove** those same five keys (dead since 2.1.282; each session prints an ignored-vars notice).

Receiver changes (implementation-lead):
1. **Interval flush from the watchdog.** `_tick` calls `_do_flush()` when `monotonic() - state.last_flush_monotonic >= flush_interval`,
   independent of exports. `_on_export`'s check stays. `--flush-interval` is threaded into the spawn argv like `--grace-period-seconds`.
2. **Foreign-session filter** (the endpoint is now user-global, so every project's sessions post to :4318 — PT-79 class).
   In `_handle_export_body`, a datapoint whose `session_id` has no transcript per `backfill_tokens._transcript_path_for(session_id,
   transcripts_dir)` is dropped before `fold`. Positive hits cached in `ReceiverState.known_sessions` (in-memory set, never persisted);
   misses not cached. A datapoint with no `session.id` is kept (unchanged). Each flush that dropped any prints one stderr line
   `otel_receiver: dropped <n> datapoint(s) from <k> session(s) with no transcript in this repo` — counts only, never ids.
   Ordering assumption: a session's transcript exists before its first token export (unmeasured; a miss is retried next export).
3. **`--status`** gains a last line `exporter-endpoint: <url> (source: env|user-settings|default)` from the §5 resolver. Earlier lines byte-stable.

AC4 verification needs sessions started after the user delta; if it is not applied by review, AC4 is **blocked-on-user**, not failed.

## 2. AC2 watchdog flake, AC5 self-stop sweep flake — widen bounds / remove the race; no clock injection

- **AC2:** keep `recreate_bound = 0.5`; poll window after `rmtree` becomes `recreate_bound + 15.0`, self-stop wait `grace + 15.0`.
  Add a lower-bound assertion: dir not recreated within the first `0.3 s` after `rmtree` (monotonic, cannot flake upward).
- **AC5:** the periodic sweep disappears under §4 (reap every tick). `PeriodicReapSweepTests` is rewritten: drop the transient
  `sessions: 2` assertion (the race itself); assert `sessions: 1` and the id absent within a 10 s poll. The fresh-transcript
  survival test is **inverted** (dead pid + fresh transcript → dropped within the poll), per §4.
- Gate for both: qa runs each module 10× under `run_tests.py -j 8` (AC2) and `-j 4` (AC5); counts reported at tests-red.

## 3. AC3 — worktree resolution

`main()` computes `repo_root = worktree_root.main_checkout_root(backfill_tokens._repo_root())` once; every default path
(pidfile, sessions dir, out-file, logfile, transcripts slug, prefix, roster, `branch_repo_root` default) derives from it — so
`--ensure-running`, `--session-ended`, `--status`, `--flush-now`, `--stop` all hit the main checkout's metrics dir.
New module `scripts/cairn/worktree_root.py`: `_resolve_worktree_main_checkout` moved verbatim from `run_tests.py` (which keeps the
name as an import alias; `test_estimation.py` references it) plus `main_checkout_root(p) -> Path` = resolver result or `p`.
`_signal_running` failure text becomes `error: no running receiver (<label>): pidfile <abs path> absent or stale` → exit 1.

## 4. AC6/AC7 — registration and liveness

- **Register first.** In `ensure_running`, `register_session` moves above the H1 gate (right after the `config.yml` check).
  H1 still gates only the spawn; its decline now prints one stderr line:
  `otel_receiver: not starting -- CLAUDE_CODE_ENABLE_TELEMETRY is not set in this process; Claude Code >= 2.1.282 reads telemetry vars from ~/.claude/settings.json, not project settings`.
- **Liveness = pid, every tick.** `_tick` reaps with the pid-only predicate (`_pid_is_alive`) on **every** tick, nudged or not.
  The transcript-staleness second signal (PT-86 addendum C) is **withdrawn** from the reap predicate — AC7 requires drop within
  one beat of pid exit. `pid: null` entries are still never reaped. `--periodic-reap-seconds` stays accepted (argv back-compat), no effect.
- **Self-stop arming** unchanged: empty live set ∧ `ever_nonempty` → grace deadline → stop. The `dead-pending` status label can no
  longer arise; builder removes it and any now-unused two-signal helper.
- Pid reuse is not guarded (unmeasured risk). M10's bg-spare entry stays listed while its process lives — correct under this rule.

## 5. POLY-25 — H3 without OTEL_* in hook env

New `_exporter_endpoint(environ, user_settings_path) -> Tuple[Optional[str], str]` returns `(endpoint, source)`:
`environ["OTEL_EXPORTER_OTLP_ENDPOINT"]` → `env` in `user_settings_path` (`$CLAUDE_CONFIG_DIR/settings.json` else
`~/.claude/settings.json`; unreadable/malformed → skipped) → `(None, "default")`. Project settings are **not** consulted (M7).
`_effective_endpoint_port` consumes its result. `ensure_running` takes `user_settings_path: Optional[Path]`; tests pass a tmp file.
TRACKER.md telemetry section: replace the project-settings env instructions with the user-settings location and cite 2.1.282.

## 6. POLY-27

Recreate step: `if sessions_dir.parent.is_dir(): sessions_dir.mkdir(exist_ok=True)` (no `parents=`) + markers + log; else keep
holding, log once per absence episode `watchdog: registry parent absent, holding <path>`.

## 7. POLY-9

`cairn.py` `_parse_scalar`: for `raw[0] == "*"` raise `YamlError(f"{ctx}: {raw!r} starts with '*' and reads as a YAML alias; quote it: \"{raw}\"")`.
`&` keeps the current message. TRACKER.md → Path ownership gains one sentence: hand-edited `*`-leading globs must be quoted.

## 8. POLY-7 — tests to mirror

In `test_ensure_metrics_worktree.py`, mirror `test_a_broken_origin_url_still_mounts_the_real_branch_not_a_fresh_orphan`
(throwaway origin + clone, real subprocess): (3a) no `refs/remotes/origin/metrics`, origin URL unreachable → exit 0, exactly one
stderr line, metrics path unchanged; (3d) a `git` shim first on `PATH` that exits 128 on `worktree add` and execs real git otherwise
→ backup contents merged back into the path, no `*.bak*` left.

## Red tests qa writes (one module per concern)

1. interval flush with no exports (`--flush-interval 1`, `.last-flush` advances within 10 s) · 2. foreign session dropped / own
worktree-sibling session kept / no-`session.id` kept, stderr count line has no id · 3. `--status` exporter-endpoint line, three sources ·
4. AC2/AC5 rewrites per §2 · 5. linked-worktree `--flush-now`/`--status`/`--ensure-running` hit the main checkout (fake main + linked
worktree, real git); loud failure text · 6. registration with H1 off (file written, no spawn, stderr line) and with a receiver running ·
7. dead pid dropped within 10 s poll, fresh transcript irrelevant; `pid: null` kept · 8. POLY-25 resolver precedence incl. malformed
user file · 9. POLY-27 parent absent → no mkdir, holding line · 10. POLY-9 hint text · 11. POLY-7 3a + 3d. Existing tests asserting the
two-signal rule or `dead-pending` are inverted or deleted, listed by name at tests-red.
