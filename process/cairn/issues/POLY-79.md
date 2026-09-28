---
id: POLY-79
title: Tracker and worktree tooling follow-ups
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

Umbrella for tooling gaps found while running the Plan team in parallel worktrees on 2026-09-28: issue-ID collisions, the hand-off location rule, priority validation at creation, and guard-push counting add-then-remove as a touch. Add further items here rather than filing one issue each.

## Context

Umbrella for tooling gaps surfaced 2026-09-28 while running the Plan team in parallel worktrees. Add further items here rather than filing one issue each.

## Items

- [ ] **Issue-ID allocation collides across worktrees.** `cairnlib.store._next_id_candidate` scans the local `process/cairn/issues/` directory, so two agents in separate worktrees both allocate the same next ID (team-lead and architect both created POLY-76 on 2026-09-28; the lead's was renumbered to POLY-78 by hand). Options: reserve IDs through a shared counter file on `main`, scan every worktree in `git worktree list`, or make the lead the only allocator and have teammates request IDs. Decide and implement; add a `cairn check` rule that flags duplicate IDs across branches if cheap.
- [ ] **Teammates in worktrees cannot reach the shared `temp/` or their agent memory.** Not a project hook: the harness's worktree isolation blocks writes outside the worktree, and both dirs live in the main checkout. Consequence seen 2026-09-28: the architect committed a hand-off under `process/reviews/POLY-C/`, which is tracked and triggers the full CI suite (POLY-74). Rule, to be written into `process/WORKFLOW.md` and every agent brief: hand-offs go to `temp/` **inside the teammate's own worktree** (gitignored there too) and the pointer sent to the lead is the absolute path; `process/reviews/<milestone>/` is only for rulings that are meant to be committed. Agent memory for worktree-bound teammates is a harness limitation to record, not fix here.
- [ ] **`cairn guard-push` counts a path added and removed within the range as touched.** A feature branch that briefly committed an out-of-scope file and then removed it is blocked even though the net diff against `main` is clean (POLY-78, 2026-09-28; fixed by rewriting unpushed commits). Decide whether the guard should judge the net diff, the per-commit touches, or both, and document it in TRACKER.md.
- [ ] **Lead commits made from a teammate's worktree carry the teammate's git identity.** The lead's POLY-80 tracker done-flip (a771961) was authored as devops-engineer because it was committed inside that worktree, and guard-push attributes by author name, so it tripped the same check a real leak would. Either set the lead's identity explicitly (`git -c user.name=... commit`) in the merge flow, or have guard-push exempt the tracker done-flip commit shape. Document in the merge-pr skill.
- [ ] **`cairn new` accepted `--priority high` and only failed at `cairn check`.** Validate the P0–P3 vocabulary at creation time.
