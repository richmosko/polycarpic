---
id: POLY-105
title: Backup + storage first-run checks
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-99, POLY-104, POLY-164]
assignee: devops-engineer
paths: [process/cairn/reviews/**, docs/INFRA/index.html]
labels: [ops, verification, backup]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-26
---

OQ-INFRA-4 and OQ-INFRA-11 on the real B2 bucket and the first instance with a backup (prod; staging runs no backup service): compliance-mode lock, the put-only key's capability set, the lifecycle rule, refused delete / overwrite / shorten / bucket-retention attempts, the storage cap; base backup with -X none recovering through archived WAL; poly_backup dumping every row of a FORCE-RLS table; no slot left after a run.

## Acceptance criteria

- [ ] Each item has a recorded pass or fail, and INFRA states the measured value.
- [ ] Any fail goes back to SecEng and the architect before the first real backup.

## Comments

### @team-lead — 2026-11-22

From the POLY-99 verdict (process/cairn/reviews/POLY-99/verdict.md §8): this issue measures on the real bucket what POLY-99 proved against a fake only: B2 returning the MD5 as the ETag for a single-part PUT and enforcing Content-MD5; B2 refusing the box key's DELETE (or turning it into a hide marker); whether {writeFiles} alone is enough, with the uploader's rclone 1.76 flags (--no-check-dest --s3-no-head) and the E9 probe; DR10 on real Object Lock, run against the drill's own probe object; the b2_list_file_versions fields; the sibling yes|no flag; real Healthchecks pings; WAL compression on real activity against the 10 GB cap; OQ-INFRA-11.

### @team-lead — 2026-11-26

Reworded from POLY-104's staging deploy (finding F17): staging has no backup or uploader service, so these measurements run on the first instance that has a backup, which is prod. `blocked_by` gains POLY-164 for that reason; INFRA's OQ-INFRA-11 says the same. The measurements still come before real household data.
