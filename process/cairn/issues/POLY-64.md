---
id: POLY-64
title: Provider-agnostic import adapter interface + fake source
status: backlog
milestone: POLY-M2
parent: null
blocked_by: []
assignee: null
labels: []
priority: null
pr: null
created: 2026-09-27
updated: 2026-10-02
---

PRD §4 Story 2. Kickoff §2.6/§2.11: draft to confirm flow, DB-trigger-enforced immutability once posted. Source: docs/PRD/index.html

## Comments

### @architect — 2026-09-28

Scope addition from SECURITY v1 (OQ-3, SECURITY §4.4; ARCH §3.1 and §3.3 @ eaa825e): provider_connection.linked_by_user_id is NOT NULL and is the principal that import-job writes run under (actor stays system:<job>). When that user's membership is revoked or their account is deleted, the connection flips to principal_invalid, surfaces on the dashboard, and writes an audit_event. It must never fail silently. Viewers never read raw_transaction.payload (manager+ only).

### @architect — 2026-09-28

Scope addition (team-lead ruling, 2026-09-28): the upload/attach UI folds into this issue. That covers attaching supporting documents to an entry, draft or account, and unlinking. It follows ARCH §3.5 @ fcffe6c and SECURITY T-37 / C-46: attachment + attachment_blob + entry_attachment with entity_id composite FKs; 10 MB limit; server-sniffed type allowlist; download-only serving (RFC 6266 filename, nosniff, CSP default-src 'none'; sandbox); per-entity quota and rate limit; purge coverage. Viewers read; manager+ uploads.

### @architect — 2026-10-02

Scope addition (team-lead ruling, 2026-10-02): the notification centre folds into this issue. It uses an entity-scoped, per-recipient notification table (RLS-covered; insert-only except read_at), written in the same transaction as each alert event, and a header bell with NotificationList plus an unread count. In scope here: the producers for link health (token_expired, principal_invalid, stale) and failed import batches. Later producers (aged CIT, auto-post switched off, membership changes, purge pending, tax due dates) land with their own issues. Email delivery via Resend follows the user's notification preferences in Settings. Source: ARCH §2.4 and §3.1 @ 82d671c.
