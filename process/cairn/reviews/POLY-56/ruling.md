# POLY-56 — gate-1 ruling (architect, 2026-09-26)

Measured against `5d3a11c`. Each claim cites its measurement, or is tagged `(unmeasured)`.

## M — measurements

| # | Command / read | Result |
|---|---|---|
| M1 | `board.js:1175-1176` | Card renders one chip, class `subissues`, text `done/total`, only when `childProgress(...).total > 0`. No checklist signal on cards today. |
| M2 | `cairn.py` `build_board_payload` → `_stamped` | `/api/board` issues carry **frontmatter only**, no `description`. A client-side card count is impossible without shipping every body. |
| M3 | `board.js:1776-1792` `splitAcceptanceCriteria` | The only checklist parser; lives in `board.js`, not `board-logic.js`, so no JS test reaches it. Scope: every line after the first `## Acceptance criteria` heading in the pre-Comments description; regex `^- \[( \|x\|X)\]\s*(.*)$`, column 0 only. |
| M4 | `apply_patch` on a CRLF fixture (scratch) | Output body was LF: `b'body  \r\n- [ ] a \r\n'` → `b'body  \n- [ ] a \n'`. `read_text` universal-newline translation. **TRACKER.md's "body byte-for-byte" claim is false today for CRLF files** (trailing spaces survive). Out of scope here — see Bubble-up. |
| M5 | lint dry-run over `process/cairn/issues/` (71 live issues) | All statuses: 24 titles > 70 chars, 56 empty descriptions. Open issues only (status ∉ done/cancelled): **8 long, 8 empty** — all eight are the same children of POLY-48/POLY-49. |
| M6 | `_claim_issue_file` | Writes `dump_frontmatter(fields) + "\n"` in the one `O_EXCL` write. A body can ride that write; no second rewrite needed. |

## R1 — Badge: distinct, not unified

- Units differ: a sub-issue has its own status and owner; a checklist row is a line of text. Adding them up would let "3/3" hide a sub-issue that isn't done.
- New chip `chip("checklist", "☑ " + done + "/" + total)`, placed right after the `subissues` chip. Shown only when `total > 0`. Uses the base outline chip; **no new palette token** (design work is out of scope here).
- **One parser, in Python.** New `cairn.checklist_items(description) -> [{ordinal, text, checked, line}]`, where `ordinal` is 1-based and `line` is the index within the description. `build_board_payload` stamps `issue["checklist"] = {"done": k, "total": n}` on every issue. `build_issue_payload` stamps `issue["checklist_items"] = [{ordinal, text, checked}]`.
- The drawer renders `issue.checklist_items`. `splitAcceptanceCriteria` keeps only its description cut; it moves to `board-logic.js` and its `items` output is deleted. Result: two parsers become one.
- Parser semantics (unchanged from M3 except where noted): scope is after the first `^##\s*Acceptance criteria\s*$` in the pre-`## Comments` description. Item = `^- \[( |x|X)\] ?(.*?)\r?$`, column 0. Indented (nested) items are **not** counted. `[X]` counts as checked. Items under `## Comments` are never seen (`split_comments` has already cut them off). No fence exception, the same rule `split_comments` follows. Text is stripped of the trailing `\r`.
- Cost: `_stamped` for issues now reads the whole file, not just the frontmatter `(unmeasured)`. With 71 files this is negligible. It does not gate the build.

## R2 — Write-back: build the CLI, re-defer the board

