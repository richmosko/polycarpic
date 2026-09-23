---
id: POLY-2
title: Path-ownership push check for concurrent writers
status: todo
milestone: POLY-A
parent: null
blocked_by: [POLY-1]
assignee: null
labels: [workflow, cairn]
priority: P1
pr: null
created: 2026-09-23
updated: 2026-09-23
---


Worktree isolation guarantees one writer per checkout, but several agents push
to the same feature branch. Kickoff decision: `docs/project_kickoff.md` § 2.1
→ *One writer per file*: each cairn sub-issue declares the paths its agent may
touch, and a push-time check compares the agent's commits against the declared
paths and fails loudly on a stray file. Depends on POLY-1: the check attributes
commits by git author identity.

## Acceptance criteria

- [ ] `process/TRACKER.md` frontmatter schema gains an optional `paths:` list (glob patterns, repo-relative) on issues; `cairn check` validates it and `cairn new --paths` / `cairn set <ID> paths=…` write it
- [ ] `cairn guard-push <ID>` lists the files changed by commits authored by the sub-issue's assignee between the branch base and HEAD, and exits non-zero naming every file outside the declared globs
- [ ] A sub-issue with no `paths:` field passes with a warning, not a failure (opt-in, not a hard gate for existing flows)
- [ ] The shared worktree-protocol block runs `cairn guard-push` before `git push` and the push is skipped on failure
- [ ] Unit tests in `scripts/cairn/tests/` cover: in-bounds commit, stray file, no `paths:` declared, glob semantics (`src/auth/**`)
- [ ] The board's issue drawer shows the declared paths on a sub-issue
