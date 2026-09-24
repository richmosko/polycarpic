---
id: POLY-2
title: Path-ownership push check for concurrent writers
status: in-review
milestone: POLY-A
parent: null
blocked_by: [POLY-1]
assignee: null
labels: [workflow, cairn]
priority: P1
pr: https://github.com/richmosko/polycarpic/pull/6
created: 2026-09-23
updated: 2026-09-23
---


Worktree isolation guarantees one writer per checkout, but several agents push
to the same feature branch. Kickoff decision: `docs/project_kickoff.md` § 2.1
→ *One writer per file*: each cairn sub-issue declares the paths its agent may
touch, and a push-time check compares the agent's commits against the declared
paths and fails loudly on a stray file. Depends on POLY-1: the check attributes
commits by git author identity.

## Acceptance criteria

- [ ] `process/TRACKER.md` frontmatter schema gains an optional `paths:` list (glob patterns, repo-relative) on issues; `cairn check` validates it and `cairn new --paths` / `cairn set <ID> paths=…` write it
- [ ] `cairn guard-push <ID>` lists the files changed by commits authored by the sub-issue's assignee between the branch base and HEAD, and exits non-zero naming every file outside the declared globs
- [ ] A sub-issue with no `paths:` field passes with a warning, not a failure (opt-in, not a hard gate for existing flows)
- [ ] The shared worktree-protocol block runs `cairn guard-push` before `git push` and the push is skipped on failure
- [ ] Unit tests in `scripts/cairn/tests/` cover: in-bounds commit, stray file, no `paths:` declared, glob semantics (`src/auth/**`)
- [ ] The board's issue drawer shows the declared paths on a sub-issue

## Comments

### @team-lead — 2026-09-23

Feature started. Branch: `feature/poly-2-path-ownership-push-check`. Roster: implementation-lead + qa-engineer; architect reviews at gate 3.

### @architect — 2026-09-23

**Gate-1 ruling — POLY-2.** Seams and thresholds are fixed here. Nothing is left to propose by message.

1. **Branch base.** `base = git merge-base <main-ref> HEAD`, where `<main-ref>` is `origin/main` if it resolves and local `main` otherwise. If neither resolves: exit 2. Range = `base..HEAD`, run with `--no-merges`, so files that arrive when main is merged in never count. Why: the fork point is the only anchor that stays correct after `main` is merged into the feature branch, and local `main` goes stale in worktrees. Rejected: diffing against `origin/<feature-branch>`. It checks only this push, so a stray file already pushed passes on the next run.
2. **Glob matcher.** Use a hand-rolled glob→regex translator in cairn.py, stdlib only. Do not use `fnmatch` or `PurePath.full_match`: `full_match` needs Python 3.13+, and cairn has no stated version floor. Semantics: patterns are repo-relative and use `/` separators. `**` as a whole segment matches zero or more segments. `*` matches within one segment and never crosses `/`. `?` matches one non-`/` char. Every other char is literal (no `[...]` classes). Dotfiles are not special. `src/auth/**` matches `src/auth/a.py` and `src/auth/x/y.py`. It does not match `src/authz/a.py`. A pattern with no wildcards matches exactly one path.
3. **Attribution.** File list = `git log --no-merges --no-renames --format=%an --name-only base..HEAD`. Keep the commits whose author name equals the issue's `assignee` exactly (per-agent `user.name`, POLY-1). `--no-renames` lists both sides of a rename. Deletions count as touches. Cases:
   - no `paths:` → warn on stderr, exit 0;
   - `paths:` set and `assignee: null` → exit 2 ("cannot attribute");
   - `@handle` (human) assignee → warn, exit 0 (humans are not under the protocol);
   - assignee has zero commits in range → exit 0.
   The guard keys on the *issue's* assignee, not on the invoking identity. So running it from the lead's main checkout is a valid audit of that agent's commits. The lead's own commits are never checked. Exit codes: 0 pass, 1 stray files (every offending path listed, sorted, one per line), 2 usage/config error (unknown ID, unresolvable base, null assignee).
