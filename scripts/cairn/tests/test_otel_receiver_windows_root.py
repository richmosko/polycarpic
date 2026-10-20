"""POLY-59 gate-1 ruling §1 (process/cairn/reviews/POLY-59/ruling.md @ d9a966c):
pins that `otel_receiver.py --ingest` computes `milestone_windows` against
the MAIN CHECKOUT's `process/cairn/`, never a linked worktree's own
(possibly divergent) copy -- a regression test, not a bug-fix test: the
ruling measured no production defect (`main()` already anchors everything
through `worktree_root.main_checkout_root`, and all three `flush()` call
sites already pass their own `milestone_windows_table`), but nothing
previously pinned this with a real linked worktree.

Mechanism: a real git main checkout carries ONE milestone file
(`POLY-A.md`), committed. A real `git worktree add` linked worktree then
`git rm`s that same milestone file and commits the removal -- so the
WORKTREE's own `process/cairn/milestones/` is empty while the MAIN
CHECKOUT's still has the file. Running the WORKTREE's own engine copy
(`--ingest`, no `--repo-root`) against a fixture with no `cairn.issue`
anywhere must still resolve `milestone:POLY-A` -- proof that the windows
lookup ran against the main checkout, not the worktree that's actually
executing.

Named mutations this pins (ruling §5): M1 (the `--ingest` branch's
`cairn.milestone_windows(branch_repo_root)` swapped for
`cairn.milestone_windows(backfill_tokens._repo_root())`) and M1b
(dropping the `worktree_root.main_checkout_root(...)` wrapper at
`main()`'s `repo_root = ...` line) each redirect the lookup at the
worktree's own (milestone-less) copy, so the fallback lands on bare
`main` instead -- both must turn this test red.

Deliberate near-duplicate of `test_otel_receiver_hardening.py`'s
`_make_git_main_checkout_with_worktree` scaffolding (project convention:
each otel_receiver test module carries its own copies rather than
sharing scaffolding across files that must stay independently
readable), extended with a committed milestone file.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from typing import Optional

import helpers  # noqa: F401

SCRIPT_PATH = helpers.CAIRN_DIR / "otel_receiver.py"
FIXTURES = helpers.FIXTURES_DIR / "otlp"
REAL_METRICS_DIR = helpers.TESTS_DIR.parent.parent.parent / "process" / "cairn" / "metrics"
REAL_TOKEN_USAGE_PATH = REAL_METRICS_DIR / "token-usage.jsonl"
REAL_RECEIVER_PIDFILE = REAL_METRICS_DIR / ".receiver.pid"
REAL_SESSIONS_DIR = REAL_METRICS_DIR / ".sessions"

# POLY-49 gate-1 ruling §3: otel_receiver.py imports worktree_root.py
# unconditionally -- every fake-engine copy must carry it too.
ENGINE_FILES = ("otel_receiver.py", "backfill_tokens.py", "cairn.py", "worktree_root.py")

_REAL_STATE_SNAPSHOT = None


def setUpModule():
    global _REAL_STATE_SNAPSHOT
    _REAL_STATE_SNAPSHOT = helpers.snapshot_real_state(
        REAL_TOKEN_USAGE_PATH, REAL_RECEIVER_PIDFILE, REAL_SESSIONS_DIR, REAL_METRICS_DIR.parent,
    )


def tearDownModule():
    helpers.assert_real_state_untouched(_REAL_STATE_SNAPSHOT)


def _make_fake_engine_root(testcase) -> Path:
    root = helpers.make_empty_tmp_dir(testcase)
    engine_dir = root / "scripts" / "cairn"
    engine_dir.mkdir(parents=True)
    helpers.copy_engine(engine_dir, ENGINE_FILES)
    data_dir = root / "process" / "cairn"
    data_dir.mkdir(parents=True)
    (data_dir / "config.yml").write_text("prefix: PT\nport: 8766\n", encoding="utf-8")
    return root


_MILESTONE_BODY = """---
id: POLY-A
name: Test Milestone
kind: process
major: POLY-V1
status: in-progress
target_tag: null
ga: false
---

