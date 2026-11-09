---
id: POLY-119
title: Economic view
status: backlog
milestone: POLY-1.1
parent: null
blocked_by: [POLY-118, POLY-93]
assignee: null
paths: [packages/reports/**, packages/portfolio/**, packages/db/migrations/**, apps/web/src/routes/**]
labels: [reports, db, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

Beside the gross roll-up, the economic view weights every figure by the viewer's stake in each entity (ARCH §3.3c; Principal 2026-11-07; OQ-29). It weights exactly the entities the selected parent's gross roll-up shows, each once, and adds none. The economic view is a net-worth lens and is unaffected by the tax classification (Principal, 2026-11-08, Q5).

## Acceptance criteria

- [ ] Economic net worth equals the sum over the roll-up set of the viewer's weight × entity net worth.
- [ ] An entity outside the selected parent adds nothing, even if the viewer holds units.
- [ ] A holder entity composes one level deep.
- [ ] The economic view is never more revealing than the viewer's gross view of the same parent.
- [ ] Income uses the split in force on each entry's posting date; balances use the split on as_of.
- [ ] A joint-filers parent still shows cap-table-weighted figures; only tax allocation ignores the cap table there (Principal, 2026-11-08).
- [ ] app.rollup_economic (poly_rollup) takes no Person argument; Tests: ARCH §3.3c (Σ economic + outside = gross; a spouse's separate trust weights 0).
