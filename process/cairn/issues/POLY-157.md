---
id: POLY-157
title: Prod maintenance page
status: backlog
milestone: POLY-M6
parent: null
blocked_by: []
assignee: devops-engineer
labels: [ops, infra]
priority: null
pr: null
created: 2026-11-22
updated: 2026-11-24
---

INFRA §7.1 described a production maintenance page that the Caddyfile does not have (POLY-138 F4; POLY-97 ruling Scope). Build it before the first production deploy.

## Acceptance criteria

- [ ] The Caddyfile serves a static maintenance page for the production site when a documented switch is set, and the compose lint covers it.
- [ ] INFRA describes the switch and the page, quoting the real behaviour.