4. **`paths:` field.** Optional `list[string]`. Add it as a row in TRACKER.md → issue frontmatter table, directly after `assignee`. An absent key means undeclared, which is not the same as `[]`: an explicit `[]` means "may touch nothing". Add it to `LIST_FIELDS` so `--paths a,b` and `paths=a,b` share `_split_csv`. `cairn check` validates **shape only, never existence** (a feature creates its own files). Each entry must be a non-empty string with no leading `/`, no `..` segment, no `\`, and no `**` fused to other chars (`a**b`). Add `guard-push` to the CLI table.
5. **Protocol-block placement.** Replace the "On completion" sentence in the shared block, byte-identical across all ten files: "On completion: if your assignment names a cairn sub-issue, run `scripts/cairn/cairn guard-push <ID>` first — on a non-zero exit do not push; report the listed files to the lead — then `git push origin HEAD:<feature-branch>` (fast-forward only — never `--force`), then report the sha…". qa adds a sixth required element (`guard-push` precedes `git push`) to `test_agent_worktree_protocol_block.py`. The existing push/fast-forward regex still matches.

Board drawer: render `paths` as a monospace list under assignee, and hide it when absent. Ownership for this loop: implementation-lead owns `scripts/cairn/**` minus `tests/`, `process/TRACKER.md`, `.claude/agents/*.md`. qa-engineer owns `scripts/cairn/tests/**`.

### @qa-engineer — 2026-09-23

Red gate @ bb13b28 (scripts/cairn/tests/test_guard_push.py, test_paths_field.py, test_agent_worktree_protocol_block.py). Ownership per ruling: qa owns scripts/cairn/tests/**.

Covers AC5 (in-bounds commit, stray file, no paths: declared warn+pass, glob semantics src/auth/**) plus ruling item 3 edge cases (null-assignee exit 2, @handle warn+pass, zero-commits pass, unknown id exit 2, deletion/rename attribution) and item 1 (merge-base excludes files merged in from main). paths: shape lint (cairn check) and cairn new --paths / cairn set paths= covered per item 4. Worktree-protocol block gains a 6th required element (guard-push precedes the push step) per item 5.

Run: `cd scripts/cairn && python3 run_tests.py -p test_guard_push.py -p test_paths_field.py -p test_agent_worktree_protocol_block.py` -- 21 failures, 0 errors, all failing for the expected reason (no guard-push subcommand; no paths validation/CLI support; block missing the 6th element). implementation-lead: green gate is yours.

### @implementation-lead — 2026-09-23

Green-gate sha: 7b1974c (paths: field + cairn guard-push, per gate-1 ruling
226865e). Tiered runs (no untiered full suite):

- test_guard_push.py: 14/14 pass (in-bounds, stray, no-paths warn, glob
  semantics, null/human/zero-commit/unknown-id, rename+deletion attribution).
- test_paths_field.py: 11/12 pass. 1 fail:
  test_an_empty_string_entry_is_an_error uses `[src/auth/**, ]` expecting an
  empty-string list entry; this repo's YAML flow-list parser elides a
  trailing comma (standard YAML trailing-comma tolerance, same as
  labels/blocked_by already get) rather than emitting `""`, so no empty
  entry ever reaches validate_path_glob. Looks like a test-construction
  issue, not a validator gap -- flagging for qa rather than editing tests/.
- test_check_lint.py (67), test_set_records.py/test_migrate_lifecycle_status.py/test_cli.py
  (86 combined): all pass -- no regressions from ISSUE_FIELD_ORDER/LIST_FIELDS gaining `paths`.
- test_frontmatter_rewrite.py: 3 pre-existing failures (DumpFrontmatterTests,
  PT13 milestone-field-order test, UnknownFrontmatterKeyPreservation)
  compare dump_frontmatter's output against cairn.ISSUE_FIELD_ORDER using
  fixture dicts that predate `paths` -- they omit the key, so the emitted
  order is one field short of the (correctly updated) constant. Needs a
  one-line fixture addition per test; out of my ownership (tests/).

Board drawer / dist rebuild, TRACKER.md schema row, and the ten
.claude/agents/*.md protocol-block edits are excluded from my ownership
this loop per team-lead's message -- not attempted here.

### @implementation-lead — 2026-09-23

Green-gate sha: efd4e4f. AC1 (TRACKER.md schema row + Path ownership
section + CLI table entry), AC4 (guard-push in all ten agents' protocol
block + WORKFLOW.md), AC6 (board.js drawer: read-only monospace Paths
list under assignee, hidden when absent) all landed.

`run_tests.py -p 'test_guard_push*' -p 'test_paths_field*' -p
'test_frontmatter_rewrite*' -p 'test_agent_worktree_protocol_block*'`:
68/68 pass. `cairn check`: ok. check_docs (TRACKER.md/WORKFLOW.md
instruction-phrase + sentence-cap lint): clean. `node --test` over
scripts/cairn/tests/js/: 477/479 (2 pre-existing failures, missing
dashboard/node_modules/layerchart -- unrelated to this change).

No dashboard/dist rebuild: board.js is served unbundled from
scripts/cairn/board/ (BOARD_DIR), a different subtree than
check_dist_freshness.py's scripts/cairn/dashboard/ watch list -- nothing
there needed touching for AC6.

### @architect — 2026-09-23

**Gate-4 verdict — POLY-2 @ 6f98f8f: CHANGES-REQUESTED** (two small defects; everything else conforms to the ruling @ 226865e).

| Axis | Result | Evidence |
|---|---|---|
| Base (§1) | ✅ origin/main → main → exit 2; merge-base; `--no-merges` | cairn.py `_resolve_push_base_ref`, `cmd_guard_push` @ 7b1974c |
| Attribution (§3) | ✅ exact `%an` == assignee; `--no-renames`; null-assignee exit 2; `@handle` exit 0. The `%x01` delimiter is a sound deviation (it is documented) | `_files_touched_by_author` @ 7b1974c |
| Exit codes (§3) | ⚠ 1 is overloaded. See defect B | — |
| Glob matcher (§2) | ⚠ 14/15 probe cases correct. `**/**` fails. See defect A | probe: `python3 -c` over `_glob_to_regex`, 15 (pattern, path) pairs |
| `paths:` field + lint (§4) | ✅ row after `assignee`; shape-only; absent ≠ `[]`; `LIST_FIELDS` shared | TRACKER.md, `validate_path_glob` @ 0251300 / 7b1974c |
| Protocol block (§5) | ✅ wording is as ruled; byte-identity plus the sixth-element test pass | agents/*.md @ fa0b554, 68/68 per lead |
| TRACKER "Path ownership" / WORKFLOW | ✅ faithful to the ruling | @ 0251300 |
| Drawer | ✅ read-only list under assignee; hidden when absent; `[]` renders "(may touch nothing)" | board.js @ efd4e4f |

**Defect A — consecutive `**` segments.** `_glob_to_regex("**/**")` compiles to `^(?:.*/)?(?:/.*)?$`. That regex matches neither `x` nor `a/b`, yet `validate_path_glob("**/**")` passes. So a lint-clean pattern silently denies every file. Fix: collapse runs of consecutive `**` segments to one before translating (`a/**/**/b` ≡ `a/**/b`, `**/**` ≡ `**`). qa: add a regression case (`**/**` matches `x` and `a/b`).

**Defect B — malformed `paths:` exits 1.** `cmd_guard_push` never validates `paths_val`:
- A scalar (`paths: src/**`) is iterated character by character. Every file then reports as stray, exit 1.
- A non-string entry raises a traceback. Python also exits 1.

Both are indistinguishable from "stray files". Fix: if `paths_val` is not a list, or any entry fails `validate_path_glob`, print the reason and exit 2 (config error, per §3). The matchers are built only after that check. qa: add a regression test covering scalar `paths:` and an int entry → exit 2.

Non-blocking, no change needed: `src/auth/**` also matches `src/auth` itself (zero segments). This is harmless, and the ruling allows it.

Re-review delta after the fix: `cairn.py` (`_glob_to_regex`, `cmd_guard_push`) plus the two new tests only.

### @implementation-lead — 2026-09-23

Fix sha: dc3b393, addressing architect's gate-4 verdict @ c311ae7.
Defect A: consecutive ** segments collapse to one before translation
(_glob_to_regex). Defect B: cmd_guard_push validates paths_val via
validate_path_glob before building matchers; scalar/non-string entries
now exit 2, never 1. Verified: **/** matches x and a/b; a/**/**/b
matches a/b and a/x/y/b; scalar paths: and an int entry both exit 2 with
a named reason (manual scratch-repo repro, no qa regression tests on
origin yet as of this commit). test_guard_push.py + test_paths_field.py:
26/26 still pass.

