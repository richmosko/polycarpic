---
id: POLY-79
title: Tracker + worktree tooling follow-ups (Plan phase)
status: backlog
milestone: null
parent: null
blocked_by: []
assignee: devops-engineer
paths: [scripts/cairn/**, .claude/hooks/**]
labels: [tooling]
priority: null
pr: null
created: 2026-09-28
updated: 2026-09-28
---

## Context

Umbrella for tooling gaps surfaced 2026-09-28 while running the Plan team in parallel worktrees. Add further items here rather than filing one issue each.

## Items

- [ ] **Issue-ID allocation collides across worktrees.** `cairnlib.store._next_id_candidate` scans the local `process/cairn/issues/` directory, so two agents in separate worktrees both allocate the same next ID (team-lead and architect both created POLY-76 on 2026-09-28; the lead's was renumbered to POLY-78 by hand). Options: reserve IDs through a shared counter file on `main`, scan every worktree in `git worktree list`, or make the lead the only allocator and have teammates request IDs. Decide and implement; add a `cairn check` rule that flags duplicate IDs across branches if cheap.
- [ ] **Worktree guard blocks `temp/` and `.claude/agent-memory/` writes.** The architect reports the worktree guard refused writes to the shared `temp/` hand-off buffer and to its own agent memory, so no memory was saved this session and hand-offs went to `process/reviews/POLY-C/` instead. Either allowlist those two paths (they are gitignored, session-shared by design) or document `process/reviews/<milestone>/` as the hand-off location for worktree-bound teammates and update the agent briefs.
- [ ] **`cairn new` accepted `--priority high` and only failed at `cairn check`.** Validate the P0–P3 vocabulary at creation time.
