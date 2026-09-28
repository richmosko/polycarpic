# POLY-60 — gate-1 ruling (architect, 2026-09-27)

Measured against `989944f`. Each claim cites its measurement, or is tagged `(unmeasured)`.

## M — measurements

Harness: a scratch script (not committed) builds a data dir holding a fully-CRLF issue with trailing spaces and a tab
(`body line  \r\n`, `- [ ] a  \r\n`, `- [ ] b\t\r\n`, one comment `old  \r\n`; 308 bytes, 27 CRLF). It runs each path via
`scripts/cairn/cairn --data-dir <scratch> ...` and diffs before/after bytes with `difflib.SequenceMatcher`. An LF copy of
the same fixture is the control.

| # | Path | Command | CRLF fixture result | LF control |
|---|---|---|---|---|
| M1 | set | `cairn set POLY-901 priority=P2` | rc 0; 308→281 bytes; CRLF 27→**0** (frontmatter **and** body); trailing whitespace kept | 2 bytes differ (`3→2`, `6→7` in `updated`) |
| M2 | comment | `cairn comment POLY-902 --author arch --body hi` | rc 0; 308→311; CRLF 27→**0**; the new block is LF | `updated` byte + an appended tail only |
| M3 | check-item | `cairn check-item POLY-903 1` | **rc 1**, `file must start with a '---' frontmatter delimiter`; 0 bytes written | exactly 1 byte (` `→`x`) |
| M4 | close | `apply_patch(p, {status: done, ratio: 1.0})`, the only issue-file write in `estimate.cmd_close` (`estimate.py:588`); the full CLI needs the metrics mount | rc 0; CRLF 27→**0** | — |
| M5 | archive | `cairn archive --done-before 2026-12-31` | rc 0; the file moves to `archive/issues/`; **0 bytes differ** (rename only, `_git_mv_or_rename`) | — |
| M6 | cause | `records.py` | `apply_patch`/`append_comment` use `read_text` (universal newlines) and write through `_atomic_write` (text mode, emits `\n`). `check-item` decodes raw bytes, so the fence line is `---\r` ≠ `---`. `flow.py:300` also parses `cat-file` bytes decoded raw: it is a **reader** that refuses CRLF the same way. | |
| M7 | children | `git log -S`/`--grep` + a read of the current code | All 8, **plus POLY-9**, are shipped on `main` (table R3) | |
| M8 | dir-stat | `multiroot.py:287-297` vs `watch.py:199-216,248` | The same `sorted(glob("*.py"))` → max `st_mtime_ns`, sum `st_size` loop appears twice, plus the file branch. `watch` imports `multiroot`, so `multiroot` cannot import `watch` | |

## R1 — Seam: bytes in, bytes out

**Edited span, per path** (the tests assert that every byte outside it is identical):
`set` / `close` = the frontmatter block, fence to fence. `comment` = the frontmatter block, plus bytes appended after the old EOF.
`check-item` = one byte. `archive` = none (a path change only).

- **Fence rule, one place:** `parse_frontmatter` treats a line as a fence iff it is `---` or `---\r` (lines split on `\n`).
  It strips a trailing `\r` from each frontmatter line before `parse_yaml_subset`, and returns `body` **unchanged**
  (the `\r`s are kept). Signature unchanged, so every read-only caller (`parse_issue`, lint, store, archive, estimate,
  `flow.py:300`) becomes CRLF-tolerant with no edit.
- **New in `cairnlib/records.py`:**
  `RawRecord(NamedTuple): raw: bytes, eol: bytes, body_start: int, frontmatter: dict, mtime_ns: int`.
  `read_record(path) -> RawRecord`: stat → `read_bytes` → utf-8 decode → `parse_frontmatter`, then
  `body_start = len(raw) - len(body.encode())`. `eol` is `b"\r\n"` if the opening fence line ends in `\r\n`, else `b"\n"`.
  `write_record(path, data: bytes, expect_mtime_ns: int | None = None) -> None`: the current `_atomic_write_bytes`,
  plus an optional re-stat guard.
  `emit_frontmatter(fields, eol) -> bytes` = `dump_frontmatter(fields)` with `\n`→`eol`, encoded.
- **Every writer goes through it.** `apply_patch`: `emit_frontmatter(new_fm, r.eol) + r.raw[r.body_start:]`.
  `append_comment`: the separator logic runs on the raw tail using `eol` / `eol*2`. The block (heading and body text)
  is built with `\n` and converted to `eol`, and the old bytes are kept as a prefix, untouched.
  `cmd_check_item`: `read_record` + `write_record(..., expect_mtime_ns=r.mtime_ns)`, replacing its inline decode/offset/stat.
  `close` and the server inherit through `apply_patch`/`append_comment`.
- **Delete the text-mode `_atomic_write`.** `records.py` is its only caller (grep). One writer means no path can drift back.
- Mixed-EOL file: re-emitted frontmatter takes the opening fence's EOL; body bytes are never touched. A BOM or non-utf-8
  file is refused as today `(unmeasured, out of scope)`. `dump_frontmatter` re-canonicalising a hand-quoted key is inside
  the edited span, not a regression.

