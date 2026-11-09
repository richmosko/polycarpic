---
id: POLY-104
title: First staging deploy
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-97, POLY-98, POLY-100, POLY-99, POLY-95, POLY-96, POLY-101]
assignee: devops-engineer
paths: [process/cairn/reviews/**, docs/INFRA/index.html]
labels: [ops, verification]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

Run INFRA §7.1 steps 1–13 and 18 on a real Hetzner project, staging only (fake data), verbatim as a novice would, and record every command that differs; INFRA v1.2 lands the fixes. Folds in OQ-INFRA-7 (plan, firewall counts, IPv6), OQ-INFRA-8, OQ-INFRA-9 (Healthchecks limits), the outside-in scan and C-78 token deletion. Record in process/cairn/reviews/<this ID>/staging-deploy.md.

## Acceptance criteria

- [ ] Staging reaches healthy; nmap shows exactly 22/80/443 on v4 and v6.
- [ ] provision-check passes.
- [ ] OQ-INFRA-7, -8 and -9 each have a recorded answer.
- [ ] The review file lists every doc correction, and INFRA v1.2 lands them.
