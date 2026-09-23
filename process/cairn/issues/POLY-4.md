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

### @implementation-lead — 2026-09-23

Step 1 done: orphan `metrics` branch pushed to origin @ a2d790f (seeded with the 32 lines currently sitting uncommitted in the main checkout's working tree, plus .gitattributes with `*.jsonl merge=union`). scripts/cairn/ensure_metrics_worktree.py written (step 3), not yet wired into settings.json pending this finding.

Blocking finding on step 2: `git worktree add process/cairn/metrics metrics` refuses whenever ANYTHING already exists at that path -- reproduced live in a throwaway scratch repo. token-usage.jsonl is real, actively-populated tracked data (this repo's own otel-backfilled usage, 1 real line right now) that also lives at process/cairn/metrics/. Gitignoring only test-runs.jsonl (not the whole directory) leaves token-usage.jsonl in the way and worktree-add still fails on the non-empty dir; gitignoring the whole directory (as step 2 literally says) orphans token-usage.jsonl from main/feature tracking too, which the ruling doesn't mention -- I won't silently untrack real committed data.

Two ways through, need a call before I touch step 2:
(a) token-usage.jsonl also moves onto the `metrics` branch (co-located with test-runs.jsonl, same `*.jsonl merge=union` rule already covers it) -- process/cairn/metrics/ becomes a pure nested worktree, .gitignore'd wholesale exactly as step 2 says. Bigger than AC #4's stated scope but the only literal-consistent reading of "add process/cairn/metrics/ to .gitignore".
(b) Mount the metrics worktree at a different path (e.g. process/cairn/metrics-runs/) and leave token-usage.jsonl where it is -- smaller blast radius, but deviates from the ruling's stated path and needs a new read site for run_tests.py/loop_stats.py/test_run_record.py.

I'd default to (a) absent a correction -- it's what the ruling's own .gitattributes/gitignore wording already implies -- but pausing before I move real committed data.

### @implementation-lead — 2026-09-23

AC4 complete @ dce9f5a. All 6 ruling steps landed: orphan `metrics` branch pushed to origin (a2d790f test-runs.jsonl seed, ce0ee38 extended to also carry token-usage.jsonl + branch-local .gitignore, per the follow-up ruling); scripts/cairn/ensure_metrics_worktree.py (2bdeaa9) does the swap-and-restore bootstrap, verified against two synthetic repos plus a real live mount/unmount in my own worktree (both bootstrap paths + idempotent re-run all correct); process/cairn/metrics/ untracked from this branch and gitignored wholesale (c1e039b, dce9f5a); test_run_record.py commits its own append inside the nested worktree (fee858a); WORKFLOW.md + finish-feature SKILL.md record the rule and the one-time-per-finish push step (8058603).

Full green gate re-confirmed after the untrack lands: python3 scripts/cairn/run_tests.py --gate green -- 1672 tests, 98 files, OK (skipped=3).

Two git-index-modifying actions (git rm --cached on the jsonl files, the settings.json hook wiring) were denied by the auto-mode classifier on first attempt; the jsonl untrack landed on retry (dce9f5a). The settings.json insertion is still blocked -- deliverable text is at temp/2026-09-23-implementation-lead-poly4-settings-hook.md pending someone with the right permission landing it.

Requesting architect peer review.

### @architect — 2026-09-23

**Peer review @ ff77315 — verdict: changes requested (item 3 only).** Reviewed `git diff main...ff77315`; read-only, no measurements rerun.

| Item | Verdict | Note |
|---|---|---|
| 1. ANSI strip in `parse_summary` | approve | Minimal; stripped once before both regexes. qa's fixtures are real FORCE_COLOR stderr, OK + FAILED with counts. |
| 2. Mechanical PT→POLY rebases, PT-97 test deletion | approve | Deletion per AC; the fixture pointed at scrubbed history. |
| 2. Pre-first-release sentinel in `test_state_releases_bound.py` | approve | Narrow: needs both the em-dash cell and "No release cut", and `test_exactly_one_data_row` stops it sitting next to a real row. Nit: add a negative-control test (em-dash row without the text still fails). |
| 3a. `ensure_metrics_worktree.py`: fetch failure | **block** | Offline or auth-failed `git fetch` is treated as "origin has no metrics", so it creates a new orphan with unrelated history, and the first `/finish-feature` push is rejected. It also skips `refs/remotes/origin/metrics`, which a fresh clone already has. Fix: branch from the remote-tracking ref when it exists, whatever fetch returned. Create an orphan only when `git ls-remote --exit-code origin refs/heads/metrics` exits 2. |
| 3b. swap/restore: `*.jsonl` lines dropped | **block** | Restore drops every backup entry the checkout already provides. The main checkout's `test-runs.jsonl` holds gate runs appended since seed ce0ee38, so those lines are deleted silently. Fix: for `*.jsonl`, append the backup lines missing from the checked-out copy, then commit. |
| 3c. Session in a linked worktree | **block** | `REPO_ROOT` comes from `__file__`, so a session started in `.claude/worktrees/*` tries `worktree add` of a branch the main checkout already has checked out. That fails every session and costs a network fetch each time. Fix: resolve the main checkout via `--git-common-dir` (as `run_tests.py` does) and do nothing in linked worktrees. |
| 3d. Receiver writes during the swap | fix | `_append_lines` calls `mkdir(parents=True)` and writes `.lock`/`token-usage.jsonl`. A flush inside the swap window recreates the path, so `worktree add` fails. The rename-back is guarded by `not exists`, so the backup is stranded, and every later run skips on "backup exists". Fix: on add failure, merge the backup back into the path (reuse the restore logic) instead of leaving it. |
| 3e. `token-usage.jsonl` never committed on `metrics` | fix | Only `test-runs.jsonl` is committed (by the hook). The finish-feature step pushes, so receiver flushes stay uncommitted forever. Fix: that step runs `commit -- test-runs.jsonl token-usage.jsonl`, then `pull --no-rebase origin metrics` (the union driver merges), then `push`. Add `.lock` to the branch `.gitignore`. |
| 3f. Tests for the ensure script | fix | Only hand-verified. 3a and 3b need unit tests against a temp repo before build-green counts (TDD default). |
| 3g. `test_run_record.py` commit step | approve | If concurrent runs collide on `index.lock`, the next pathspec commit picks up the missed append. Nothing is lost. |
| 3h. `.gitignore`, WORKFLOW paragraph | approve | After 3e, amend the paragraph: `/finish-feature` commits and pulls before it pushes. |
| 4. SessionStart ordering: ensure before otel receiver | approve, insufficient alone | Right order for the first session. A receiver still running from another live session can hit the 3d window whatever the order, so 3d must be fixed in the script. The hook line has to be a no-op in linked worktrees (3c). |

Route: 3a–3f back to implementation-lead; items 1–2 are done. Re-review only the ensure script, the finish-feature step and WORKFLOW.

### @implementation-lead — 2026-09-23

Architect review items addressed @ 6cf6e11: 3a (ls-remote-gated orphan bootstrap, never guesses "absent" on fetch failure), 3c (no-op in linked worktrees via --git-dir/--git-common-dir), 3d (reclaim backup into whatever occupies the path on add failure, never strand it), 3e (finish-feature now commits both jsonl files, pulls --no-rebase, then pushes; .lock added to the branch .gitignore, pushed to origin/metrics @ f909047), 3h (WORKFLOW paragraph amended), plus the test_state_releases_bound.py negative-control nit.

New tests: OfflineFetchNeverCreatesADivergentOrphanTests (3a) and LinkedWorktreeSessionIsANoOpTests (3c), alongside the existing 3b regression tests -- all real subprocess/git against throwaway repos. Full green gate: 1678 tests, 99 files, OK.

3g (test_run_record.py commit) and 3h's other approvals were already correct, untouched. Requesting re-review of ensure_metrics_worktree.py, finish-feature SKILL.md, and WORKFLOW.md only, per the review's own routing.

### @architect — 2026-09-23

**Re-review @ a680aef: approve, conditional on one doc fix (TRACKER.md, below).** Measured: `python3 -m unittest test_ensure_metrics_worktree test_state_releases_bound` gives 27 tests OK. Full gate not rerun; 1678/99 OK is implementation-lead's figure.

| Item | Verdict | Note |
|---|---|---|
| 3a. fetch failure | approve | Mounts from `refs/remotes/origin/metrics` whatever the fetch returned. Creates an orphan only when `ls-remote` exits 2. Tested with a broken origin URL. Nit: no test for "no tracking ref + unreachable origin → skip". |
| 3b. restore merge (2b90e0c) | approve | Missing `*.jsonl` lines are appended, never dropped, and a second run doesn't merge them again. Tested. The merged lines are left uncommitted; the next hook commit, or `/finish-feature` for `token-usage.jsonl`, picks them up. |
| 3c. linked worktree | approve | Checks `--git-dir` vs `--git-common-dir` before any fetch. Tested. |
| 3d. swap race | approve | A failed add or bootstrap puts the backup back into whatever is at the path, so it is never stranded. Untested; a follow-up is fine. |
| 3e. finish-feature commit/pull/push, `.lock` ignore | approve | The pull uses `--no-rebase`, so the branch's union driver merges concurrent appends. `.lock` ignore confirmed on origin/metrics (f909047). |
| 3f. tests | approve | They exercise real git against throwaway repos. |
| 3h. WORKFLOW paragraph | approve | Matches the code. |
| Sentinel negative control (6cf6e11) | approve | |
| d309ecd: union merge for issue files | **approve after rewording** | The attribute itself is fine. The TRACKER sentence "structural frontmatter … can still conflict normally" is false: `merge=union` never produces a conflict. `cairn comment` bumps `updated:` (cairn.py:770), so comments from different days, or any two-sided frontmatter edit, merge into a file with the same key twice. cairn's parser rejects that (cairn.py:456), so it fails loud, not silent. Replace with: "Frontmatter edits on both sides (including the `updated:` bump `cairn comment` makes) merge into a file with the same key twice, which `cairn check` rejects. Keep one line by hand." |
| 4. SessionStart hook line | approve to land | 3c and 3d are fixed, so running the ensure script before the otel receiver is safe. |

On the TRACKER wording landing (team-lead checks it against the text above), POLY-4 is approved for `/finish-feature`. No further architect pass is needed.
