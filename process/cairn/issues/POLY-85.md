---
id: POLY-85
title: Runtime config + ops hooks
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-82]
assignee: backend-lead
paths: [packages/config/**, apps/web/**, apps/worker/**, apps/migrate/**, Dockerfile, .dockerignore, tests/**, layers.json, apps/*/package.json, pnpm-lock.yaml, package.json, docs/ARCH/**, docs/INFRA/**, docs/SECURITY/**]
labels: [enabler, infra]
priority: P2
pr: null
created: 2026-11-08
updated: 2026-11-10
---

The app-side hooks the operations scripts depend on, from devops's not-filed list (INFRA §3.2, §6.5, §9.3; ARCH §7.4, §7.5, §8.1): the *_FILE secret loader, the loopback-only status listener inside web (until POLY-81 moves it to an admin service), the image label carrying the source commit that the deploy check reads, and the structured log schema.

## Acceptance criteria

- [ ] Every secret is read from a mounted file named by a *_FILE variable; a missing or empty file refuses start, naming the variable.
- [ ] The status listener binds 127.0.0.1 only and returns migration and app status; the public /api/v1/health returns ok or not only (R-6).
- [ ] The image carries the commit label the attestation covers, and POLY-100's tag-to-digest check reads it.
- [ ] Logs are structured JSON to a committed schema; no secret, token or raw provider payload field is logged.

## Comments

### @team-lead — 2026-11-09

From the POLY-83 architect ruling (R7, `process/cairn/reviews/POLY-83/ruling.md`): `migrate check-config` lands in POLY-83 checking only the DB-side inputs (migrator secret file present and non-empty, connection settings present; exit 0/1, no connection). The TLS_MODE, PLAID_ENV and other-secret checks land here with `packages/config` — extend `apps/migrate`'s check-config, do not duplicate it. `packages/config` is L0 in layers.json (ARCH v1.15.2); `apps/migrate` already allow-lists it.

### @team-lead — 2026-11-10

Feature started. Branch: `feature/poly-85-runtime-config-ops-hooks`.
