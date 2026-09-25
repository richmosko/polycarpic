---
id: POLY-56
title: Checklists as the granularity layer
status: todo
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, board]
priority: P2
pr: null
created: 2026-09-25
updated: 2026-09-25
---

User decision 2026-09-25 (POLY-51 loop): sub-issues nest one level only. Anything finer than a sub-issue is a **checklist** in the issue body, visible on the card. Sub-issues stay for work that needs its own assignee, status, or cost estimate (the per-stage records); checklists cover everything else. Queued after the grouped umbrellas POLY-48 / POLY-49 / POLY-50.

**What exists today (measured):** the body parser already splits `- [ ]` / `- [x]` items into `split.items` and the drawer renders them as **disabled** checkboxes under "Acceptance criteria" (board.js ~2146). Cards carry a `done/total` badge for sub-issues (`childProgress`), and the drawer lists children (`childrenOf`). Write-back of checkboxes was **deferred by ruling 2026-08-19** (TRACKER.md → Deferred work): cairn keeps zero body-rewriting paths; comment append is the only tail-only exception. Until 2026-09-25 issues put acceptance criteria in comments as numbered lists, so the parser saw none for them.

**Authoring convention (user request 2026-09-25):** issue titles are short labels (one noun phrase, ≤ 70 chars); the substance lives in the body, a description paragraph plus `## Acceptance criteria` as `- [ ]` rows. Comments are the log, not the spec. The four umbrellas were rewritten to this shape by hand on 2026-09-25; this issue makes the tooling enforce it.

**Write-back is gated on a gate-1 ruling.** Ticking a checkbox on the board rewrites `- [ ]` → `- [x]` for that one line. The ruling must give the anchored-rewrite design (line identity: text + ordinal, not index), the conflict story (a teammate editing the same body in a worktree; the board's stale-snapshot check), and the byte-preservation guarantee for every other byte of the file. If the ruling says the risk is not worth it, the other criteria still ship and write-back stays deferred with the ruling recorded.

## Acceptance criteria

- [ ] Card badge for checklist progress: a card whose body carries checklist items shows `k/n` checked, distinct from or unified with the sub-issue `done/total` badge (architect rules). Read-only
- [ ] Sub-issues as checkbox rows: the drawer renders children in the checklist style, checked when `status: done`, still linking to the child. Read-only
- [ ] Checkbox write-back built per the ruling, or explicitly re-deferred with the ruling recorded in TRACKER.md
- [ ] Convention in TRACKER.md: short title, description body, criteria as body `- [ ]` items; qa's verdict ticks them (board write-back or a CLI such as `cairn check-item <ID> <ordinal>`, architect rules the mechanism)
- [ ] `cairn new` seeds the body (`--body -` or a template with the two headings) and warns on a title over 70 chars; `cairn check` warns on a long title or an empty description
- [ ] Tests: parser edge cases (nested lists, `- [X]`, items inside comments ignored), badge counts, drawer rendering, title/description lint, and if built the write-back round-trip byte-for-byte on a fixture with CRLF and trailing whitespace

## Comments

### @team-lead — 2026-09-25

Filed 2026-09-25 from the POLY-51 loop; spec is in the body above. Authoring convention added the same day at the user's request.
