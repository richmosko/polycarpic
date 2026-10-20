# POLY-6 gate-1 ruling — test boundary, migration retirement, first CI job

Architect, 2026-09-25, on `feature/poly-6-test-boundary-ci` @ 460cf6c. Gating ruling for POLY-6
AC1–AC5; qa (POLY-29), implementation-lead (POLY-30) and devops-engineer (POLY-31) build from this
file. Counts measured at 460cf6c (`TestLoader.discover(...).countTestCases()` per file, or `grep`
over `scripts/cairn/tests/test_*.py`); unmeasured claims are tagged.

Baseline (`test-runs.jsonl`, finish @ 0cece30): 104 files, 1777 tests, 3 skipped, 26.2 s, 8 workers.

## (a) AC1 — the boundary and where workflow tests live

**Rule.** A test file stays in `scripts/cairn/tests/` iff its subject (the thing it would catch a
regression in) is code or data under `scripts/cairn/`, including cairn's installation surface in the
host repo (its `test_run_*` hooks, the skills that invoke its tools, `settings.json` entries, the
metrics dir, `docs/DESIGN` tokens the board mirrors). A file whose subject is a repo convention and
that exercises no `scripts/cairn/` code moves.

**Move — 5 files, 50 tests** to repo-root `tests/workflow/` (same basenames):

| File | Tests | Subject |
|---|---|---|
| `test_agent_git_identity.py` | 12 | `.claude/agents/*.md` git-identity step + SessionStart `worktreeConfig` |
| `test_agent_worktree_protocol_block.py` | 5 | shared worktree-protocol block across agent files |
| `test_state_releases_bound.py` | 22 | `process/STATE.md` → Releases one-row bound |
| `test_ratified_text_scanners.py` | 7 | backtick spans in WORKFLOW/TRACKER/roles/agents/skills |
| `test_message_cap_hook.py` | 4 | `.claude/hooks/message_cap.py` (not a cairn hook) |

