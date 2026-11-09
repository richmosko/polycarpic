---
id: POLY-118
title: Parent roll-up
status: backlog
milestone: POLY-1.1
parent: null
blocked_by: [POLY-94, POLY-63, POLY-107]
assignee: null
paths: [packages/reports/**, packages/portfolio/**, packages/db/migrations/**, apps/web/src/routes/**]
labels: [reports, db, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

A parent's viewer sees consolidated totals equal to the sum of everything beneath it, each base entity counted once at any depth, plus the parent's own accounts (ARCH §3.3a, §3.3b; SECURITY C-19, C-25; OQ-18, P2). For entities the viewer holds no membership on, only class totals and income and expense by top-level category are shown, for any period. A drill into such an entity stops at its boundary.

## Acceptance criteria

- [ ] Totals equal the sum of the included entities, each once when reachable by two paths; a parent's own accounts are included.
- [ ] A viewer with no membership on a child sees class totals and top-level category income and expense only, for any date range; never a payee, memo, account or counterparty.
- [ ] Drilling into a non-member child stops at the boundary; a member of that child can drill further.
- [ ] The holdings popover lists accounts for entities the viewer may see, through ordinary RLS, and only totals for the rest.
- [ ] app.rollup_descendants, app.rollup_totals and app.rollup_tree (poly_rollup) with role-targeted SELECT policies confined to descendants of the caller's parents; fixed RETURNS TABLE; nothing without a viewer membership on the parent.
- [ ] Tests: ARCH §3.3a and the §3.3b roll-up items (a diamond sums once; zero tenant rows at every depth).
