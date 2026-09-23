"""POLY-4 regression: `ensure_metrics_worktree.py`'s first-mount swap
used to silently drop local hook-recorded appends made since the last
time anyone pushed the `metrics` branch (team-lead, live repro against
the lead's own checkout -- the branch's own 32 seed lines survived, the
4 real appends made locally after that seed were deleted along with the
`metrics.pre-worktree` backup dir). Every existing clone hits this on
its first mount, because the fresh checkout is never a superset of a
local backup that's been accumulating hook appends since the last push.

Real subprocess, real git, real files on disk -- same posture as
test_worktree_metrics_path_resolution.py: a throwaway repo (never this
checkout) carries its OWN copy of `ensure_metrics_worktree.py` (so
`Path(__file__)`-derived `REPO_ROOT` resolves to the fake repo, never
the real one) plus its own `origin` remote holding the pushed `metrics`
branch content.
"""
from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path

import helpers  # noqa: F401

SCRIPT_SRC = helpers.CAIRN_DIR / "ensure_metrics_worktree.py"


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)


def _hash_object(cwd: Path, path: Path) -> str:
    result = _git(cwd, "hash-object", "-w", str(path))
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def _build_fake_repo_with_pushed_metrics_branch(testcase, seed_lines: "list[str]") -> "tuple[Path, Path]":
    """Returns (checkout_root, bare_remote). `checkout_root` is a real git
    repo on `main`, with `origin` pointing at `bare_remote`, and
    `origin/metrics` already holding `seed_lines` joined as
    `test-runs.jsonl` plus a `.gitattributes`/`.gitignore` pair -- the
    POLY-4 steady state every real clone eventually reaches. A COPY of
    the real `ensure_metrics_worktree.py` lives at
    `checkout_root/scripts/cairn/ensure_metrics_worktree.py` so the
    script under test resolves `REPO_ROOT` to this fake repo."""
    checkout_root = helpers.make_empty_tmp_dir(testcase)
    bare_remote = helpers.make_empty_tmp_dir(testcase) / "remote.git"

    result = _git(checkout_root.parent, "init", "-q", "-b", "main", str(checkout_root))
    assert result.returncode == 0, result.stderr
    _git(checkout_root, "config", "user.email", "test@example.com")
    _git(checkout_root, "config", "user.name", "Test")
    (checkout_root / "readme.md").write_text("x\n", encoding="utf-8")
    _git(checkout_root, "add", "--", "readme.md")
    _git(checkout_root, "commit", "-q", "-m", "init")

    result = _git(checkout_root, "init", "--bare", "-q", str(bare_remote))
    assert result.returncode == 0, result.stderr
    _git(checkout_root, "remote", "add", "origin", str(bare_remote))
    _git(checkout_root, "push", "-q", "origin", "main")

    seed_dir = helpers.make_empty_tmp_dir(testcase)
    seed_runs = seed_dir / "test-runs.jsonl"
    seed_runs.write_text("".join(line + "\n" for line in seed_lines), encoding="utf-8")
    seed_gitattributes = seed_dir / ".gitattributes"
    seed_gitattributes.write_text("*.jsonl merge=union\n", encoding="utf-8")
    seed_gitignore = seed_dir / ".gitignore"
    seed_gitignore.write_text(".receiver.pid\n.sessions/\notel_receiver.log\n*.swp\n", encoding="utf-8")

    blob_runs = _hash_object(checkout_root, seed_runs)
    blob_gitattributes = _hash_object(checkout_root, seed_gitattributes)
    blob_gitignore = _hash_object(checkout_root, seed_gitignore)
    mktree_input = (
        f"100644 blob {blob_runs}\ttest-runs.jsonl\n"
        f"100644 blob {blob_gitattributes}\t.gitattributes\n"
        f"100644 blob {blob_gitignore}\t.gitignore\n"
    )
    tree_result = subprocess.run(
        ["git", "-C", str(checkout_root), "mktree"],
        input=mktree_input, capture_output=True, text=True,
    )
    assert tree_result.returncode == 0, tree_result.stderr
    tree_sha = tree_result.stdout.strip()
    commit_result = _git(checkout_root, "commit-tree", tree_sha, "-m", "metrics: seed")
    assert commit_result.returncode == 0, commit_result.stderr
    commit_sha = commit_result.stdout.strip()
    push_result = _git(checkout_root, "push", "-q", "origin", f"{commit_sha}:refs/heads/metrics")
    assert push_result.returncode == 0, push_result.stderr
    _git(checkout_root, "branch", "-D", "metrics")  # no local ref -- a fresh clone never has one either

    script_dir = checkout_root / "scripts" / "cairn"
    script_dir.mkdir(parents=True)
    (script_dir / "ensure_metrics_worktree.py").write_text(
        SCRIPT_SRC.read_text(encoding="utf-8"), encoding="utf-8",
    )
    return checkout_root, bare_remote


