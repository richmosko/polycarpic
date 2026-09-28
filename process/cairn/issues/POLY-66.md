---
id: POLY-66
title: Quarterly estimated tax: annualized accrual + safe harbor
status: backlog
milestone: null
parent: null
blocked_by: []
assignee: null
labels: []
priority: null
pr: null
created: 2026-09-27
updated: 2026-09-27
---

PRD §4 Story 4 (round-2 rewrite), §5 FRs. Running accrual per entity/jurisdiction: annualize income to date by tax treatment, derive (1) pending liability = 100% of annualized tax to date minus prepaid-tax balance, (2) two safe-harbor values (prior-year basis, current-year basis) with required payment = lesser minus prepaid balance, (3) the gap between required and pending. Freeze the annualized figure at each jurisdiction's period cutoff (federal: Mar 31/May 31/Aug 31/Dec 31, multipliers 4/2.4/1.5/1) so the upcoming due amount is fixed while accrual continues. Due dates, cutoffs, multipliers, and cumulative required percentages come from a per-jurisdiction, per-filing-year lookup table (data, not code) — e.g. federal 25/50/75/100 (×90% ⇒ 22.5/45/67.5/90), California 30/70/70/100. At filing, export frozen per-period figures for Schedule AI / Form 2210 and the state equivalent. Each payment still posts to a per-jurisdiction prepaid-tax asset account; filing settlement still routes via the entity's tax-classification attribute (expense vs. distribution) from POLY-62. Annualized-installment method is now the feature, not a non-goal — this supersedes the original body text. CPA to confirm trust/pass-through treatment (PRD §10). Source: docs/PRD/index.html