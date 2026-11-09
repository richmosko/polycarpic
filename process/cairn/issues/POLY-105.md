---
id: POLY-105
title: Backup + storage first-run checks
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-99, POLY-104]
assignee: devops-engineer
paths: [process/cairn/reviews/**, docs/INFRA/index.html]
labels: [ops, verification, backup]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

OQ-INFRA-4 and OQ-INFRA-11 on the real B2 bucket and staging Postgres: compliance-mode lock, the put-only key's capability set, the lifecycle rule, refused delete / overwrite / shorten / bucket-retention attempts, the storage cap; base backup with -X none recovering through archived WAL; poly_backup dumping every row of a FORCE-RLS table; no slot left after a run.

## Acceptance criteria

- [ ] Each item has a recorded pass or fail, and INFRA v1.2 states the measured value.
- [ ] Any fail goes back to SecEng and the architect before the first real backup.
