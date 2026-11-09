---
id: POLY-110
title: Export with ledger fingerprint
status: backlog
milestone: POLY-M2
parent: null
blocked_by: [POLY-109, POLY-89]
assignee: null
paths: [packages/ledger/**, packages/tenancy/**, apps/web/src/routes/**]
labels: [ledger, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

Every export of an entity's books carries the head of its hash chain, so the owner can later prove the books are the ones the system held (PRD §4; SECURITY C-24). The export is also what the purge guard requires: a SHA-256, the snapshot marker and an export.completed audit event (ARCH §3.4 guards 3–4, §2.4 ExportReceipt). Placed in M2 (PM placement, adopted).

## Acceptance criteria

- [ ] An export shows the fingerprint on the page and inside the file; an entity with no posted entries says so.
- [ ] Re-checking an export against a later ledger confirms the chain through that head is unchanged.
- [ ] Export needs the second-step prompt (step-up).
- [ ] The export covers every purgeable table (the same catalog-derived list the purge uses) plus attachments.
- [ ] export.completed carries the SHA-256, the snapshot marker and {journal_number, entry_hash, alg_version}.
- [ ] Test: the export's head equals the verifier's.
