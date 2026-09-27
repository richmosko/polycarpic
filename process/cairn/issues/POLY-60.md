---
id: POLY-60
title: Cairn core: byte-exact writes, CRLF, old-style child issues (grouped)
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn]
priority: P3
pr: null
created: 2026-09-26
updated: 2026-09-27
---

Grouped follow-ups from the POLY-56 loop (2026-09-26): architect ruling measurement M4 (672ce44) and the gate-4 verdict (7c73f03). One PR closes every item.

**CRLF → LF across the whole body on any cairn write.** `apply_patch` / `append_comment` read with universal newlines, so a CRLF issue file is silently normalised on the first `cairn set` or `cairn comment`. TRACKER.md's "body byte-for-byte" claim is false today for those paths; POLY-56's `check-item` is byte-exact on its own.

**`cairn check-item` refuses a fully-CRLF file.** With CRLF frontmatter fences it exits 1 and writes nothing, while `show` / `set` accept the same file after translating it to LF. Fails safe; fix alongside the item above by making every read/write path byte-exact.

**Lint noise: 16 warnings on 8 open issues** (8 titles over 70 chars + 8 empty descriptions), all children of POLY-48 / POLY-49 with old-style titles and empty bodies. Expected until they are rewritten to the authoring convention (short title, description body, criteria as `- [ ]` rows) or archived with their umbrellas.

**Duplicate dir-stat code in `cairnlib/multiroot.py`** (POLY-58 verdict, 222f15a): commit d0b06a9 unhooked `compute_multi_etag` from `watch` by copying about 10 lines of the directory-stat logic instead of sharing it. Fold back into one helper.

## Acceptance criteria

- [ ] Every cairn read/write path preserves bytes outside the edited span; one test with a CRLF + trailing-whitespace fixture per write path (`set`, `comment`, `check-item`, `close`, `archive`)
- [ ] `check-item` accepts a CRLF-frontmatter file and still changes exactly one byte
- [ ] TRACKER.md's byte-for-byte sentence is true (written after the measurement lands)
- [ ] `cairn check` on the live tracker reports 0 title/description warnings: the 8 POLY-48/POLY-49 children rewritten to the convention or archived
- [ ] `compute_multi_etag` and the watcher share one dir-stat helper; no duplicated stat loop in `cairnlib/multiroot.py`

## Comments

### @team-lead — 2026-09-27

Feature started. Branch: `feature/poly-60-cairn-core-bytes`. Promoted straight from backlog (user, 2026-09-27).
