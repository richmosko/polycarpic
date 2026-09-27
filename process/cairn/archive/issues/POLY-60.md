---
id: POLY-60
title: Cairn core: byte-exact writes, CRLF, old-style child issues (grouped)
status: done
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn]
priority: P3
pr: https://github.com/richmosko/polycarpic/pull/30
created: 2026-09-26
updated: 2026-09-27
---

Grouped follow-ups from the POLY-56 loop (2026-09-26): architect ruling measurement M4 (672ce44) and the gate-4 verdict (7c73f03). One PR closes every item.

**CRLF → LF across the whole body on any cairn write.** `apply_patch` / `append_comment` read with universal newlines, so a CRLF issue file is silently normalised on the first `cairn set` or `cairn comment`. TRACKER.md's "body byte-for-byte" claim is false today for those paths; POLY-56's `check-item` is byte-exact on its own.

**`cairn check-item` refuses a fully-CRLF file.** With CRLF frontmatter fences it exits 1 and writes nothing, while `show` / `set` accept the same file after translating it to LF. Fails safe; fix alongside the item above by making every read/write path byte-exact.

**Lint noise: 16 warnings on 8 open issues** (8 titles over 70 chars + 8 empty descriptions), all children of POLY-48 / POLY-49 with old-style titles and empty bodies. Expected until they are rewritten to the authoring convention (short title, description body, criteria as `- [ ]` rows) or archived with their umbrellas.

**Duplicate dir-stat code in `cairnlib/multiroot.py`** (POLY-58 verdict, 222f15a): commit d0b06a9 unhooked `compute_multi_etag` from `watch` by copying about 10 lines of the directory-stat logic instead of sharing it. Fold back into one helper.

## Acceptance criteria

- [x] Every write path goes through `read_record`/`write_record` (ruling R1); one test per path (`set`, `comment`, `check-item`, `close`, `archive`) on a CRLF + trailing-whitespace fixture asserts every byte outside that path's edited span is unchanged; the text-mode `_atomic_write` is gone
- [x] `parse_frontmatter` accepts `---\r` fences (frontmatter values carry no `\r`, body unchanged); `check-item` on a fully-CRLF file exits 0 and changes exactly one byte
- [x] TRACKER.md Write-back carries the R4 sentence verbatim; `tests/INTERFACE.md` lists the new seam and module
- [x] POLY-7, 8, 9, 15, 25, 27, 33, 40, 47 set `done`, each with a comment naming its R3 sha; POLY-49 criterion 1 ticked; `cairn check` on the live tracker reports 0 title/description warnings
- [x] `cairnlib/enginesrc.py` (`engine_source_files`, `engine_source_stat`) is the only dir-stat loop; `compute_multi_etag` and `watch.engine_fingerprint`/`engine_is_stale` call it
- [x] Every row of the review checklist in `process/reviews/POLY-60/ruling.md` has its test, and each test fails under its named mutation

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

### @architect — 2026-09-27

Gate-4 verdict on 5a8c907 (build 3e2ec7b): **changes requested** (one item). The harness is scratch-only; each mutation ran against its pinned test module in a scratch copy (row 6 in place, then reverted).

| Axis | Result | Evidence |
|---|---|---|
| Per-path bytes, CRLF + trailing-whitespace fixture (M-harness) | pass | set 308→308 B, CRLF 27→27, 2 bytes differ; comment old bytes kept + CRLF tail (CRLF 27→31); check-item rc 0, 1 byte; close seam CRLF kept (+1 CRLF for the `ratio` line); archive 0 bytes differ. The LF control is unchanged from 989944f |
| Checklist rows 1, 2, 4, 5, 7–12 | pass | every mutation turns its test red |
| Checklist row 6 (emit ignores eol) | pass | `CloseCRLFByteExactTests` goes red with an error (`ValueError: subsection not found`), not a failure; still red |
| **Checklist row 3** (drop `endswith(eol)`) | **fail** | `test_missing_trailing_eol_gets_a_real_crlf_separator_not_glued_text` stays green: the mutated output `...eol\r\n### @b` still starts with `\r\n`. Fix: assert `appended.startswith(b"\r\n\r\n### @b")`, the exact separator the LF path has always produced (`eol` + blank line) |
| R1 seam | pass | `read_record`/`write_record`/`emit_frontmatter` carry set, comment, check-item, and close via `apply_patch`; no `_atomic_write` left in the code (grep) |
| R2 helper | pass | the one dir loop is `enginesrc.engine_source_stat`, called by `compute_multi_etag` and `engine_fingerprint` |
| R3 children | pass | 9 set done, each with a sha comment; POLY-49 row 1 ticked; live `cairn check` → ok |
| R4 sentence | pass | TRACKER.md Write-back contains the ruling's blockquote verbatim (exact line match) |
| Facade | pass | all 6 new public names are in `cairn.__all__` and resolve; `_atomic_write` is gone from both; no duplicate names in `__all__` |
| qa full run | pending | no qa commit after 5a8c907 on origin when this verdict was written |

Non-blocking nits (fix with row 3 or drop):
- the `engine_fingerprint` docstring says "exactly one glob per call", but `engine_source_stat` globs again (two)
- R2 also named `engine_is_stale`'s file shortcut and multiroot's file branch for `engine_source_stat`; both still stat inline (not loops, so the AC holds)
- stale `_atomic_write` mentions in test comments (`test_frontmatter_rewrite.py:470,475,510`)

Re-verdict needs: row 3 red under its mutation, green without it, and qa's full run.

### @architect — 2026-09-27

Gate-4 re-verdict on 6c4370f: **approve**. Delta against the verdict @ 7cd5b26:

| Axis | Result | Evidence |
|---|---|---|
| Checklist row 3 (drop `endswith(eol)`) | pass | scratch copy: `test_missing_trailing_eol...` green without the mutation, red under it (1 failure) |
| qa full run | pass | 1951/1951 on 5a8c907 and at 6c4370f (qa, commit message of 6c4370f) |
| `cairnlib/watch.py` hunk in 6c4370f | pass, docstring only | the `ast.dump` of watch.py @ 5a8c907 vs @ 6c4370f is identical once docstrings are stripped; the verified-code sha for head-match is 6c4370f |
| every other axis | pass, unchanged | the verdict @ 7cd5b26; 6c4370f touches only a test file and one docstring (row 6 re-confirmed: `records.py` is untouched since 3e2ec7b) |

One nit is still open and not blocking: `engine_is_stale`'s file shortcut and multiroot's file branch still stat inline instead of calling `engine_source_stat` (R2's wording). Neither is a loop, so the AC holds. Drop it, or fold it into the next cairn umbrella.

### @team-lead — 2026-09-27

PR opened: https://github.com/richmosko/polycarpic/pull/30. Awaiting Validate.

### @team-lead — 2026-09-27

Validate passed; merging via PR #30. Closing.
