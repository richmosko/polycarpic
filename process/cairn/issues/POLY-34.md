---
id: POLY-34
title: Estimation: estimate and ratio on cost (USD or cost-weighted tokens), not the raw token sum
status: done
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, workflow]
priority: P2
pr: https://github.com/richmosko/polycarpic/pull/13
created: 2026-09-25
updated: 2026-09-25
---
POLY-6's calibration records (the first loop with every role attributed) show cache reads at 91–99% of every sub-issue's raw token sum and still ≈83% of its dollar cost at Sonnet rates. The kickoff chose tokens as the cost proxy; the raw sum moves by an order of magnitude with a model swap or a caching change and no change in work (ratios 1.2 / 17.6 / 31.3 / 5.0 / 10.0 this loop). The calibration record already carries the four counters and `cost_usd`; the issue frontmatter, `ratio`, the bloat flag, and `cairn estimate` use only the raw sum. Evidence table in the team-lead comment below and on POLY-6's closing comment.

## Acceptance criteria

- [ ] Architect rules the estimate unit — `cost_usd` (from the price table at close time) or cost-weighted tokens — and revises `scripts/cairn/design/estimation.md` §1 (fields), §4 (estimate output), §5 (bloat); the raw counters stay in the calibration record
- [ ] Sub-issue schema gains the cost fields (e.g. `estimate.cost_usd` / `actual.cost_usd`, decimal strings like `ratio`), `ratio` is computed on the ruled axis, `actual.tokens` stays as a secondary; `cairn check` validates; TRACKER.md rows updated
- [ ] `cairn estimate` tiers, medians and the suggestion line use the new axis; null-cost rows (unpriced model) are excluded from the cost median the way null-token rows are today
- [ ] `estimation.bloat_ratio` is defined on the new axis; the unset-threshold path is unchanged
- [ ] POLY-6's five sub-issues (POLY-28–32) are re-closed under the new axis on this branch as the first cost-based reference class, `--at` their gate commits, with `--base <merge-base> --ref <merge>^2`
## Comments

### @team-lead — 2026-09-25

From POLY-6's calibration records (first loop with every role attributed, 2026-09-25): cache reads are 91–99% of every sub-issue's raw token sum, and at Sonnet rates still ≈83% of the dollar cost (POLY-30: 37.6M tokens, $9.43). The kickoff (§2.12) chose tokens as the cost proxy; the data shows the raw sum is a poor one — a model swap or a caching change moves the ratio by an order of magnitude with no change in work (ratios this loop: 1.2, 17.6, 31.3, 5.0, 10.0 against hand estimates that priced no cache reads).
The calibration record already carries `input`, `cache_write`, `cache_read`, `output`, and `cost_usd` per close; the issue frontmatter and the ratio/bloat evaluation use only `actual.tokens`.
AC: (1) architect rules the estimate unit — `cost_usd` or cost-weighted tokens — and revises estimation.md §1/§5; (2) sub-issue schema gains `estimate.cost_usd` / `actual.cost_usd` (or the weighted equivalent) with `ratio` computed on it, raw counters kept in the record; (3) `cairn estimate` medians and the suggestion line use the new axis; (4) `estimation.bloat_ratio` is defined on it; (5) POLY-6's five sub-issues re-closed under the new axis as the first reference class. Evidence table on POLY-6's closing comment.

### @team-lead — 2026-09-25

Feature started. Branch: `feature/poly-34-estimate-on-cost-axis`.
Lead estimate at start (calibration input): 16 commits, 2 gate cycles, ~60 min spawn→merge. Token estimates below are the first seeded from `cairn estimate`'s reference classes (raw-token unit, cache-inclusive) rather than hand guesses; a dollar guess is recorded beside each for comparison once this loop moves the axis: plan 0.9M / $1 · qa execute 8M / $3 · impl execute 15M / $5 · review 3M / $2.

### @architect — 2026-09-25

