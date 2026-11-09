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
updated: 2026-11-08
---

INFRA §4.4–§4.6 / ARCH §8.1: a 5-minute poll under flock, digest pull, gh attestation verify pinned to the repo and signer workflow, prod git verify-tag against operator-installed allowed_signers, the tag-to-digest label check, ops-bundle extraction, check-config then migrate --plan, a pre-migration encrypted backup via the backup container, migrate under advisory lock, up -d, a 120 s health poll, automatic rollback, quarantine and heartbeat. A bad migration is recovered off the box from the operator's laptop within 60 minutes; no plaintext dump is written on the box (Principal Q8, 2026-11-08).

## Acceptance criteria

- [ ] With a fake registry fixture, an unverified image is never run.
- [ ] A failed attestation, a bad tag signature and a wrong commit label each stop the deploy and alert.
- [ ] An unhealthy release rolls back within 120 s and is quarantined; a failing migration file leaves the old containers running.
- [ ] The script never rewrites itself.
- [ ] The bad-migration rollback runbook restores from the pre-migration backup on the operator's laptop within 60 minutes (measured in the restore drill).
