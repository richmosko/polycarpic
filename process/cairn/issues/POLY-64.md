---
id: POLY-64
title: Provider-agnostic import adapter interface + fake source
status: backlog
milestone: POLY-M2
parent: null
blocked_by: [POLY-107, POLY-108, POLY-130]
assignee: null
labels: []
priority: null
pr: null
created: 2026-09-27
updated: 2026-11-08
---

PRD §4 Story 2. Kickoff §2.6/§2.11: draft to confirm flow, DB-trigger-enforced immutability once posted. Source: docs/PRD/index.html

## Acceptance criteria

- [ ] Each raw row attaches to a custodial account through provider_account (POLY-108).
- [ ] Transactions group into one entry only within a single bank date (G3).
- [ ] Confirm enforces gates G1 to G6 (ARCH §3.2a); apps/worker runs the import poll as an idempotent job unit.
- [ ] The import poll in apps/worker passes `ingest` an opener bound to the job's one connection (built from `secrets/open`), never `open()` itself. `ingest` and the adapters type it with the type-only `Opener` from `@poly/secrets`; the fake source accepts it and opens nothing (ARCH §2.2, SECURITY A-39).
- [ ] Raw rows de-duplicate structurally (ARCH §3.1, §6.1, from mosko-fintech 021): a unique de-dup hash with INSERT … ON CONFLICT DO NOTHING; re-running the same batch inserts no row, and the skipped rows are counted as duplicates on import_batch (ARCH §2.4).

## Comments

### @architect — 2026-09-28

Scope addition from SECURITY v1 (OQ-3, SECURITY §4.4; ARCH §3.1 and §3.3 @ eaa825e): provider_connection.linked_by_user_id is NOT NULL and is the principal that import-job writes run under (actor stays system:<job>). When that user's membership is revoked or their account is deleted, the connection flips to principal_invalid, surfaces on the dashboard, and writes an audit_event. It must never fail silently. Viewers never read raw_transaction.payload (manager+ only).

### @architect — 2026-09-28

Scope addition (team-lead ruling, 2026-09-28): the upload/attach UI folds into this issue. That covers attaching supporting documents to an entry, draft or account, and unlinking. It follows ARCH §3.5 @ fcffe6c and SECURITY T-37 / C-46: attachment + attachment_blob + entry_attachment with entity_id composite FKs; 10 MB limit; server-sniffed type allowlist; download-only serving (RFC 6266 filename, nosniff, CSP default-src 'none'; sandbox); per-entity quota and rate limit; purge coverage. Viewers read; manager+ uploads.

### @architect — 2026-10-02

Scope addition (team-lead ruling, 2026-10-02): the notification centre folds into this issue. It uses an entity-scoped, per-recipient notification table (RLS-covered; insert-only except read_at), written in the same transaction as each alert event, and a header bell with NotificationList plus an unread count. In scope here: the producers for link health (token_expired, principal_invalid, stale) and failed import batches. Later producers (aged CIT, auto-post switched off, membership changes, purge pending, tax due dates) land with their own issues. Email delivery via Resend follows the user's notification preferences in Settings. Source: ARCH §2.4 and §3.1 @ 82d671c.

### @architect — 2026-10-10

Correction (DESIGN pass 6, 2026-10-10): there is no header bell. Notifications are proposed to open from the avatar popover, with an unread badge on the avatar (ARCH §2.4). Everything else in the notification scope comment stands.

### @architect — 2026-11-08

Re-scoped 2026-11-08. The ledger core moves to POLY-107 and custodial accounts to POLY-108; POLY-64 posts into them. The notification and audit_event tables move to POLY-62; this issue keeps the notification centre UI and the link-health producers. Scope: ImportAdapter plus fake source, raw store and de-dup, drafts, rules, confirm with gates G1 to G6, and the worker's import poll. Data-source priority per custodial: files, then a direct free API, then Plaid, then SimpleFIN; implementation order fake, files, direct, Plaid, SimpleFIN. Before v1.0 the Plaid Sandbox feeds the real adapter on staging and no real books exist.
