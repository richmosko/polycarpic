---
id: POLY-113
title: Period close + tax true-up
status: backlog
milestone: POLY-1.0
parent: null
blocked_by: [POLY-66, POLY-93]
assignee: null
paths: [packages/tax/**, packages/db/migrations/**, apps/worker/**, apps/web/src/routes/**]
labels: [tax, ledger]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

A taxpayer entity's income tax payable is brought to the current estimate at each reporting-period close, with one user-confirmed entry per jurisdiction (Principal 2026-11-06; ARCH §4.5). Cadence is per entity, monthly by default or quarterly. Between closes the balance sheet shows a computed line, never posted on read. POLY-66 keeps the estimate, safe harbor and freezes.

## Acceptance criteria

- [ ] Closing a period proposes one draft per jurisdiction (the change in estimate since the last close); nothing posts until confirmed.
- [ ] The cadence defaults to monthly and can be set to quarterly per entity.
- [ ] Between closes the balance sheet shows a labelled computed line; no entry posts when the sheet is read; it stays out of the trial balance.
- [ ] A pass-through or grantor entity proposes no accrual; a joint-filers parent accrues its own payable; a pass-through parent allocates tagged income to holders by the cap table on each entry's date.
- [ ] Filing posts the true-up to the return and settles the payable from the per-jurisdiction prepaid account, with the refund and apply-forward elections.
- [ ] Prior-year tax can be typed per entity, jurisdiction and year, and shows the ledger's figure as a check once one exists.
- [ ] Seeded per jurisdiction: Prepaid tax (per filing year, at the authority's custodial), Income tax payable, Tax refund receivable, Income tax expense.
- [ ] Close amount A = annualized tax to date before prepaid; delta from the last accrued_to_date in tax_close; a re-close posts a new revision, and Correct entry is not offered.
- [ ] app.allocated_income (poly_stake) returns totals × stake, never rows.