### @architect — 2026-09-23

**Gate-4 re-review — POLY-2 @ 9d8fe71: APPROVE.** Delta c311ae7..9d8fe71 only.

| Axis | Result | Evidence |
|---|---|---|
| Defect A (consecutive `**`) | ✅ collapsed before translation; `a/**/**/b` ≡ `a/**/b` | `_glob_to_regex` @ dc3b393 |
| Defect B (malformed `paths:`) | ✅ non-list or invalid entry → exit 2; checked before the null-assignee check and before any matcher is built | `cmd_guard_push` @ dc3b393 |
| Regression tests | ✅ 3 tests, red against c311ae7; 71/71 | 9d8fe71, per lead |

**Scope ruling: unquoted `*`-leading entries.** This goes to a follow-up backlog issue (P3), not into POLY-2. Measured: `dump_frontmatter` on `paths: ['**/**', '*.py', 'src/**']` emits `["**/**", "*.py", src/**]`, and `parse_frontmatter` reads back the same list. So every write path cairn owns (`cairn new --paths`, `cairn set paths=`, the board) round-trips, and AC1 is met. The failure only occurs when a person types an unquoted `*` entry into the file by hand. Even then it fails loudly: `cairn check` and `guard-push` both raise the YamlError, so it never becomes a silent pass. Scope of the follow-up:
- when the anchor/alias rejection hits a value starting with `*`, add a hint: "quote it — `\"*.py\"`";
- document the quoting rule on the TRACKER.md `paths` row.

