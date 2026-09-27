---
id: POLY-10
title: OTel receiver has never written token-usage.jsonl; watchdog thread crashed on a missing .sessions/.closing path
status: done
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P1
pr: https://github.com/richmosko/polycarpic/pull/11
created: 2026-09-23
updated: 2026-09-25
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

Gate-1 ruling (POLY-21): read `process/reviews/POLY-10/ruling.md` @ 3d83a20. Summary of rulings, all measured (M1–M7 in the note):
- AC1: absent `.sessions/` = unknown, never empty → hold (cancel grace, no reap), no mkdir during the swap window, recreate after 60 s; `.closing` ENOENT caught; any other watchdog exception exits the whole receiver with code 3 after the §5 shutdown. Forbidden state: listening ∧ watchdog dead.
- AC2: `.watchdog-heartbeat` + `.last-flush` dotfiles; `--status` adds `watchdog:` and `last-flush:` lines; exit 2 = running with a dead watchdog.
- AC5: one `_transcript_path_for` resolver scanning `<slug>--claude-worktrees-*/<id>.jsonl` (0.09 ms/miss), used by role resolution, staleness probe and `--status` (fixes a latent PT-86 one-signal reap for teammates). No registration-time paths.
- AC4: `OTEL_*` reach neither tool subshells nor hook-spawned processes (measured); TRACKER H1/H3 wording is false as written — H3 never runs in the real hook path. Doc fix in POLY-10; code fix is a follow-up.
- Tests: 8, listed in note §(f).

### @team-lead — 2026-09-24

Gate-1 ruling accepted @ 3d83a20 (hold-during-swap / recreate after 60 s / fail closed exit 3; heartbeat + last-flush files for --status with exit 2 on the forbidden state; one shared transcript-path resolver over the worktree sibling dirs used by role, staleness and status; smoke test via the real CLI). POLY-21 closed at design-gate clear. Follow-ups filed from the bubble-ups: POLY-25 (H3 check never runs), POLY-26 (backfill sibling scan). PT-86 latent reap defect is in scope via the shared resolver.

### @qa-engineer — 2026-09-24

RED @ bb000bc: `scripts/cairn/tests/test_otel_receiver_watchdog_attribution.py`, 8 tests per gate-1 ruling (3d83a20) §f.

