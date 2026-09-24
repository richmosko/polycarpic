---
id: POLY-3
title: Effort estimation loop in cairn (tokens + gate cycles)
status: in-progress
milestone: POLY-A
parent: null
blocked_by: [POLY-2]
assignee: null
labels: [workflow, cairn]
priority: P2
pr: null
created: 2026-09-23
updated: 2026-09-24
---


Kickoff decision: `docs/project_kickoff.md` § 2.12. Effort is estimated in
**tokens** (cost) and **gate cycles** (bloat; one red→green pass or one review
round); wall-clock is recorded but secondary; human minutes never appear. Each
issue is decomposed into cairn sub-issues, one per agent, tagged with stage
(plan / execute / review), owned paths (POLY-2), dependencies, and an estimate.
At close, actuals are pulled from the OTel token telemetry
(`scripts/cairn/otel_receiver.py`) and the per-agent commit log (POLY-1), the
actual/estimate ratio is written onto the sub-issue, and a calibration record
is appended. Closed sub-issues become reference classes for new estimates.
Built into cairn; neither *Claude Code Time Estimator* nor *OpenSpec* is
adopted. **Architect design pass precedes implementation** — this issue's own
sub-issues are the first hand-estimated reference class.

## Acceptance criteria

- [ ] Architect design note beside cairn (`scripts/cairn/design/estimation.md`) covering: sub-issue fields, actuals sources, calibration record format, reference-class query — reviewed by team-lead before code
- [ ] `process/TRACKER.md` schema gains on sub-issues: `stage` (plan | execute | review), `estimate: {tokens, gate_cycles}`, `actual: {tokens, gate_cycles, wall_clock}`, `ratio`; `cairn check` validates them
- [ ] `cairn close <ID>` pulls actuals for the sub-issue's assignee from the OTel receiver and the commit log, writes `actual` + `ratio`, and appends a calibration record under `process/cairn/metrics/`
- [ ] `cairn estimate <ID>` prints the closest reference classes (same stage + assignee, then same labels) with their actuals, to seed a new estimate
- [ ] Bloat flag: a sub-issue whose gate cycles exceed the estimate, or whose token ratio exceeds `config.yml` → `estimation.bloat_ratio`, is labelled `bloat`; the threshold key ships unset and the flag is skipped until POLY-A's baseline sets it
- [ ] `loop-stats` reuses the same actuals source rather than a second reader
- [ ] Unit tests in `scripts/cairn/tests/` for close, estimate, and the unset-threshold path
- [ ] `process/WORKFLOW.md` gains a short *Estimation* section: when the lead decomposes, when the architect reviews, when close runs

## Comments

### @team-lead — 2026-09-23

Feature started. Branch: `feature/poly-3-effort-estimation-loop`.
Lead estimate at start, recorded for calibration at done: loop size ≈ 2–3× POLY-5 (eight ACs, an architect design note gate before code, new schema + two CLI commands + close-time actuals). Guess: 8 commits, 3 gate cycles, ~60 min team wall-clock from spawn to merge. Prior data point: POLY-5 estimated 1–2 h, actual 21 min.
Known conflict for the design note: `process/TRACKER.md` line ~227 lists `estimate` under "deliberately absent, so they don't get re-proposed"; POLY-3 AC2 adds it on sub-issues. The design note must rescind that sentence explicitly.

### @architect — 2026-09-23

Design note (AC1) at `scripts/cairn/design/estimation.md` @ 6979191 — for team-lead review before code.
Key calls: flat dotted keys (`estimate.tokens` …) not nested maps (dumper/set/patch have no dict support); `ratio` a quoted decimal string (parser is int-only); tokens attributable only as (parent, role, flush window), so `close` flushes the receiver first; one gate cycle = a maximal run of the assignee's commits broken only by a different-stage or lead commit; calibration at `process/cairn/metrics/calibration.jsonl` (metrics branch); shared seam `token_actuals` / `gate_cycle_actuals` in cairn.py. §8 rescinds TRACKER.md's "deliberately absent: estimate" for sub-issues.

### @team-lead — 2026-09-23

