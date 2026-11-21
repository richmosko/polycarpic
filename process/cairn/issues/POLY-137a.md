---
id: POLY-137a
title: Auth follow-ups ruling
status: todo
milestone: POLY-M1
parent: POLY-137
blocked_by: []
assignee: architect
paths: [process/cairn/issues/POLY-137.md, process/cairn/reviews/POLY-137/**, process/cairn/issues/POLY-137a.md, docs/ARCH/**]
stage: plan
estimate.cost_usd: "8.00"
estimate.gate_cycles: 2
labels: [auth, security]
priority: null
pr: null
created: 2026-11-21
updated: 2026-11-21
---

The architect rules the design for this loop's criteria on POLY-137 before any test is written.

## Acceptance criteria

- [ ] A ruling at `process/cairn/reviews/POLY-137/ruling.md` covers every row of POLY-137's "Acceptance criteria (this loop)": the mailer seam and its fake, the reset wiring, where the 24-hour hold and its cancel live (the database decides), the limiter, the purge schedule, and the migration order.
- [ ] Each measured claim cites its command; the rest is tagged (unmeasured).
- [ ] seceng's review of the ruling is answered; any re-issue is a single replacement ruling.