---
id: POLY-80
title: Retire process/reviews
status: done
milestone: null
parent: null
blocked_by: []
assignee: devops-engineer
paths: [process/cairn/reviews/**, process/reviews/**, process/WORKFLOW.md, process/TRACKER.md, process/DECISIONS.md, .claude/roles/team-lead.md, .claude/agents/*.md, .claude/hooks/message_cap.py, scripts/cairn/**, tests/workflow/**, .github/workflows/ci.yml, process/cairn/archive/**, .worktreeinclude, docs/project_kickoff.md, .claude/hooks/**, .claude/skills/**]
labels: [tooling, ci, process]
priority: P1
pr: null
created: 2026-09-28
updated: 2026-09-28
---

Rulings move from the free-floating `process/reviews/<ID>/` into the tracker record at `process/cairn/reviews/<ID>/`, hand-offs are never committed, and guard-push enforces it. Principal ruling of 2026-09-28: cairn's records self-contained under one parent, no unnecessary CI triggers, nothing that is a hand-off reaches GitHub.

## Context

Principal ruling 2026-09-28, three principles:
1. **Cairn's records are self-contained under one parent directory** (`process/cairn/`). The same holds for cairn's own board/dashboard design assets, which POLY-78 moves under `scripts/cairn/`.
2. **No unnecessary CI triggers.** Tracker records are already excluded from the CI change filter; rulings must live where that exclusion applies.
3. **A hand-off is never committed to GitHub.** Hand-offs live in `temp/` (the teammate's own worktree copy when worktree-bound) and are pointed to by absolute path.

Today `process/reviews/<ID>/` holds 19 files across 12 issues (POLY-6 … POLY-61). The location is sanctioned by `process/WORKFLOW.md` (B6, D14, "a ruling is … or `process/reviews/<ID>/ruling.md`"), `process/TRACKER.md`, `.claude/roles/team-lead.md`, all ten agent briefs, and the `message_cap.py` hook text, all inherited from project_template. Four `DECISIONS.md` entries and several `TRACKER.md` paragraphs cite ruling files by path; `tests/workflow/` pins some ruling files by blob.

## Acceptance criteria

- [ ] `git mv process/reviews/<ID>/ → process/cairn/reviews/<ID>/` for every existing ruling directory, history preserved. `process/reviews/` no longer exists.
- [ ] Every path citation follows: `process/DECISIONS.md`, `process/TRACKER.md`, `process/WORKFLOW.md`, `tests/workflow/` blob pins, any `scripts/cairn/` docstring or test. `grep -rn "process/reviews" .` returns nothing outside `.git/`.
- [ ] `process/WORKFLOW.md` (B6, D14, the ruling sentence), `process/TRACKER.md`, `.claude/roles/team-lead.md`, all ten `.claude/agents/*.md` briefs and the `message_cap.py` hook text say: a ruling is an issue comment, or `process/cairn/reviews/<ID>/ruling.md` when it exceeds the comment budget; constructions and harness output go to `temp/`; **hand-offs are never committed**; worktree-bound teammates use `temp/` inside their own worktree and send an absolute path.
- [ ] CI's change filter `EXCLUDE` covers `process/cairn/reviews/` (coordinate with POLY-74 so the two edits to `ci.yml` don't conflict; land POLY-74 first).
- [ ] Mechanical enforcement of principle 3: `cairn guard-push` (or `cairn check`) refuses any new file under `process/` that is not a tracker record (`process/cairn/{issues,milestones,majors,archive,reviews}/`) or one of the named process docs (`WORKFLOW.md`, `TRACKER.md`, `STATE.md`, `DECISIONS.md`, `cairn/config.yml`), with a message naming `temp/`. Unit test included.
- [ ] `cairn show <ID>` lists the issue's review files if `process/cairn/reviews/<ID>/` exists (one line each); the board's detail drawer may follow later, not required here.
- [ ] Optional, same brief-editing pass: add the `mcp__claude-in-chrome__*` tools to `.claude/agents/ux-designer.md` so the designer can do its own visual research (two Plan-phase deliverables needed a browser the teammate did not have).
- [ ] Note in the issue comment what should be pushed upstream to project_template (the location change and the guard), so the template stops shipping the free-floating directory.

## Comments

### @team-lead — 2026-09-28

Merging via PR #44 (Principal: "go with your rec on rulings"). Verified on the branch: process/reviews/ empty, 19 files moved with history, PINNED_RULINGS carve-out matches RULING_BLOBS exactly (POLY-6, 10, 26, 48, 51), full suites green. Closing.