**Stay — the other 7 of the lead's 12 grep candidates, verified:** `test_check_budgets` (cairn
`check` docs lint, fixture tree), `test_column_parity` (cairn.py ↔ board-logic.js), `test_dashboard`,
`test_dashboard_roster` (cairn server reads agents from a fixture), `test_ga_milestone_lint`,
`test_snapshot`, `test_skill_id_literals` (pins `setup-tracker/SKILL.md` — cairn's own installer —
to `check_repo`'s accepted ids; imports cairn). Also stay: `test_agent_setting_role` (backfill/
receiver), `test_test_run_hooks`, `test_worktree_metrics_path_resolution`, `test_run_tests`,
`test_loop_stats` (the `test_run_*` hooks are cairn's runner telemetry), `test_svelte_check_gate`
and `test_check_lead_not_in_worktree` (mixed: the skill-reading class pins how a skill invokes a
`scripts/cairn/` tool). Residual host couplings that stay, named so spin-off can see them: reads of
`docs/DESIGN/{tokens,variants,design-system-spec}`, `.githooks/`, `.gitignore`, `.claude/agents`
(roster), `process/TRACKER.md`.

**Mechanics.**
- `tests/workflow/workflow_helpers.py` exports `REPO_ROOT = Path(__file__).resolve().parents[2]`.
  Moved files replace `import helpers` + `helpers.CAIRN_DIR.parent.parent` with it. Nothing in
  `tests/workflow/` imports `helpers`, `cairn`, or puts `scripts/cairn` on `sys.path`.
  The two agent-file tests keep importing each other (same dir). No `__init__.py` under `tests/`.
- **Discovery: a second root in `run_tests.py`, not a separate entry point.** Reason: one command
  keeps one gate, one ledger row, and leaves `test_run_guard`/`test_run_record`, the settings
  prefilter, and both skills' gate lines unchanged. A second entry point would need all four taught.
- `WORKFLOW_TESTS_DIR = SCRIPT_DIR.parent.parent / "tests" / "workflow"`; roots =
  `[TESTS_DIR]` + `[WORKFLOW_TESTS_DIR]` **iff it is a directory**. A spun-off cairn or a
  fake-engine-root copy has no such dir and behaves exactly as today.
- `-p` globs apply to every root (`-p "test_agent*.py"` finds files in both). `--gate` and a bare
  run cover both roots. `--list` prints basenames. `full` in the self-record is unchanged.
- **Basenames must be unique across roots** (`times`/`failed_files` are keyed by name): discovery
  finding a duplicate exits 2 with both paths, before anything runs.
- Each child runs with `cwd = file.parent.parent` and `-s <file.parent.name>`; `build_argv` gains a
  start-dir parameter whose default keeps today's exact argv (`-s tests`). Existing
  `test_run_tests.py` tests stay green unmodified; any that pin single-root behaviour are listed in
  the build-green commit.
- Update the moved path named at `.claude/skills/merge-pr/SKILL.md:114` and `process/WORKFLOW.md:915`.

## (b) AC4 — what "retire" means

**Three migrations: delete.** `migrate-prefix-ids` (0.6.1), `migrate-lifecycle-status` (0.7.0),
`migrate-archive-issues` (0.7.1) are template-era; this repo was bootstrapped at 0.12.2 and never ran
them. A fresh template instance doesn't need them either — `/setup-tracker` writes the current shape.
They stay in the template, not here. Delete from `cairn.py`: the `migrate` subparser, `cmd_migrate_*` ×3,
`migrate_*` ×3 and their report renderers, `_migrate_hint_if_bare`, `_lifecycle_migrate_hint_if_renamed`,
and the two `fix: … migrate archive-issues` clauses (allocation guard, `check_repo`). **The detection
lints stay** (bare id, legacy status value, legacy flat `archive/*.md`); only the fix hint naming a
dead command goes. `legacy_archived_issue_paths` stays (two callers remain). Tests removed: 3 files,
**77 tests** (31 + 16 + 30). No surviving test asserts a migrate hint (grep, measured). TRACKER.md
command-table rows 589–591 and the line-366 instruction go; history prose (318, 440, 442) stays.
`INTERFACE.md:50` caller count updates.

**Token backfill: not retired — the CLI, the module and its 67 tests stay.** Measured reasons: the
backfill is not one-shot. `process/TRACKER.md` §110–114 names a backfill re-run as *the* mechanism that
applies an attribution-logic fix to history ("retroactive for `transcript-backfill` lines"); POLY-26
(backlog) fixes the backfill's own scan; `otel_receiver.py` uses 15 module names (`grep -o
'backfill_tokens\.\w+'`: header scan, role/issue resolution, lock/atomic write, `DEFAULT_OUT_REL`,
`BackfillError`), `cairn.py` 3. Retiring `main()` alone saves 43 tests but breaks the documented
correction path and POLY-26's premise. AC4's "token backfill" item is struck by this ruling.

Net: −77 tests, −3 files, 50 move. Expected: 101 files, 1700 tests over two roots (qa confirms at red).

## (c) AC5 — the Actions workflow

`.github/workflows/ci.yml`, `name: ci`. **One job**, id and name `cairn` — the required-check name
the user registers on `main`. `runs-on: ubuntu-latest`, `timeout-minutes: 20`, `permissions:
contents: read`. Triggers: `pull_request` (branches: `main`) and `workflow_dispatch`.

**No workflow-level `paths:`**: a required check whose workflow never triggers stays "Expected" and
blocks the merge, while a job that runs and skips its steps reports success. The filter is a **step**:
1. `actions/checkout` (full-SHA pin), `fetch-depth: 0`.
2. `changes` step: on `workflow_dispatch` → `run=true`; on `pull_request` →
   `git diff --name-only "$BASE_SHA" HEAD` matched against `^(scripts/cairn/|\.claude/|process/|
   tests/workflow/|\.github/workflows/|\.githooks/|docs/DESIGN/)`. Fail-closed: if the diff errors,
   the step errors and the job is red — never a silent `run=false`. `tests/**` narrows to
   `tests/workflow/**` (product tests will live elsewhere); `.githooks/**` and `docs/DESIGN/**` are
   added because stay-files read them (measured, (a)).
3. All later steps `if: steps.changes.outputs.run == 'true'`: `actions/setup-python` 3.14,
   `actions/setup-node` 26 (local is 3.14.7 / v26.7.0; availability on the runner unmeasured —
   devops confirms on first run).
4. `python3 scripts/cairn/run_tests.py` — **no `--gate`** (CI is not a gate owner; `CLAUDECODE` is
   unset, so the un-tiered refusal does not fire), env `CAIRN_TEST_RUNS_FILE: ${{ runner.temp }}/test-runs.jsonl`.
5. JS: `node --test` over `find scripts/cairn/tests/js -name '*.test.js' ! -name token-chart-logic.test.js`,
   commented `# POLY-8: remove when token-chart-logic skips without node_modules` (POLY-8's AC gains
   "drop the CI exclusion"). Rejected: no JS until POLY-8 — loses 46 files to exclude one.

`concurrency: { group: ci-${{ github.event.pull_request.number || github.ref }}, cancel-in-progress: true }`.
**Must not:** push, commit, tag, comment; write `process/cairn/metrics/` (env override above);
`npm ci` the dashboard (activates skip-gated tests the local gate skips, never measured green);
use `pull_request_target` or secrets; run mutating `cairn` commands. No matrix, no sharding. Registering `cairn` as a required check is a user action after
the first green run. Git identity: all 19 committing test files set their own (measured) — no global config.

## (d) AC2 — per-package jobs (future, no implementation)

Each product package (SvelteKit app, ledger) gets its own job in `ci.yml`, same shape: always
triggered, its own `changes` step over its own paths, a required check named after the package; only
the ledger job carries a Postgres service container. Path lists are disjoint (only
`.github/workflows/**` is shared), so a change in one never runs the other's suite. A matrix, if
ever, splits by package, never by shard.

## (e) AC3 — the WORKFLOW.md sentence

Placed as the last paragraph of `## Shared / reusable components`, verbatim:

> **cairn's test boundary is spin-off-clean.** `scripts/cairn/tests/` holds only tests whose subject is
> code under `scripts/cairn/`; this repo's own convention tests (STATE.md shape, agent-definition
> blocks, workflow-doc scanners, non-cairn hooks) live in `tests/workflow/`, which `run_tests.py`
> picks up as a second root only when it exists — so `/spin-off-component` can extract
> `scripts/cairn/` with its suite intact.

## (f) Tests qa writes (red first)

Repo invariants: `tests/workflow/test_cairn_test_boundary.py`. Runner: `scripts/cairn/tests/test_run_tests.py` (fake roots, no real-suite spawn, PT-94 D11).
1. The five moved basenames exist under `tests/workflow/` and not under `scripts/cairn/tests/`.
2. No `scripts/cairn/tests/test_*.py` line combines a repo-root expression (`REPO_ROOT`,
   `CAIRN_DIR.parent.parent`, `TESTS_DIR.parent.parent.parent`) with `"STATE.md"`, `"WORKFLOW.md"`,
   `"CLAUDE.md"`, `"roles"`, or `"message_cap.py"` (measured: only moved files match today).
3. No `tests/workflow/*.py` imports `cairn`, `helpers`, or inserts `scripts/cairn` into `sys.path`.
4. Runner, fake roots: both roots discovered; second root absent → today's behaviour; `-p` spans
   roots; duplicate basename → exit 2 before any run; `build_argv` default argv unchanged.
5. `cairn --help` omits `migrate`; `cairn migrate …` exits non-zero; `cairn.py` defines no
   `migrate_prefix_ids`/`migrate_lifecycle_status`/`migrate_archive_issues`;
   no `test_migrate_*.py` files; `backfill_tokens.main` still exists.
6. `.github/workflows/ci.yml` parses (a minimal YAML read is enough; no new dependency): one job
   `cairn`; no top-level `on.*.paths`; a `changes` step whose pattern contains each ruled path;
   `permissions.contents == read`; `CAIRN_TEST_RUNS_FILE` set on the Python step; no `--gate`,
   `git push`, `npm ci`, or `pull_request_target` anywhere in the file; the JS exclusion names POLY-8.
7. WORKFLOW.md contains the (e) sentence's first bold clause.
