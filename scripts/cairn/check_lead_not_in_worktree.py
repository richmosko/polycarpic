#!/usr/bin/env python3
"""check_lead_not_in_worktree.py -- POLY-5 gate-1 ruling (architect,
process/cairn/issues/POLY-5.md @ be1d195, item (b)/(c)): the lead-side
guard. `process/WORKFLOW.md` assumes the lead's own tree is the MAIN
checkout, never a linked worktree (POLY-5's root cause: a lead spawned
inside its own worktree, via background-job isolation, silently
satisfied the shared protocol's "already in a worktree" check and
spawned teammates from there -- nothing failed loudly). This script
checks the lead's own cwd and fails loudly, rather than advisorily,
when that assumption is violated.

Exit codes:
  0 -- the cwd is the main checkout, or isn't a git repo at all. No
       stdout either way.
  1 -- the cwd resolves inside a LINKED worktree. Prints a message to
       STDOUT (not stderr): SessionStart hook output is injected into
       the session transcript, and a teammate spawned with this cwd
       sees the same hook output too, so stdout is what actually
       reaches the audience that needs to act on it. The message names
       `team-lead`, the resolved worktree path, the resolved
       main-checkout path, and a `Fix:` line.

Detection (item c): a linked worktree is discriminated by
`realpath(--git-dir) != realpath(--git-common-dir)`, resolved against
the cwd -- the same check `run_tests.py` and
`ensure_metrics_worktree.py`'s `_is_linked_worktree` already use (PT-82
ruling, measured in four contexts). Reused here via import rather than
reimplemented, so the two checkers can never drift apart on what
counts as "linked."

Callers (item b): `/start-feature`'s new step 0 (Pre-flight), and a
SessionStart hook line (wired by the user directly into
`.claude/settings.json` -- not this script's job, and not AC2-gating;
AC2 is met by the pre-flight alone).

Never raises on a non-git directory or an unreadable repo -- that's
exit 0, not a crash; only a confirmed linked worktree is exit 1.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from subprocess import CompletedProcess, run

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ensure_metrics_worktree import _is_linked_worktree  # noqa: E402


def _git(*args: str, cwd: Path) -> CompletedProcess:
    return run(["git", *args], cwd=str(cwd), capture_output=True, text=True)


def _resolve_main_checkout(cwd: Path) -> str:
    """Best-effort resolved path to the main checkout, for the message.
    `--git-common-dir` points at the main checkout's own `.git/`; its
    parent is the checkout root."""
    common_dir = _git("rev-parse", "--git-common-dir", cwd=cwd)
    if common_dir.returncode != 0:
        return "<unknown>"
    common_dir_path = (cwd / common_dir.stdout.strip()).resolve()
    return str(common_dir_path.parent)


def check(cwd: Path) -> int:
    cwd = cwd.resolve()
    in_git_repo = _git("rev-parse", "--is-inside-work-tree", cwd=cwd).returncode == 0
    if not in_git_repo:
        return 0
    if not _is_linked_worktree(cwd):
        return 0

    main_checkout = _resolve_main_checkout(cwd)
    sys.stdout.write(
        "check_lead_not_in_worktree: team-lead's own working directory is a LINKED "
        f"worktree, not the main checkout: {cwd}\n"
        f"Main checkout: {main_checkout}\n"
        "The lead's tree must always be the main checkout (process/WORKFLOW.md -> "
        "'The lead never enters a worktree') -- spawning teammates from inside a "
        "worktree silently breaks their own EnterWorktree isolation (POLY-5).\n"
        "Fix: restart Claude Code from the main checkout, or run `ExitWorktree` if "
        "this worktree was entered via the EnterWorktree tool, before spawning any "
        "teammate.\n"
    )
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cwd", type=Path, default=Path.cwd())
    args = parser.parse_args()
    return check(args.cwd)


if __name__ == "__main__":
    sys.exit(main())
