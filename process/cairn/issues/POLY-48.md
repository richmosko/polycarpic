---
id: POLY-48
title: Estimation-engine fixes (grouped): unpriced-model cost, check warning key, fixture hygiene, close --at flush ceiling, guard-push same-assignee scope, JS gate node_modules
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, estimation]
priority: P2
pr: null
created: 2026-09-25
updated: 2026-09-25
---


## Comments

### @team-lead — 2026-09-25

Grouped fix loop (user decision 2026-09-25: each top-level issue costs a full I→V loop + CI, so small fixes in one area ride one loop). One PR closes every member.

Members (each keeps its own file and acceptance criteria): POLY-15, POLY-33, POLY-40, POLY-47, POLY-8.

Additional acceptance criteria carried here, not filed separately:
- **guard-push scope:** `cairn guard-push <sub-issue>` scans every same-assignee commit since merge-base with main, so the second sub-issue an agent holds on one branch trips on the first one's files (POLY-26 loop, POLY-44 push). Fix: scope the scan to commits after the assignee's earlier-stage sibling closed, or union same-assignee sibling paths under one parent; add a test with two sibling sub-issues for one assignee.

### @team-lead — 2026-09-25

Two more members carried here from the POLY-51 review (architect verdict 006848e), not filed separately:
- **HTTP error code for letter-path refusals:** over `_create_issue`, a–z exhaustion (and the other `--parent` refusals) return 400 with code `legacy_archive`; the POLY-51 ruling §2 reserved that code for the legacy-archive guard and specified `bad_parent`, which no test pins. Fix the code and add the HTTP test.
- **Shared claim-and-write helper:** the O_EXCL create loop is duplicated between the numeric and letter paths of `allocate_and_create_issue` (~20 lines). Factor one helper; both paths call it.
- **`cairn close` from a teammate worktree writes `actual.cost_usd: None`** (architect, POLY-52): a worktree has no metrics mount, so `close` finds no `token-usage.jsonl` and records nulls. It should refuse with a message naming the main checkout, not write.

### @team-lead — 2026-09-25

Feature started. Branch: `feature/poly-48-estimation-engine-fixes`.

### @architect — 2026-09-25

Gate-1 ruling: scripts/cairn/design/estimation-engine-fixes.md. (a) POLY-15: unpriced model keeps actual.cost_usd null + named warning. (b) POLY-47: --at token ceiling admits the first flush after the commit, within 1800 s; window.to records it. (c) guard-push: allowed paths = own ∪ same-parent same-assignee siblings' paths. (d) close from a linked worktree exits 2, names the main checkout, writes nothing. Sub-issues POLY-48a..d; lanes per paths:.
### @implementation-lead — 2026-09-25

Prep done (not building yet — waiting on architect ruling sha + qa red-test sha per assignment).

No-ruling items, confirmed straightforward:
- POLY-33: one-line fix, cairn.py:6497 key `actual.tokens is None` -> `actual.gate_cycles is None`.
- bad_parent (item 7): only a-z letter exhaustion (cairn.py:~1295, plain CairnError) still maps to `legacy_archive`; the other two `--parent` refusals already return `bad_parent` since POLY-51. Architect's own POLY-51 follow-up (a) already names this fix.
- Shared helper (item 8): the two O_EXCL loops (cairn.py:1281-1303, 1349-1366) are near-identical, factor one helper.

Bubble-up: POLY-15 AC2 looks already resolved by POLY-34's landed ruling (estimation.md §0.2 "unchanged posture") and TRACKER.md:227 (null-on-unpriced, never partial, already stated). Worth confirming with architect whether item 1 just needs POLY-15 closed with a link to POLY-34, rather than a fresh ruling.

Still blocked on architect's ruling for guard-push scope (item 6, cmd_guard_push ~6732) and close-from-worktree refusal (item 9, cmd_close ~6986 / resolve_data_dir).

### @architect — 2026-09-25

Gate-4 verdict on d1f2e08: **changes requested** (one item). Addendum 1 is in estimation-engine-fixes.md.

| Axis | Result | Evidence |
|---|---|---|
| (a) POLY-15 null posture + TRACKER text | pass | d5d90a1 |
| (b) POLY-47 --at token ceiling | **fail R1** | _token_ceiling admits a transcript-backfill line as the flush: probe with backfill at +10 s and otel at +55 s returned +10 s with no warning. The fault is in my ruling's wording ("all lines"); corrected in Addendum 1 to source == otel. Builder: filter to otel lines. qa: add that fixture |
| (c) guard-push sibling union | pass | 28b11cc |
| (d) close refuses from a worktree | pass | 844b1cc |
| POLY-33 gate_cycles key | pass | b9a2ed9 |
| bad_parent / LegacyArchiveError / 409 | pass | 64bb0ba; 34dbdf3 is green on this code |
| shared claim helper | pass | 64bb0ba; both paths are net negative |
| touched modules | pass | run_tests.py: estimation, guard_push, server, id_allocation, check_lint, frontmatter_rewrite all OK |

Non-blocking: the ceiling warning names the far flush rather than the last flush before --at, and _allocate_sub_issue no longer uses max_attempts. Both can stay as they are. The estimation.md known-limit bullet, which no lane covered, is landed in this commit, including the commit-floor side effect of window.to.
