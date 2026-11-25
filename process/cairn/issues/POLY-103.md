---
id: POLY-103
title: Monitoring, heartbeat, alerts
status: backlog
milestone: POLY-M6
parent: null
blocked_by: [POLY-98, POLY-99]
assignee: devops-engineer
paths: [infra/monitor/**]
labels: [ops, observability]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-24
---

INFRA §6.5: the 5-minute self-check against the public name (issuer matches TLS_MODE), backup and deploy pings, the Resend path for host alerts, the alert list (spool, backup age from last-upload, certificate, disk, slots and WAL, unaccounted poly_backup connections, B2 cap, GitHub token, pending reboot), and the Healthchecks setup checklist. The ledger-chain SEV1 email is POLY-109's.

## Acceptance criteria

- [ ] Each alert has a fake-input test that fires it and a clean input that does not.
- [ ] No alert body carries a secret.
- [ ] Killing the box's network turns the Healthchecks check red within grace.

## Comments

### @team-lead — 2026-11-11

From the POLY-95 loop (ruling F7): alert on `pg_stat_archiver.failed_count` rising, beside the 2-hour spool alert.

### @team-lead — 2026-11-19

From the POLY-149 loop (`process/DECISIONS.md`, 2026-11-19; Principal). **Copy the sign-in record off the server.** `app.sign_in_record` can be erased by the migration credential or by anyone with full control of the database server. When log shipping exists, ship each new record line to a store that no database credential can write or delete, and say in SECURITY what the copy covers. Until then the risk stands as accepted.

### @team-lead — 2026-11-20

From POLY-150 (devops healthcheck review, 2026-11-20). The worker's and other containers' healthchecks are `node -e process.exit(0)`, which is always healthy: it proves the container runs, not that the service works. Whether web's healthcheck (`/`, following the 303 to `/sign-in`) needs a client address is unmeasured. The auth healthcheck was fixed in POLY-150 to send `x-forwarded-for`. No healthcheck has run in a compose stack; the first staging deploy (POLY-104) is the real check.

### @team-lead — 2026-11-22

From the POLY-97 loop (ruling Scope): an alert when the worker's `job.run` lines stop (POLY-137 runbook item) belongs here.

### @team-lead — 2026-11-22

From the POLY-99 verdict (process/cairn/reviews/POLY-99/verdict.md §8): alerts left to this issue: spool older than 2 h, `last-upload` older than 26 h, the 45-day drill alert, WAL kept by a slot. Root (the job runner) sends every ping; `heartbeat_url` is a host-only secret at /etc/polycarpic/secrets/host/, root:root 0400, the full check URL with only /fail appended. Open with the Principal (ruling §D3, seceng's review): a daily off-box listing check with a list-only key, since an uploader that reports uploads it never made is seen only at the monthly drill (SECURITY C-73 residual).
