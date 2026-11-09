---
id: POLY-121
title: Vercel + Neon target
status: backlog
milestone: null
parent: null
blocked_by: [POLY-96, POLY-99]
assignee: devops-engineer
paths: [infra/vercel/**, infra/ops/neon-*]
labels: [ops, vercel, post-ga-candidate]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

Unscheduled: nothing schedules the tertiary target yet (architect, 2026-11-08). INFRA §4.7, §6.6, §7.4, D-11/D-12: signature-verified tag deploy from the laptop, the per-project env-name check, the weekly encrypted Neon export with the put-only key, and restore. Needs the ARCH §7.6 two-project split built first (not yet filed). Records OQ-INFRA-6 at first stand-up.

## Acceptance criteria

- [ ] deploy.sh refuses an unsigned tag; check.sh prints keyring: jobs only.
- [ ] A cron route without the secret returns 401, and 404 on the web project.
- [ ] An export restores into a fresh Neon project.
- [ ] OQ-INFRA-6 (Neon restore window, Vercel Hobby limits) is recorded.
