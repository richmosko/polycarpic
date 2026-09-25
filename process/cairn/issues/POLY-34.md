---
id: POLY-34
title: Estimation: estimate and ratio on cost (USD or cost-weighted tokens), not the raw token sum
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, workflow]
priority: P2
pr: null
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
