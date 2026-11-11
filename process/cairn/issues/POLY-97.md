---
id: POLY-97
title: Infra scaffolding + provisioning
status: todo
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
paths: [infra/hetzner/**, infra/provision.sh, infra/provision-check.sh, infra/README.md]
labels: [ops, infra]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-11
---

The committed, idempotent scripts INFRA §7.1 steps 7–11 call (D-7): create.sh, cloud-init, provision.sh and provision-check.sh. provision-check is the evidence for C-70, C-71, C-72, C-76, C-77 and C-79 (sshd from sshd -T, the C-79 set, spool holds only .age, Docker pools vs fixed subnets).

## Acceptance criteria

- [ ] shellcheck is clean and a dry run in a container passes in CI.
- [ ] On a real Hetzner project create.sh run twice is a no-op the second time and never opens a port other than 22/80/443.
- [ ] provision-check ends ALL CHECKS PASSED, and each FAIL line names its fix.
- [ ] No secret is printed or logged.

## Comments

### @team-lead — 2026-11-11

From the POLY-95 loop (`process/cairn/reviews/POLY-95/`): (F1) `infra/postgres-major` is created by POLY-95 and removed from this issue's `paths:`; provision-check reads it from `main`. (F2) The "spool holds only `.age`" check allows `spool/wal/.inflight/`, empty at rest. (F6, as amended by A1) provision.sh creates one secrets directory per service, `root:<gid>` 0750 with 0440 files, sets the Postgres data dirs to uid 999, and provision-check asserts it and that no secret file is world-readable. **(F12, gates the first real backup)** the uploader (uid 10005) cannot read or delete the 0600 `.age` files Postgres and backup write; grant it by default POSIX ACLs on the spool folders, never by chmod or a shared gid.
