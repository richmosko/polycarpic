---
id: POLY-93
title: Cap table
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-90]
assignee: null
paths: [packages/db/migrations/**, packages/tenancy/**, apps/web/src/routes/**]
labels: [db, tenancy, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

Every entity carries a total unit count and effective-dated, append-only holder rows (ARCH §3.1a; Principal 2026-11-07; SECURITY A-18, C-27). Holders are Persons, Trusts or Businesses, never users; units sum to at most the total and the remainder reads as outside owners. Equity is independent of access. Placed in M1 with the membership schema (PM recommendation, adopted). On a multi-owner entity the M1 gate refuses edits until co-owner approvals ship in POLY-1.0. Former-holder behaviour is in POLY-114.

## Acceptance criteria

- [ ] An owner sets a total and adds holders; the screen shows each holder's units, share of total, and the outside-owners remainder.
- [ ] Units over the total are refused, at every change point (deferred trigger).
- [ ] Edits append rows; a past date's split can be read; prior rows cannot be changed or deleted.
- [ ] The editor lists owner-access members first, with add holder for anyone else; a Person holder whose user has no access is offered Invite as viewer.
- [ ] A 0-unit owner is accepted and shown as such.
- [ ] A cycle, directly or via a holder, and a two-link entity chain are refused, including through an entity the editor cannot see (app.check_equity_holding, poly_graph).
- [ ] Adding or changing a holder notifies that holder (its owners for an entity holder).
- [ ] New non-Person entities default to 100 units held by the creator's own Person.
- [ ] poly_stake definers app.my_stakes, app.cap_table_candidates, app.held_entities and one split function on the allowlist; equity_* SELECT not widened.
- [ ] The M1 multi-owner gate covers equity_total and equity_holding.
- [ ] Tests: ARCH §3.1a Tests.
