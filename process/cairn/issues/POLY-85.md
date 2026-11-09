---
id: POLY-85
title: Runtime config + ops hooks
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-82]
assignee: backend-lead
paths: [packages/config/**, apps/web/src/lib/server/**, apps/worker/src/**, Dockerfile]
labels: [enabler, infra]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

The app-side hooks the operations scripts depend on, from devops's not-filed list (INFRA §2.2, §7.5; ARCH §7.4, §8.1): the *_FILE secret loader, the loopback-only status listener inside web (until POLY-81 moves it to an admin service), the image label carrying the source commit that the deploy check reads, and the structured log schema.

## Acceptance criteria

- [ ] Every secret is read from a mounted file named by a *_FILE variable; a missing or empty file refuses start, naming the variable.
- [ ] The status listener binds 127.0.0.1 only and returns migration and app status; the public /api/v1/health returns ok or not only (R-6).
- [ ] The image carries the commit label the attestation covers, and POLY-100's tag-to-digest check reads it.
- [ ] Logs are structured JSON to a committed schema; no secret, token or raw provider payload field is logged.
