---
id: POLY-6
title: Separate repo-convention tests from cairn's suite; path-filtered CI per component
status: done
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [workflow, cairn, tests, ci]
priority: P2
pr: https://github.com/richmosko/polycarpic/pull/12
created: 2026-09-23
updated: 2026-09-25
---
cairn is isolated in practice, not by declaration: all tracker code and its tests live under `scripts/cairn/`, `run_tests.py` discovers only `scripts/cairn/tests/`, and there is no CI. Several files there guard repo conventions (STATE.md releases row, agent-definition drift, worktree protocol block, git identity) rather than the tracker, which couples a future `/spin-off-component` of cairn to project-specific checks. Full history in the comments below.

## Acceptance criteria

- [ ] Repo-convention tests move out of `scripts/cairn/tests/` into a workflow-tests location with their own discovery entry point (or a second `-s` root in `run_tests.py`); cairn's suite contains only tracker/tooling tests
- [ ] CI (when introduced) runs path-filtered jobs: one for `scripts/cairn/` + workflow tests, one per product package; a change in one does not run the other's suite
- [ ] `process/WORKFLOW.md` (Shared / reusable components) notes that cairn's test boundary is spin-off-clean
- [ ] One-shot migration commands that have already run on this repo (`migrate-prefix-ids`, `migrate-lifecycle-status`, `migrate-archive-issues`, token backfill) are retired together with their tests (~130 of the ~1700 suite); a migration a fresh template instance still needs stays in the template, not here. Note: `otel_receiver.py` imports header-scan helpers from `backfill_tokens.py` and POLY-26 builds on that module — the architect rules what "retire the token backfill" means for the shared module
- [ ] A first GitHub Actions workflow (`.github/workflows/`) runs cairn's Python suite via `run_tests.py` plus the JS suite as ONE path-filtered job (`scripts/cairn/**`, `.claude/**`, `process/**`), and is registered as a required status check on `main` so the branch-protection rule enforces green; no matrix and no sharding until a product package exists
## Comments

### @team-lead — 2026-09-23

Filed from a POLY-4 side conversation (2026-09-23). Not scheduled; no milestone.

**Observation.** cairn is isolated in practice, not by declaration: all tracker code and its 104 test files live under `scripts/cairn/`, `run_tests.py` discovers only `scripts/cairn/tests/`, and there is no CI or packaging file yet. Because cairn is the only code in the repo today, "the test suite" and "cairn's tests" coincide.

**The fuzzy edge.** Several files in `scripts/cairn/tests/` guard repo conventions rather than the tracker — e.g. `test_state_releases_bound.py` (STATE.md releases row), the agent-definition drift test, `test_agent_git_identity.py` (worktree protocol block). They sit there because that is where the runner looks, not because they belong to cairn. That couples a future `/spin-off-component` of cairn to project-specific checks.

**When it matters.** Once product code (SvelteKit + Postgres) arrives with its own runner, and once CI exists.

## Acceptance criteria

- [ ] Repo-convention tests move out of `scripts/cairn/tests/` into a workflow-tests location with their own discovery entry point (or a second `-s` root in `run_tests.py`); cairn's suite contains only tracker/tooling tests
- [ ] CI (when introduced) runs path-filtered jobs: one for `scripts/cairn/` + workflow tests, one per product package; a change in one does not run the other's suite
- [ ] `process/WORKFLOW.md` (Shared / reusable components) notes that cairn's test boundary is spin-off-clean
- [ ] One-shot migration commands that have already run on this repo (`migrate-prefix-ids`, `migrate-lifecycle-status`, `migrate-archive-issues`, token backfill) are retired together with their tests (~130 of the ~1700 suite); a migration a fresh template instance still needs stays in the template, not here
- [ ] A first GitHub Actions workflow (`.github/workflows/`) runs cairn's Python suite via `run_tests.py` plus the JS suite as ONE path-filtered job (`scripts/cairn/**`, `.claude/**`, `process/**`), and is registered as a required status check on `main` so the branch-protection rule enforces green; no matrix and no sharding until a product package exists (a matrix then splits by package, e.g. a Postgres service container for ledger tests, not by shard — ruled 2026-09-24, suite is ~24 s on 8 local workers)

### @team-lead — 2026-09-23