Gate-1 ruling (POLY-35): `scripts/cairn/design/estimation.md` @ e4c73bf §0 (§1/3/4/5/8/9 revised to match). Summary:
- (a) Unit = `cost_usd` from prices.json at close. Measured: POLY-6's $/MTok ranges 0.25–1.04 (4.2×). Weighted tokens are rejected because they are model-relative (cache_read/input is 0.05 on opus-5-5 vs 0.10 on sonnet-5) or else just $/const. A repricing needs a re-close; the record adds `prices_retrieved`. An unpriced model gives cost null, ratio null, and a warning naming the model.
- (b) `estimate.cost_usd` ("3.00", set coerces 2 dp, > 0) and `actual.cost_usd` (close-written, 4 dp). `ratio` = cost ratio. `estimate.tokens` becomes an optional secondary. Close always writes the four computed keys, null included. Check: a ratio requires both cost operands.
- (c) `cairn estimate`: the cost median excludes null/schema-1 rows. Suggestion is `estimate.cost_usd=X.XX estimate.gate_cycles=N`.
- (d) `bloat_ratio` applies to the cost ratio with reason `"cost"`. The unset path is unchanged; its skip line says "cost".
- (e) AC5: POLY-28–32 are re-closed with `estimate.cost_usd` absent, so ratio is null. A derived estimate would be invented or circular. Command: `--base 97037a6 --ref a508b32^2`, order 28 (`--at 4601a09`) → 29/30/31 (`c93342d`) → 32 (`75cc704`). Expected costs are in §0.6.
- POLY-39: verified that no test reads the real tracker tree, and CI runs no `cairn check`. The pattern is fail-closed (`grep -v` EXCLUDE, then PATTERN), per §0.7. **Limit:** `CHANGED` is the cumulative PR diff, so code PRs (this one included) still run the full suite on every push. Only tracker-only PRs skip. A `before`-diff is rejected as fail-open.
- (f) Tests are in §9.1, with the POLY-39 shape test first.

### @team-lead — 2026-09-25

Gate-1 ruling accepted @ e4c73bf: unit is `cost_usd` frozen at close (record gains `prices_retrieved`; unpriced model → null cost, null ratio, named warning); fields `estimate.cost_usd` / `actual.cost_usd` as decimal strings, `ratio` = cost ratio, `estimate.tokens` optional secondary; AC5 re-closes POLY-28–32 with `estimate.cost_usd` absent (ratio null — a derived dollar estimate would be an invented number in the first reference class), `--base 97037a6 --ref a508b32^2` in the ruled order. POLY-35 closed at design-gate clear.
POLY-39 limit accepted as measured: the change step diffs the whole PR, so the exclusion only saves runs on tracker-only PRs. One addendum question sent to the architect: anchoring the skip to the delta since the PR's last *successful* run (never a cancelled/red one) would let tracker-only tips on a green tree skip without the masking risk §0.7 rejects.

### @architect — 2026-09-25

Addendum 1 (POLY-35) is accepted: `estimation.md` @ 1f99d10 §0.8. A tracker-only push can now skip the suite, anchored to the last successful `cairn` run on the PR.
- **Anchor:** the newest successful PR run's head_sha (A), from the Actions API with `actions: read`.
- **Conditions:** A is present locally, A is an ancestor of the PR head, and the base sha is an ancestor of A. That last check makes the tested tree equal A's tree.
- **Skip:** run=false only when every path changed between A and the PR head matches EXCLUDE.
- **Fail-closed:** any API or ancestry-probe error skips nothing and falls through to §0.7. The step has one extra `run=false` and no `|| true`.
- **Scope:** POLY-39 grows to include this. qa's shape test is listed in §0.8.

### @qa-engineer — 2026-09-25

POLY-39 shape tests RED @ 7bd9a6d (tests/workflow/test_cairn_test_boundary.py).

`CiExcludePatternTests` (§0.7): EXCLUDE/PATTERN extraction, tracker-only paths → run=false, still-relevant paths → run=true, mixed → true, unrelated doc → false, PATTERN byte-identical, no bare `|| true`.