- **Build `cairn check-item <ID> <ordinal> [--uncheck]`.** qa's verdict uses it, and it stays inside the commit-by-pathspec discipline. The **board checkbox stays `disabled`.** Board write-back is re-deferred: it adds the stale-tab risk (TRACKER.md → Write-back's twenty-minute-old tab) on top of the rewrite risk, and nothing needs it yet.
- **Line identity.** The ordinal addresses the k-th item from `checklist_items` over a **fresh read inside the command**, never an index cached across processes. The command prints `<ID> #<k> [x] <text>` so the caller can see which line it hit. `--text <exact>` is optional. When given, the command refuses (exit 1, no write) unless the stripped item text equals it. That flag is the text+ordinal anchor for scripted callers.
- **Rewrite = one byte.** Read with `read_bytes()`. Locate the target line's byte offset through the same line split (`b"\n"`). The line keeps its `\r`. Replace the single byte between `[` and `]`: `' '`→`'x'`, or on `--uncheck`, `'x'/'X'`→`' '`. Write through a binary sibling of `_atomic_write` (same temp + `os.replace` + mode preservation). **`updated` is not bumped and the frontmatter is not re-emitted.** Guarantee: output length == input length, and exactly one byte differs. If the item is already in the requested state, the command writes nothing, prints the same line, and exits 0.
- **Conflict story.** *Same checkout:* capture `st_mtime_ns` at read and re-stat just before `os.replace`. On a mismatch, refuse with exit 1 and no write (the same `seen` contract the board uses). *Another worktree:* that worktree has its own copy of the file. The two edits meet at `git pull --rebase`/merge as an ordinary one-line conflict. Git surfaces it and nothing is silently lost. Nothing new is needed.
- Errors, each with exit 1 and no write: unknown id, ordinal < 1 or > n, no Acceptance-criteria section, archived issue (read-only, as on the board).
- TRACKER.md: the Deferred-work row is rewritten to *"CLI tick built (POLY-56, ruled 2026-09-26): `cairn check-item` changes exactly one byte, mtime-guarded. Board write-back stays deferred: a stale board tab plus a mid-file rewrite is two risks for no current consumer. Revisit when a human needs to tick from the board."* Add a CLI table row for `check-item`.

## R3 — `cairn new` body seeding and `cairn check` lint

- **Seam:** `_claim_issue_file(..., body: str = "")` → `content = dump_frontmatter(full) + "\n" + body`, in the same `O_EXCL` write (M6). `allocate_and_create_issue` passes it through.
- `cairn new --body <text|->`, where `-` reads stdin. If `--body` is absent, the seeded skeleton is exactly `"\n## Acceptance criteria\n\n- [ ] \n"`. The empty description then draws the check warning until someone fills it.
- `cairn new` warns on stderr and still creates the issue, exit 0: `warning: title is <n> chars (cap 70) -- short label in the title, substance in the body`.
- `cairn check` → new warnings in `check_budgets` (warn, never fail). **Scope: live `issues/` with status ∉ {done, cancelled} and no `stage:` field.** Per M5 this yields 16 warnings instead of 80. Warning texts:
  - `<file>: title is <n> chars (cap 70) -- short label in the title, substance in the body`
  - `<file>: empty description -- a paragraph before '## Acceptance criteria' says what and why`
  - "Empty" means the pre-Comments description, cut at the AC heading, is whitespace only.
- Constant: `TITLE_CHAR_CAP = 70`, next to `COMMENT_LINE_CAP`.

## R4 — Drawer children as checkbox rows

`issueLinkListEl(kids, { checklist: true })` prefixes each row with a disabled checkbox, `checked = status === "done"`. The link and status annotation stay as they are. "Blocked by" and "Blocks" do not pass the option.

## Review checklist — each test has one named mutation it must catch

| Test | Mutation that must turn it red |
|---|---|
| parser counts column-0 items only | accept leading whitespace in the item regex |
| `[X]` is checked | lowercase-only `x` match |
| items after `## Comments` ignored | parse `body` instead of the `split_comments` pre-half |
| items before the AC heading ignored | drop the heading scan |
| CRLF item text has no `\r` | remove the `\r?` strip |
| board payload `checklist` counts | count `total` as done |
| card chip absent when total = 0 | drop the `total > 0` guard |
| card chip distinct class | reuse the `subissues` class |
| drawer renders `checklist_items` | restore the client-side `items` parse |
| child row checked iff done | treat `cancelled` as checked |
| check-item one-byte diff on a CRLF + trailing-whitespace fixture | route the write through `_atomic_write` (text mode) |
| check-item leaves `updated` alone | call `apply_patch` |
| check-item `--uncheck` | always write `'x'` |
| check-item idempotent no-write | always rewrite (the mtime changes) |
| check-item stale mtime refused | skip the re-stat |
| check-item `--text` mismatch refused | ignore `--text` |
| check-item ordinal out of range, and archived issue | clamp the ordinal / resolve archive paths as writable |
| `new --body -` round-trip, and default skeleton | drop the body from the `O_EXCL` write |
| `new` title warning at 71, silent at 70 | `>=` instead of `>` |
| check title/empty-desc warnings | lint done issues too (count rises) / exempt nothing for `stage:` |
