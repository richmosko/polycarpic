---
id: POLY-108
title: Custodial accounts
status: backlog
milestone: POLY-M2
parent: null
blocked_by: [POLY-107]
assignee: null
paths: [packages/ledger/**, packages/db/migrations/**, apps/web/src/routes/**]
labels: [ledger, db]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

A custodial account (institution, account type, number mask, provider link) is its own record, and the ledger is organised by nature with a custodian sub-account under each nature class (Option C; ARCH §3.6; Principal 2026-11-06, 2026-11-07). Real estate and other no-custodian assets sit beside the nature classes, outside Allocation. Placed in M2 with the fake import (PM recommendation, adopted).

## Acceptance criteria

- [ ] Creating a custodial account creates its ledger sub-accounts under the right nature classes, named institution plus type, with the mask added to both only when a second of the same type exists.
- [ ] A custodial's book value is the sum of its ledger accounts; its cash is its cash account.
- [ ] Real estate is an asset account outside the nature classes; it counts in net worth and the balance sheet and never in Allocation.
- [ ] The Custodial Accounts screen groups by Institution or Account type; a card account shows owed as negative.
- [ ] The import adapter attaches each raw row to a custodial account through provider_account.
- [ ] custodial_account table; partial unique index (custodial_account_id, nature_class); the per-entity seeded chart (four nature classes, Cash in Transit, Suspense, Opening Balance Equity, realized gains by holding period); tax authorities as custodials with no provider link.
- [ ] custodial_account stores the account-number mask (last 4), never the full number; every read path, the viewer's included, shows only the mask (ARCH §2.4, §3.1, §6.1, from mosko-fintech 002).
