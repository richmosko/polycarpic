---
id: POLY-105
title: Backup + storage first-run checks
status: backlog
milestone: POLY-1.0
parent: null
blocked_by: [POLY-99, POLY-104, POLY-164]
assignee: devops-engineer
paths: [process/cairn/reviews/**, docs/INFRA/index.html]
labels: [ops, verification, backup]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-27
---

OQ-INFRA-4 and OQ-INFRA-11 on the real B2 bucket and the first instance with a backup (prod; staging runs no backup service): compliance-mode lock, the put-only key's capability set, the lifecycle rule, refused delete / overwrite / shorten / bucket-retention attempts, the storage cap; base backup with -X none recovering through archived WAL; poly_backup dumping every row of a FORCE-RLS table; no slot left after a run.

## Acceptance criteria

- [ ] Each item has a recorded pass or fail, and INFRA states the measured value.
- [ ] Any fail goes back to SecEng and the architect before the first real backup.

## Comments

### @team-lead — 2026-11-22

From the POLY-99 verdict (process/cairn/reviews/POLY-99/verdict.md §8): this issue measures on the real bucket what POLY-99 proved against a fake only: B2 returning the MD5 as the ETag for a single-part PUT and enforcing Content-MD5; B2 refusing the box key's DELETE (or turning it into a hide marker); whether {writeFiles} alone is enough, with the uploader's rclone 1.76 flags (--no-check-dest --s3-no-head) and the E9 probe; DR10 on real Object Lock, run against the drill's own probe object; the b2_list_file_versions fields; the sibling yes|no flag; real Healthchecks pings; WAL compression on real activity against the 10 GB cap; OQ-INFRA-11.

### @team-lead — 2026-11-26

Reworded from POLY-104's staging deploy (finding F17): staging has no backup or uploader service, so these measurements run on the first instance that has a backup, which is prod. INFRA's OQ-INFRA-11 says the same. **Ordering is open:** POLY-164 (first prod deploy) is blocked by POLY-106, which is blocked by this issue, so as filed these measurements must pass before the only instance that can host them exists. Either staging gets a backup service for the measurement, or the order becomes prod deploy, then this issue, then real household data. The Principal decides, with POLY-165.

### @team-lead — 2026-11-27

Ordering decided by the Principal, 2026-11-27 (`process/DECISIONS.md`): first prod deploy with no real data (POLY-164), then this issue, then the restore drill (POLY-116), then real household data. This issue no longer blocks POLY-106 and moves to POLY-1.0. devops says, under POLY-165, whether the checks that need only the bucket can run before the prod deploy.
