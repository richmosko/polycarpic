---
id: POLY-34
title: Estimation: estimate and ratio on cost (USD or cost-weighted tokens), not the raw token sum
status: todo
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


## Comments

### @team-lead — 2026-09-25

From POLY-6's calibration records (first loop with every role attributed, 2026-09-25): cache reads are 91–99% of every sub-issue's raw token sum, and at Sonnet rates still ≈83% of the dollar cost (POLY-30: 37.6M tokens, $9.43). The kickoff (§2.12) chose tokens as the cost proxy; the data shows the raw sum is a poor one — a model swap or a caching change moves the ratio by an order of magnitude with no change in work (ratios this loop: 1.2, 17.6, 31.3, 5.0, 10.0 against hand estimates that priced no cache reads).
The calibration record already carries `input`, `cache_write`, `cache_read`, `output`, and `cost_usd` per close; the issue frontmatter and the ratio/bloat evaluation use only `actual.tokens`.
AC: (1) architect rules the estimate unit — `cost_usd` or cost-weighted tokens — and revises estimation.md §1/§5; (2) sub-issue schema gains `estimate.cost_usd` / `actual.cost_usd` (or the weighted equivalent) with `ratio` computed on it, raw counters kept in the record; (3) `cairn estimate` medians and the suggestion line use the new axis; (4) `estimation.bloat_ratio` is defined on it; (5) POLY-6's five sub-issues re-closed under the new axis as the first reference class. Evidence table on POLY-6's closing comment.