def _run_script(checkout_root: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(checkout_root / "scripts" / "cairn" / "ensure_metrics_worktree.py")],
        cwd=str(checkout_root), capture_output=True, text=True,
    )


class FirstMountMergesLocalAppendsTests(unittest.TestCase):
    """The regression itself: a local `test-runs.jsonl` that already has
    the pushed branch's seed lines PLUS newer, not-yet-pushed hook
    appends must keep ALL of them after the first-mount swap -- not just
    the branch's own seed content."""

    def test_local_hook_appends_since_last_push_survive_first_mount(self):
        seed_lines = ['{"n": 1}', '{"n": 2}']
        checkout_root, _bare_remote = _build_fake_repo_with_pushed_metrics_branch(self, seed_lines)

        metrics_dir = checkout_root / "process" / "cairn" / "metrics"
        metrics_dir.mkdir(parents=True)
        local_extra_lines = ['{"n": 3}', '{"n": 4}', '{"n": 5}']
        (metrics_dir / "test-runs.jsonl").write_text(
            "".join(line + "\n" for line in seed_lines + local_extra_lines), encoding="utf-8",
        )

        result = _run_script(checkout_root)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        final_lines = (metrics_dir / "test-runs.jsonl").read_text(encoding="utf-8").splitlines()
        self.assertEqual(
            final_lines, seed_lines + local_extra_lines,
            f"local hook appends made since the last metrics push must survive the first-mount "
            f"swap, in order, alongside the branch's own seed lines -- got {final_lines!r}",
        )
        self.assertTrue((metrics_dir / ".git").is_file(), "process/cairn/metrics/ must be a linked worktree after mount")
        self.assertFalse(
            (checkout_root / "process" / "cairn" / "metrics.pre-worktree").exists(),
            "the backup dir must be removed once its content is merged in",
        )

    def test_no_local_only_lines_still_yields_exactly_the_seed_once(self):
        """Negative control: when the local copy is byte-identical to the
        branch's seed (nothing new to merge), the merge must not
        duplicate any line."""
        seed_lines = ['{"n": 1}', '{"n": 2}']
        checkout_root, _bare_remote = _build_fake_repo_with_pushed_metrics_branch(self, seed_lines)

        metrics_dir = checkout_root / "process" / "cairn" / "metrics"
        metrics_dir.mkdir(parents=True)
        (metrics_dir / "test-runs.jsonl").write_text(
            "".join(line + "\n" for line in seed_lines), encoding="utf-8",
        )

        result = _run_script(checkout_root)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        final_lines = (metrics_dir / "test-runs.jsonl").read_text(encoding="utf-8").splitlines()
        self.assertEqual(final_lines, seed_lines, f"got {final_lines!r}")

    def test_second_run_is_idempotent_and_does_not_remerge(self):
        seed_lines = ['{"n": 1}']
        checkout_root, _bare_remote = _build_fake_repo_with_pushed_metrics_branch(self, seed_lines)

        metrics_dir = checkout_root / "process" / "cairn" / "metrics"
        metrics_dir.mkdir(parents=True)
        local_extra_lines = ['{"n": 2}']
        (metrics_dir / "test-runs.jsonl").write_text(
            "".join(line + "\n" for line in seed_lines + local_extra_lines), encoding="utf-8",
        )

        first = _run_script(checkout_root)
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        second = _run_script(checkout_root)
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)

        final_lines = (metrics_dir / "test-runs.jsonl").read_text(encoding="utf-8").splitlines()
        self.assertEqual(
            final_lines, seed_lines + local_extra_lines,
            f"a second (already-a-worktree) run must be a pure no-op, never re-merge -- got {final_lines!r}",
        )


if __name__ == "__main__":
    unittest.main()
