---
id: POLY-116
title: Restore drill (GA gate)
status: backlog
milestone: POLY-1.0
parent: null
blocked_by: [POLY-99, POLY-105, POLY-158]
assignee: devops-engineer
paths: [infra/drill.sh, process/cairn/reviews/**, .github/workflows/**]
labels: [ops, backup, ga-gate]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-24
---

DECISIONS 2026-11-06 / INFRA §6.7: the first passing drill against real backup objects, run off the box with the read key and the age key from the password manager, plus the bad-migration path of §6.4 timed end to end against the 60-minute RTO (Principal Q8, 2026-11-08). A drill not run in 45 days raises an issue and an email.

## Acceptance criteria

- [ ] DRILL PASSED is recorded in process/cairn/reviews/ with timings.
- [ ] Checks: trial balance zero per entity; hash-chain verifier passes; globals carry the RLS roles and no password hash; FORCE-RLS row counts match; WAL path within 20 minutes; put-only key attempts are denied.
- [ ] The bad-migration restore is measured from the operator's laptop at or under 60 minutes, with no plaintext dump on the box.
- [ ] The 45-day reminder automation exists; GA cannot be tagged without the review file.

## Comments

### @team-lead — 2026-11-22

From the POLY-99 verdict (process/cairn/reviews/POLY-99/verdict.md §8, §9; ruling §L1, §D2): the timed 60-minute bad-migration recovery; DR9 on a ledger schema; fdesetup on a real Mac; whether a --rm scratch survives a Docker Desktop restart; timings at real data size; restore.sh on a non-macOS host. Unhomed and candidate for this issue or a new one before POLY-104: the box-side route back into prod (INFRA's former restore-apply), bound by seceng's conditions: streamed, into a separate throwaway cluster with no network, data only, as a non-superuser; its design waits on the Principal's D2. Debt: if more drill logic is added, move selection and verdict logic out of shell into tested Python; the backup suite is at 384 s of a 420 s target with 18 real restores, so a further real restore needs consolidation first (Guards correction @ f2a5705a).

### @team-lead — 2026-11-23

From POLY-100 (2026-11-23, Principal agreed): the 60-minute timing of the bad-migration rollback runbook is measured here, in the timed restore drill. POLY-100 proves only the runbook's inputs (its T13).
