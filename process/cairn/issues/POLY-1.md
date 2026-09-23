---
id: POLY-1
title: Per-agent git author identity in worktrees
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: team-lead
labels: [workflow, git]
priority: P1
pr: null
created: 2026-09-23
updated: 2026-09-23
---


Every teammate works in its own git worktree on the shared feature branch, but
today all commits carry the Principal's author identity, so the per-agent commit
log the estimation loop (POLY-3) and the path-ownership check (POLY-2) both
depend on does not exist. Kickoff decision: `docs/project_kickoff.md` § 2.1
→ *Git author identity*. Pushes keep using the Principal's credentials; PRs are
opened by the Principal's GitHub account; the model's `Co-Authored-By` trailer
stays. Accepted costs: blank avatars on GitHub, unsigned commits.

## Acceptance criteria

- [ ] `extensions.worktreeConfig=true` is set in the repo config by the SessionStart hook, idempotently (same pattern as `core.hooksPath`), so a fresh clone gets it without a manual step
- [ ] The shared worktree-protocol block in every `.claude/agents/*.md` sets `user.name=<agent-name>` and `user.email=<agent-name>@agents.polycarpic.local` with `git config --worktree` immediately after `EnterWorktree`, before any commit
- [ ] The block stays byte-identical across all agent files (a test in `scripts/cairn/tests/` or a check script fails on drift)
- [ ] The team-lead's main checkout is untouched: commits there keep the Principal's identity
- [ ] Verified end to end: one spawned teammate commits in its worktree and `git log --format='%an <%ae>'` on the feature branch shows the agent's identity with the `Co-Authored-By` trailer intact
- [ ] `process/WORKFLOW.md` → worktree section documents the identity convention in one paragraph; `docs/project_kickoff.md` § 2.1 is left as the decision record

## Comments

### @team-lead — 2026-09-23

Feature started. Branch: `feature/poly-1-agent-git-identity`. Started during the Research phase by Principal decision: POLY-A's definition of done includes the § 2.1 / § 2.12 workflow items, and they precede the PRD interview per kickoff § 4 step 1.