`CiAnchoredSkipTests` (§0.8 addendum 1): anchor lookup filters event=pull_request + status=success, `actions: read` permission, both ancestry checks present, `run=false` written exactly twice, no bare `|| true`.

14 failures across 23 tests, all AssertionError on missing EXCLUDE/anchor-lookup literals in ci.yml -- right-reason RED. Pre-existing CiWorkflowShapeTests suite (9 tests) unaffected.

### @devops-engineer — 2026-09-25

POLY-39 landed @ 4774ef2: applied §0.7 exclusion pattern and §0.8 anchored-skip addendum to .github/workflows/ci.yml's `changes` step, byte-identical to the ruling text. Fail-closed throughout (no `|| true`); permissions gains `actions: read`, the step gains `GH_TOKEN`. qa's shape tests (CiExcludePatternTests + CiAnchoredSkipTests) pass: `python3 -m unittest tests.workflow.test_cairn_test_boundary -k Ci` → 19/19 OK.

### @qa-engineer — 2026-09-25

Cost-axis RED @ f9e54be (scripts/cairn/tests/test_estimation.py, §9.1 items 1-9).

New classes: CostAxisCheckTests, CostAxisSetTests, CostAxisRoundTripTests, CloseCostAxisPricedTests, CloseCostAxisUnpricedTests (+ token_actuals unpriced_models), CloseEstimateTokensOnlyTests, RecloseClearsStaleRatioTests, EstimateCostAxisTests (header/median/suggestion/schema-1 dash).

Rewrote: CloseBloatFlagTests' two tests (tokens→cost bloat_reasons) and EstimateCommandTests.test_median_suggestion_line (token→cost suggestion), both directly superseded by the ruling.

25/73 failures, all right-reason (current code computes token ratios, no cost fields, no unpriced_models key, 'token threshold unset' not 'cost'). Other 48 pre-existing tests untouched, still green. POLY-39 confirmed green @ 4774ef2 (devops).

### @implementation-lead — 2026-09-25

GREEN @ 78a7276 (POLY-37). Per ruling e4c73bf (estimation.md §0.2-0.6):
ISSUE_FIELD_ORDER gains estimate.cost_usd/actual.cost_usd ahead of their
token siblings; cairn check validates them and requires the cost pair
for a non-null ratio; _coerce_cli_value gains ESTIMATION_DECIMAL_FIELDS;
token_actuals gains unpriced_models; cmd_close writes the cost ratio +
schema-2 calibration records (ratio_tokens/prices_retrieved kept for
continuity) and evaluates bloat on the cost ratio ("cost" reason); cmd_estimate
moves to the cost axis (header/rows/median/suggestion), excluding null-cost
and schema-1 rows from the median. TRACKER.md schema rows and WORKFLOW.md →
Estimation updated to match.

test_estimation.py: 74/74 green (qa's amendment a9d6cc8 landed the ruled
semantics for the 2 previously-superseded tests). Full --gate green over
both roots: only 3 known reds remain in test_frontmatter_rewrite.py
(_OPTIONAL_UNDECLARED_FIELDS tuple + the L56 fixture dict need the two new
field names) -- routed to qa, awaiting their amendment.

AC5 re-closes (POLY-28-32) are the lead's, from the main checkout.

### @architect — 2026-09-25

Verdict (POLY-38): **changes-requested** (one item), reviewed at b3d9d77.

| axis | result | evidence |
|---|---|---|
| POLY-39 §0.7 exclusion (fail-closed, rc > 1 exits) | pass | 4774ef2 |
| POLY-39 §0.8 anchor (newest success, both ancestry checks, one extra run=false, no `\|\| true`, errors fall through) | pass | 4774ef2 |
| AC1 unit + note §0/1/4/5 | pass | e4c73bf, 1f99d10 |
| AC2 fields/order/check/set coercion/TRACKER rows | pass | 78a7276 |
| AC3 estimate columns/suggestion/null exclusion | **R1** | 78a7276 cmd_estimate |
| AC4 bloat on the cost ratio, "cost" reason, skip line | pass | 78a7276 |
| AC5 re-close POLY-28–32 | pending (lead) | dry-run 0.8802 matches §0.6 |

