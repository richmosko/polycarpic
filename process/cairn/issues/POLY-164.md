---
id: POLY-164
title: First prod deploy
status: backlog
milestone: POLY-1.0
parent: null
blocked_by: [POLY-106, POLY-90, POLY-91, POLY-163, POLY-157, POLY-158, POLY-159, POLY-103, POLY-156, POLY-155, POLY-135, POLY-160, POLY-165]
assignee: devops-engineer
labels: [ops, deploy, security]
priority: null
pr: null
created: 2026-11-24
updated: 2026-11-24
---

The first deploy of a `v1.*` release to prod. Filed at the POLY-M1 regroup (2026-11-25) so that every "before the first prod deploy" gate has an issue to block. Prod accepts only a `v1.*` tag (INFRA), so this belongs to POLY-1.0; POLY-M6 (Production readiness) ends with every condition met and shown, and deploys nothing. seceng reviews the runbook and the result.

## Acceptance criteria

- [ ] Every issue of POLY-M6 is done, and POLY-M1 is closed by POLY-106 (POLY-90 and POLY-91 before any second person).
- [ ] Prod is opened to the internet only with POLY-163's edge limits in force; the outside-in scan is repeated against prod.
- [ ] INFRA §7.1 is run on prod as written, with every command that differs recorded; real release attestation is verified on the box.
- [ ] No real household data is loaded by this issue: that waits on the restore drill (POLY-116).
