---
id: POLY-10
title: OTel receiver has never written token-usage.jsonl; watchdog thread crashed on a missing .sessions/.closing path
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P1
pr: null
created: 2026-09-23
updated: 2026-09-24
---
The OTel receiver (`scripts/cairn/otel_receiver.py`) ran for a day without writing `process/cairn/metrics/token-usage.jsonl`: its watchdog thread died on a missing `.sessions/.closing` path (the metrics dir was swapped aside under it by `ensure_metrics_worktree.py`). After a bare restart it flushes, but every teammate session lands as `role: subagent-unattributed` (16 lines) instead of its agent name, so no sub-issue can ever match its assignee's tokens and every `cairn close` writes `actual.tokens: null`. See the two team-lead comments for the evidence.

## Acceptance criteria

- [ ] Watchdog survives a swapped or absent `.sessions` dir: it recreates the dir or exits the whole receiver loudly — never a dead thread under a live listener; a test pins it
- [ ] `--status` reports the watchdog thread state and the last flush time
- [ ] A smoke test proves one metrics export lands as an `otel` line in the token log (end-to-end through the HTTP endpoint)
- [ ] The absent `OTEL_*` exporter vars in tool subshells are root-caused (settings.json `env` scope vs the lead's Bash env) and the finding is recorded in `process/TRACKER.md` → telemetry, as a verification not a bug unless proven otherwise
- [ ] Teammate sessions resolve to their agent name (`architect`, `qa-engineer`, `implementation-lead`, …), not `subagent-unattributed`: the resolver reads the team agent's identity from wherever Claude Code actually records it for `--agent-name` teammates (transcript header, session registry, process args), with a test on a captured teammate transcript fixture; the lead still resolves to `team-lead`
## Comments

### @team-lead — 2026-09-23

Found 2026-09-24 during the POLY-3 design review. The receiver (pid 61107, started 2026-09-22 22:45) listened on 4318 for a day with 13 registered sessions and never produced `process/cairn/metrics/token-usage.jsonl`. Its log holds one traceback: the `_watchdog_loop` thread died with `FileNotFoundError` on `process/cairn/metrics/.sessions/.closing` — consistent with `ensure_metrics_worktree.py` swapping the metrics dir aside under a running receiver. Also worth checking: the lead's Bash env shows only `CLAUDE_CODE_ENABLE_TELEMETRY=1`, none of the `OTEL_*` exporter vars from `.claude/settings.json` → `env`, so exports may never reach the receiver at all. Restarted bare at review time; POLY-3's reader treats a missing file as `actual.tokens: null` + warning, so POLY-3 does not block on this, but calibration data is empty until it is fixed.
Acceptance: (1) watchdog survives a swapped/absent `.sessions` dir (recreate or exit loudly, never a dead thread under a live listener); (2) `--status` reports the watchdog thread state and last flush time; (3) a smoke test proves one metrics export lands as an `otel` line; (4) root-cause the absent `OTEL_*` vars in tool subshells and document the finding in TRACKER.md's telemetry section.

### @team-lead — 2026-09-23

Update after the bare restart (2026-09-24 06:21Z flush): token-usage.jsonl now exists, so exports do reach the receiver — the dead watchdog was the blocker, and the OTEL_* env suspicion is weaker (keep AC4 as a verification, not a bug). New AC5: teammate sessions land as `role: subagent-unattributed` (both opus and sonnet lines on POLY-3) rather than `architect` / `qa-engineer` / `implementation-lead`; only the lead resolves to `team-lead`. The role resolver's transcript-header lookup evidently does not see team agents spawned with `--agent-name`. Until fixed, every POLY-3 sub-issue closes with `actual.tokens` matching nothing (0 or null), so calibration tokens are empty even with the receiver healthy. Fix candidates: read `--agent-name` from the registered session's process args, or from the `agent.name` resource attribute if Claude Code sets it for team agents.

### @team-lead — 2026-09-24

Feature started. Branch: `feature/poly-10-receiver-watchdog-attribution`.
Lead estimate at start (calibration input; prior: POLY-5 21 min, POLY-3 95 min/32 commits, POLY-16 37 min/15 commits): 16 commits, 2 gate cycles, ~50 min spawn→merge. Receiver code is threaded and transcript-scanning, so the diagnosis (AC5) is the risk.

### @team-lead — 2026-09-24

AC5 root cause, measured 2026-09-24 before spawn: `_resolve_role_from_session` returns `subagent-unattributed` when `<transcripts_dir>/<session_id>.jsonl` is absent. `.sessions/.transcripts-dir` is `~/.claude/projects/-Users-mosko-Projects-polycarpic`, but every teammate runs with cwd `.claude/worktrees/<name>/`, so Claude Code files its transcript under the sibling slug `-Users-mosko-Projects-polycarpic--claude-worktrees-<name>/` (17 such dirs exist, one transcript each). The header fields (`agentSetting`/`agentName`) are presumably there; nothing reads that dir. Fix shape is the architect's call: scan `<slug>--claude-worktrees-*` siblings (cheap, PT-87 scan window unchanged), or have SessionStart registration record each session's own transcript path so the receiver never guesses.

### @architect — 2026-09-24

Gate-1 ruling (POLY-21): read `scripts/cairn/design/telemetry-attribution.md` @ 3d83a20. Summary of rulings, all measured (M1–M7 in the note):
- AC1: absent `.sessions/` = unknown, never empty → hold (cancel grace, no reap), no mkdir during the swap window, recreate after 60 s; `.closing` ENOENT caught; any other watchdog exception exits the whole receiver with code 3 after the §5 shutdown. Forbidden state: listening ∧ watchdog dead.
- AC2: `.watchdog-heartbeat` + `.last-flush` dotfiles; `--status` adds `watchdog:` and `last-flush:` lines; exit 2 = running with a dead watchdog.
- AC5: one `_transcript_path_for` resolver scanning `<slug>--claude-worktrees-*/<id>.jsonl` (0.09 ms/miss), used by role resolution, staleness probe and `--status` (fixes a latent PT-86 one-signal reap for teammates). No registration-time paths.
- AC4: `OTEL_*` reach neither tool subshells nor hook-spawned processes (measured); TRACKER H1/H3 wording is false as written — H3 never runs in the real hook path. Doc fix in POLY-10; code fix is a follow-up.
- Tests: 8, listed in note §(f).
