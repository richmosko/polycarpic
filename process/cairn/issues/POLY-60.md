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

- [ ] Every write path goes through `read_record`/`write_record` (ruling R1); one test per path (`set`, `comment`, `check-item`, `close`, `archive`) on a CRLF + trailing-whitespace fixture asserts every byte outside that path's edited span is unchanged; the text-mode `_atomic_write` is gone
- [ ] `parse_frontmatter` accepts `---\r` fences (frontmatter values carry no `\r`, body unchanged); `check-item` on a fully-CRLF file exits 0 and changes exactly one byte
- [ ] TRACKER.md Write-back carries the R4 sentence verbatim; `tests/INTERFACE.md` lists the new seam and module
- [ ] POLY-7, 8, 9, 15, 25, 27, 33, 40, 47 set `done`, each with a comment naming its R3 sha; POLY-49 criterion 1 ticked; `cairn check` on the live tracker reports 0 title/description warnings
- [ ] `cairnlib/enginesrc.py` (`engine_source_files`, `engine_source_stat`) is the only dir-stat loop; `compute_multi_etag` and `watch.engine_fingerprint`/`engine_is_stale` call it
- [ ] Every row of the review checklist in `process/reviews/POLY-60/ruling.md` has its test, and each test fails under its named mutation

## Comments

### @team-lead — 2026-09-27

Feature started. Branch: `feature/poly-60-cairn-core-bytes`. Promoted straight from backlog (user, 2026-09-27).

### @architect — 2026-09-27

Gate-1 ruling: process/reviews/POLY-60/ruling.md (measured @ 989944f; acceptance criteria amended in place).

- M: set/comment/close turn a CRLF file into LF throughout (frontmatter and body); check-item refuses a CRLF file (fence `---\r`); archive is byte-exact (rename). Trailing whitespace survives on every path.
- R1 seam: `parse_frontmatter` accepts `---\r` fences (the one fence rule; read-only callers unchanged). New `read_record`/`write_record`/`emit_frontmatter` in records.py; every writer uses them; the text-mode `_atomic_write` is deleted. Re-emitted frontmatter takes the opening fence's EOL.
- R2: new leaf `cairnlib/enginesrc.py` (`engine_source_files`, `engine_source_stat`), shared by `compute_multi_etag` and `watch`.
- R3: all 8 children, plus POLY-9, already shipped (shas in the table) → set done with a sha comment, tick POLY-49 #1; no archive in this PR.
- R4: the TRACKER.md Write-back sentence, verbatim in the ruling.
- Review checklist: 12 tests, one named mutation each.
