---
id: POLY-95
title: Compose, Postgres config + lint
status: backlog
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
paths: [infra/compose/**, infra/postgres/**, infra/lint/**]
labels: [ops, ci, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

INFRA §2.2: prod and staging compose projects, backup-net (internal, fixed subnet), upload-net, per-container secrets, the Postgres image with age, the C-75 and C-79 settings, archive_command with age, the first four pg_hba lines, and the compose-policy lint (C-70).

## Acceptance criteria

- [ ] The lint has pass and fail fixtures for every INFRA §2.2 rule, including a service on both project networks, ports: outside caddy, db_password_backup in a second service, backup-net not internal, and a subnet differing from pg_hba.
- [ ] A CI container runs SHOW on each Postgres setting (max_replication_slots=2, max_wal_senders=3, max_slot_wal_keep_size=2GB, log_connections).
- [ ] archive_command encrypts with age and fails closed when the target exists.
- [ ] The Postgres tag and digest are written once, on the `FROM postgres:17.N@sha256:…` line of the postgres derivative image (INFRA §6.1a); compose, the CI Postgres service and the backup container read it from there, and a fixture with a retyped tag fails the lint.
- [ ] A lint check fails when the major on that `FROM` line differs from `infra/postgres-major` (pass and fail fixtures). It runs in the infra lint job, so POLY-96 only needs to run that job on `infra/**` changes, which its criteria already require.
