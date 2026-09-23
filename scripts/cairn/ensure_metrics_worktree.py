#!/usr/bin/env python3
"""ensure_metrics_worktree.py -- POLY-4 AC #4 (team-lead ruling,
process/cairn/issues/POLY-4.md @ 5495132 + follow-up ruling confirming
token-usage.jsonl moves too): idempotent bootstrap for
`process/cairn/metrics/` as a nested worktree of the orphan `metrics`
branch. That branch holds `test-runs.jsonl`, `token-usage.jsonl`, a
`.gitattributes` (`*.jsonl merge=union`), and its own `.gitignore` for
the otel receiver's runtime scratch (`.receiver.pid`, `.sessions/`,
`otel_receiver.log`, `*.swp`) -- never merged into `main` or any feature
branch. See WORKFLOW.md -> Metrics branch for the full rule.

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
   `git worktree add --orphan -b metrics <path>`, then commit a real
   first commit so the branch isn't left with an unborn HEAD.
3. `git worktree add <path> metrics` once the ref exists locally by
   either path above.

The swap (team-lead ruling, POLY-4.md @ 5495132 follow-up): `git worktree
add` refuses outright on any non-empty target directory, and
`process/cairn/metrics/` is ALSO the otel receiver's runtime scratch
directory (pidfile, `.sessions/`, its log) even after the tracked
`*.jsonl` files move off this branch. So a pre-existing directory there
is renamed aside to `metrics.pre-worktree` (never deleted), the worktree
is added at the now-clear path, and then every entry from the backup
that ISN'T already provided by the fresh checkout (the runtime scratch,
never a stale copy of a tracked file the checkout just supplied) is
moved back in before the backup directory is removed. A renamed-aside
directory keeps any process's already-open file descriptors on files
inside it valid (POSIX rename semantics) -- the otel receiver's own log
fd survives this swap without needing to be told to reopen anything.

Never raises: a broken repo state here must not fail the session start
it's wired into. Prints one diagnostic line to stderr on any skip/error;
exits 0 regardless (SessionStart hooks are advisory, not gating).
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path
from subprocess import CompletedProcess, run
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent.parent  # scripts/cairn -> scripts -> repo root
METRICS_PATH = REPO_ROOT / "process" / "cairn" / "metrics"
BACKUP_PATH = REPO_ROOT / "process" / "cairn" / "metrics.pre-worktree"
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


def _swap_aside(path: Path, backup: Path) -> bool:
    """Renames `path` to `backup` so `git worktree add` sees a clear
    target. Returns True iff `path` is now clear (didn't exist, or was
    renamed aside successfully)."""
    if not path.exists():
        return True
    if backup.exists():
        sys.stderr.write(
            f"ensure_metrics_worktree: {path} exists and is not a worktree, but "
            f"{backup} (a prior, not-yet-restored backup) already exists too -- "
            f"leaving both in place, skipping bootstrap this run.\n"
        )
        return False
    try:
        path.rename(backup)
    except OSError as exc:
        sys.stderr.write(f"ensure_metrics_worktree: could not rename aside {path}: {exc}\n")
        return False
    return True


def _restore_backup_into(backup: Path, path: Path) -> None:
    """Moves every backup entry NOT already provided by the fresh
    checkout back into `path` -- the runtime scratch (pidfile,
    .sessions/, the receiver's log), never a stale copy of a tracked
    file the checkout just supplied (test-runs.jsonl, token-usage.jsonl,
    .gitattributes, .gitignore all already exist post-checkout, so those
    specific backup entries are simply dropped with the rest of the
    backup dir at the end)."""
    for entry in backup.iterdir():
        target = path / entry.name
        if target.exists():
            continue  # the checkout already provides this name -- keep it
        try:
            shutil.move(str(entry), str(target))
        except OSError as exc:
            sys.stderr.write(f"ensure_metrics_worktree: could not restore {entry} into {path}: {exc}\n")
    shutil.rmtree(backup, ignore_errors=True)


def _bootstrap_fresh_orphan() -> None:
    add = _git("worktree", "add", "--orphan", "-b", BRANCH, str(METRICS_PATH))
    if add.returncode != 0:
        sys.stderr.write(f"ensure_metrics_worktree: could not create orphan worktree: {add.stderr}\n")
        return
    # An orphan worktree starts with an unborn HEAD (no commits at all) --
    # give it one real commit so test_run_record.py's `git commit` calls
    # have something to build on.
    (METRICS_PATH / ".gitattributes").write_text("*.jsonl merge=union\n", encoding="utf-8")
    (METRICS_PATH / ".gitignore").write_text(
        ".receiver.pid\n.sessions/\notel_receiver.log\n*.swp\n", encoding="utf-8",
    )
    _git("add", "--", ".gitattributes", ".gitignore", cwd=METRICS_PATH)
    _git("commit", "-q", "-m", "metrics: initialize orphan branch", cwd=METRICS_PATH)


def main() -> int:
    if _is_registered_worktree(METRICS_PATH):
        return 0

    swapped = METRICS_PATH.exists()
    if not _swap_aside(METRICS_PATH, BACKUP_PATH):
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
            if swapped and not METRICS_PATH.exists():
                # Don't strand the backup on a failed add -- put it back
                # exactly where it was.
                BACKUP_PATH.rename(METRICS_PATH)
            return 0
    else:
        # Neither local nor remote has `metrics` yet -- this is a fresh
        # fork nobody has bootstrapped. Create it, rather than fail.
        _bootstrap_fresh_orphan()
        if not METRICS_PATH.exists():
            if swapped:
                BACKUP_PATH.rename(METRICS_PATH)
            return 0

    if swapped:
        _restore_backup_into(BACKUP_PATH, METRICS_PATH)
    return 0


if __name__ == "__main__":
    sys.exit(main())
