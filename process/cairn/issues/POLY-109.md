---
id: POLY-109
title: Ledger hash chain + verifier
status: backlog
milestone: POLY-M2
parent: null
blocked_by: [POLY-107, POLY-64]
assignee: backend-lead
paths: [packages/ledger/**, packages/db/migrations/**, apps/worker/**]
labels: [ledger, db, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

SECURITY C-24 / ARCH §3.2.9 (Principal P4, 2026-11-07): journal_chain written at commit by the deferred app.chain_entry() trigger under the counter lock, the late-line guard, a pinned and versioned canonical encoding, and the weekly per-entity verifier whose break is SEV1. It exposes the head the export carries.

## Acceptance criteria

- [ ] journal_chain is append-only, inserted only by poly_journal; the head lives on the counter; entries are never UPDATEd to hold a hash.
- [ ] The canonical encoding spec (field order, numeric text form, UTF-8 NFC) is committed beside the code with alg_version = 1 and golden vectors.
- [ ] The late-line BEFORE INSERT trigger on journal_line refuses a line for an already chained entry.
- [ ] The weekly verifier job runs via app.job_targets; a break writes an audit_event, a notification, and an email to every owner and the operator.
- [ ] ledger.head(entity) returns {journal_number, entry_hash, alg_version}, null for an entity with no posted entry.
- [ ] Tests: ARCH §3.2.9 Tests, except the export-head equality (POLY-110).
