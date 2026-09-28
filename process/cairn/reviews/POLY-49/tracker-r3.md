---
kind: deliverable
target: process/TRACKER.md
---

# POLY-49 R3 — TRACKER.md telemetry lines, verbatim replacements (architect, verdict @ a51fac6)

Replace each whole line (line numbers as of a51fac6) with the text below. Keep lines 90 and the H2 bullet as they are.
Line 88 changes only in its second sentence.

## L80 (Lifecycle)

**Lifecycle (PT-86): the receiver starts with the first session on the repo and stops with the last** (see the upgrade note immediately below for the one-time transition window). Every `SessionStart` (main session or teammate) registers its session id in `process/cairn/metrics/.sessions/`: one file per id, holding a liveness-probe pid (`$PPID`, the Claude Code session process). Every `SessionEnd` deregisters it; a teammate's `SessionEnd` fires on `shutdown_request`. A watchdog thread inside the receiver owns the stop decision. When the registry drains from non-empty to empty, it arms a grace window (`--grace-period-seconds`, default 10s). A new registration cancels the window; otherwise the receiver flushes, removes its pidfile, and exits. On every watchdog tick, before the drain check, a pid probe (`os.kill(pid, 0)`) drops each session whose process is gone. A `pid: null` entry is never dropped. `--periodic-reap-seconds` is accepted and has no effect. `--stop` stops the receiver manually. `--status` reports the live-session count and each id's liveness: `alive`, `dead` (pid gone, dropped on the next tick), or `unknown` (no pid).

## L86 (H1)

1. **Telemetry gate (H1).** `ensure_running` registers the calling session first. It then requires `CLAUDE_CODE_ENABLE_TELEMETRY` to be truthy (`"1"`/`"true"`/`"yes"`/`"on"`, case-insensitive) in its own environment before spawning. Otherwise it spawns nothing and prints one stderr line saying that Claude Code >= 2.1.282 reads the var from `~/.claude/settings.json`; the hook still exits 0. Hook-spawned processes inherit `CLAUDE_CODE_ENABLE_TELEMETRY` from the user env block but never the `OTEL_*` vars, which is why H3 resolves the endpoint itself.

## L88 (H3) — second sentence only

If the resolved port disagrees with `otel_port`, it refuses to start and names both ports plus the resolution source (`env`/`user-settings`/`default`).

## L96 (CLI anchoring)

**Every CLI invocation anchors on the main checkout.** `main()` resolves `repo_root` once via `worktree_root.main_checkout_root(...)`. `--ensure-running`, `--session-ended`, `--status`, `--flush-now` and `--stop` all derive their pidfile, sessions dir, out-file and logfile from it. A failed `--flush-now`/`--stop` names the pidfile it resolved: `error: no running receiver (<label>): pidfile <abs path> absent or stale`.

## L108 (attribution)

**Teammate attribution resolves through worktree-sibling transcript dirs.** A team-agent session's transcript lives under `<main-slug>--claude-worktrees-<name>/`. `_transcript_path_for` checks `<transcripts_dir>/<id>.jsonl` first, then the first matching `<transcripts_dir.name>--claude-worktrees-*/<id>.jsonl`. Role resolution and the foreign-session export filter both use it. `backfill_tokens.scan_transcripts` walks the main dir plus every `_worktree_sibling_dirs` match. Known gap: teammate records carry `gitBranch: worktree-<name>`, which `_bucket_for_branch` maps to `main` rather than the issue (POLY-45).
