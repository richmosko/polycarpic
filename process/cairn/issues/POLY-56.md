---
id: POLY-56
title: Checklists as the granularity layer
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, board]
priority: P2
pr: null
created: 2026-09-25
updated: 2026-09-26
---

User decision 2026-09-25 (POLY-51 loop): sub-issues nest one level only. Anything finer than a sub-issue is a **checklist** in the issue body, visible on the card. Sub-issues stay for work that needs its own assignee, status, or cost estimate (the per-stage records); checklists cover everything else. Queued after the grouped umbrellas POLY-48 / POLY-49 / POLY-50.

**What exists today (measured):** the body parser already splits `- [ ]` / `- [x]` items into `split.items` and the drawer renders them as **disabled** checkboxes under "Acceptance criteria" (board.js ~2146). Cards carry a `done/total` badge for sub-issues (`childProgress`), and the drawer lists children (`childrenOf`). Write-back of checkboxes was **deferred by ruling 2026-08-19** (TRACKER.md → Deferred work): cairn keeps zero body-rewriting paths; comment append is the only tail-only exception. Until 2026-09-25 issues put acceptance criteria in comments as numbered lists, so the parser saw none for them.

**Authoring convention (user request 2026-09-25):** issue titles are short labels (one noun phrase, ≤ 70 chars); the substance lives in the body, a description paragraph plus `## Acceptance criteria` as `- [ ]` rows. Comments are the log, not the spec. The four umbrellas were rewritten to this shape by hand on 2026-09-25; this issue makes the tooling enforce it.

**Write-back is gated on a gate-1 ruling.** Ticking a checkbox on the board rewrites `- [ ]` → `- [x]` for that one line. The ruling must give the anchored-rewrite design (line identity: text + ordinal, not index), the conflict story (a teammate editing the same body in a worktree; the board's stale-snapshot check), and the byte-preservation guarantee for every other byte of the file. If the ruling says the risk is not worth it, the other criteria still ship and write-back stays deferred with the ruling recorded.

## Acceptance criteria

Amended by the gate-1 ruling (`process/reviews/POLY-56/ruling.md`).

- [ ] Card badge: a distinct `checklist` chip `☑ k/n` (shown only when n > 0), fed by a server-side `checklist {done,total}` on `/api/board` from one Python parser `checklist_items`; the drawer renders `checklist_items` from `/api/issue`, and the client-side item parse is removed. Read-only
- [ ] Sub-issues as checkbox rows: the drawer's Children list renders a disabled checkbox per child, checked iff `status: done`, still linking to the child. Read-only
- [ ] `cairn check-item <ID> <ordinal> [--uncheck] [--text <exact>]` built: exactly one byte changes, `updated` untouched, mtime-guarded, idempotent; board write-back re-deferred with the ruling recorded in TRACKER.md → Deferred work
- [ ] Convention in TRACKER.md: short title, description body, criteria as body `- [ ]` items; qa's verdict ticks them with `cairn check-item`
- [ ] `cairn new --body <text|->` seeds the body in the same `O_EXCL` write (default skeleton `## Acceptance criteria` + one empty item) and warns on a title over 70 chars; `cairn check` warns on a long title or an empty description for open, non-`stage:` issues
- [ ] Tests: one per row of the ruling's review checklist, each catching its named mutation, including the check-item byte-for-byte round-trip on a CRLF + trailing-whitespace fixture

## Comments

### @team-lead — 2026-09-25

Filed 2026-09-25 from the POLY-51 loop; spec is in the body above. Authoring convention added the same day at the user's request.

### @team-lead — 2026-09-26

Feature started. Branch: `feature/poly-56-checklists`.

### @architect — 2026-09-26

**Gate 1 — ruling:** `process/reviews/POLY-56/ruling.md`. The acceptance criteria above were amended in place to match it.

- Badge: a distinct `checklist` chip. One Python parser feeds both the card and the drawer.
- Write-back: the CLI `cairn check-item` is built (a one-byte rewrite, mtime-guarded). Board write-back is re-deferred.
- Lint: `cairn new --body` plus a title cap of 70 chars; `cairn check` warns on open issues without `stage:`.
- The review checklist is pre-registered in the ruling file, one named mutation per test.
