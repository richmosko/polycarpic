---
id: POLY-107
title: Ledger core
status: backlog
milestone: POLY-M2
parent: null
blocked_by: [POLY-62, POLY-84]
assignee: backend-lead
paths: [packages/ledger/**, packages/db/migrations/**]
labels: [ledger, db]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

packages/ledger and its database invariants (ARCH §3.2): journal_entry / journal_line, the balanced-entry deferred trigger, append-only and TRUNCATE triggers, the forced actor, the composite same-entity FK, the gapless journal number under poly_journal with the counter row created by an AFTER INSERT trigger on entity, and correctEntry(). POLY-64 posts into it. Custodial accounts and the chart by nature are POLY-108.

## Acceptance criteria

- [ ] Balanced (Σ base_amount = 0, at least two lines) at commit; posted rows reject UPDATE, DELETE and TRUNCATE except poly_purge for the GUC entity.
- [ ] actor_kind / actor_id forced by trigger (A-5); composite FK (entity_id, account_id).
- [ ] entity_journal_counter and the numbering trigger (poly_journal, A-23): gapless under rollback; a caller-supplied number is overwritten; multi-entity transactions lock in entity_id order.
- [ ] correctEntry() writes reversal and replacement in one transaction; posting_date_allowed() returns true.
- [ ] Property test: the trial balance is zero after random postings (G2).
- [ ] Tests: ARCH §3.2 invariants and the C-24 counter items.
