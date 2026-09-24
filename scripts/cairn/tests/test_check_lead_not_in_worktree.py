"""POLY-5 gate-1 ruling (architect, process/cairn/issues/POLY-5.md @
be1d195, item (b)/(c)/(d)): the lead-side guard script,
`scripts/cairn/check_lead_not_in_worktree.py [--cwd PATH]` (default: the
process cwd). Exit codes: 0 = main checkout, or not a git repo, with NO
output. 1 = linked worktree -- prints to STDOUT (SessionStart injects
stdout and teammates see the hook too) a message that names
`team-lead`, the resolved worktree path, the resolved main-checkout
path, and a `Fix:` line.

Detection (item c): a linked worktree is `realpath(--git-dir) !=
realpath(--git-common-dir)`, resolved against the cwd -- the same
discriminator `run_tests.py` and `ensure_metrics_worktree.py`'s
`_is_linked_worktree` already use (PT-82 ruling). This is real
subprocess, real git, real temp repos on disk -- never mocked -- same
posture as test_ensure_metrics_worktree.py / test_feature_branch_invariant.py.

Also covers item (b)'s second caller: `/start-feature`'s new step 0
(Pre-flight) names this script.
"""
from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path

import helpers  # noqa: F401

SCRIPT_PATH = helpers.CAIRN_DIR / "check_lead_not_in_worktree.py"
REPO_ROOT = helpers.CAIRN_DIR.parent.parent  # scripts/cairn -> scripts -> repo root
START_FEATURE_SKILL = REPO_ROOT / ".claude" / "skills" / "start-feature" / "SKILL.md"


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)


def _run_script(cwd: Path) -> subprocess.CompletedProcess:
    """Invokes the script with `--cwd <cwd>` -- the CLI contract the
    ruling specifies. Real subprocess: if the script doesn't exist yet
    (RED phase) this fails for the right reason (python reports "No
    such file or directory", a non-{0,1} returncode), never a silent
    import-time skip."""
    return subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--cwd", str(cwd)],
        capture_output=True, text=True, timeout=15,
    )


def _build_main_checkout(testcase) -> Path:
    """A real, standalone git repo (never this checkout) with one commit
    on its default branch -- the "main checkout" shape."""
    root = helpers.make_empty_tmp_dir(testcase)
    result = _git(root.parent, "init", "-q", "-b", "main", str(root))
    assert result.returncode == 0, result.stderr
    _git(root, "config", "user.email", "test@example.com")
    _git(root, "config", "user.name", "Test")
    (root / "readme.md").write_text("x\n", encoding="utf-8")
    _git(root, "add", "--", "readme.md")
    _git(root, "commit", "-q", "-m", "init")
    return root


def _add_linked_worktree(testcase, main_checkout: Path, branch: str = "worktree-probe") -> Path:
    parent = helpers.make_empty_tmp_dir(testcase)
    worktree_path = parent / "linked"
    result = _git(main_checkout, "worktree", "add", "-b", branch, str(worktree_path))
    assert result.returncode == 0, result.stderr
    return worktree_path


class MainCheckoutExitsZeroSilentlyTests(unittest.TestCase):
    def test_main_checkout_exits_zero_with_no_stdout(self):
        main_checkout = _build_main_checkout(self)
        result = _run_script(main_checkout)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout, "", f"expected no stdout for the main checkout, got: {result.stdout!r}")


class LinkedWorktreeExitsOneWithLoudMessageTests(unittest.TestCase):
    def test_linked_worktree_exits_one(self):
        main_checkout = _build_main_checkout(self)
        worktree_path = _add_linked_worktree(self, main_checkout)
        result = _run_script(worktree_path)
        self.assertEqual(
            result.returncode, 1,
            f"expected exit 1 from a linked worktree -- got {result.returncode}, "
            f"stdout={result.stdout!r} stderr={result.stderr!r}",
        )

    def test_linked_worktree_message_names_team_lead_both_paths_and_a_fix_line(self):
        main_checkout = _build_main_checkout(self)
        worktree_path = _add_linked_worktree(self, main_checkout)
        result = _run_script(worktree_path)
        stdout = result.stdout
        self.assertIn("team-lead", stdout, f"expected 'team-lead' named in the message -- got: {stdout!r}")
        self.assertIn(
            str(worktree_path.resolve()), stdout,
            f"expected the resolved worktree path in the message -- got: {stdout!r}",
        )
        self.assertIn(
            str(main_checkout.resolve()), stdout,
            f"expected the resolved main-checkout path in the message -- got: {stdout!r}",
        )
        self.assertIn("Fix:", stdout, f"expected a 'Fix:' line in the message -- got: {stdout!r}")


class SubdirectoryOfLinkedWorktreeExitsOneTests(unittest.TestCase):
    def test_a_subdirectory_of_the_linked_worktree_also_exits_one(self):
        main_checkout = _build_main_checkout(self)
        worktree_path = _add_linked_worktree(self, main_checkout)
        subdir = worktree_path / "nested" / "deeper"
        subdir.mkdir(parents=True)
        result = _run_script(subdir)
        self.assertEqual(
            result.returncode, 1,
            f"expected exit 1 from a subdirectory of a linked worktree -- got {result.returncode}, "
            f"stdout={result.stdout!r} stderr={result.stderr!r}",
        )


class NonGitDirectoryExitsZeroTests(unittest.TestCase):
    def test_a_non_git_directory_exits_zero_with_no_stdout(self):
        plain_dir = helpers.make_empty_tmp_dir(self)
        result = _run_script(plain_dir)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout, "", f"expected no stdout for a non-git dir, got: {result.stdout!r}")


class StartFeatureSkillNamesTheScriptAtStepZeroTests(unittest.TestCase):
    """Item (b): `/start-feature` gets a new `### 0. Pre-flight` (step 0,
    so no renumbering), running this script; a non-zero exit stops the
    skill."""

    def test_skill_has_a_step_zero_preflight_section_before_step_one(self):
        self.assertTrue(START_FEATURE_SKILL.is_file(), f"expected {START_FEATURE_SKILL} to exist")
        source = START_FEATURE_SKILL.read_text(encoding="utf-8")
        step_zero_idx = source.find("### 0. Pre-flight")
        self.assertNotEqual(
            step_zero_idx, -1,
            f"expected a '### 0. Pre-flight' section in {START_FEATURE_SKILL} -- got source: {source!r}",
        )
        step_one_idx = source.find("### 1.")
        self.assertNotEqual(step_one_idx, -1, f"expected a '### 1.' section in {START_FEATURE_SKILL}")
        self.assertLess(
            step_zero_idx, step_one_idx,
            "expected '### 0. Pre-flight' to appear before '### 1.' (step 0, no renumbering)",
        )

    def test_step_zero_names_the_script(self):
        source = START_FEATURE_SKILL.read_text(encoding="utf-8")
        step_zero_idx = source.find("### 0. Pre-flight")
        self.assertNotEqual(step_zero_idx, -1, f"expected a '### 0. Pre-flight' section")
        step_one_idx = source.find("### 1.")
        section = source[step_zero_idx:step_one_idx if step_one_idx != -1 else len(source)]
        self.assertIn(
            "check_lead_not_in_worktree.py", section,
            f"expected step 0 to name the script -- got section: {section!r}",
        )


if __name__ == "__main__":
    unittest.main()
