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

import importlib.util
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from typing import Optional

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


def _run_script(checkout_root: Path, env: "Optional[dict]" = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(checkout_root / "scripts" / "cairn" / "ensure_metrics_worktree.py")],
        cwd=str(checkout_root), capture_output=True, text=True, env=env,
    )


def _make_failing_worktree_add_git_shim(testcase) -> Path:
    """POLY-49 ruling §8: a `git` shim placed FIRST on `PATH` that exits
    128 on exactly `git worktree add <path> <branch>` (positional, no
    `--orphan`) and execs the REAL git for every other invocation
    (fetch, rev-parse, ls-remote, the orphan-create path, ...). Returns
    the shim's directory -- prepend it to a subprocess env's `PATH`.
    A real `os.execvp` handoff, not a Python re-implementation of git."""
    shim_dir = helpers.make_empty_tmp_dir(testcase)
    real_git = shutil.which("git")
    testcase.assertIsNotNone(real_git, "this test environment has no git on PATH at all")
    shim_path = shim_dir / "git"
    shim_path.write_text(
        "#!/usr/bin/env python3\n"
        "import os, sys\n"
        f"REAL_GIT = {real_git!r}\n"
        "args = sys.argv[1:]\n"
        "if len(args) >= 3 and args[0] == 'worktree' and args[1] == 'add' and args[2] != '--orphan':\n"
        "    sys.stderr.write('shim: refusing this worktree add\\n')\n"
        "    sys.exit(128)\n"
        "os.execv(REAL_GIT, [REAL_GIT] + args)\n",
        encoding="utf-8",
    )
    shim_path.chmod(0o755)
    return shim_dir


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


class OfflineFetchNeverCreatesADivergentOrphanTests(unittest.TestCase):
    """Architect's block (POLY-4.md review, item 3a): an offline/auth-
    failed `git fetch` used to be read as "origin has no metrics",
    creating a fresh orphan with unrelated history -- even though a
    fresh clone already carries `refs/remotes/origin/metrics` locally
    (git's own post-push tracking-ref update, confirmed live: pushing
    `<sha>:refs/heads/metrics` populates it without ever running `git
    fetch`) and `git ls-remote` would have confirmed the ref is real if
    origin were reachable."""

    def test_a_broken_origin_url_still_mounts_the_real_branch_not_a_fresh_orphan(self):
        seed_lines = ['{"n": 1}', '{"n": 2}']
        checkout_root, _bare_remote = _build_fake_repo_with_pushed_metrics_branch(self, seed_lines)
        # refs/remotes/origin/metrics is already populated locally (the
        # push above updated it) -- now make origin itself unreachable,
        # simulating the offline/auth-failed case the block is about.
        result = _git(checkout_root, "remote", "set-url", "origin", "/no/such/path/does-not-exist.git")
        self.assertEqual(result.returncode, 0, result.stderr)

        metrics_dir = checkout_root / "process" / "cairn" / "metrics"
        metrics_dir.mkdir(parents=True)
        (metrics_dir / "test-runs.jsonl").write_text(
            "".join(line + "\n" for line in seed_lines), encoding="utf-8",
        )

        result = _run_script(checkout_root)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        final_lines = (metrics_dir / "test-runs.jsonl").read_text(encoding="utf-8").splitlines()
        self.assertEqual(
            final_lines, seed_lines,
            f"an unreachable origin must still mount the REAL branch from the local "
            f"refs/remotes/origin/metrics tracking ref, never fabricate a fresh orphan "
            f"with unrelated history -- got {final_lines!r}",
        )
        self.assertTrue((metrics_dir / ".git").is_file())


class LinkedWorktreeSessionIsANoOpTests(unittest.TestCase):
    """Architect's block (POLY-4.md review, item 3c): a session started
    inside a linked worktree must never try to `git worktree add` the
    `metrics` branch itself -- the main checkout may already have it
    checked out, which would fail every such session and cost a network
    fetch each time for nothing."""

    def test_running_from_a_linked_worktree_does_nothing(self):
        seed_lines = ['{"n": 1}']
        checkout_root, _bare_remote = _build_fake_repo_with_pushed_metrics_branch(self, seed_lines)

        linked_root = helpers.make_empty_tmp_dir(self) / "linked"
        result = _git(checkout_root, "worktree", "add", "-b", "feature-x", str(linked_root))
        self.assertEqual(result.returncode, 0, result.stderr)
        script_dir = linked_root / "scripts" / "cairn"
        script_dir.mkdir(parents=True)
        (script_dir / "ensure_metrics_worktree.py").write_text(
            SCRIPT_SRC.read_text(encoding="utf-8"), encoding="utf-8",
        )

        result = _run_script(linked_root)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(
            (linked_root / "process" / "cairn" / "metrics").exists(),
            "a linked worktree session must do nothing -- no mount, no directory created",
        )