Design note reviewed @ 6979191: APPROVED, no revision round. Accepted calls: flat dotted keys (writer has no dict support), `ratio` as a quoted decimal string (int-only parser), gate cycle = maximal run of the assignee's commits broken only by a different-stage or lead commit, `close` flushes the receiver first, bloat sweep by grep. Length over target is fine.
Receiver finding, out of POLY-3 scope → POLY-10: the receiver never wrote token-usage.jsonl and its watchdog thread is dead. Restarted bare at review time. POLY-3's null-tokens path is therefore the live path for this loop's own sub-issues.
Decomposition (first hand-estimated reference class; tokens incl. cache reads, gate cycles): POLY-11 architect/plan 800k/1 · POLY-12 qa-engineer/execute 700k/1 · POLY-13 implementation-lead/execute 1.2M/2 · POLY-14 architect/review 400k/1. Closed via `cairn close` at finish-feature once it exists.

### @qa-engineer — 2026-09-23

RED @ da3af80: `scripts/cairn/tests/test_estimation.py` (POLY-12), plus an INTERFACE.md pointer. Confirmed failing for the right reason: `python3 -m unittest discover -s tests -p "test_estimation.py"` -> 22 failures + 6 errors (AttributeError on `cairn.token_actuals`/`gate_cycle_actuals`, argparse "invalid choice" for `close`/`estimate`, `unknown field 'estimate.tokens'`, `ISSUE_FIELD_ORDER` missing the seven keys) out of 34 tests. The 6 passing are pre-existing generic behavior (dump_frontmatter quoting/round-trip) that must stay green, not new coverage.

Covers design note Section 9's minimum set: check validation (stage enum/parent, non-int estimate, `estimate.tokens: 0`, actual-on-non-done, ratio-without-operand, unknown `estimation.*` key, bloat_ratio >1.0), round-trip + `ISSUE_FIELD_ORDER` position, `token_actuals`/`gate_cycle_actuals` unit tests, `cairn close` (actuals, gate-cycle splitting, calibration line, missing-token-log warning, unset/set bloat threshold), `cairn estimate` (tier A/B, dedup, self-exclusion, empty message, median suggestion), loop-stats parity.

Two assumptions flagged in the file's own docstring (not literally pinned by the design note): `since`/`until` are ISO-8601 `Z` strings compared lexically (matches `build_tokens_payload`'s existing convention); `close`/`estimate` resolve repo root from `cwd` like `guard-push` does. Neither should require a test rewrite if wrong -- just a signature tweak.

`scripts/cairn/cairn guard-push POLY-12` passed before push.

### @implementation-lead — 2026-09-23

GREEN — POLY-13 @ a3738ed (scripts/cairn/cairn.py, process/TRACKER.md, process/WORKFLOW.md).

Implements the design note (de28e82): ISSUE_FIELD_ORDER gains stage/estimate.*/actual.*/ratio;
check_repo validates them plus config.yml's estimation.bloat_ratio; new token_actuals/
gate_cycle_actuals are the shared actuals seam (AC6); `cairn close`/`cairn estimate` per §7;
TRACKER.md/WORKFLOW.md updated per §8, "estimate deliberately absent" sentence rescinded.

All 34 scripts/cairn/tests/test_estimation.py tests pass. Full suite (`run_tests.py --gate green`)
has 3 pre-existing failures in test_frontmatter_rewrite.py, unrelated to test_estimation.py: they
hardcode the old (pre-POLY-3) ISSUE_FIELD_ORDER literal/fixtures, same precedent as the `paths`
field exclusion already in that file. Not part of qa's red set for this loop — pending qa's
fixture update on top of this commit.

### @architect — 2026-09-23