## R2 — Dir-stat helper

New leaf module **`cairnlib/enginesrc.py`** (no cairnlib imports). It sits below `multiroot` and `watch`, so it adds no back-edge.
`engine_source_files(path: Path) -> List[Path]`: sorted `*.py` for a directory, `[path]` for a file.
`engine_source_stat(path: Path) -> Tuple[int, int]`: `(max st_mtime_ns, sum st_size)` over those files; `(0, 0)` if empty;
raises `OSError`, so callers keep their own handling.
`compute_multi_etag` folds `engine_source_stat`. `engine_fingerprint` iterates `engine_source_files` for the sha and takes
mtime/size from `engine_source_stat`. `engine_is_stale`'s file shortcut uses `engine_source_stat`.
The `cairn.py` facade re-exports the module, and `tests/INTERFACE.md`'s module list gains it.

## R3 — The old-style children: all shipped; flip to done

| Child | Parent | Resolved by |
|---|---|---|
| POLY-7 | 49 | `7b22b32` (PATH-shim 3d + 3a skip tests, `test_ensure_metrics_worktree.py:295,343,406,441`) |
| POLY-8 | 48 | `a428df5` (`t.skip` when `dashboard/node_modules` is absent + independence test) |
| POLY-15 | 48 | `ba0a246` (AC1 rate), `d5d90a1` + POLY-48 ruling (a) (null posture stated; `test_estimation.py:1642`) |
| POLY-25 | 49 | `b5a1f86` (env → `$CLAUDE_CONFIG_DIR/settings.json` → 4318; `_default_user_settings_path`) |
| POLY-27 | 49 | `b5a1f86` (recreate guarded on the parent existing; red `7b22b32`) |
| POLY-33 | 48 | `b9a2ed9` (`guards.py:155` keys on `actual.gate_cycles`) |
| POLY-40 | 48 | `a428df5` (`test_frontmatter_rewrite.py:35` derives from `ISSUE_FIELD_ORDER`) |
| POLY-47 | 48 | `d1f2e08` + `41fe68e` (the ceiling admits the first flush after the commit) |
| POLY-9 (not linted: it has a body; same staleness) | 49 | `affd63d` (hint text) + TRACKER.md Path ownership (`:433`) |

The lead, in this PR: per child, `cairn set <id> status=done`, plus one `cairn comment` naming its sha(s) from this table.
Then `cairn check-item POLY-49 1 --text "POLY-7, POLY-9, POLY-25, POLY-27 acceptance criteria met and closed by this PR"`.
POLY-48 has no checklist row, so there is nothing to tick. **No archive in this PR**: the only live selector,
`archive --done-before`, would sweep unrelated done issues. They ride the next routine sweep together with POLY-48/49.
Titles are not rewritten: the lint scope excludes `done`, and a closed record keeps its history.

## R4 — TRACKER.md (Write-back, replaces the `:579` sentence)

> Writes are bytes in, bytes out. `set`, board edits and `close` rewrite only the frontmatter block, re-emitted in canonical key order with the file's own line ending (the opening fence's: CRLF or LF). Every byte after the closing `---` is kept exactly as read, CRLF and trailing whitespace included. A comment append also changes `updated` and adds bytes after the old end of file, in the file's line ending. `check-item` changes exactly one byte. `archive` moves the file without changing a byte. Writes go to a temp file in the same directory followed by `os.replace` — atomic, so a crashed write can't truncate an issue.

`tests/INTERFACE.md`: update the `parse_frontmatter`, `apply_patch` and `append_comment` lines, and add `read_record` / `write_record` / `emit_frontmatter`.

## Review checklist — one named mutation per test

| Test (CRLF + trailing-whitespace fixture unless noted) | Mutation that must turn it red |
|---|---|
| `set`: bytes after `body_start` identical; the frontmatter stays CRLF | `apply_patch` reads with `read_text` again |
| `comment`: the old bytes are an exact prefix (bar `updated`); the new block uses CRLF | build the block with a literal `\n` (no `eol` conversion) |
| `comment` on a file with no final EOL: one `eol` is added and nothing earlier changes | drop the `endswith(eol)` check |
| `check-item` on a fully-CRLF file: rc 0, exactly 1 byte differs | revert the fence rule to `== "---"` |
| `check-item` stale mtime is still refused (via `write_record`) | pass `expect_mtime_ns=None` |
| `close` (the `apply_patch` seam, `status/ratio` patch): body identical | `emit_frontmatter` ignores `eol` |
| `archive`: the archived file's bytes == the pre-archive bytes | archive re-emits through `apply_patch` |
| `parse_frontmatter` on CRLF: frontmatter values have no `\r`; `body` keeps its `\r` | strip `\r` from the body too |
| mixed EOL (CRLF fence, LF body): body identical | derive `eol` by majority/`os.linesep` |
| no text-mode writer left in `records.py` (grep test) | reintroduce `_atomic_write` |
| `engine_source_stat` dir and file cases; `compute_multi_etag` changes when a `.py` in the dir is touched | sum mtimes instead of max / drop the helper call |
| `cairn check` on the live tracker: 0 title/description warnings | leave one child at `backlog` |
