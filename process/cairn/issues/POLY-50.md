---
id: POLY-50
title: Backfill attribution (grouped)
status: todo
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P3
pr: null
created: 2026-09-25
updated: 2026-09-25
---

Grouped fix loop for `backfill_tokens.py` (user decision 2026-09-25). One PR closes every member; together they are the prerequisites for the first real backfill write on this repo (POLY-26 ruling §3).

**Members:** POLY-45, POLY-46.

**Carried here, not filed separately:**
- **milestone-window collision:** the POLY-26 dry-run (2026-09-25, 68c8dfa) printed `cairn: warning: milestone_windows dropped colliding milestone window(s) ['POLY-A', 'POLY-B']`. Both milestone files resolve to the same creation id/timestamp (bootstrapped in one commit), so every record that would match a milestone window falls back to `main`.

## Acceptance criteria

- [ ] POLY-45, POLY-46 acceptance criteria met and closed by this PR
- [ ] Same-timestamp milestones are disambiguated by file (or ordered deterministically); test with two milestones created in one commit
- [ ] A real (non-dry-run) backfill write on this repo attributes every record to an issue or milestone, none to `main` by fallback

## Comments

### @team-lead — 2026-09-25

Grouped 2026-09-25 from the POLY-26 loop's follow-ups; spec is in the body above.
