---
id: POLY-152a
title: Sign-in service ruling
status: done
milestone: POLY-M1
parent: POLY-152
blocked_by: []
assignee: architect
paths: [process/cairn/issues/POLY-152.md, process/cairn/reviews/POLY-152/**, process/cairn/issues/POLY-152a.md, docs/ARCH/**]
stage: plan
estimate.cost_usd: "9.00"
estimate.gate_cycles: 2
actual.cost_usd: "4.4728"
actual.tokens: 7590692
actual.gate_cycles: 2
actual.wall_clock: 15
ratio: "0.50"
labels: [security, auth]
priority: null
pr: null
created: 2026-11-17
updated: 2026-11-17
---

The architect rules the design for POLY-152 from the spike record (`process/cairn/reviews/POLY-148/spike.md`) before any test is written.

## Acceptance criteria

- [ ] A ruling at `process/cairn/reviews/POLY-152/ruling.md` covers every one of POLY-152's 9 criteria: the process and its mounts, poly_auth's exact grant list, `provision_person`, the service's own entry definer, the `recent_auth_at` strip, the commit-together rule, the cap's cookie path, and the migration order.
- [ ] The ruling settles refresh (spike §7.6): what re-issues which cookie, and when, within the 30-day cap.
- [ ] The ruling says how POLY-89's guards, definers and fixtures move to poly_auth transactions, and what web still does until POLY-153.
- [ ] seceng's review of the ruling is answered; any re-issue is a single replacement ruling, not an addendum chain.