**R1 (conflict ruled): §0.4 wins.** A schema-1 row with a non-null `actual.cost_usd` counts toward the cost median, because its cost came from the same `token_actuals` pricing. Only its `ratio` changed meaning, and that is why it prints as `-`. I have revised the §9.1 item 9 sentence @ 0a0b1f7. Fix: drop the `r.get("schema") == 2` filter from `cost_values` and correct the comment there. qa's pending test ("one priced schema-1 row among nulls → median equals it") pins it.

**D1 (accepted deviation):** close writes `ratio: null` only when the file already carried a ratio, not always. A null and an absent ratio are equivalent to check, and this avoids adding a new key to never-costed files.

Approve follows once R1 is green and AC5's re-close lands.

### @architect — 2026-09-25

Re-verdict (POLY-38): **approve** at 3d286da for code and AC5. One tracker action (B1) is required before finish.

| axis | result | evidence |
|---|---|---|
| R1 cost median counts priced schema-1 rows | pass | 35501e7 (filter dropped, comment corrected) |
| AC5 POLY-28–32 re-closed | pass | 3d286da. Schema-2 lines: window, gate cycles, wall and cost are identical to the prior lines (0.8802/3.7907/9.4330/1.1035/2.0704); ratio null; prices 2026-09-24 |
| POLY-39, AC1–AC4 | pass (unchanged) | 6a6df12 table |
| `cairn check` on the real tree | **fail, 1 error** | POLY-35: ratio present without both cost operands |

**B1:** POLY-35 was closed at 9528a5c by the pre-cost engine, so it carries schema 1 and a token `ratio: "3.27"`. Fix: set `estimate.cost_usd=1` (your $1 plan guess on the start comment, a real prior estimate and not a derived one), then re-close with `--at 9528a5c`. The ratio then comes out on the cost axis, and check passes. POLY-38 is closed the same way: set `estimate.cost_usd=2` from the start comment before its close.

### @qa-engineer — 2026-09-25

VERDICT: PASS @ a9c66d0

python3 run_tests.py --gate verdict (both roots): 1765 tests, OK (skipped=4, pre-existing).
node --test scripts/cairn/tests/js/**/*.test.js: 479 tests, 477 pass, 2 fail -- both the known layerchart ENOENT cases (POLY-8), no others.

Acceptance criteria: schema/estimate/close/bloat/cairn-estimate all on cost_usd; POLY-28-32 re-closed as the first cost-based reference class (AC5); R1 (schema-1 cost counts in the median) fixed and pinned. Full regression clean.

Signing off -- merge-ready.

### @team-lead — 2026-09-25

PR opened: https://github.com/richmosko/polycarpic/pull/13. Awaiting Validate. First run (code tip d7cf281, no anchor yet) ran the full suite and passed; this tracker-only push is the first live test of the §0.8 skip.

### @team-lead — 2026-09-25

Validate passed (qa PASS @ 7d09edd at a9c66d0; architect APPROVE @ 08b5525 on 35501e7; CI `cairn` green on every push incl. the first live §0.8 skip); merging via PR #13. Closing.
Estimate calibration: estimated 16 commits / 2 gate cycles / ~60 min at spawn (16:40Z). Actual: 28 commits, 2 red→green cycles + 1 review round, merged 2026-09-25T18:00Z, loop cost $39.17. First loop with sub-issues estimated and closed in dollars: POLY-35 $1→$1.90, POLY-36 $3→$9.01, POLY-37 $5→$6.79, POLY-38 $2→$0.90, POLY-39 —→$1.17. POLY-6's class re-closed on the cost axis (AC5).
Follow-up filed: POLY-40 (frontmatter fixtures derive from the schema).
