---
id: POLY-95
title: Compose, Postgres config + lint
status: done
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
paths: [infra/compose/**, infra/postgres/**, infra/lint/**, infra/caddy/**, infra/ci/**, infra/postgres-major, .github/workflows/**, process/cairn/issues/POLY-95.md, process/cairn/reviews/POLY-95/**, tests/**, package.json, pnpm-lock.yaml, docs/INFRA/**, docs/SECURITY/**]
labels: [ops, ci, security]
priority: null
pr: https://github.com/richmosko/polycarpic/pull/115
created: 2026-11-08
updated: 2026-11-11
---

INFRA §2.2: prod and staging compose projects, backup-net (internal, fixed subnet), upload-net, per-container secrets, the Postgres image with age, the C-75 and C-79 settings, archive_command with age, the first four pg_hba lines, and the compose-policy lint (C-70).

## Acceptance criteria

- [x] The lint has pass and fail fixtures for every INFRA §2.2 rule, including a service on both project networks, ports: outside caddy, db_password_backup in a second service, backup-net not internal, and a subnet differing from pg_hba. — tests/infra/lint.test.ts: pass fixtures plus the fail table (`web (not caddy) on both projects' edge networks`, `ports: on web`, `db_password_backup in a second service`, `backup-net not internal`, `backup-net subnet differs from pg_hba`)
- [x] A CI container runs SHOW on each Postgres setting (max_replication_slots=2, max_wal_senders=3, max_slot_wal_keep_size=2GB, log_connections). — tests/infra/image/postgres.test.ts: `SHOW %s = %s` for every setting, plus the sourcefile check
- [x] archive_command encrypts with age and fails closed when the target exists. — tests/infra/image/postgres.test.ts: `archive_command` block (`one segment -> <f>.age` decrypts byte-identical; `a DIFFERENT target already exists -> non-zero`; `the IDENTICAL segment re-archived -> non-zero`)
- [x] The Postgres tag and digest are written once, on the `FROM postgres:17.N@sha256:…` line of the postgres derivative image (INFRA §6.1a); compose, the CI Postgres service and the backup container read it from there, and a fixture with a retyped tag fails the lint. — tests/infra/lint.test.ts: `compose retypes the postgres tag`, `compose retypes tag+digest on staging`, `FROM line without a digest`; tests/infra/wiring.test.ts: `one place for the Postgres tag and digest`
- [x] A lint check fails when the major on that `FROM` line differs from `infra/postgres-major` (pass and fail fixtures). It runs in the infra lint job, so POLY-96 only needs to run that job on `infra/**` changes, which its criteria already require. — tests/infra/lint.test.ts: `FROM major 18, infra/postgres-major 17`, `infra/postgres-major 18, FROM major 17`, pass fixture `a different major is clean (18 / 18.1)`; tests/infra/wiring.test.ts: lint job runs the lint

## Comments

### @team-lead — 2026-11-10

From the POLY-128 loop (architect, gate-1 hand-off, 2026-11-11): the SvelteKit CSP (SECURITY C-07) now lives in `apps/web/vite.config.ts`, and the ruling left HSTS, `nosniff` and `Referrer-Policy` "at Caddy", which no issue owns. This issue touches the Caddy config; its ruling either takes those three headers or names the issue that does.

### @team-lead — 2026-11-10

Feature started. Branch: `feature/poly-95-compose-postgres-config-lint`. Runs in parallel with POLY-86 (team suffix `-95`).

### @architect — 2026-11-10

Gate 1 ruling issued for seceng review: process/cairn/reviews/POLY-95/ruling.md (R1 Caddy headers owned here; R2 this loop creates infra/postgres-major; R3 lint + image jobs, no new top-level job; widen paths by infra/postgres-major and process/cairn/reviews/POLY-95/**).

### @team-lead — 2026-11-11

PR opened: https://github.com/richmosko/polycarpic/pull/115. Verdict pass @ 492242d, seceng pass @ 1b29e1a, CI run 42987963075 green @ c4c1ae3.

### @team-lead — 2026-11-11

Validate passed; merging via PR #115. Closing.
