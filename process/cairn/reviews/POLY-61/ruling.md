# POLY-61 — gate 1 ruling (architect, 2026-09-27)

Base: `feature/poly-61-receiver-staleness-check` @ 2d080e8. All measurements ran against the worktree copy or a throwaway process; the live daemon was only observed with `ps`, never signalled or written (C10).

## Measurements

| # | Command | Result |
|---|---|---|
| m1 | import `otel_receiver`, list `sys.modules` files under `scripts/cairn/` | `otel_receiver.py`, `backfill_tokens.py`, `cairn.py`, `worktree_root.py`, all of `cairnlib/*.py`. Same set as the tests' `ENGINE_FILES` + `copy_engine`'s `cairnlib/` |
| m2 | `engine_fingerprint` over those 4 files + `cairnlib/` | 1.5 ms; `engine_is_stale` ×5 against those values: all `False`, 0.9 ms |
| m3 | `ps -o command -p $(cat process/cairn/metrics/.receiver.pid)` | the live daemon runs `/Users/mosko/Projects/polycarpic/scripts/cairn/otel_receiver.py` (main checkout); the spawn argv is `Path(__file__).resolve()` (`otel_receiver.py:1538`) |
| m4 | `engine_fingerprint` / `engine_is_stale` location | `cairnlib/watch.py:185,220`, built on `cairnlib/enginesrc` — the issue's "`cairnlib/enginesrc` (`engine_fingerprint` …)" refers to this pair |
| m5 | `grep -c "hashlib\|st_mtime_ns" scripts/cairn/otel_receiver.py` | `0` |
| m6 | `os.kill(<pid of an exited, reaped child>, SIGCONT)` | raises `ProcessLookupError [Errno 3]` |
| m7 | `gh pr diff 34 --name-only \| grep -E '<R5 pattern>'`; the same for PR 35 | PR 34 (touched `otel_receiver.py`): match, rc 0. PR 35 (tracker only): no match, rc 1 |
| m8 | consumers of the `--status` exit code | none in `.claude/`, hooks, or `scripts/`; only `merge-pr` step 3 runs it, and a human reads the output |

## R1 — Seam: a sessions-dir marker, written once at boot

- `otel_receiver.py` imports `from cairnlib.watch import engine_fingerprint, engine_is_stale`. It adds no hashing or stat code of its own (guard G1).
- `_engine_sources() -> List[Path]`: `Path(__file__).resolve().parent` / each of `otel_receiver.py`, `backfill_tokens.py`, `cairn.py`, `worktree_root.py`, then that dir / `cairnlib`, in that order (m1). The list covers every module the daemon actually imports, not only the two the issue names. A change to `backfill_tokens.py` leaves the daemon just as stale as the POLY-50 `cairnlib/` case does.
- New constant `ENGINE_FINGERPRINT_MARKER_NAME = ".engine-fingerprint"`, stored in `_sessions_dir(pidfile)`. Content is JSON: `{"<resolved abs path>": {"sha", "mtime_ns", "size"}, …}`, in source order.
- `serve()` computes the dict **once**, at entry, and holds it in a local. It writes the marker next to `.nudge-capable` / `.transcripts-dir` (`:1847-1852`). The registry-recreate branch (`:2112-2113`) rewrites the marker **from the same held dict and never recomputes it**, because recomputing there would launder a stale daemon's fingerprint.
- Why not a pidfile sidecar: `_read_pidfile` parses the pidfile as an int, and a sidecar would add a new file to the metrics worktree. The sessions dir already has a marker pattern, a recreate path, and a dotfile filter, so the marker needs no new gitignore surface (Delta 6 argument).

## R2 — `--status` compares against the recorded paths, not its own copy

- `_status` reads the marker. For each recorded path it calls `engine_is_stale(Path(path), boot)`. The comparison runs against the files the daemon loaded from (m3: the main checkout), **not** against the invoking CLI's `__file__`. A worktree CLI on a feature branch would otherwise raise a false alarm.
- There is one new line, placed immediately after `last-flush:` and before `sessions:`. The first three lines and the final `exporter-endpoint:` line stay byte-stable. Exact forms:
  - `engine: current`
  - `engine: stale (<basename>, <basename>)`. The names are the stale sources in marker order: `otel_receiver.py`, `backfill_tokens.py`, `cairn.py`, `worktree_root.py`, `cairnlib`.
  - `engine: unknown (no fingerprint)`: the marker is absent or unparseable (a pre-POLY-61 daemon, like the one live today).
  - `engine: unknown (not running)`: `running` is False. The marker is not read.

## R3 — Exit code

Precedence: `1` not running > `2` watchdog stale > **`3` running, watchdog not stale, engine stale** > `0`. `unknown` never changes the rc, which is the same asymmetry as watchdog `absent`. There are no scripted consumers (m8), so a new code breaks nothing. The `_status` docstring's exit-code paragraph gains the `3` row.

