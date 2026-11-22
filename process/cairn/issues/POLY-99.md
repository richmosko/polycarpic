---
id: POLY-99
title: Backup, uploader, restore, drill
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-97, POLY-95, POLY-83]
assignee: devops-engineer
paths: [process/cairn/issues/POLY-99.md, process/cairn/reviews/POLY-99/**, infra/backup/**, infra/restore.sh, infra/drill.sh, infra/ops/**, infra/operator/**, infra/compose/**, infra/provision.sh, infra/provision-check.sh, infra/postgres/**, infra/README.md, infra/lint/**, infra/ci/**, tests/**, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, .github/workflows/**, package.json, pnpm-lock.yaml, .gitignore, .gitleaksignore]
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

### @team-lead — 2026-11-22

From the POLY-98 security review (`process/cairn/reviews/POLY-98/ruling-review.md` R-a; ruling R7): `polycarpic-ops status` accounts for poly_backup connections by the windows in `jobs.log`, which the backup uid itself writes, so a compromised backup container could write a window covering its own connections (capped at 6 h by K9). Take the windows from a source root writes: the systemd unit start and stop times in the journal. The ruling's R7 also fixes the line formats the backup and uploader write to `jobs.log` and `last-upload`.

### @team-lead — 2026-11-22

Feature started. Branch: `feature/poly-99-backup-restore-drill`. Runs before POLY-100 by the Principal's choice of 2026-11-22: the deploy's pre-migration backup and its 60-minute restore criterion rest on this issue's backup container, `restore.sh` and drill. POLY-100 is claimed on `feature/poly-100-pull-based-deploy` (one start commit) and parked until this merges; this loop's ruling fixes the premigration interface the deploy calls.

### @architect — 2026-11-22

Gate 1, ruling: `process/cairn/reviews/POLY-99/ruling.md` @ 9f87a180a2403b83023a7f226294abf37f4b137f. qa writes 99c and devops builds 99d from it; seceng reviews it as 99b (§S, S1–S8).
- Measured (§M): `rclone copyto --no-check-dest --s3-no-head --s3-upload-cutoff 5G` sends one PUT and no HEAD or list; without `--no-check-dest` rclone HEADs first. A rewritten ETag fails the run. The base backup (tar to stdout through age) plus archived WAL recovers on a scratch Postgres. A forced-switch WAL segment is 16 MiB raw and ≈ 81 KB under gzip -1.
- Slice 0 (R12): `backup.sh nightly` on the scratch stack, three published names, no plaintext seen by the spool watcher. It goes green before the rest of 99c.
- Premigration contract for POLY-100: R6.
- `jobs.log` windows are written by root (the job runner); this closes POLY-98 R-a (R9). `05_backupdb.py` gains a root-owner check; `04_backup.py` is unchanged.
- Principal: D1 (whether the from-box premigration restore always requires the bucket cross-check). Lead: L1 (where the box-side `restore-apply` goes; not in the confirmed scope).

### @architect — 2026-11-22

Gate 1, ruling re-issued whole: `process/cairn/reviews/POLY-99/ruling.md` @ 852474706b9c6a90ed21c73e6f278685042ded37. It replaces 9f87a180, which no review or test had used. It folds in seceng-99 prep positions (mapped in §S): the uploader is read-only; root writes every record and does every deletion and ping; from-box names are validated and the file checked against root record; the scratch cluster is separate and isolated; replay is checked; no core dumps. B4 is not adopted (§S). Principal: D1-D3. Lead: L1.
