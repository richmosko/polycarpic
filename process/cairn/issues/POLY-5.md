---
id: POLY-5
title: Fail closed when a teammate cannot isolate in its own worktree
status: todo
milestone: POLY-A
parent: null
blocked_by: [POLY-1]
assignee: null
labels: [workflow, git]
priority: P1
pr: null
created: 2026-09-23
updated: 2026-09-23
---


Found during POLY-1 (architect ruling on POLY-1 @ 752c1b4). Both teammates
worked inside team-lead's own worktree instead of creating their own: the lead
was worktree-isolated this session (background-job mode), the teammates were
spawned with that directory as cwd, and each treated "already in a worktree" as
satisfying the protocol's `EnterWorktree` first step, so it was never called.
Consequences seen: a per-worktree identity set by one agent leaked onto the
lead's commit 1ff7489, and the lead's uncommitted files blocked a teammate's
`pull --rebase`. The design assumption in `process/WORKFLOW.md` (lead in the
main checkout, one worktree per teammate) was silently violated and nothing
failed loudly.

## Acceptance criteria

- [ ] Shared worktree-protocol block: `EnterWorktree` is called unconditionally, even when cwd is already under `.claude/worktrees/`; if it fails or is refused, the teammate sets no identity, makes no commit, and reports the failure to team-lead instead of working in place
- [ ] Lead-side guard: a check (SessionStart hook or `/start-feature` pre-flight) that warns loudly, or refuses to spawn teammates, while the lead's cwd is inside a worktree; the message names the fix
- [ ] The byte-identical drift test and `test_agent_git_identity.py` are extended to cover the new block wording
- [ ] `process/WORKFLOW.md` worktree section states the fail-closed rule in one sentence

## Comments

### @team-lead — 2026-09-23

Related finding (POLY-4 loop, iterm2 split-pane mode): every teammate's first `EnterWorktree` raised an interactive permission prompt ("permission-root relocation … a model-supplied worktree") because agent files run `permissionMode: default` and no allow rule existed. In in-process mode this stalls silently — the prompt is only visible in a split pane. Mitigation landed on `feature/poly-4-test-suite-health`: `EnterWorktree` / `ExitWorktree` added to `permissions.allow` in `.claude/settings.json`. POLY-5's fail-closed AC #1 should also cover "prompt denied" → report to team-lead, not work in place.
