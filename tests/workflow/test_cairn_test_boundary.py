"""POLY-6 gate-red (qa-engineer), pinned to the architect's gate-1 ruling
(scripts/cairn/design/test-boundary-ci.md @ 615b94e). This file lives
under `tests/workflow/` itself, so it is subject to its own guard
(NoWorkflowTestTouchesCairnTests below) -- it must never import `cairn`,
`helpers`, or put `scripts/cairn` on `sys.path`.

Repo invariants only (section (f), items 1, 2, 3, 6, 7). Runner behaviour
(item 4) lives in `scripts/cairn/tests/test_run_tests.py`; the migrate
retirement (item 5) lives in `scripts/cairn/tests/test_migrate_retired.py`
-- both are cairn's own subject matter, not a repo convention.

No `helpers`/`cairn` import, no `sys.path` insert (the whole point this
module and its siblings under `tests/workflow/` exist to make possible --
see (a): "so /spin-off-component can extract scripts/cairn/ with its
suite intact").
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CAIRN_TESTS_DIR = REPO_ROOT / "scripts" / "cairn" / "tests"
WORKFLOW_TESTS_DIR = REPO_ROOT / "tests" / "workflow"
CI_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
WORKFLOW_MD = REPO_ROOT / "process" / "WORKFLOW.md"


class MovedBasenamesTests(unittest.TestCase):
    """(f)1: the five moved basenames exist under tests/workflow/ and not
    under scripts/cairn/tests/ (ruling section (a), the move table)."""

    MOVED_BASENAMES = [
        "test_agent_git_identity.py",
        "test_agent_worktree_protocol_block.py",
        "test_state_releases_bound.py",
        "test_ratified_text_scanners.py",
        "test_message_cap_hook.py",
    ]

    def test_each_moved_file_lives_under_workflow_and_not_under_cairn_tests(self):
        for name in self.MOVED_BASENAMES:
            with self.subTest(name=name):
                self.assertTrue(
                    (WORKFLOW_TESTS_DIR / name).is_file(),
                    f"{name} is missing from tests/workflow/ -- the move (ruling section a) hasn't landed",
                )
                self.assertFalse(
                    (CAIRN_TESTS_DIR / name).exists(),
                    f"{name} must not remain under scripts/cairn/tests/ once moved",
                )


class NoRepoConventionReferenceRemainsInCairnSuiteTests(unittest.TestCase):
    """(f)2: no scripts/cairn/tests/test_*.py line combines a repo-root
    expression with a workflow-doc name -- measured (ruling section a):
    only the five moved files match today."""

    ROOT_EXPRESSIONS = ("REPO_ROOT", "CAIRN_DIR.parent.parent", "TESTS_DIR.parent.parent.parent")
    TARGET_STRINGS = ("STATE.md", "WORKFLOW.md", "CLAUDE.md", "roles", "message_cap.py")

    def test_no_cairn_test_line_combines_a_repo_root_expression_with_a_workflow_doc_name(self):
        offenders = []
        for path in sorted(CAIRN_TESTS_DIR.glob("test_*.py")):
            for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
                if any(expr in line for expr in self.ROOT_EXPRESSIONS) and \
                        any(target in line for target in self.TARGET_STRINGS):
                    offenders.append(f"{path.name}:{lineno}: {line.strip()}")
        self.assertEqual(
            offenders, [],
            "repo-convention references remain in cairn's own suite (should have moved):\n" + "\n".join(offenders),
        )


class NoWorkflowTestTouchesCairnTests(unittest.TestCase):
    """(f)3: no tests/workflow/*.py imports cairn/helpers or inserts
    scripts/cairn onto sys.path -- this is the property that keeps
    /spin-off-component's extraction of scripts/cairn/ suite-intact."""

    IMPORT_RE = re.compile(r"^\s*(import\s+(cairn|helpers)\b|from\s+(cairn|helpers)\s+import\b)", re.MULTILINE)
    SYS_PATH_CAIRN_RE = re.compile(r"sys\.path\.(insert|append)\([^)]*cairn")

    def test_no_top_level_workflow_test_file_imports_cairn_or_helpers_or_touches_sys_path(self):
        offenders = []
        for path in sorted(WORKFLOW_TESTS_DIR.glob("*.py")):
            text = path.read_text(encoding="utf-8")
            if self.IMPORT_RE.search(text) or self.SYS_PATH_CAIRN_RE.search(text):
                offenders.append(path.name)
        self.assertEqual(offenders, [], f"these tests/workflow/ files couple to cairn's own suite: {offenders!r}")


class CiWorkflowShapeTests(unittest.TestCase):
    """(f)6: `.github/workflows/ci.yml` parses -- a minimal text read
    against the ruling's section (c), no new YAML dependency."""

    RULED_PATHS = (
        "scripts/cairn/",
        ".claude/",
        "process/",
        "tests/workflow/",
        ".github/workflows/",
        ".githooks/",
        "docs/DESIGN/",
    )

    def setUp(self):
        if not CI_WORKFLOW.is_file():
            self.fail(f"{CI_WORKFLOW} does not exist yet (ruling section c, devops-engineer's POLY-31)")
        self.text = CI_WORKFLOW.read_text(encoding="utf-8")
        self.lines = self.text.splitlines()

    def test_exactly_one_job_named_cairn(self):
        jobs_idx = next((i for i, l in enumerate(self.lines) if l.strip() == "jobs:"), None)
        self.assertIsNotNone(jobs_idx, "no top-level `jobs:` key found")
        job_ids = [
            m.group(1) for l in self.lines[jobs_idx + 1:]
            for m in [re.match(r"^  ([A-Za-z0-9_-]+):\s*$", l)]
            if m
        ]
        self.assertEqual(job_ids, ["cairn"], f"expected exactly one job `cairn`, got {job_ids!r}")

    def test_no_top_level_on_paths_filter(self):
        on_idx = next((i for i, l in enumerate(self.lines) if l.strip() == "on:" or l.startswith("on:")), None)
        self.assertIsNotNone(on_idx, "no top-level `on:` trigger key found")
        # Scan the `on:` block (until the next zero-indent key) for a `paths:` line.
        block = []
        for l in self.lines[on_idx + 1:]:
            if l and not l[0].isspace():
                break
            block.append(l)
        self.assertFalse(
            any("paths:" in l for l in block),
            "a required check must never trigger with a workflow-level `paths:` filter (ruling section c)",
        )

    def test_a_changes_step_contains_every_ruled_path(self):
        self.assertIn("changes", self.text, "no `changes` step id found")
        missing = [p for p in self.RULED_PATHS if p not in self.text]
        self.assertEqual(missing, [], f"the changes step is missing these ruled paths: {missing!r}")

    def _step_block(self, step_id: str) -> str:
        """Text from `id: <step_id>` up to (not including) the next step's
        `- name:` marker, or EOF -- good enough for a text-only YAML read
        (no new dependency, per the ruling)."""
        idx = self.text.find(f"id: {step_id}")
        self.assertNotEqual(idx, -1, f"no step with id: {step_id} found")
        rest = self.text[idx:]
        next_step = re.search(r"\n\s*- name:", rest)
        return rest[: next_step.start()] if next_step else rest

    def test_changes_step_never_pipes_echo_into_grep_under_pipefail(self):
        # Architect gate-4 verdict F1 (POLY-32, process/cairn/issues/POLY-6.md
        # @ 0b3a4c5): `echo "$CHANGED" | grep -qE "$PATTERN"` under
        # `set -euo pipefail` -- `grep -q` exits on its first match, closing
        # its end of the pipe; `echo`'s own SIGPIPE write on a >64 KB diff
        # then aborts the step under pipefail, silently landing on
        # `run=false` rather than a red job. Fix: a here-string
        # (`grep -qE "$PATTERN" <<<"$CHANGED"`) has no pipe to break.
        block = self._step_block("changes")
        self.assertNotRegex(
            block, r"echo\b[^\n]*\|\s*grep",
            "the changes step must not pipe `echo ... |` into grep under pipefail (F1)",
        )

    def test_permissions_contents_is_read(self):
        self.assertRegex(
            self.text, r"permissions:\s*\n\s*contents:\s*read",
            "permissions.contents must be read (ruling section c)",
        )

    def test_cairn_test_runs_file_env_is_set(self):
        self.assertIn("CAIRN_TEST_RUNS_FILE", self.text)

    def test_never_pushes_commits_or_uses_pull_request_target(self):
        for forbidden in ("--gate", "git push", "npm ci", "pull_request_target"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, self.text, f"ci.yml must never contain {forbidden!r}")

    def test_js_exclusion_names_poly_8(self):
        self.assertIn("POLY-8", self.text, "the JS token-chart-logic exclusion must name POLY-8")


class CiExcludePatternTests(unittest.TestCase):
    """POLY-39 (ruling scripts/cairn/design/estimation.md @ e4c73bf, §0.7):
    the `changes` step gains an `EXCLUDE` regex that filters tracker-data
    paths (`process/cairn/{issues,milestones,majors,archive}/**`) out
    before `PATTERN` is applied via `grep -vE ... | grep -qE ...` semantics
    (simulated here in Python `re`, never a subprocess -- ci.yml itself is
    the only thing under test). `PATTERN` stays byte-identical to its
    pre-POLY-39 value, and the step never swallows a non-zero grep exit
    status with a bare `|| true`."""

    PATTERN_LITERAL = (
        r'^(scripts/cairn/|\.claude/|process/|tests/workflow/'
        r'|\.github/workflows/|\.githooks/|docs/DESIGN/)'
    )

    def setUp(self):
        if not CI_WORKFLOW.is_file():
            self.fail(f"{CI_WORKFLOW} does not exist yet")
        self.text = CI_WORKFLOW.read_text(encoding="utf-8")
        self.block = self._step_block("changes")

    def _step_block(self, step_id: str) -> str:
        idx = self.text.find(f"id: {step_id}")
        self.assertNotEqual(idx, -1, f"no step with id: {step_id} found")
        rest = self.text[idx:]
        next_step = re.search(r"\n\s*- name:", rest)
        return rest[: next_step.start()] if next_step else rest

    def _exclude_and_pattern(self):
        m_exclude = re.search(r"EXCLUDE='([^']*)'", self.block)
        m_pattern = re.search(r"PATTERN='([^']*)'", self.block)
        self.assertIsNotNone(
            m_exclude,
            "the changes step has no EXCLUDE='...' literal yet (ruling section 0.7)",
        )
        self.assertIsNotNone(m_pattern, "the changes step has no PATTERN='...' literal")
        return re.compile(m_exclude.group(1)), re.compile(m_pattern.group(1))

    def _run(self, changed_paths: list) -> bool:
        """Mirrors `grep -vE "$EXCLUDE" <<<"$CHANGED" | grep -qE "$PATTERN"`:
        filter changed paths through EXCLUDE first, then test the survivors
        against PATTERN."""
        exclude_re, pattern_re = self._exclude_and_pattern()
        relevant = [p for p in changed_paths if not exclude_re.search(p)]
        return any(pattern_re.search(p) for p in relevant)

    def test_tracker_only_paths_give_run_false(self):
        for p in [
            "process/cairn/issues/POLY-1.md",
            "process/cairn/milestones/POLY-A.md",
            "process/cairn/majors/POLY-V1.md",
            "process/cairn/archive/POLY-0.md",
        ]:
            with self.subTest(path=p):
                self.assertFalse(self._run([p]), f"{p} alone must not trigger the cairn job")

    def test_still_relevant_paths_give_run_true(self):
        for p in ["process/STATE.md", "process/cairn/config.yml", "scripts/cairn/cairn.py"]:
            with self.subTest(path=p):
                self.assertTrue(self._run([p]), f"{p} must still trigger the cairn job")

    def test_tracker_and_code_mixed_gives_run_true(self):
        self.assertTrue(self._run(["process/cairn/issues/POLY-1.md", "scripts/cairn/cairn.py"]))

    def test_unrelated_doc_path_gives_run_false(self):
        self.assertFalse(self._run(["docs/PRD/index.html"]))

    def test_pattern_literal_unchanged_from_the_pre_poly_39_shape(self):
        _, pattern_re = self._exclude_and_pattern()
        self.assertEqual(pattern_re.pattern, self.PATTERN_LITERAL)

    def test_changes_step_never_swallows_grep_exit_status_with_bare_or_true(self):
        self.assertNotRegex(
            self.block, r"\|\|\s*true",
            "the changes step must not swallow a non-zero grep exit status with "
            "`|| true` (ruling section 0.7 fail-closed exclusion)",
        )


class WorkflowMdSpinOffCleanSentenceTests(unittest.TestCase):
    """(f)7: WORKFLOW.md contains the (e) sentence's first bold clause."""

    def test_workflow_md_states_cairns_test_boundary_is_spin_off_clean(self):
        self.assertTrue(WORKFLOW_MD.is_file())
        text = WORKFLOW_MD.read_text(encoding="utf-8")
        self.assertIn(
            "**cairn's test boundary is spin-off-clean.**", text,
            "WORKFLOW.md is missing the ruled (e) bold clause under Shared / reusable components",
        )


if __name__ == "__main__":
    unittest.main()
