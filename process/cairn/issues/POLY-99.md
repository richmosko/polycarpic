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
updated: 2026-11-22
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

### @team-lead — 2026-11-22

From the POLY-97 loop (ruling Scope, Addendum 1 S6; seceng positions 1a/1b; build review F-probe2):
- Restores and drills pick a file **version** by upload time, never "latest by name"; alert when a name has more than one version or any hide marker; restore only into a throwaway Postgres.
- The uploader exits non-zero and skips the heartbeat ping on any refused upload.
- Upload verification uses no HEAD and no list: the box key never gains `readFiles` or `listFiles` (it may only narrow to `writeFiles`).
- Restore runbook F4 (`app.session_handle` restored with `session`) stays here.
- Once the uploader's rclone flags are fixed here, `infra/operator/b2-setup.py --probe` reuses them.
- No spool writer may `chmod` a spool file: a `chmod 0600` cancels the uploader's ACL (ruling M1).
