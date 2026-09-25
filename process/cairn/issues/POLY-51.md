---
id: POLY-51
title: Sub-issue IDs get a letter suffix on the parent (POLY-1234a); existing numbered sub-issues are not renamed
status: done
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn]
priority: P2
pr: https://github.com/richmosko/polycarpic/pull/15
created: 2026-09-25
updated: 2026-09-25
---


## Comments

### @team-lead — 2026-09-25

User request 2026-09-25 (POLY-26 loop): sub-issues are hard to track visually as bare numbers. New scheme: a sub-issue's ID is its parent's ID plus a lowercase letter in creation order — `cairn new --parent POLY-26` yields POLY-26a, then POLY-26b. Queued as the next loop after POLY-26.

Acceptance criteria:
1. `cairn new --parent <ID>` allocates `<ID><letter>` (a..z, then error; no gaps reused) and writes `issues/<ID><letter>.md`; a top-level `cairn new` keeps the numeric counter.
2. Both ID patterns in cairn.py (`ID_RE`, `_issue_id_re`) and every consumer (`show/set/comment/close/estimate/check/guard-push/loop-stats`, the board's filters and drawer, `cairn ls`) accept the suffixed form; the estimation reference class and stage windows work unchanged for suffixed sub-issues.
3. Branch names, `check_feature_branch_invariant.py`, and backfill's branch matcher stay parent-only and untouched.
4. **No rename of existing numbered sub-issues** (user decision): POLY-11..14, 17..24, 28..32, 35..39, 41..44 keep their IDs; both forms coexist and `cairn check` accepts both.
5. `process/TRACKER.md` documents the scheme; a test covers allocation, a..z exhaustion, and mixed-form listing.

### @team-lead — 2026-09-25

Feature started. Branch: `feature/poly-51-sub-issue-letter-ids`.

Lead's estimate at start (calibration record): ~45 min wall clock, ~12 commits, 1 gate cycle, ~$20 team cost. Reference: POLY-26 (same engine area, one shared helper + scan change) took 34 min / $16.86 against 45 min / $25.

Survey for the gate-1 ruling: the engine has two ID patterns — `ID_RE` (`^([A-Za-z][A-Za-z0-9]*)-(\d+)$`, used by `_next_id_candidate` to find the max numeric id) and `_issue_id_re(prefix)` (`^<P>-\d+$`, used by `check_repo`'s shape classifier). TRACKER.md §"four shapes" separates records by the first character class after the prefix, so `POLY-26a` (digit first) stays in the issue class once the issue pattern admits a trailing `[a-z]`. The board sorts by `ID_SORT_RE = /^(.*?)-(\d+)$/` in board-logic.js, which would misplace a suffixed id. Allocation is `allocate_and_create_issue` (O_EXCL, one glob per attempt); a `--parent` path needs a per-parent letter allocator with the same O_EXCL discipline.

### @architect — 2026-09-25

Gate-1 ruling: `scripts/cairn/design/sub-issue-letter-ids.md` (this commit). Sub-issues POLY-52 (plan, architect), POLY-53 (execute, qa-engineer), POLY-54 (execute, implementation-lead), POLY-55 (review, architect) — numeric, since the letter scheme does not exist until green.

- Patterns: `_issue_id_re` widens to `^<P>-\d+[a-z]?$`; `ID_RE` stays numeric-only (the counter never sees suffixes); new `_sub_issue_letter_re(parent)`; both sort regexes (py L1854, js L474) widen to `^(.*?)-(\d+)[a-z]?$` with the 3-tuple key unchanged — the full-string tiebreak already orders 26 < 26a < 26b < 27.
- Allocator: the letter path branches on `fields.parent` inside `allocate_and_create_issue` (CLI + HTTP); parent must resolve; depth 1 only (checked on the record, so legacy numbered sub-issues are refused as parents too); max+1 over live + archive, no gap reuse, O_EXCL retry, error past `z`; no numeric fallback.
- New lint: a suffixed id's `parent:` must equal its stem minus the letter.
- Measured: 9 id-shape concerns across 10 regex lines; 3 change (issue re, py sort, js sort) + allocator + new lint; branch-side 3 and the token sort stay untouched (AC3). Every other consumer is string-equality or filename lookup — estimation is shape-blind (§4).
- Tests: § 6, 11 new cases; 9 existing test files must pass unchanged. Guard: 0 existing tests edited; board-logic.js diff = one regex line.

### @team-lead — 2026-09-25

Gate-1 ruling accepted at f22c704 (`scripts/cairn/design/sub-issue-letter-ids.md`) as written, §0–§6. Notes for the record: the no-rename rule covers all 37 numbered sub-issues live today (30 stage sub-issues + the 11 umbrella members reparented under POLY-48/49/50), not only the 26 listed in AC4. Two rules beyond the AC, both accepted: `--parent` must resolve and be depth 1 (legacy numbered sub-issues cannot be parents either); lint requires a suffixed id's `parent` to equal its stem minus the letter. Uppercase suffixes rejected. POLY-52 closed at the gate from the main checkout.

### @qa-engineer — 2026-09-25

POLY-53 (red tests, 701a850): ruling §6 item 5 said "pre-create PT-3b.md after the scan (monkeypatch the scan)" -- no scan helper exists to monkeypatch pre-implementation (TDD: the letter allocator itself doesn't exist yet, so I can't name an internal seam sight-unseen). Substituted a genuine ThreadPoolExecutor race over the letter path (20 concurrent `allocate_and_create_issue(parent="PT-3")` calls), the identical substitution test_id_allocation.py's ConcurrentAllocationTests already makes for the numeric path, for the same reason.

Caught myself on a real gap: the first draft only asserted id-uniqueness and passed vacuously -- pre-implementation, parent is inert for id generation, so 20 unique top-level numeric ids (PT-4..PT-23) also satisfy plain uniqueness without ever touching the letter path. Fixed by asserting every allocated id is PT-3<letter>-shaped; confirmed it now fails for the right reason before pushing.

Requesting a ruling on whether the concurrency substitution is acceptable, or whether the implementer should also add an internal scan-seam test matching the ruling's literal monkeypatch phrasing once that seam exists.
### @implementation-lead — 2026-09-25

Build green (POLY-54): `_issue_id_re`/`_ID_SORT_RE` (cairn.py) and `ID_SORT_RE` (board-logic.js) widened to `[a-z]?`; `ID_RE` unchanged; letter path added to `allocate_and_create_issue` (new `_allocate_sub_issue`/`_next_sub_issue_letter`, same O_CREAT|O_EXCL retry discipline) with the three `--parent` refusals raising a new `BadParentError` (400 `bad_parent` over HTTP, distinct from `legacy_archive`); `check_repo` gained the suffixed-id↔parent agreement rule; TRACKER.md's five §5 edits landed. 0 existing tests edited. `run_tests.py --gate green`: 1787 tests OK. `node --test` over tests/js (excluding token-chart-logic.test.js): 434 pass. Ruling: scripts/cairn/design/sub-issue-letter-ids.md @ f22c704.

### @team-lead — 2026-09-25

Green verified at bb4e3a8 from the main checkout: 206 tests across the seven affected files OK, JS 434/434, `cairn check` clean on the live tree, no test file changed between red 701a850 and green. Live smoke on a throwaway copy of `process/cairn`: `cairn new --parent POLY-51` → POLY-51a, again → POLY-51b; `--parent POLY-52` → "parent POLY-52 is itself a sub-issue -- sub-issues nest one level"; `cairn ls` orders POLY-51, POLY-51a, POLY-51b, POLY-52. Review (POLY-55) dispatched.

### @architect — 2026-09-25

Gate-4 verdict (POLY-55) on green `bb4e3a8` (red `701a850`): **APPROVE.**

| Axis | Result | Evidence |
|---|---|---|
| §1 patterns | pass: `_issue_id_re` widened, `ID_RE` numeric-only, both sort regexes widened, 3-tuple key kept | `bb4e3a8` cairn.py L165/L231/L1974, board-logic.js L480 |
| §2 allocator | pass: letter path branches on `fields.parent` in the single funnel; resolves the parent, checks depth on the record and the shape, max+1 over live+archive, O_EXCL retry, errors past `z`, no numeric fallback | `bb4e3a8` `_allocate_sub_issue`, `_next_sub_issue_letter` |
| §2 HTTP codes | **deviation, non-blocking**: a–z exhaustion is a plain `CairnError` → 400 `legacy_archive`; the ruling reserved that code for the legacy guard alone. No `bad_parent` test. | `bb4e3a8` `_create_issue` |
| §3 consumers / AC3 | pass: agreement lint added; token sort, backfill, branch invariant untouched | `git diff 0b57918 bb4e3a8 --stat` |
| §4 estimation shape-blind | pass: no estimation code touched | same |
| §5 TRACKER text | pass: all five edits landed | `bb4e3a8` TRACKER.md |
| §6 tests | pass: 0 test files touched red→green; the `test_sub_issue*` and `test_id_*` modules pass | lead's run + mine at `afe113d` |
| Guard: ≤ 60 non-comment lines in cairn.py | **79 measured; the limit was tagged (unmeasured), so it cannot gate.** About 20 lines are the numeric path's fill + O_EXCL + write body, copied into the letter loop | line count over `git diff 0b57918 bb4e3a8 -- cairn.py`, excluding blank, comment and docstring lines |
| Guard: board-logic.js = 1 regex line | pass | same diff |

**Item-5 substitution stands.** Measured: with `os.open` wrapped to count collisions, the 20-thread race hit `FileExistsError` in 50/50 runs (4475 retries total). The retry branch runs on every run, and the `PT-3<letter>` check rules out the passes-for-the-wrong-reason case. No scan-seam test is required.

Follow-ups (group into an engine umbrella; lead's choice which): (a) map exhaustion to `bad_parent` (or its own code) and test the 400; (b) factor a shared claim-and-write helper out of the two O_EXCL loops.

### @team-lead — 2026-09-25

Architect verdict APPROVE accepted (006848e on green bb4e3a8). POLY-55 closed at the verdict from the main checkout. qa's item-5 race substitution stands (collision branch measured hit in 50/50 runs). Two follow-ups (HTTP error code `bad_parent` untested and wrong on exhaustion; duplicated O_EXCL loop) recorded on POLY-48. Sending qa the verdict run.

### @qa-engineer — 2026-09-25

QA verdict gate @ 13bbc5f: PASS.

`run_tests.py --gate verdict`: 1787 tests, 0 failures/errors, 4 skipped -- OK.
`node --test` over tests/js (46 files, token-chart-logic.test.js excluded per the CI/POLY-8 exclusion): 434 tests, 0 failures.

All 11 red tests from POLY-53 (test_sub_issue_ids.py, test_sub_issue_id_lint.py, the appended test_id_sort.py/test_server.py/id-sort.test.js/child-progress.test.js cases) are green against POLY-54's allocator, patterns, and lint. No skips added, no test edited to pass.

### @team-lead — 2026-09-25

PR opened: https://github.com/richmosko/polycarpic/pull/15. Verdicts already recorded (qa 92a9e23 at 13bbc5f; architect 006848e at bb4e3a8); head-match `gate --head bb4e3a8` PASS. Awaiting the required `cairn` check and the merge call.

### @team-lead — 2026-09-25

Validate passed; merging via PR #15. Closing.

Calibration (lead's start estimate vs actual): est ~45 min / 12 commits / 1 gate cycle / ~$20 → actual ~50 min loop window (19:46–20:36Z) / 15 commits incl. tracker chores / 1 gate cycle / $17.49 loop cost at the scorecard. Sub-issue actuals: POLY-52 $1.59 (1.06), POLY-53 $4.52 (1.81 — qa's verdict commit counted as a second cycle, POLY-48 note), POLY-54 $3.78 (1.08), POLY-55 $0.71 (0.71). This loop's own sub-issues were the last minted under the numeric scheme; the next loop's are the first letter ids.