Scope added 2026-09-24 (user, after the POLY-2 finish gate ran 1707 tests): retire the one-shot migrations and their ~130 tests as part of the same isolation effort. The whole suite costs ~24 s on 8 workers; the point is boundary, not wall-clock.

### @team-lead — 2026-09-23

Scope added 2026-09-24 (user): the first CI workflow lands here too — one path-filtered Actions job, required check on main. Matrix/sharding deferred until there is more than one package; devops-engineer owns the workflow, decided in Plan.

### @team-lead — 2026-09-24

Feature started. Branch: `feature/poly-6-test-boundary-ci`. Attached to milestone POLY-A (was unscheduled) as a workflow item, P3 → P2, at the user's request 2026-09-24.
Lead estimate at start (calibration input; prior: POLY-5 21 min, POLY-3 95 min/32 commits, POLY-16 37 min/15, POLY-10 62 min/13): 18 commits, 2 gate cycles, ~70 min spawn→merge. Five ACs across four owners (architect, qa, implementation-lead, devops-engineer); the branch-protection registration is a user action after the workflow's first run.

### @architect — 2026-09-25

Gate-1 ruling: read `scripts/cairn/design/test-boundary-ci.md` @ 615b94e (AC1–AC5, measured at 460cf6c).
- AC1: 5 files / 50 tests move to `tests/workflow/`; discovered as an optional second root in `run_tests.py` (one gate command, hooks unchanged).
- AC4: three `migrate` commands + 77 tests deleted; detection lints stay, fix hints go. Token backfill NOT retired (re-runnable correction path per TRACKER.md, POLY-26 open, receiver uses 15 module names), so that AC4 item is struck.
- AC5: one job `cairn` (the required-check name), no workflow-level `paths:` (a required check would hang); fail-closed step-level change filter; JS runs minus `token-chart-logic.test.js` until POLY-8.

### @team-lead — 2026-09-25

Gate-1 ruling accepted @ 615b94e. Five convention files (50 tests) move to `tests/workflow/` with the runner picking it up as an optional second root so `--gate` and the hooks are unchanged; three migrate commands and 77 tests deleted, `legacy_archived_issue_paths` lint kept; one job `cairn` with an in-job `changes` step (not workflow-level `paths:`, so the required check always reports); JS run excludes the POLY-8 file until POLY-8 lands.
Scope deviation accepted by team-lead, flagged to the user: AC4's "token backfill" item is struck — the backfill is the documented retroactive-attribution mechanism (TRACKER §110–114), POLY-26 targets it, and otel_receiver imports 15 names from the module. If the user still wants the CLI retired, it becomes a follow-up after POLY-26. POLY-28 closed at design-gate clear.

### @qa-engineer — 2026-09-25

RED @ 3923bfd, pinned to gate-1 ruling 615b94e (f)1-7. Files: tests/workflow/test_cairn_test_boundary.py (1,2,3,6,7), scripts/cairn/tests/test_run_tests.py::MultiRootDiscoveryTests (4), scripts/cairn/tests/test_migrate_retired.py (5).

Confirmed red for the right reason (narrowed -p runs, no real-suite spawn):
- MovedBasenamesTests: 5 subTest failures — moved basenames absent from tests/workflow/ (move not landed).
- NoRepoConventionReferenceRemainsInCairnSuiteTests: 1 failure — offending lines still in scripts/cairn/tests/.
- CiWorkflowShapeTests: 7 failures — .github/workflows/ci.yml does not exist yet.
- WorkflowMdSpinOffCleanSentenceTests: 1 failure — sentence not yet in WORKFLOW.md.
- MultiRootDiscoveryTests: single-root-today control passes; both-roots/-p-spans-roots/duplicate-refusal fail (single root only); build_argv TypeError (no start_dir kwarg yet).
- test_migrate_retired.py: 11 failures — migrate subcommand/functions/tests still present; backfill_tokens controls pass.

NoWorkflowTestTouchesCairnTests passes today (control, vacuously true — no cairn/helpers coupling in tests/workflow/ yet).

Handed to implementation-lead (POLY-30) and devops-engineer (POLY-31) to build green.

### @devops-engineer — 2026-09-25

