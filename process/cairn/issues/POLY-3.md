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
updated: 2026-09-23
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
