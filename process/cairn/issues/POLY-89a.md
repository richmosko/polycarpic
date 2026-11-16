---
id: POLY-89a
title: Second step ruling
status: in-progress
milestone: POLY-M1
parent: POLY-89
blocked_by: []
assignee: architect
paths: [process/cairn/issues/POLY-89.md, process/cairn/reviews/POLY-89/**, process/cairn/issues/POLY-89a.md, docs/ARCH/**]
stage: plan
estimate.cost_usd: "8.00"
estimate.gate_cycles: 2
labels: [auth, security]
priority: null
pr: null
created: 2026-11-16
updated: 2026-11-16
---

The architect rules the design for POLY-89 before any test is written: the trigger set, the definers, the migration order, the single exemption predicate, where `reset-mfa` lives, and the ARCH §3.1c correction. Written against the POLY-147 marker; guards are role-indifferent triggers.

## Acceptance criteria

- [ ] A ruling comment on POLY-89 covers every one of its 15 criteria, names each trigger and definer, and gives the migration order against BetterAuth's measured write order.
- [ ] The ruling states where `polycarpic user reset-mfa` lives, or defers the command to POLY-98 with the database definer and its test landing here.
- [ ] seceng's review of the ruling is answered; any re-issue is a single replacement ruling, not an addendum chain.
- [ ] ARCH §3.1c is corrected in this PR, with no history or version runs in the doc.