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
