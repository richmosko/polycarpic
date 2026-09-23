---
id: POLY-4
title: Test-suite health after template scrub: color-safe run_tests.py, fix 5 stale failures
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: team-lead
labels: [workflow, cairn, tests]
priority: P2
pr: null
created: 2026-09-23
updated: 2026-09-23
---


Two findings from the POLY-1 loop (implementation-lead's green-gate comment on
POLY-1 @ b02ca11, reproduced by team-lead), both outside POLY-1's scope.

**1. `run_tests.py` mis-parses colorized output.** Its stderr summary regex does
not tolerate ANSI escape codes. With `FORCE_COLOR` set in the shell (tmux
teammate panes leak it), every file reports as an error even when unittest
prints `OK`; `FORCE_COLOR=0 NO_COLOR=1` is the current workaround. A gate that
lies about its result is worse than one that fails.

**2. Six pre-existing failing files left by the template scrub** (kickoff
§ 2.2): `test_test_run_hooks.py` (missing `process/reviews/PT-97` fixture,
deleted with `process/reviews/`), `test_backfill_tokens.py`,
`test_otel_receiver.py` (cwd / prefix resolution), `test_state_releases_bound.py`
(STATE.md Releases row format), `test_agent_setting_role.py` (backfill role
matrix keyed on scrubbed `PT-301`–`PT-306` fixtures; resolves everything to
`main`). None touch product code; they are template debris.

## Acceptance criteria

- [ ] `run_tests.py` strips ANSI sequences before parsing the unittest summary, or forces `NO_COLOR` on the child process; a test covers colorized output
- [ ] The six listed files are fixed or deleted with a one-line rationale each (a fixture pointing at scrubbed template history is deleted, not recreated)
- [ ] `python3 scripts/cairn/run_tests.py --gate green` is fully green on `main`
- [ ] `process/cairn/metrics/test-runs.jsonl` handling reviewed: decide whether hook-recorded runs are committed with feature work or gitignored, and record the call in `process/WORKFLOW.md`

## Comments

### @team-lead — 2026-09-23

Feature started. Branch: `feature/poly-4-test-suite-health`. Team: implementation-lead + qa-engineer; architect reviews. The uncommitted `test-runs.jsonl` diff from prior sessions rides on this branch pending AC #4.

### @qa-engineer — 2026-09-23

Red gate @ 5d9cb16: added ParseSummaryColorizedTests (scripts/cairn/tests/test_run_tests.py) — two cases with real FORCE_COLOR=1 `unittest discover` stderr (Python 3.14, OK and FAILED runs), captured verbatim. `_SUMMARY_RE`'s `^(OK|FAILED)` anchor doesn't match past a leading ANSI SGR escape, so `parse_summary` raises `ParseError` on stderr unittest itself reports as passing.

Narrowed run (`-p "test_run_tests.py"`): both new tests fail red with `ParseError`, not an assertion mismatch — confirmed failing for the right reason.

Full `--gate red`: 1673 tests, 98 files, FAILED (failures=23, errors=7, files=6) — my 1 new file plus the 5 pre-existing stale files from this issue's finding #2. Implementation-lead: parser fix + the 6 stale files are yours; do not touch test_run_tests.py's new class except to make it pass.

### @implementation-lead — 2026-09-23

Green gate @ 12063c6: python3 scripts/cairn/run_tests.py --gate green -- 1672 tests, 98 files, OK (skipped=3).

parse_summary now strips ANSI SGR escapes before matching unittest's own summary lines (ee2a962) -- fixes qa's red gate (5d9cb16). The 5 pre-existing stale files, all one class (config.yml's issue prefix changed PT->POLY at bootstrap, breaking every branch-derived bucket key): test_backfill_tokens.py + fixtures (3a2630f), test_otel_receiver.py + basic.json (8cc803c, 12063c6), test_agent_setting_role.py + fixtures (7a3c6c0). Two exceptions to the mechanical rename: test_test_run_hooks.py's one PT-97-fixture test deleted per AC, not recreated (696069b); test_state_releases_bound.py's guard taught a real pre-first-release sentinel row exception, since STATE.md's own row is genuinely correct as-is (95d265c).

AC #4 (test-runs.jsonl commit-vs-gitignore) recommendation sent to team-lead, pending user confirmation before the WORKFLOW.md entry lands.

Requesting architect peer review.

### @team-lead — 2026-09-23

**AC #4 ruling (user-confirmed): metrics live on an orphan `metrics` branch, never merged, checked out as a nested worktree at `process/cairn/metrics/`.** Not committed with feature work, not gitignored-and-lost. Hold the green gate until this lands.

1. Orphan branch `metrics` (create from a temp worktree with `git checkout --orphan metrics`) containing only `test-runs.jsonl` — seeded with the 19 pending lines currently uncommitted in the main checkout's working tree — and a `.gitattributes` with `*.jsonl merge=union`. Push to origin.
2. On the feature branch: `git rm --cached process/cairn/metrics/test-runs.jsonl`; add `process/cairn/metrics/` to `.gitignore`.
3. `scripts/cairn/ensure_metrics_worktree.py`, idempotent: if `process/cairn/metrics/` is not a worktree of `metrics`, `git fetch origin metrics` and `git worktree add process/cairn/metrics metrics` (create the orphan locally if origin has none). Wire it as a SessionStart hook step. **Put the `.claude/settings.json` change in its own pathspec commit** — the lead cannot commit that file (auto-mode classifier); the user lands it if it bounces on push.
4. `test_run_record.py`: after appending, `git -C process/cairn/metrics commit -q -m "metrics: test run" -- test-runs.jsonl`; skip silently if not a worktree. The push of `metrics` belongs to `/finish-feature` (add the step to `.claude/skills/finish-feature/SKILL.md`), not the hook.
5. `run_tests.py`'s worktree→main-checkout redirect must still resolve to the nested worktree path; verify from your own worktree. Fix fixtures that assumed the file is tracked on main.
6. WORKFLOW.md: one paragraph — the rule, branch name, never-merge invariant, bootstrap step.

Commit by pathspec, push, report shas; then full green gate and architect review.
