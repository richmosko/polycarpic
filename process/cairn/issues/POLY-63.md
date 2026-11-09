---
id: POLY-63
title: Per-entity financial-health dashboard
status: backlog
milestone: POLY-M2
parent: null
blocked_by: [POLY-62, POLY-64, POLY-107]
assignee: null
labels: []
priority: null
pr: null
created: 2026-09-27
updated: 2026-11-08
---

PRD §4 Story 2. Depends on the entity/membership schema and on the GL existing enough to show balances. Source: docs/PRD/index.html

## Acceptance criteria

- [ ] A parent with its own accounts shows the ordinary dashboard for those accounts only; the consolidated view is POLY-118 (POLY-1.1).

## Comments

### @architect — 2026-10-02

Scope addition (team-lead ruling, 2026-10-02): header Search folds into this issue. It searches accounts (name and number) and payees and memos on posted entries and pending drafts, using Postgres full-text (tsvector) inside withTenant, so results are RLS-filtered with no separate index. SearchResults are grouped by kind. Viewers get masked numbers and no raw payloads. Report views join the results when POLY-73 lands (M5). Source: ARCH §2.4 @ 82d671c.

### @architect — 2026-11-08

Decomposition 2026-11-08: a parent entity holding its own accounts gets this ordinary dashboard from the first slice; consolidation is POLY-118. Blocked by the ledger core POLY-107.
