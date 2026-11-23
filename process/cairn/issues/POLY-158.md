---
id: POLY-158
title: Rollback: copy back into prod
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-100]
assignee: devops-engineer
labels: [infra, security, backup]
priority: null
pr: null
created: 2026-11-23
updated: 2026-11-23
---

The box-side route from a pre-migration backup back into prod (POLY-99 ruling §L1, the former `restore-apply`). POLY-99 stops at a throwaway cluster on the laptop, so the 60-minute bad-migration recovery has no built route back. Design decided by the Principal on 2026-11-23 (`process/DECISIONS.md`, D2): the laptop decrypts and streams the restore over ssh into a temporary scratch cluster on the box. seceng reviews the ruling and the build.

## Acceptance criteria

- [ ] The laptop decrypts and streams over ssh stdin; no plaintext file is written on the box, and the age identity never leaves the laptop (shown red on a mutant that decrypts on the box).
- [ ] The scratch is a separate cluster, never a database inside prod: no network, no capabilities, no secret, names validated before use (POLY-99 R7).
- [ ] The scratch's data directory is tmpfs while the data fits, with a measured fallback to a fresh directory on the LUKS volume.
- [ ] "Destroyed" means: container stopped and removed, its dedicated data directory removed, and the tool lists no scratch afterwards. Dropping a database in a running cluster does not count.
- [ ] `polycarpic-ops status` shows RED for any scratch cluster or its directory older than 24 hours.
- [ ] Copy-back is data only, run as a non-superuser.
- [ ] The bucket cross-check is always required before anything is streamed to the box: refused without the read key, with no override on this path (Principal, 2026-11-23, condition on D1).
- [ ] INFRA §6.4, §6.8 and §8.10 and SECURITY describe the built path; the 60-minute target is measured on a real box or carried to POLY-104 by name.