Addendum 1 (lead's close dry-run findings on a3738ed). Ruling text is in scripts/cairn/design/estimation.md @ 85c5fd6, §2. Summary:
1. Zero assignee commits in W: a warning on stderr is mandatory, and a test pins it. The current build is non-conformant.
2. Token file present but no (parent, role, W) line: `actual.tokens: null`, no `ratio`, a warning, and `"ratio": null` in calibration. A token total of 0 only ever comes from ≥1 matching line. `estimate` leaves null-token rows out of the token median.
3. W.from = max(parent flip = oldest commit in base..ref, the latest calibration window.to of a closed sibling with the same parent and assignee). The sub-issue file's creation time is dropped, and there is no --since override. wall_clock = the assignee's last commit in W − from (null when there are no commits).
Tests: one per item, in test_estimation.py.

### @implementation-lead — 2026-09-23

GREEN (cycle 2) — addendum 1 @ bbbc8f7 (scripts/cairn/cairn.py).

Implements the addendum (design note @ 85c5fd6, POLY-3.md @ b6caa8a): from_ts = max(parent flip,
sibling floor); token_actuals treats a present-but-no-match file the same as a missing one (tokens:
null, no ratio); gate_cycle_actuals gains last_commit_ts for wall_clock; mandatory stderr warning
on zero assignee commits; cairn estimate excludes null-token rows from the token median.

All 37 test_estimation.py tests pass. Full gate: 1754 OK.

### @architect — 2026-09-23

**Verdict (POLY-14): CHANGES REQUESTED** on green bbbc8f7, checked against the note @ c195c37.

| Axis | Result | Evidence |
|---|---|---|
| AC1 design note | pass | 85c5fd6, c195c37 |
| AC2 schema + check | pass, one doc nit (R4) | bbbc8f7 cairn.py check_repo; TRACKER.md rows |
| AC3 close | **fail** (R2, R3) | bbbc8f7 cmd_close / token_actuals |
| AC4 estimate | pass | bbbc8f7 cmd_estimate: tiers, dedup, null-token median |
| AC5 bloat flag | pass | bbbc8f7: unset → skip line; gate overrun flags |
| AC6 loop-stats shares the reader | **fail** (R1) | loop_stats.py:713 still calls build_tokens_payload |
| AC7 tests | pass once R1–R3 have tests | test_estimation.py |
| AC8 WORKFLOW Estimation | pass | WORKFLOW.md § Estimation |
| TRACKER rescission | pass | TRACKER.md "no longer on this list" |

Required:
- **R1 (AC6).** `loop_stats.scorecard` must read cost via `cairn.token_actuals(data_dir, issue_id)["cost_usd"]`. It must also add per-agent `tokens` from `token_actuals(..., role=<role>)` (note §6). The current test only proves the two readers agree; it does not prove there is one reader.
- **R2.** `from_ts is None` (empty `base..ref` with no sibling floor) currently leaves W unbounded, so gate_cycle_actuals counts the assignee's whole-repo history. `close` must exit 1 with a message instead (note §2 @ c195c37). Needs a test.
- **R3.** `token_actuals` must filter `source == "otel"` (note §2 formula). A `transcript-backfill` run whose `generated` falls in W would otherwise double-count. Needs a test with a backfill line in W.
- **R4.** In the TRACKER.md `actual.wall_clock` row, change "created → closed" to "window start → assignee's last commit in W".

Accepted deviation: `gate_cycle_actuals` walks `ref`'s first-parent history bounded by W, not `base..ref`. The note is aligned @ c195c37, and R2 is what makes this safe.

### @implementation-lead — 2026-09-23

GREEN (cycle 3) — review R1-R4 @ ee8bed1 (cairn.py, loop_stats.py, TRACKER.md).

R1: loop_stats.scorecard reads cost + per-agent tokens via cairn.token_actuals (not build_tokens_payload).
R2: from_ts with no floor at all -> `cairn close` exits 1 (unbounded window refused).
R3: token_actuals filters source=="otel" (transcript-backfill no longer double-counts).
R4: TRACKER.md actual.wall_clock wording updated.

New review tests pass. Full suite: 1757 total, 6 failing (CloseCommandTestBase/CloseBloatFlagTests —
base==ref fixture staleness against R2's now-mandatory bounded window; qa's fixture fix, same class
as the earlier test_frontmatter_rewrite.py staleness).

### @architect — 2026-09-23

**Re-verdict (POLY-14): APPROVE** on 67a54d9, checked against the note @ c195c37.

| Axis | Result | Evidence |
|---|---|---|
| R1 / AC6 loop-stats on token_actuals | pass | ee8bed1 loop_stats.scorecard; LoopStatsSharedReaderTests |
| R2 bounded window | pass | ee8bed1 cmd_close exits 1 on no floor; UnboundedWindowForbiddenTests; 67a54d9 fixture floor |
| R3 otel-only | pass | ee8bed1 token_actuals; TokenActualsSourceFilterTests |
| R4 TRACKER wall_clock row | pass | ee8bed1 TRACKER.md |
| AC1–AC5, AC7, AC8 | pass (unchanged since bbbc8f7 verdict) | c9ae61a table |

Cost ruling. `cost_usd: null` when any matching line's model is missing from prices.json is **not a POLY-3 defect**:
- It is the established posture of `build_tokens_payload`: a total with a gap is null, not understated. The shared reader keeps that posture on purpose.
- Cost is not an estimation axis. Tokens are, and the calibration record keeps the per-counter breakdown, so cost can be recomputed once the price exists.
- The missing `claude-opus-5-5` rate is a **prices.json follow-up**, to be filed separately.

Non-blocking notes, for the lead to file or drop:
- Because of R3, loop-stats cost is now otel-only. An issue with only backfill lines shows "—" where it used to show a cost.
- A role with two transcripts (`role-<stem>` keys) shows the full role token total on each key.

### @qa-engineer — 2026-09-24

**QA verdict: PASS** on `bf56e5a` (architect re-approved `67a54d9` at `de60cde`; `bf56e5a` is team-lead's POLY-15 filing, tracker-only, no code).

Python: `python3 run_tests.py --gate verdict` from `scripts/cairn` -- 1757 tests, OK (skipped=4). One transient failure on the first run (`test_otel_receiver_self_stop.GraceWindowFlushContentTests.test_a_datapoint_posted_during_the_grace_window_lands_in_the_final_flush`) -- passed standalone and on a full-suite rerun; `otel_receiver.py` has zero diff across this entire feature loop, so this is a pre-existing timing flake under parallel contention, not a POLY-3 regression. Not filed as a new issue -- flagging for team-lead to decide whether it needs one.

JS: `node --test "scripts/cairn/tests/js/**/*.test.js"` -- 479 tests, 477 pass, 2 fail (layerchart ENOENT x2, POLY-8, known).

`test_estimation.py`: 40/40. All 8 ACs covered per the architect's final verdict table (AC1-AC8, TRACKER rescission). guard-push POLY-12 passed.

### @team-lead — 2026-09-24

First reference class closed via `cairn close` @ 07d31c8 (calibration.jsonl on metrics @ 4d36f3f):
| sub-issue | stage/assignee | est. cycles | actual | wall | flag |
|---|---|---|---|---|---|
| POLY-11 | plan/architect | 1 | 4 | 79m | bloat |
| POLY-12 | execute/qa-engineer | 1 | 4 | 82m | bloat |
| POLY-13 | execute/implementation-lead | 2 | 3 | 75m | bloat |
| POLY-14 | review/architect | 1 | 0 | null | — |
Tokens null on all four: teammates land as `subagent-unattributed` (POLY-10 AC5). POLY-14's 0 / POLY-11's 4 is a windowing defect, filed as POLY-16. The qa overrun counts two fixture repairs caused by schema and R2 changes — real cycles, honestly counted.

### @qa-engineer — 2026-09-24

**QA re-verified: PASS** at `b6455f8` (branch moved past the `07d31c8` you named -- `b6455f8` is a further tracker-only commit, no code; re-ran at the true current tip per "re-verify at tip").

Python: `python3 run_tests.py --gate verdict` from `scripts/cairn` -- 1757 tests, OK (skipped=4), clean on the first run (no repeat of the prior transient otel self-stop flake).

JS: `node --test "scripts/cairn/tests/js/**/*.test.js"` -- 477/479, 2 known layerchart ENOENT (POLY-8), unchanged.

`prices.json`'s new `claude-opus-5-5` row (ba0a246) doesn't affect `test_estimation.py`'s fixtures -- they inject their own `TEST_PRICES` dict rather than reading the real price table, except `LoopStatsSharedReaderTests` and `LoopStatsParityTests`, which pin `claude-haiku-4-5-20251001` -- unaffected by an added row.
