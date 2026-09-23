#!/usr/bin/env python3
"""ensure_metrics_worktree.py -- POLY-4 AC #4 (team-lead ruling,
process/cairn/issues/POLY-4.md @ 5495132, step 3): idempotent bootstrap
for `process/cairn/metrics/` as a nested worktree of the orphan `metrics`
branch. That branch holds `test-runs.jsonl` (plus a `.gitattributes` with
`*.jsonl merge=union`) and is never merged into `main` or any feature
branch -- see WORKFLOW.md -> Metrics branch for the full rule.

Wired as a SessionStart hook step (.claude/settings.json) so every fresh
session -- the main checkout or any teammate's `.claude/worktrees/*`
checkout -- gets a working `process/cairn/metrics/` without a manual
bootstrap step.

Idempotent: exits 0 immediately once `process/cairn/metrics/` is
registered as a git worktree (checked via `git worktree list
--porcelain`'s own path list, never just "a `.git` file exists there" --
a stale or foreign `.git` file must not be trusted as proof).

Bootstrap path (first run in a checkout, or after `metrics` was deleted
locally):
1. `git fetch origin metrics`. If origin has it -- the normal case once
   any checkout has run this script after POLY-4's one-time seed push --
   create a local branch tracking it.
2. If origin has no `metrics` ref at all (a fresh fork before anyone has
   pushed one), create it as a fresh orphan worktree instead of failing:
   `git worktree add --orphan -b metrics <path>`, then commit the
   `.gitattributes` file so the branch has a real first commit.
3. `git worktree add <path> metrics` once the ref exists locally by
   either path above.

A stray file/dir at `process/cairn/metrics/` that ISN'T already a
worktree (e.g. the pre-POLY-4 tracked file's last hook-recorded content,
now an untracked leftover once `git rm --cached` landed on a feature
branch) is moved aside to `<path>.pre-worktree-backup` rather than
silently deleted -- POLY-4 itself already carried that exact content
into the orphan branch's seed commit, but "already migrated, safe to
delete" is a judgment call this script should never make silently for
content it did not itself write.

Never raises: a broken repo state here must not fail the session start
it's wired into. Prints one diagnostic line to stderr on any skip/error;
exits 0 regardless (SessionStart hooks are advisory, not gating).
"""
from __future__ import annotations

import sys
from pathlib import Path
from subprocess import CompletedProcess, run
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent.parent  # scripts/cairn -> scripts -> repo root
METRICS_PATH = REPO_ROOT / "process" / "cairn" / "metrics"
BRANCH = "metrics"


def _git(*args: str, cwd: Optional[Path] = None) -> CompletedProcess:
    return run(["git", *args], cwd=str(cwd or REPO_ROOT), capture_output=True, text=True)


def _is_registered_worktree(path: Path) -> bool:
    result = _git("worktree", "list", "--porcelain")
    if result.returncode != 0:
        return False
    target = str(path.resolve()) if path.exists() else str(path)
    for line in result.stdout.splitlines():
        if line.startswith("worktree "):
            candidate = line[len("worktree "):]
            candidate_resolved = str(Path(candidate).resolve()) if Path(candidate).exists() else candidate
            if candidate_resolved == target or candidate == str(path):
                return True
    return False


def _move_stray_path_aside(path: Path) -> bool:
    """Returns True iff `path` is now clear (didn't exist, or was moved
    aside successfully). False means the caller should skip bootstrap
    this run rather than risk `git worktree add` colliding with it."""
    if not path.exists():
        return True
    backup = path.parent / f"{path.name}.pre-worktree-backup"
    if backup.exists():
        sys.stderr.write(
            f"ensure_metrics_worktree: {path} exists and is not a worktree, but "
            f"{backup} (a prior backup) already exists too -- leaving both in "
            f"place, skipping bootstrap this run.\n"
        )
        return False
    try:
        path.rename(backup)
    except OSError as exc:
        sys.stderr.write(f"ensure_metrics_worktree: could not move aside {path}: {exc}\n")
        return False
    return True


def _bootstrap_fresh_orphan() -> None:
    add = _git("worktree", "add", "--orphan", "-b", BRANCH, str(METRICS_PATH))
    if add.returncode != 0:
        sys.stderr.write(f"ensure_metrics_worktree: could not create orphan worktree: {add.stderr}\n")
        return
    # An orphan worktree starts with an unborn HEAD (no commits at all) --
    # give it one real commit so test_run_record.py's `git commit` calls
    # have something to build on.
    (METRICS_PATH / ".gitattributes").write_text("*.jsonl merge=union\n", encoding="utf-8")
    _git("add", "--", ".gitattributes", cwd=METRICS_PATH)
    _git("commit", "-q", "-m", "metrics: initialize orphan branch", cwd=METRICS_PATH)


def main() -> int:
    if _is_registered_worktree(METRICS_PATH):
        return 0

    if not _move_stray_path_aside(METRICS_PATH):
        return 0

    fetch = _git("fetch", "origin", BRANCH)
    have_remote_branch = fetch.returncode == 0
    have_local_branch = _git("rev-parse", "--verify", f"refs/heads/{BRANCH}").returncode == 0

    if have_remote_branch and not have_local_branch:
        _git("branch", BRANCH, f"refs/remotes/origin/{BRANCH}")
        have_local_branch = True

    if have_local_branch:
        add = _git("worktree", "add", str(METRICS_PATH), BRANCH)
        if add.returncode != 0:
            sys.stderr.write(f"ensure_metrics_worktree: git worktree add failed: {add.stderr}\n")
        return 0

    # Neither local nor remote has `metrics` yet -- this is a fresh fork
    # nobody has bootstrapped. Create it, rather than fail.
    _bootstrap_fresh_orphan()
    return 0


if __name__ == "__main__":
    sys.exit(main())
