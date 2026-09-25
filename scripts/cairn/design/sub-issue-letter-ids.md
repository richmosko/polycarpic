# POLY-51 — sub-issue letter ids (gate-1 ruling)

Architect, 2026-09-25. Base: `ac6383a`. Sub-issues: POLY-52 (plan, architect),
POLY-53 (execute, qa-engineer), POLY-54 (execute, implementation-lead),
POLY-55 (review, architect).

## 0. Measurements

- `grep -nE 're\.compile|re\.match|\\d\+' scripts/cairn/cairn.py` + the same over
  `scripts/**/*.{py,js,sh}` and `.claude/hooks`: **9 id-shape sites** in total
  — 6 in `cairn.py` (L160 `_issue_id_re`, L227 `ID_RE`, L1206 allocator,
  L1708 parent lint, L1854 `_ID_SORT_RE`, L3563 inline token sort),
  1 in `board-logic.js` (L474 `ID_SORT_RE`), 2 branch-side
  (`backfill_tokens.py` L239 `_issue_regex`, L647 inline token sort;
  `check_feature_branch_invariant.py` L54 counted with them as the third
  branch-side site → 10 lines, 9 distinct concerns). `loop_stats.py` L189 and
  `backfill_tokens.py` L266 strip an agent-name `-N` suffix — not ids.
- Every other consumer compares ids by **string equality or filename lookup**,
  never by shape: `find_issue_path` / `find_record_path` (show/set/comment/
  close/estimate/guard-push), `check_repo` parent + blocked_by, `cmd_show`
  children (L5750), `_sibling_floor` (L6787 `row["parent"]`, `row["id"]`),
  `cmd_estimate` (parent+stage+assignee from frontmatter), `cmd_close` token
  window (keyed on `parent` = the branch issue), `gate_cycle_actuals`
  (assignee + time window), `milestone_windows` (git refs), board
  `childRecords`/`childKeyOf` (`repo::parent` string), board filters
  (status/milestone/assignee/label/repo — no id parsing).
- Live sub-issues before this loop: **37** numbered files carry `parent:`
  (`grep -l '^parent: POLY-' process/cairn/issues/*.md` = 41 after POLY-52..55
  were created). AC4's enumerated list is 26 of them; the no-rename rule
  covers all 37.

## 1. Patterns

