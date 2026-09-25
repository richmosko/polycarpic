---
id: POLY-56
title: Checklists as the granularity layer: body checklist progress on cards, sub-issues as checkbox rows, ruled write-back, acceptance criteria as body checklists
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


## Comments

### @team-lead — 2026-09-25

User decision 2026-09-25 (POLY-51 loop): sub-issues nest one level only. Anything finer than a sub-issue is a **checklist** in the issue body, visible on the card. Sub-issues stay for work that needs its own assignee, status, or cost estimate (the per-stage records); checklists cover everything else. Queued after the grouped umbrellas POLY-48 / POLY-49 / POLY-50.

What exists today (measured): the body parser already splits `- [ ]` / `- [x]` items into `split.items` and the drawer renders them as **disabled** checkboxes under "Acceptance criteria" (board.js ~2146). Cards carry a `done/total` badge for sub-issues (`childProgress`), and the drawer lists children (`childrenOf`). Write-back of checkboxes was **deferred by ruling 2026-08-19** (TRACKER.md → Deferred work): cairn keeps zero body-rewriting paths; comment append is the only tail-only exception. Recent issues put acceptance criteria in comments as numbered lists, so the parser sees none for them.

Acceptance criteria:
1. **Card badge for checklist progress:** a card whose body carries checklist items shows `k/n` checked, distinct from (or unified with — architect rules) the sub-issue `done/total` badge. Read-only.
2. **Sub-issues as checkbox rows:** the drawer renders children in the same checklist style, checked when `status: done`, still linking to the child. Read-only.
3. **Checkbox write-back — gated on a gate-1 ruling.** Ticking a checkbox on the board rewrites `- [ ]` → `- [x]` for that one line. The ruling must give the anchored-rewrite design (line identity: text + ordinal, not index), the conflict story (a teammate editing the same body in a worktree; the board's stale-snapshot check), and the byte-preservation guarantee for every other byte of the file. If the ruling says the risk is not worth it, items 1–2 and 4 still ship and write-back stays deferred with the ruling recorded.
4. **Convention (TRACKER.md):** acceptance criteria live in the issue **body** as `- [ ]` items, not in comments; qa's verdict ticks them (via the CLI if write-back is not built: `cairn check-item <ID> <ordinal>` or equivalent — architect rules the mechanism). `cairn new` gains a way to seed the body (`--body -` or a template) so ACs can be written at creation.
5. Tests: parser edge cases (nested lists, `- [X]`, items inside comments are ignored), badge counts, drawer rendering, and — if built — write-back round-trip byte-for-byte on a fixture with CRLF and trailing whitespace.
