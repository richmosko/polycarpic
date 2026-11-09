---
id: POLY-117
title: Capacity + cost at GA
status: backlog
milestone: POLY-1.0
parent: null
blocked_by: [POLY-104]
assignee: devops-engineer
paths: [process/cairn/reviews/**, infra/compose/**]
labels: [ops, ga-gate]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

OQ-INFRA-5: after M1 lands and again before GA, measure docker stats against the memory caps, plan size, volume, disk and egress, max_slot_wal_keep_size, and B2 storage against its cap; adjust caps or downsize the plan.

## Acceptance criteria

- [ ] Each cap has a measured peak recorded beside it.
- [ ] No container is OOM-killed in a full drill plus deploy.
- [ ] The INFRA §6.5 alert thresholds are replaced by measured values.
