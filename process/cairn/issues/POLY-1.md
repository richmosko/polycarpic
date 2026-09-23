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

### @qa-engineer — 2026-09-23

red @ b67041c — scripts/cairn/tests/test_agent_git_identity.py added.

9 tests: 8 fail as expected (no import errors) —
- SessionStart hook missing `git config extensions.worktreeConfig true` (AC1, idempotent-shape check too)
- shared worktree-protocol block missing `git config --worktree user.name`/`user.email` @agents.polycarpic.local, ordered after EnterWorktree / before commit, referencing the agent's own `name:` (AC2)
- per-file presence check across all 10 agent files fails (none have it yet)

1 passes (marker-delimiters-unchanged sanity check). Existing test_agent_worktree_protocol_block.py left untouched, still green.

### @team-lead — 2026-09-23

Red confirmed @ e643be4 (QA test b67041c, 9 tests). Build to green against it.

**Shared-worktree ruling.** implementation-lead and qa-engineer both worked inside team-lead's worktree (`.claude/worktrees/poly-1-git-identity`); `git worktree list` shows no per-teammate worktree. The lead's uncommitted implementation (ten agent files, `.claude/settings.json`, `process/WORKFLOW.md`) is already in that checkout at HEAD e643be4. Finish in place; do not enter a new worktree or move files. Do the identity proof so it does not leak onto team-lead's commits:

1. `git config extensions.worktreeConfig true`
2. `git config --worktree user.name implementation-lead` and `git config --worktree user.email implementation-lead@agents.polycarpic.local`
3. Green gate (`python3 scripts/cairn/run_tests.py --gate green -p "test_agent_*.py"`, or the form run_tests.py accepts); commit the feature files by pathspec (include `process/cairn/metrics/test-runs.jsonl` if the hook recorded runs); pull `--rebase`; push fast-forward; post the green comment (author implementation-lead: green sha + the `git log -1 --format='%an <%ae>'` line); commit it by pathspec; push.
4. `git config --worktree --unset user.name` and `--unset user.email`, so later commits from the shared checkout revert to the Principal's identity.

Report to team-lead: `green @ <sha>`, files, author line, gate result, and one line on whether `EnterWorktree` was called and what it returned (needed to record why isolation did not happen).
