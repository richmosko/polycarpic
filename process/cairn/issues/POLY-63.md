---
id: POLY-63
title: Per-entity financial-health dashboard
status: backlog
milestone: POLY-M3
parent: null
blocked_by: [POLY-62, POLY-64]
assignee: null
labels: []
priority: null
pr: null
created: 2026-09-27
updated: 2026-10-02
---

PRD §4 Story 1. Depends on the entity/membership schema and on the GL existing enough to show balances. Source: docs/PRD/index.html

## Comments

### @architect — 2026-10-02

Scope addition (team-lead ruling, 2026-10-02): header Search folds into this issue. It searches accounts (name and number) and payees and memos on posted entries and pending drafts, using Postgres full-text (tsvector) inside withTenant, so results are RLS-filtered with no separate index. SearchResults are grouped by kind. Viewers get masked numbers and no raw payloads. Report views join the results when POLY-73 lands (M5). Source: ARCH §2.4 @ 82d671c.
