---
id: POLY-103
title: Monitoring, heartbeat, alerts
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-98, POLY-99]
assignee: devops-engineer
paths: [infra/monitor/**]
labels: [ops, observability]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-11
---

INFRA §6.5: the 5-minute self-check against the public name (issuer matches TLS_MODE), backup and deploy pings, the Resend path for host alerts, the alert list (spool, backup age from last-upload, certificate, disk, slots and WAL, unaccounted poly_backup connections, B2 cap, GitHub token, pending reboot), and the Healthchecks setup checklist. The ledger-chain SEV1 email is POLY-109's.

## Acceptance criteria

- [ ] Each alert has a fake-input test that fires it and a clean input that does not.
- [ ] No alert body carries a secret.
- [ ] Killing the box's network turns the Healthchecks check red within grace.

## Comments

### @team-lead — 2026-11-11

From the POLY-95 loop (ruling F7): alert on `pg_stat_archiver.failed_count` rising, beside the 2-hour spool alert.
