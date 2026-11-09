---
id: POLY-116
title: Restore drill (GA gate)
status: backlog
milestone: POLY-1.0
parent: null
blocked_by: [POLY-99, POLY-105]
assignee: devops-engineer
paths: [infra/drill.sh, process/cairn/reviews/**, .github/workflows/**]
labels: [ops, backup, ga-gate]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

DECISIONS 2026-11-06 / INFRA §6.7: the first passing drill against real backup objects, run off the box with the read key and the age key from the password manager, plus the bad-migration path of §6.4 timed end to end against the 60-minute RTO (Principal Q8, 2026-11-08). A drill not run in 45 days raises an issue and an email.

## Acceptance criteria

- [ ] DRILL PASSED is recorded in process/cairn/reviews/ with timings.
- [ ] Checks: trial balance zero per entity; hash-chain verifier passes; globals carry the RLS roles and no password hash; FORCE-RLS row counts match; WAL path within 20 minutes; put-only key attempts are denied.
- [ ] The bad-migration restore is measured from the operator's laptop at or under 60 minutes, with no plaintext dump on the box.
- [ ] The 45-day reminder automation exists; GA cannot be tagged without the review file.
