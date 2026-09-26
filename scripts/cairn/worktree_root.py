#!/usr/bin/env python3
"""worktree_root.py -- POLY-49 ruling §3: the one shared resolver for
"what is the MAIN checkout's root, given a repo_root that might be a
linked worktree" -- `run_tests.py`'s own self-recording (PT-82) and
`otel_receiver.py`'s CLI (`--ensure-running`, `--session-ended`,
`--status`, `--flush-now`, `--stop`) both need this, and a teammate's
worktree is exactly where the receiver's own defaults (pidfile, sessions
dir, out-file, logfile) used to silently diverge from the main
checkout's real ones (POLY-49, carried "flush from a worktree" finding).

`_resolve_worktree_main_checkout` moved here VERBATIM from `run_tests.py`
(same PT-82 ruling, same measured discriminator) -- `run_tests.py` keeps
importing it under the same name so nothing that already refers to
`run_tests._resolve_worktree_main_checkout` (docstrings in
`ensure_metrics_worktree.py`/`test_estimation.py`) goes stale.
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Optional


def _resolve_worktree_main_checkout(repo_root: Path) -> Optional[Path]:
    """PT-82 (architect's ruling, re-issued, PT-82.md @ 69e9664): the
    MAIN checkout's root, iff `repo_root` is a LINKED worktree --
    discriminated by `--git-dir != --git-common-dir`. Measured, four
    contexts: a linked worktree is the ONLY one where they differ
    (`--git-dir` = `.git/worktrees/<name>`, `--git-common-dir` = the
    main `.git`); the main checkout and a fake engine root NESTED INSIDE
    this repo both report the same value for both -- so common-dir alone
    is not a safe signal, and using it unconditionally would redirect a
    fake-engine-root test copy's self-record into the real
    `test-runs.jsonl`. `None` for every other case (main checkout, a
    fake root inside or outside a repo, git unavailable) -- callers fall
    back to the pre-existing default. Never raises."""
    try:
        git_dir = subprocess.run(
            ["git", "-C", str(repo_root), "rev-parse", "--git-dir"],
            capture_output=True, text=True, timeout=5,
        )
        common_dir = subprocess.run(
            ["git", "-C", str(repo_root), "rev-parse", "--git-common-dir"],
            capture_output=True, text=True, timeout=5,
        )
    except (FileNotFoundError, OSError):
        return None
    if git_dir.returncode != 0 or common_dir.returncode != 0:
        return None
    git_dir_path = (repo_root / git_dir.stdout.strip()).resolve()
    common_dir_path = (repo_root / common_dir.stdout.strip()).resolve()
    if git_dir_path == common_dir_path:
        return None  # main checkout, or a fake root nested inside the repo
    return common_dir_path.parent


def main_checkout_root(p: Path) -> Path:
    """`_resolve_worktree_main_checkout(p)` when `p` is a linked
    worktree, else `p` itself unchanged -- the one call every caller
    that just wants "the real root to anchor persistent state under"
    (a pidfile, a sessions dir, a data file, a self-record) should make,
    instead of each re-deriving the None-means-fall-back-to-p dance
    `_resolve_worktree_main_checkout` alone requires."""
    resolved = _resolve_worktree_main_checkout(p)
    return resolved if resolved is not None else p