AC5 landed @ 29b17da: `.github/workflows/ci.yml` per ruling 615b94e §(c) — one job
`cairn` (the required-check name), no workflow-level `on.*.paths`, a step-level
`changes` gate (fail-closed on diff error) over the ruled paths, full-SHA-pinned
checkout@v7.0.1/setup-python@v7.0.0(3.14)/setup-node@v7.0.0(26), Python suite via
`run_tests.py` (no `--gate`), JS via `node --test` excluding
`token-chart-logic.test.js` (POLY-8 comment inline), concurrency
cancel-in-progress. All 7 of qa's `CiWorkflowShapeTests` pass locally.

Required-check registration (user action, after this workflow's first green PR run):

gh api -X PATCH repos/richmosko/polycarpic/branches/main/protection/required_status_checks \
  -f strict=true -f 'checks[][context]=cairn' -F 'checks[][app_id]=null'

(or via UI: Settings → Branches → main → Require status checks → add `cairn`.)

### @implementation-lead — 2026-09-25

Build-green (implementation-lead), POLY-30 @ 3c85c8d: AC1 — moved the 5 ruled files (50 tests) to tests/workflow/ with workflow_helpers.REPO_ROOT (no cairn/helpers coupling); run_tests.py picks up tests/workflow/ as an optional second root (build_argv gains start_dir, each child's cwd/-s derive from its own absolute path, duplicate basenames exit 2 pre-run). AC4 — deleted migrate-prefix-ids/lifecycle-status/archive-issues (cmd_*, migrate_*, renderers, subparser) and their 3 test files (77 tests); detection lints kept, dead-command fix hints removed; legacy_archived_issue_paths kept (2 callers); token backfill untouched. AC3 — WORKFLOW.md spin-off-clean sentence added; moved-path refs fixed in WORKFLOW.md/merge-pr/SKILL.md; TRACKER.md migrate rows/instruction removed (history kept); INTERFACE.md caller count updated.

One pre-existing test_run_tests.py assertion pinned single-root --list output; updated for both roots (in path order).

Verified after rebasing onto devops's AC5 (29b17da): `run_tests.py --gate green` — 103 files, 1727 tests, OK (skipped=4).

### @architect — 2026-09-25

Gate-4 verdict (POLY-32) on 010f414 against the ruling `scripts/cairn/design/test-boundary-ci.md` @ 615b94e: **changes-requested, one item (F1)**.

| Axis | Result | Evidence |
|---|---|---|
| AC1 move + second root (a) | pass | 5 files + `workflow_helpers.py` at `tests/workflow/` (3c85c8d); `_discover_all`, duplicate basename → exit 2, `build_argv` default argv unchanged (870b83e); `--list` = 103 files |
| AC4 migrations (b) | pass | `migrate` subparser/cmds/functions gone, detection lints and `legacy_archived_issue_paths` kept, TRACKER rows removed (870b83e); backfill untouched per ruling |
| AC3 WORKFLOW sentence (e) | pass | verbatim in WORKFLOW.md → Shared / reusable components; moved path updated at WORKFLOW.md:921 + merge-pr SKILL.md:114 |
| AC5 workflow shape (c) | **F1** | 29b17da: shape, pins, permissions, concurrency, env override, POLY-8 exclusion all match |
| AC2 (d) | pass | nothing to build; paragraph lives in the note |
| Tests (f) | pass | touched modules via `run_tests.py -p …`: 142 tests OK (test_run_tests 46 OK) |

**F1 (blocking, devops, one line).** `ci.yml` changes step: `echo "$CHANGED" \| grep -qE` under `set -o pipefail`. `grep -q` exits on first match; if the diff exceeds the pipe buffer (~64 KB), echo takes SIGPIPE, the pipeline returns 141, `if` reads false → silent `run=false` on exactly the large diffs that most need testing. The ruling says fail-closed. Fix: `if grep -qE "$PATTERN" <<<"$CHANGED"; then` (no pipe). (unmeasured on a real runner; the mechanism is standard bash.)

Nits (non-blocking): stale comments cairn.py:82 ("see migrate_lifecycle_status below") and :1101 (names `migrate_archive_issues`' glob as a caller).

Lead's questions. (1) History split 870b83e/3c85c8d: **accept**, no squash. Force-push is outside the worktree protocol, and `git diff -M` over the PR detects the renames. (2) The real-state guard's dotfile tolerance is test-harness behaviour from POLY-10's heartbeat, not the test boundary, so it stays out of the note. Record it in qa's commit and on POLY-10 if a follow-up is needed.

### @architect — 2026-09-25

Gate-4 verdict (POLY-32) re-issued on aa9ec31 (tip 00c431d) against the ruling `test-boundary-ci.md` @ 615b94e: **approve**.

| Axis | Result | Evidence |
|---|---|---|
| F1 fail-closed change filter (c) | pass | 039237a: `grep -qE "$PATTERN" <<<"$CHANGED"`, no pipe; pinned by `test_changes_step_never_pipes_echo_into_grep_under_pipefail` (aa9ec31) |
| AC1 / AC3 / AC4 / AC2 | pass | unchanged from the 0b3a4c5 verdict table |
| Nits | pass | 54045a6; the one remaining `migrate_archive_issues` mention at cairn.py:1105 is a history note, accepted |
| Guard tolerance (outside the ruling) | pass | 3ec874c: tolerates content changes to `.watchdog-heartbeat`/`.last-flush` only; a removed file still trips. Recorded on POLY-10 (00c431d) |
| Tests | pass | `run_tests.py -p` over test_cairn_test_boundary, test_real_state_guard*, test_migrate_retired: 41 OK |

Remaining user action (AC5): after the workflow's first green run on the PR, register `cairn` as a required status check on `main`.

### @qa-engineer — 2026-09-25

PASS @ ba516cb (qa-engineer verdict gate).

python3 run_tests.py --gate verdict (scripts/cairn, both roots): 1728 tests, 103 files, 8 workers, 26.5s, OK (skipped=4).

node --test "scripts/cairn/tests/js/**/*.test.js": 479 tests, 477 pass, 2 fail — both the known layerchart ENOENT cases in token-chart-logic.test.js (node_modules absent locally, POLY-8's own tracked exclusion in ci.yml). No other JS failures.

All five POLY-6 ACs covered: boundary moved (5 files/tests/workflow), migrations retired (3 files/~77 tests gone, backfill_tokens untouched), WORKFLOW.md spin-off-clean sentence present, ci.yml single path-filtered job (F1 pipefail fix verified), run_tests.py two-root discovery green. Anchor #14 marked completed.

### @team-lead — 2026-09-25

PR opened: https://github.com/richmosko/polycarpic/pull/12. Awaiting Validate; the PR's `cairn` job is the workflow's first real run.

### @qa-engineer — 2026-09-25

PASS @ da31076 (qa-engineer verdict re-issued, CI green at 36160150591).

python3 run_tests.py --gate verdict (scripts/cairn, both roots): 1728 tests, 103 files, 8 workers, 26.4s, OK (skipped=4).

node --test "scripts/cairn/tests/js/**/*.test.js": 479 tests, 477 pass, 2 fail — both the known layerchart ENOENT cases in token-chart-logic.test.js (node_modules absent locally, POLY-8's tracked exclusion in ci.yml). Same counts as the prior verdict @ ba516cb.

The CI-red self-record env leak (CAIRN_TEST_RUNS_FILE inherited by 4 fake-engine-root subprocess tests) is fixed at this tip and verified both with the override unset and set. No other change since the ba516cb verdict besides that fix and tracker bookkeeping.

### @team-lead — 2026-09-25

Validate passed (qa PASS @ c93342d, re-verified @ 7ca97a1 at da31076; architect APPROVE @ 75cc704; CI `cairn` green on the tip); merging via PR #12. Closing.
Estimate calibration: estimated 18 commits / 2 gate cycles / ~70 min at spawn. Actual: 23 commits, 1 red→green + 1 review round + 1 CI-hermeticity fix, ~65 min active team time (window spans an overnight pause), merged 2026-09-25T16:32Z. Loop cost $37.77.
Sub-issue actuals (tokens / cost / ratio on raw tokens): POLY-28 0.84M / $0.88 / 1.20 · POLY-29 12.3M / $3.79 / 17.6 · POLY-30 37.6M / $9.43 / 31.3 · POLY-31 3.0M / $1.10 / 5.0 · POLY-32 4.0M / $2.07 / 10.0. Cache reads are 91–99% of tokens and ≈83% of cost → the raw-sum ratio is a poor proxy; filed as POLY-34 (estimate on cost).
Struck from AC4 by ruling: token backfill retirement (documented retroactive-attribution mechanism; POLY-26 depends on it). User action still open: register `cairn` as a required check on main.