| Name | Before | After | Role |
|---|---|---|---|
| `_issue_id_re(prefix)` | `^<P>-\d+$` | `^<P>-\d+[a-z]?$` | lint shape: an issue is either form |
| `ID_RE` | `^([A-Za-z][A-Za-z0-9]*)-(\d+)$` | **unchanged** | numeric-counter scan only; a suffixed stem deliberately fails it, so `POLY-26a` never moves the top-level counter (its number is its parent's, already counted) |
| new `_sub_issue_letter_re(parent)` | — | `^<re.escape(parent)>([a-z])$` | per-parent letter scan in the allocator |
| `_ID_SORT_RE` (py) / `ID_SORT_RE` (js) | `^(.*?)-(\d+)$` | `^(.*?)-(\d+)[a-z]?$` | sort key |

The key stays the 3-tuple `(prefix, n, full)`; only the regex widens. The
third element (full-string tiebreak) already orders `POLY-26` < `POLY-26a` <
`POLY-26b` (a string is less than its own extensions; `a` < `b`), and the
number orders `POLY-26b` < `POLY-27`. So both existing `idSortKey`/
`_id_sort_key` tests (`("mvp", -1, "mvp")`, `["mvp", -1, "mvp"]`) stay valid
unchanged — no tuple-shape change, no caller change (`compareByIdSortKey` and
the 7 Python callers read the same three slots).

Classifier: separation by the first character after `<P>-` still holds — a
digit is an issue (optional trailing lowercase letter, never a dot) or a
development milestone (dot); `M`/`V`+digit and capitals are unchanged. The
trailing `[a-z]` on an issue cannot collide with `M\d+[a-z]?` (first char `M`)
or `[A-Z][a-z]?` (first char a capital). Uppercase suffixes (`POLY-26A`) are
**not** admitted — lint errors, and the lowercase-only rule avoids
case-insensitive-filesystem collisions on macOS.

## 2. Allocator

In `allocate_and_create_issue` (the single funnel for `cmd_new` **and** the
HTTP `_create_issue`), branch on `fields.get("parent")`:

- **null** → today's numeric path, byte-for-byte unchanged.
- **non-null `X`** → letter path:
  1. Legacy-archive guard runs first (unchanged, both paths).
  2. `X` must resolve via `find_issue_path` (live **or** archived — archived
     parents are allowed only because refusing them adds a rule nobody asked
     for; `cairn check`'s dangling-parent lint already treats both as known).
     Unresolved → `CairnError("parent X: no such issue")`. Today `cairn new
     --parent BOGUS` succeeds and only `check` complains; this tightens it,
     because the id is now derived from the parent.
  3. **Depth 1 only:** error if `X`'s own frontmatter `parent` is non-null
     (covers both a suffixed `X` and a legacy numbered sub-issue such as
     POLY-28), or if `X` matches `<P>-\d+[a-z]$` — message
     `"parent X is itself a sub-issue -- sub-issues nest one level"`.
     Checked on the record, not only the shape, so legacy sub-issues are
     covered.
  4. Candidate letter = `max(letters)` + 1 over stems matching
     `_sub_issue_letter_re(X)` in **`issues/` and `archive/issues/`**; `a`
     when none. **No gap reuse**: `a`,`c` present → `d`.
  5. `O_CREAT|O_EXCL` loop exactly as the numeric path: `FileExistsError` →
     next letter. Past `z` (either from the scan or from races) →
     `CairnError("parent X has exhausted sub-issue letters a..z")`, nothing
     written. No fallback to a numeric id (silent fallback would reintroduce
     the mixed scheme for new records).
- The `fields["parent"]` value written is `X` verbatim.
- HTTP: every letter-path refusal is a `CairnError`, which `_create_issue`
  (L5246) already maps to a 400 — no new handler. The 400's error code may
  stay `legacy_archive` only for the legacy guard; the three new refusals use
  code `bad_parent` (the implementer distinguishes by a `CairnError`
  subclass or attribute — builder's choice).

`cairn set <id> parent=Y` stays unrestricted; lint catches the lie (§3 new rule).

## 3. Consumers

| Site | Change |
|---|---|
| `cairn.py` `_issue_id_re` L160 | widen (§1) → `check`, and everything reading `issue_re`, accept both forms |
| `cairn.py` `ID_RE` L227 / `_next_id_candidate` L1199 | none (comment: suffixed stems intentionally excluded) |
| `cairn.py` allocator L1206 | letter path (§2) + `_sub_issue_letter_re` helper |
| `cairn.py` `check_repo` parent block L1708 | **new rule**: a stem matching `<P>-(\d+)([a-z])$` must have `parent == <P>-\1` — error `"POLY-26a: suffixed id implies parent POLY-26, found <v>"`. Numbered sub-issues carry no such constraint. |
| `cairn.py` `_ID_SORT_RE` L1854 | widen (§1) → `ls`, `show` children, snapshot, cycle canonicalisation all sort correctly |
| `cairn.py` L3563 token `_issue_sort_key` | **untouched** (AC3) — the token-usage `issue` field is branch-derived, parent-only |
| `board-logic.js` `ID_SORT_RE` L474 | widen (§1) → card order, drawer children (`childrenOf`), blockers list |
| board `childRecords` / `childKeyOf` / `↳ parent` chip / drawer parent link / filters | none — string equality on `parent` |
| `backfill_tokens.py` `_issue_regex` L239, L647 | **untouched** (AC3). Note: `(?![\d.])` would bucket a hypothetical `feature/poly-26a-…` under POLY-26 — correct by accident; branches stay parent-only by rule. |
| `check_feature_branch_invariant.py` L54 | **untouched** (AC3) |
| show/set/comment/close/estimate/guard-push/loop-stats | none — filename lookup + string compare |

## 4. Coexistence and estimation

No rename (user decision). Both forms pass `_issue_id_re`; mixed children
under one parent are legal and sort numbered-first-then-lettered only within
the same number (e.g. POLY-51's legacy children POLY-52..55 sort after
POLY-51a..; that is correct numeric order). The estimation engine is
shape-blind: reference class = `(parent, stage, assignee)` read from
frontmatter; `_sibling_floor` matches `row.parent` and excludes `row.id` by
string equality; calibration records store `id` as an opaque string;
`gate_cycle_actuals` and the close token window key on assignee/time and the
parent's branch issue. A suffixed sub-issue's `parent` is always a top-level
numeric id (§2 depth rule), which is exactly the token-usage `issue` value —
so the join is unchanged.

## 5. TRACKER.md text (implementation-lead lands it)

- Milestone-ids regex block: `issue ^<P>-\d+[a-z]?$`; the separability sentence
  gains "(an issue may end in one lowercase letter — a sub-issue, see
  Sub-issues)".
- ID scheme § Format: append — "**Sub-issues** (POLY-51): `cairn new --parent
  PT-14` allocates `PT-14a`, `PT-14b`, … in creation order over `issues/` and
  `archive/issues/`; letters are never reused, `z` is the last (the 27th child
  is an error), and a sub-issue cannot itself be a parent. Top-level issues keep
  the numeric counter; suffixed ids never advance it. Sub-issues created before
  POLY-51 keep their numbered ids; both forms are valid."
- § Sub-issues: replace "children sort by ID" with "children sort by ID —
  numeric, then letter (`PT-14` < `PT-14a` < `PT-14b` < `PT-15`)"; add
  "`cairn check` errors when a suffixed id's `parent:` is not its own stem minus
  the letter."
- Frontmatter table `parent` row: "One level is expected" → "One level;
  `cairn new --parent` refuses a sub-issue as parent."
- CLI table `cairn check` cell: add "suffixed-id ↔ `parent` agreement".

## 6. Tests (qa, red first — POLY-53)

New, in `tests/test_id_allocation.py` (or a new `test_sub_issue_ids.py`):
1. `--parent PT-3` on a fresh repo → `PT-3a`, then `PT-3b`; file
   `issues/PT-3a.md`, `id:` and `parent:` correct.
2. Top-level `new` after `PT-3a` exists → `PT-4` (counter ignores suffixes).
3. No gap reuse: `PT-3a`, `PT-3c` pre-seeded → `PT-3d`; archived `PT-3b` only
   → `PT-3c`.
4. Exhaustion: `PT-3a..PT-3z` seeded → `CairnError`, no file written.
5. O_EXCL race: pre-create `PT-3b.md` after the scan (monkeypatch the scan) →
   `PT-3c`.
6. `--parent` on a suffixed id (`PT-3a`) → error; on a legacy numbered
   sub-issue (record with `parent:` set) → error; on a missing id → error.
7. `check`: mixed `PT-3`, `PT-3a`, `PT-5` (legacy sub-issue of PT-3) → clean;
   `PT-3A` → shape error; `PT-3a` with `parent: PT-4` → agreement error.
8. `ls` mixed-form order: `PT-2, PT-3, PT-3a, PT-3b, PT-10`.
9. `_id_sort_key` Python cases in `test_id_sort.py`: same list.
10. JS `tests/js/id-sort.test.js` (append): `["POLY-27","POLY-26b","POLY-26",
    "POLY-26a"]` → `["POLY-26","POLY-26a","POLY-26b","POLY-27"]`; plus
    `childrenOf` on a mixed child set.
11. HTTP create with `parent` set → letter id (one test through `_create_issue`).

Must pass **unchanged**: all of `test_id_allocation.py`, `test_id_sort.py`,
`tests/js/id-sort.test.js`, `test_check_lint.py`, `test_estimation.py`,
`test_guard_push.py`, `test_feature_branch_invariant.py`,
`test_backfill_tokens.py`, `tests/js/child-progress.test.js`.

Guard thresholds: 0 existing tests edited; ≤ 60 changed lines in `cairn.py`
excluding comments (unmeasured estimate); `board-logic.js` diff = the one regex
line (+ comment).