# --------------------------------------------------------------------------
# POLY-7 (parent POLY-49): the two paths fixed by hand at POLY-4 review
# (architect, items 3a nit and 3d) but never exercised by a test. Real
# subprocess, real git, real files on disk -- same posture as the classes
# above: a throwaway repo, never this checkout.
# --------------------------------------------------------------------------


class NoNetworkNoLocalMetricsSkipsWithOneStderrLineTests(unittest.TestCase):
    """3a: when NEITHER a local `metrics` branch NOR a remote-tracking
    ref exists yet (a truly fresh checkout, never fetched), and origin
    is unreachable, `_remote_metrics_branch_definitively_absent()` can't
    read ls-remote's own "ref not found" exit code (2) apart from a
    network/auth failure -- so the script must never guess "absent" and
    fabricate an orphan. It must skip with exactly one stderr diagnostic
    and create nothing at all."""

    def test_unreachable_origin_with_no_ref_anywhere_creates_nothing(self):
        checkout_root = helpers.make_empty_tmp_dir(self)
        result = _git(checkout_root.parent, "init", "-q", "-b", "main", str(checkout_root))
        self.assertEqual(result.returncode, 0, result.stderr)
        _git(checkout_root, "config", "user.email", "test@example.com")
        _git(checkout_root, "config", "user.name", "Test")
        (checkout_root / "readme.md").write_text("x\n", encoding="utf-8")
        _git(checkout_root, "add", "--", "readme.md")
        _git(checkout_root, "commit", "-q", "-m", "init")
        # Origin is configured but unreachable -- never fetched, so no
        # refs/remotes/origin/metrics exists either.
        _git(checkout_root, "remote", "add", "origin", "/no/such/path/does-not-exist.git")

        script_dir = checkout_root / "scripts" / "cairn"
        script_dir.mkdir(parents=True)
        (script_dir / "ensure_metrics_worktree.py").write_text(
            SCRIPT_SRC.read_text(encoding="utf-8"), encoding="utf-8",
        )

        result = _run_script(checkout_root)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(
            "could not confirm origin's metrics branch state", result.stderr,
            f"expected the one-line skip diagnostic -- got stderr {result.stderr!r}",
        )
        # Ruling §8: "exactly one stderr line" -- not just "contains the
        # phrase somewhere among others".
        stderr_lines = [l for l in result.stderr.splitlines() if l.strip()]
        self.assertEqual(len(stderr_lines), 1, f"expected exactly one stderr line -- got {stderr_lines!r}")
        metrics_dir = checkout_root / "process" / "cairn" / "metrics"
        self.assertFalse(metrics_dir.exists(), f"nothing must be created on this skip -- found {metrics_dir}")
        have_local_branch = _git(checkout_root, "rev-parse", "--verify", "refs/heads/metrics")
        self.assertNotEqual(
            have_local_branch.returncode, 0,
            "no local `metrics` branch may be fabricated on an unconfirmed-absent skip",
        )


