---
id: POLY-67
title: Securities lot sub-ledger (book + daily market value)
status: backlog
milestone: POLY-M4
parent: null
blocked_by: [POLY-64, POLY-108]
assignee: null
labels: []
priority: null
pr: null
created: 2026-09-27
updated: 2026-11-08
---

PRD §4 Story 5. Kickoff §2.5. Source: docs/PRD/index.html

## Acceptance criteria

- [ ] A lot references its custodial_account and security, never a ledger account; its basis posts to the ledger account of the security's nature class under that custodial.
- [ ] A sale stores proceeds and per-lot basis on an append-only lot_match (kind sale); the gain posts to the short- or long-term account by holding period.
- [ ] An inter-custodial transfer closes the old lot with a lot_match of kind transfer and writes a successor with the original date and basis (transferred_from_lot_id).
- [ ] Return of capital and amortization are lot_adjustment rows; gate G7 holds a securities line without its lot write or class mapping in Pending.
- [ ] The lot-to-ledger tie (ARCH §3.2.8) is asserted by a periodic job that alerts, never repairs; security_allocation maps a security to a sub-category per entity.
- [ ] lot_match is an append-only junction with match_seq; the latest batch per lot is current, and a re-match appends a new batch rather than updating (ARCH §3.1, §6.1, from mosko-fintech 032).
- [ ] price_observation is unique on (security, date, source) and valuation reads the highest-priority source for a date; a better source arriving later replaces a stale fallback without deleting it (ARCH §3.1, §6.1, §9, from mosko-fintech 019).

## Comments

### @architect — 2026-11-08

Re-scoped to Option C at the 2026-11-08 decomposition (ARCH §3.6, OQ-22). Market value is cash plus lots at the latest price; the derived figure reads Unrealized. Form 8949 facts are stored on lot_match, never derived. Blocked by custodial accounts POLY-108.
