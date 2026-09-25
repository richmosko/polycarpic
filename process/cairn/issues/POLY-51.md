---
id: POLY-51
title: Sub-issue IDs get a letter suffix on the parent (POLY-1234a); existing numbered sub-issues are not renamed
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn]
priority: P2
pr: null
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