Confirmed right-reason failures against current `otel_receiver.py` (7/11 methods fail):
- AC1: absent `.sessions` swap crashes the watchdog thread on an uncaught `FileNotFoundError` at `.closing` (line 1842) — self-stop never fires after restore. Recreate-after-bound fails on missing `--registry-absent-recreate-seconds` (my own inferred flag name, flagged in the file's docstring).
- AC1 belt: an injected non-ENOENT exception (`RuntimeError` via a monkeypatched `live_session_ids`) kills the thread silently; process hangs forever instead of exiting 3.
- AC2: `--status` has no `watchdog:`/`last-flush:` lines and no exit-2 forbidden state yet.
- AC5: `resolve_role`/`_transcript_is_stale` have no worktree-sibling-dir fallback yet (direct-match and near-neighbour-exclusion cases already pass, as expected regression companions).

Bubble-up: the AC3 smoke test (real CLI, ephemeral port, HTTP POST, SIGUSR1 flush, role via a fixture transcript) is GREEN already today — AC3's wiring pre-dates this ticket. Kept as a locked-in regression test, not forced red.

No regressions: full `test_otel_receiver*` suite (4 files, 87 tests) — only this new file fails; the other 80 pass.

### @implementation-lead — 2026-09-24

GREEN @ (pending push sha): all 8 ruling tests (3d83a20 §f) pass; full suite 1777 tests/104 files green (`--gate green`).

otel_receiver.py changes per (a)-(e): watchdog holds on absent `.sessions/` (unknown, not empty), recreates after `--registry-absent-recreate-seconds` (default 60s), catches ENOENT at the `.closing` open, and any other exception hard-exits the whole receiver (code 3, `watchdog: fatal` stderr, `os._exit` from the watchdog thread since `sys.exit` in a non-main thread wouldn't set the process exit code). `--status` gained `watchdog:`/`last-flush:` lines and exit 2 -- narrowed to a *stale* heartbeat specifically, not merely *absent*: test 1's mid-swap probe needs `.sessions` (and the heartbeat file inside it) to be legitimately unreadable without tripping the forbidden-state alarm, matching PT-86 section 0's "false stop costs more than false calm" asymmetry. `_transcript_path_for` (new) resolves both the main slug dir and worktree-sibling dirs, used by role resolution, staleness probe, and `--status` alike; suffix derived via `backfill_tokens._transcript_dir_slug`, not hard-coded.

TRACKER.md: H1/H3 corrected per (e) (OTEL_* never reaches hook-spawned processes; H3 never fires against a real mismatch in the hook path). New POLY-10 paragraphs for watchdog health + sibling-scan attribution.

Judgment call beyond the ruling's literal text: (b)'s "2 = running AND watchdog not alive" reads as absent-or-stale, but that breaks test 1 (mid-swap heartbeat legitimately unreadable) unless narrowed to stale-only, which test 5 also satisfies (its absent/alive/stale cases are all explicit). Flagging for the verdict gate rather than re-opening the ruling myself.

Files: scripts/cairn/otel_receiver.py, process/TRACKER.md.

### @architect — 2026-09-24

Gate-4 verdict (POLY-24): **approve** at c43ab6d (code d8cf722), reviewed against the ruling `process/reviews/POLY-10/ruling.md` @ 3d83a20.

| Axis | Result | Evidence |
|---|---|---|
| AC1 hold / recreate / ENOENT / fatal exit 3 | pass | d8cf722 `_tick` absent-dir branch first; `.closing` catches FileNotFoundError; `_watchdog_fatal_shutdown` uses `os._exit(3)` after the §5 shutdown sequence; tests 1–4 |
| AC2 `--status` watchdog + last-flush | pass (with the deviation below) | heartbeat judged by file mtime, `.last-flush` written on every flush; test 5 |
| AC3 smoke test over real HTTP | pass | `test_smoke_http_export_lands_otel_line`, a subprocess receiver on an ephemeral port |
| AC4 env scope in TRACKER | pass | H1/H3 correction plus the watchdog and attribution paragraphs in the d8cf722 TRACKER.md diff |
| AC5 worktree-sibling attribution | pass | one `_transcript_path_for` used by role, staleness and `--status`; anchored `-old` test; lead still resolves to `team-lead` |
| Touched module | 11/11 OK | `unittest discover -p test_otel_receiver_watchdog_attribution.py`, run in the architect worktree at c43ab6d |

Deviation accepted: `--status` exits 2 only on `stale`. When the heartbeat is `absent` it still prints the state and exits 0. The ruling's "absent → 2" would false-alarm during the swap-window hold, and in the gap between bind and the first heartbeat. The only real case it misses is a daemon started before POLY-10, and one restart clears that.
Accepted: the AC5 fixture is a synthetic header-only record. It matches the measured M3 shape (`type: agent-setting` record at index ≤ 3) and carries no captured transcript content.
Non-blocking follow-up (my ruling's gap, not the build's): the recreate step uses `mkdir(parents=True)`, which can recreate `process/cairn/metrics/` itself if a swap runs longer than 60 s. The fix: keep holding while `sessions_dir.parent` is absent. Candidate to fold into POLY-25/26 or a new issue.

### @qa-engineer — 2026-09-24

VERDICT: PASS @ 2755393 (build 10040ad, architect-approved gate-1 deviation: exit 2 on stale-only).

| Suite | Command | Result |
|---|---|---|
| POLY-10 RED file | `run_tests.py -p 'test_otel_receiver_watchdog_attribution*'` | 11/11 green |
| Full Python gate | `python3 run_tests.py --gate verdict` | 1777 tests, OK, 4 skipped (expected) |
| JS suite | `node --test "scripts/cairn/tests/js/**/*.test.js"` | 479 tests, 477 pass, 2 fail — both the known layerchart ENOENT (POLY-8, unrelated to this feature) |

No new failures, no regressions. All 8 gate-1 ruling tests (§f) green: absent-dir hold, recreate-after-bound, .closing ENOENT non-fatal, fatal-exception exit 3, --status watchdog/last-flush + exit 2, HTTP smoke, worktree-sibling role resolution, worktree-sibling staleness.

### @team-lead — 2026-09-24

PR opened: https://github.com/richmosko/polycarpic/pull/11. Awaiting Validate.

### @team-lead — 2026-09-24

Validate passed (qa PASS @ a857b6c at 2755393; architect APPROVE @ 10040ad on c43ab6d); merging via PR #11. Closing.
Estimate calibration: estimated 16 commits / 2 gate cycles / ~50 min at spawn (22:22Z). Actual: 13 commits (2 code, 11 chore), 1 red→green cycle, review approved first pass, spawn → merge 2026-09-24T23:35Z ≈ 62 min (one qa turn lost to an API error). Loop cost $25.54. Sub-issues at their gates: POLY-21 1/1, POLY-22 2/2, POLY-23 1/2, POLY-24 1/1 — first loop with every sub-issue inside estimate.
Post-merge: live receiver restarted bare; first flush after that is the AC5 live proof. Follow-ups: POLY-25, POLY-26, POLY-27.

### @team-lead — 2026-09-25

Post-merge note (POLY-6 loop, 2026-09-25): the receiver's health dotfiles `.sessions/.watchdog-heartbeat` (rewritten every second) and `.sessions/.last-flush` tripped `scripts/cairn/tests/helpers.py`'s real-state guard ("content-changed") in any checkout with the live receiver — i.e. the main checkout only, since worktrees carry no metrics mount, which is why builders' gates never saw it. Fixed on the POLY-6 branch @ 3ec874c: the guard tolerates content changes to exactly those two files; removals still trip. Architect ruled it a test-harness fix, recorded here rather than in a design note.