class FailedWorktreeAddRestoresBackupExactlyTests(unittest.TestCase):
    """3d (ruling §8): a `git` shim placed first on `PATH` exits 128 on
    exactly `git worktree add <path> <branch>` (execs the real git for
    every other call, including the orphan-create shape) -- forcing the
    add to fail deterministically without depending on any other
    concurrent-worktree side effect. Nothing recreates `METRICS_PATH`
    afterward, so the backup's contents must be merged back into the
    path byte-for-byte, and no `*.bak*`/`*.pre-worktree*` artifact may
    survive."""

    def test_add_failure_via_path_shim_merges_the_backup_back_no_bak_left(self):
        seed_lines = ['{"n": 1}']
        checkout_root, _bare_remote = _build_fake_repo_with_pushed_metrics_branch(self, seed_lines)
        shim_dir = _make_failing_worktree_add_git_shim(self)

        metrics_dir = checkout_root / "process" / "cairn" / "metrics"
        metrics_dir.mkdir(parents=True)
        (metrics_dir / ".receiver.pid").write_text("12345\n", encoding="utf-8")
        sessions_dir = metrics_dir / ".sessions"
        sessions_dir.mkdir()
        (sessions_dir / "abc.json").write_text('{"pid": 12345}\n', encoding="utf-8")

        env = dict(os.environ)
        env["PATH"] = str(shim_dir) + os.pathsep + env.get("PATH", "")
        result = _run_script(checkout_root, env=env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("git worktree add failed", result.stderr, f"got stderr {result.stderr!r}")

        for stray in checkout_root.joinpath("process", "cairn").glob("metrics*.bak*"):
            self.fail(f"a stray backup artifact survived: {stray}")
        self.assertFalse(
            (checkout_root / "process" / "cairn" / "metrics.pre-worktree").exists(),
            "the backup must never be left stranded after a failed add",
        )
        self.assertEqual(
            (metrics_dir / ".receiver.pid").read_text(encoding="utf-8"), "12345\n",
            "the runtime scratch content must be restored byte-for-byte, not a worktree mount",
        )
        self.assertEqual(
            (metrics_dir / ".sessions" / "abc.json").read_text(encoding="utf-8"), '{"pid": 12345}\n',
        )
        self.assertFalse(
            (metrics_dir / ".git").exists(),
            "a failed add must not leave a worktree mount behind -- the restored dir is the plain backup",
        )


class FailedWorktreeAddMergesIntoWhateverRecreatedThePathTests(unittest.TestCase):
    """3d, the other half of the same fix: when the add fails AND
    something else (the docstring's own example: the otel receiver
    flushing mid-swap) has already recreated `METRICS_PATH` by the time
    recovery runs, the backup must be MERGED into it -- `.jsonl` files
    line-by-line, any other entry moved in only if the recreated path
    doesn't already have it -- never dropped, never overwriting what's
    there. This exercises `_reclaim_backup_after_failed_bootstrap`
    directly: a real subprocess can't inject a recreate into the narrow
    window between the failed `git worktree add` and the recovery call,
    so the throwaway copy of the script is loaded as a module and the
    function is called with real files on disk in its place."""

    def _load_module(self, fake_repo_root: Path):
        script_dir = fake_repo_root / "scripts" / "cairn"
        script_dir.mkdir(parents=True)
        script_copy = script_dir / "ensure_metrics_worktree.py"
        script_copy.write_text(SCRIPT_SRC.read_text(encoding="utf-8"), encoding="utf-8")
        spec = importlib.util.spec_from_file_location("poly7_ensure_metrics_worktree", script_copy)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        # REPO_ROOT resolves from __file__'s own on-disk location, so
        # module.METRICS_PATH / module.BACKUP_PATH already point inside
        # fake_repo_root -- no monkeypatching needed.
        return module

    def test_recreated_path_gets_the_backups_content_merged_in(self):
        fake_repo_root = helpers.make_empty_tmp_dir(self)
        module = self._load_module(fake_repo_root)

        module.BACKUP_PATH.mkdir(parents=True)
        (module.BACKUP_PATH / "test-runs.jsonl").write_text(
            '{"n": 1}\n{"n": 2}\n', encoding="utf-8",
        )
        (module.BACKUP_PATH / ".receiver.pid").write_text("999\n", encoding="utf-8")

        # Simulate the receiver recreating the path mid-swap: its own
        # fresh test-runs.jsonl (overlapping name, DIFFERENT content --
        # must be merged, not replaced) plus a file the backup never had.
        module.METRICS_PATH.mkdir(parents=True)
        (module.METRICS_PATH / "test-runs.jsonl").write_text('{"n": 2}\n{"n": 3}\n', encoding="utf-8")
        (module.METRICS_PATH / "otel_receiver.log").write_text("recreated by the daemon\n", encoding="utf-8")

        module._reclaim_backup_after_failed_bootstrap()

        self.assertFalse(module.BACKUP_PATH.exists(), "the backup must be consumed, never left in place")
        merged_lines = (module.METRICS_PATH / "test-runs.jsonl").read_text(encoding="utf-8").splitlines()
        self.assertEqual(
            merged_lines, ['{"n": 2}', '{"n": 3}', '{"n": 1}'],
            f"the recreated file's own lines must survive, plus the backup's line it didn't "
            f"already have, appended -- never dropped, never reordered -- got {merged_lines!r}",
        )
        self.assertEqual(
            (module.METRICS_PATH / "otel_receiver.log").read_text(encoding="utf-8"), "recreated by the daemon\n",
            "an entry only the recreated path has must be left completely alone",
        )
        self.assertEqual(
            (module.METRICS_PATH / ".receiver.pid").read_text(encoding="utf-8"), "999\n",
            "an entry only the backup has must be moved in, not dropped",
        )

    def test_nothing_recreated_the_path_backup_is_renamed_straight_back(self):
        """Negative control alongside the merge case: when NOTHING now
        occupies `METRICS_PATH`, recovery must be a plain rename, never
        a merge-into-nothing."""
        fake_repo_root = helpers.make_empty_tmp_dir(self)
        module = self._load_module(fake_repo_root)

        module.BACKUP_PATH.mkdir(parents=True)
        (module.BACKUP_PATH / "test-runs.jsonl").write_text('{"n": 1}\n', encoding="utf-8")

        module._reclaim_backup_after_failed_bootstrap()

        self.assertFalse(module.BACKUP_PATH.exists())
        self.assertEqual(
            (module.METRICS_PATH / "test-runs.jsonl").read_text(encoding="utf-8"), '{"n": 1}\n',
        )


if __name__ == "__main__":
    unittest.main()
