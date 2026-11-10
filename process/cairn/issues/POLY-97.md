---
id: POLY-97
title: Infra scaffolding + provisioning
status: backlog
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
paths: [infra/hetzner/**, infra/provision.sh, infra/provision-check.sh, infra/postgres-major, infra/README.md]
labels: [ops, infra]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

The committed, idempotent scripts INFRA §7.1 steps 7–11 call (D-7): create.sh, cloud-init, provision.sh and provision-check.sh. provision-check is the evidence for C-70, C-71, C-72, C-76, C-77 and C-79 (sshd from sshd -T, the C-79 set, spool holds only .age, Docker pools vs fixed subnets).

## Acceptance criteria

- [ ] shellcheck is clean and a dry run in a container passes in CI.
- [ ] On a real Hetzner project create.sh run twice is a no-op the second time and never opens a port other than 22/80/443.
- [ ] provision-check ends ALL CHECKS PASSED, and each FAIL line names its fix.
- [ ] No secret is printed or logged.