## R4 — `--ensure-running` reports only; it never restarts

- On the already-live path (`:1462`, both `return True` sites `:1483`/`:1487`), if the marker reads stale, print one stderr line and change nothing else (rc, return value, pid): `otel_receiver: running receiver's engine is stale (<names>); restart it: --stop, then --ensure-running`
- Why it does not restart: this runs from every SessionStart hook, including sessions in teammate worktrees. The spawn argv is the caller's own `__file__` (m3), so an auto-restart from a worktree session would hand the one daemon to a feature-branch engine and kill it under every other live session. Restarting stays a merge-time action (R5) or an operator's call. The stderr line reaches the session because the hook no longer swallows stderr (`ensure_running` docstring).

## R5 — `/merge-pr` → Sync local, verbatim

Replace the paragraph at `.claude/skills/merge-pr/SKILL.md:77` (the sentence up to the code block) with:

> **If the PR touched the receiver's engine** — `scripts/cairn/otel_receiver.py` or anything under `scripts/cairn/cairnlib/` (also `backfill_tokens.py`, `cairn.py`, `worktree_root.py` in `scripts/cairn/`, which it imports) — the running receiver still holds the pre-merge code (a Python daemon does not hot-reload). Check with `gh pr diff <n> --name-only | grep -E '^scripts/cairn/(otel_receiver\.py|backfill_tokens\.py|cairn\.py|worktree_root\.py|cairnlib/)'` — any match means restart it bare and confirm before reporting done:

The code block stays unchanged. After it, add:

> `--status` must print `engine: current`. `engine: stale` (exit 3) at any later time means a merge skipped this step, so restart the same way.

## R6 — SIGCONT cleanup

In `tests/test_otel_receiver_watchdog_attribution.py`, add a module-level `_sigcont_if_alive(pid)` that does `try: os.kill(pid, signal.SIGCONT)` / `except ProcessLookupError: pass`. It replaces `self.addCleanup(os.kill, pid, signal.SIGCONT)` at `:735` and is registered at the same spot, so the LIFO order is unchanged. Only `ProcessLookupError` is swallowed; `PermissionError` still raises.

## Tests (qa) and pre-registered checklist — one named mutation each

New module: `scripts/cairn/tests/test_otel_receiver_engine_staleness.py` (T1–T4), with the same `setUpModule`/`tearDownModule` real-state bracket and `make_fake_engine_root` helper as the watchdog module. T5 lives in the watchdog module.

| Test | Asserts | Mutation (must turn it red) |
|---|---|---|
| T1 `test_status_engine_current_then_stale_on_cairnlib_edit` | fake root, live daemon: `--status` rc 0 + `engine: current`; append a comment line to the fake root's `cairnlib/enginesrc.py`: rc 3 + `engine: stale (cairnlib)` | **M1** drop `cairnlib` from `_engine_sources()` |
| T2 `test_recreated_registry_keeps_boot_fingerprint` | edit the fake root's `otel_receiver.py` bytes, delete `.sessions/`, wait for the recreate (`--registry-absent-recreate-seconds` small): `engine: stale (otel_receiver.py)` | **M2** recompute the fingerprint at the recreate site |
| T3 `test_ensure_running_warns_on_stale_engine_without_restart` | stale fake engine, then `--ensure-running`: rc 0, stderr has the R4 line, pidfile pid unchanged | **M3** delete the R4 stderr print |
| T4 `test_status_unknown_when_marker_absent` | delete `.engine-fingerprint`: `engine: unknown (no fingerprint)`, rc 0 | **M4** treat a missing marker as stale |
| T5 `test_sigcont_cleanup_tolerates_exited_pid` | `Popen(["true"])`, `wait()`, then `_sigcont_if_alive(pid)` returns None | **M5** remove the `except ProcessLookupError` |

## Guards (gate 4 checks, each on a scratch copy)

- **G1** `grep -c "hashlib\|st_mtime_ns" scripts/cairn/otel_receiver.py` is `0` (m5 baseline). Reuse is the import, not a copy.
- **G2** the five receiver test modules plus the new one pass, run per-module via `scripts/cairn/run_tests.py`.
- **G3** `grep -c 'scripts/cairn/cairnlib/' .claude/skills/merge-pr/SKILL.md` ≥ 1, and the R5 sentences match verbatim.
- **G4** M1–M5 are each applied alone to a scratch copy, and each turns exactly its own test red.
- **G5** new-module wall time ≤ 45 s `(unmeasured)`. This is a budget, not a gate. If it is exceeded, report it; it does not fail the build.

## Out of scope

The live pre-POLY-61 daemon reports `engine: unknown (no fingerprint)` until it is restarted. `/merge-pr` for this PR restarts it, because the PR touches `otel_receiver.py`.
