# POLY-59 — gate-1 ruling (architect, 2026-09-27)

Base: `feature/poly-59-telemetry-follow-ups` @ c865897. All measurements are read-only against the live
metrics tree or run on scratch copies (C10); the live daemon (pid 4949) was not signalled.

## §1 AC1 — the PT-* collision lines: not a mis-anchor

**Measured.**
- `otel_receiver.log` lines 1–5 are the only PT-* lines (`grep -n PT-0` → 1..5). Line 1's dropped-id list is
  identical to `git ls-tree --name-only db906a0 process/cairn/{milestones,archive/milestones}/` (16 ids,
  `PT-0.3` … `PT-0.12.2`). db906a0 is this repo's own initial commit (the unscrubbed template tree, all 16
  milestone files added in one commit → one shared creation timestamp → every window collides).
- 42c39fd (2026-09-23T09:44-07:00, "scrub project_template history") deleted them. So the lines were written
  by **this checkout's own receiver, rooted correctly**, between db906a0 and 42c39fd; the log is gitignored
  scratch that `ensure_metrics_worktree` moves into the metrics worktree (its docstring, line 51).
- Today: `main()` roots everything at `worktree_root.main_checkout_root(backfill_tokens._repo_root())`
  (line 2383); all four `milestone_windows` sites use `branch_repo_root` = that root unless `--repo-root`.
  `flush()`'s `milestone_windows_table is None` fallback is unreachable from the CLI (all 3 callers pass
  it — grep at lines 1808/1868/2496). No production root defect exists.
- **Separate live finding.** Lines 6–182 carry 167 `['POLY-A', 'POLY-B']` collision warnings. The daemon
  (pid 4949, `ps` lstart 2026-09-25 19:58) predates c5cfc8b (POLY-50 tied-milestone fix, 2026-09-26 15:35);
  the current engine returns `[('2026-09-23T16:44:25Z','POLY-A')]` with no warning. The receiver has no
  engine-staleness self-check (the board has `cairnlib/enginesrc`). Out of scope here — bubbled to the lead.

**Seam / work.**
- qa: new module `scripts/cairn/tests/test_otel_receiver_windows_root.py`. A real git main checkout in tmp
  (engine copied, `config.yml` prefix POLY, an active `POLY-A.md` milestone committed on `main`), a real
  `git worktree add -b worktree-x`, and a commit in the worktree that `git rm`s the milestone. Run the
  **worktree's** engine copy: `otel_receiver.py --ingest <fixture with no cairn.issue> --out-file <tmp>`,
  no `--repo-root`. Assert the line's `issue == "milestone:POLY-A"`.
- implementation-lead: correct the `main()` comment above line 2383 — `--repo-root` also roots
  `milestone_windows`, not only `_current_branch`. Decoupling the two is **ruled out** here: the throwaway
  `--repo-root` repos in `test_otel_receiver.py` rely on empty windows to land on `main` (unmeasured count).

## §2 AC2 — the two flakes: mechanisms and fixes (test-only; qa owns)

**A. `StatusReportsWatchdogAndLastFlushTests`.** CI run 36277345298 printed
`watchdog: alive (last beat 2026-09-26T22:47:29Z)` at 22:47:36: a heartbeat write (every
`WATCHDOG_HEARTBEAT_WRITE_INTERVAL_SECONDS` = 1.0) landed after the test's `os.utime`. Local: 0/30 serial,
0/40 at 8-way concurrency — only CI load exposes it. **Fix:** read the daemon pid from the pidfile,
`os.kill(pid, SIGSTOP)` before the `utime`; register a `SIGCONT` cleanup *after* `_stop_fake_receiver`'s so
it runs first (LIFO); then `time.sleep(1.5)` on purpose (an adversarial wait > the 1.0 s write interval)
before `--status`. Measured: a connect probe to a SIGSTOP'd listener succeeds 5/5 (kernel backlog), so
`running` stays true; `kill(pid, 0)` works on a stopped process.

**B. `GraceWindowFlushContentTests`.** `running` = pid alive ∧ port listening (line 1623); self-stop runs
`httpd.server_close()` → `_do_flush()` → `_compare_and_delete_pidfile()` (lines 2244–2247). The test reads
`--out-file` as soon as `--status` says not-running, i.e. possibly between `server_close` and the flush.
**Fix:** after `_wait_for_status_not_running`, `assertTrue(_wait_for_pidfile_gone(fake_root, timeout=5.0))`
before reading the file — pidfile removal happens-after the flush returns.

**AC2 amended:** the 10-run bar is
`python3 scripts/cairn/run_tests.py -j 8 -p test_otel_receiver_self_stop.py -p test_otel_receiver_watchdog_attribution.py`
×10 consecutive green **plus** M2a/M2b below (the 10 runs alone cannot show determinism: 0/70 locally).

## §3 AC3 — `_otel_cutoff` one-second boundary (qa)

Existing `test_record_at_cutoff_is_excluded` covers whole-second stamps only. Add
`test_fractional_seconds_straddling_the_cutoff` beside it: records at `2026-09-23T23:59:59.999Z` (kept) and
`2026-09-24T00:00:00.326Z` (excluded, `after_cutoff == 1`), cutoff `2026-09-24T00:00:00Z`. Measured:
truncated compare gives False/True; identity compare gives False/False.

## §4 AC4 — `_branch_at`: no change (recorded reason)

Measured: live lead timeline = 10 824 entries; `_branch_at` = 130.5 µs/call (list rebuild dominates);
59 calls in a full `--dry-run` (≈ 8 ms of a 0.10 s scan). Calls are bounded: the cutoff return (line 597)
precedes the `_branch_at` call (line 605), so only pre-cutoff worktree records — frozen history — reach it;
only the timeline grows, linearly. Threading a precomputed list through three signatures plus a spy test
costs more than it saves. Revisit if a repo runs without otel lines (cutoff `None`).

## §5 Pre-registered checklist (gate 4 runs each once on a scratch copy)

| # | Mutation (scratch copy) | Must turn red |
|---|---|---|
| M1 | `--ingest` branch: `cairn.milestone_windows(branch_repo_root)` → `cairn.milestone_windows(backfill_tokens._repo_root())` | §1 new test |
| M1b | line 2383: drop `worktree_root.main_checkout_root(...)` wrapper | §1 new test |
| M2a | status test: delete the `SIGSTOP` line (keep the 1.5 s wait) | status test, every run |
| M2b | `time.sleep(1.0)` at top of `_do_flush`: grace test stays **green**; then also drop the pidfile wait | grace test |
| M3a | `_truncate_fractional_seconds` returns `ts` unchanged | §3 test |
| M3b | truncation → round up any fractional second | §3 test |