Do not add a parser exception. The YAML subset stays a strict subset of YAML, and an unquoted `*x` really is an alias in YAML.

### @qa-engineer — 2026-09-23

**Verdict gate -- PASS @ 6863a4e** (code: dc3b393 + 9d8fe71; tracker-only: 8c41351, POLY-9 backlog).

Python: `run_tests.py --gate verdict` (full suite, no -p) -- 1707 tests, 0 failures, 0 errors, 4 skipped.
JS: `node --test "tests/js/**/*.test.js"` -- 479 tests, 477 pass, 2 fail. Both failures are pre-existing and unrelated (dashboard/node_modules/layerchart missing -- ENOENT on package.json and BarChart.base.svelte), matching implementation-lead's own green-gate comment on this same baseline. No POLY-2 code touches the JS suite.

Sign-off: acceptance criteria all covered by scripts/cairn/tests/test_guard_push.py, test_paths_field.py, test_agent_worktree_protocol_block.py, test_frontmatter_rewrite.py -- green against 6863a4e. Ready for /finish-feature.

### @team-lead — 2026-09-23

PR opened: https://github.com/richmosko/polycarpic/pull/6. Finish gate at 632e573: 1707 py / 0 failures / 4 skipped; JS 477/479 (POLY-8 gap, identical on main); `cairn gate --head 6863a4e` PASS. Awaiting merge call (delivery autonomy: stop-at-merge).
