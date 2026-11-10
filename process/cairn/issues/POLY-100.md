---
id: POLY-100
title: Pull-based deploy + timers
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-97, POLY-96, POLY-76, POLY-83]
assignee: devops-engineer
paths: [infra/deploy/**]
labels: [ops, deploy, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-09
---

INFRA §4.4–§4.6 / ARCH §8.1: a 5-minute poll under flock, digest pull, gh attestation verify pinned to the repo and signer workflow, prod git verify-tag against operator-installed allowed_signers, the tag-to-digest label check, ops-bundle extraction, check-config then migrate --plan, a pre-migration encrypted backup via the backup container, migrate under advisory lock, up -d, a 120 s health poll, automatic rollback, quarantine and heartbeat. A bad migration is recovered off the box from the operator's laptop within 60 minutes; no plaintext dump is written on the box (Principal Q8, 2026-11-08).

## Acceptance criteria

- [ ] With a fake registry fixture, an unverified image is never run.
- [ ] A failed attestation, a bad tag signature and a wrong commit label each stop the deploy and alert.
- [ ] An unhealthy release rolls back within 120 s and is quarantined; a failing migration file leaves the old containers running.
- [ ] The script never rewrites itself.
- [ ] The bad-migration rollback runbook restores from the pre-migration backup on the operator's laptop within 60 minutes (measured in the restore drill).
- [ ] A failing migration file leaves the tracking table and the schema exactly as before the run (one transaction).
- [ ] Two migrate runs started together: the second waits on the advisory lock and then applies nothing.

## Comments

### @team-lead — 2026-11-09

From the POLY-83 architect ruling (R1, R6, R7): three deploy-side requirements for INFRA / provision.sh. (1) `provision.sh` runs `packages/db/sql/bootstrap.sql` as the Postgres superuser before the first migrate — roles are cluster objects and poly_backup needs REPLICATION + BYPASSRLS; bootstrap.sql carries no passwords, provision.sh sets them. (2) The deploy runs `migrate --plan` first and aborts on exit 2 (tracking rows diverge from the journal); exit 3 means pending, proceed to apply; exit 0 nothing pending. (3) The image ships `packages/db/migrations` (incl. `meta/_journal.json`) — the startup guard in web and worker reads the bundled journal to learn the expected schema version. INFRA doc update is devops's when this issue starts.