**Definition of done:** test fixture, POLY-59 gate-1 ruling §1.
"""


def _write_milestone(root: Path) -> Path:
    milestones_dir = root / "process" / "cairn" / "milestones"
    milestones_dir.mkdir(parents=True, exist_ok=True)
    path = milestones_dir / "POLY-A.md"
    path.write_text(_MILESTONE_BODY, encoding="utf-8")
    return path


def _minimal_env(**overrides: str) -> dict:
    base = {"PATH": os.environ.get("PATH", "/usr/bin:/bin")}
    if "HOME" in os.environ:
        base["HOME"] = os.environ["HOME"]
    base.update(overrides)
    return base


def _git_env() -> dict:
    env = _minimal_env()
    env.update({
        "GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "test@example.com",
        "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "test@example.com",
    })
    return env


def _make_git_main_checkout_with_removed_milestone_worktree(testcase):
    """(main_root, worktree_path) -- a REAL git repo carrying the engine
    copy + config.yml + a committed milestone file, plus a REAL linked
    `git worktree add` worktree in which that SAME milestone file has
    been `git rm`'d and the removal committed. The main checkout's own
    `process/cairn/milestones/` still holds the file; the worktree's own
    copy does not."""
    main_root = _make_fake_engine_root(testcase)
    _write_milestone(main_root)
    genv = _git_env()
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=str(main_root), check=True, env=genv)
    subprocess.run(["git", "add", "-A"], cwd=str(main_root), check=True, env=genv)
    subprocess.run(["git", "commit", "-q", "-m", "initial"], cwd=str(main_root), check=True, env=genv)

    worktree_parent = helpers.make_empty_tmp_dir(testcase)
    worktree_path = worktree_parent / "x"
    subprocess.run(
        ["git", "worktree", "add", "-q", "-b", "worktree-x", str(worktree_path)],
        cwd=str(main_root), check=True, env=genv,
    )
    subprocess.run(
        ["git", "rm", "-q", "process/cairn/milestones/POLY-A.md"],
        cwd=str(worktree_path), check=True, env=genv,
    )
    subprocess.run(
        ["git", "commit", "-q", "-m", "remove milestone"],
        cwd=str(worktree_path), check=True, env=genv,
    )
    return main_root, worktree_path


def _read_jsonl(path: Path) -> list:
    lines = []
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            raw = raw.strip()
            if raw:
                lines.append(json.loads(raw))
    return lines


class IngestFromALinkedWorktreeAnchorsMilestoneWindowsOnTheMainCheckoutTests(unittest.TestCase):
    def test_ingest_from_a_worktree_with_a_worktree_local_milestone_removal_still_resolves_the_main_checkouts_milestone(self):
        main_root, worktree_path = _make_git_main_checkout_with_removed_milestone_worktree(self)
        out_path = helpers.make_empty_tmp_dir(self) / "token-usage.jsonl"
        worktree_script = worktree_path / "scripts" / "cairn" / "otel_receiver.py"

        result = subprocess.run(
            [sys.executable, str(worktree_script), "--ingest", str(FIXTURES / "no_cairn_issue.json"),
             "--out-file", str(out_path)],
            capture_output=True, text=True, cwd=str(worktree_path), env=_minimal_env(),
        )
        self.assertEqual(result.returncode, 0, f"--ingest from the worktree must succeed -- {result.stdout!r} {result.stderr!r}")

        lines = _read_jsonl(out_path)
        self.assertTrue(lines, f"--ingest must have flushed at least one line -- stdout={result.stdout!r}")
        issues = {line.get("issue") for line in lines}
        self.assertEqual(
            issues, {"milestone:POLY-A"},
            f"milestone_windows must be computed against the MAIN CHECKOUT's "
            f"process/cairn/milestones/ (where POLY-A.md still exists), not the "
            f"executing WORKTREE's own copy (where it was git rm'd) -- got {lines!r} "
            f"(stderr={result.stderr!r})",
        )


if __name__ == "__main__":
    unittest.main()
