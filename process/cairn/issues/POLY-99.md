---
id: POLY-99
title: Backup, uploader, restore, drill
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-97, POLY-95, POLY-83]
assignee: devops-engineer
paths: [infra/backup/**, infra/restore.sh, infra/drill.sh]
labels: [ops, backup, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-11
---

INFRA §2.2, §6.1, §6.4, §6.7, D-13..D-15. backup: pg_basebackup -Ft -X none, pg_dump -Fc, pg_dumpall --globals-only --no-role-passwords, each through age in the pipe; a premigration mode. uploader: rclone put-only to B2 with checksum verify. restore.sh decrypts on the operator's laptop only; drill.sh carries the §6.7 assertions. The bad-migration restore runs off the box from the laptop, RTO 60 minutes, and no plaintext dump ever exists on the box (Principal Q8, 2026-11-08).

## Acceptance criteria

- [ ] shellcheck clean; a container test shows no plaintext file ever appears in the spool.
- [ ] backup has no route out and no bucket key; uploader has no DB credential.
- [ ] A round trip on a scratch Postgres restores base plus WAL and the dump.
- [ ] A mismatched checksum leaves the spool file and pings /fail.
- [ ] restore.sh --premigration decrypts only on the machine running it.

## Comments

### @team-lead — 2026-11-11

From the POLY-95 loop: the uploader never reads `spool/wal/.inflight/` (ruling F2), and it cannot ship anything until POLY-97 grants uid 10005 access to the spool (verdict F12).
