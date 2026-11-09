---
id: POLY-101
title: CI: auth route-policy row
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-96, POLY-86]
assignee: devops-engineer
paths: [.github/workflows/ci.yml, infra/ci/**]
labels: [ci, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

ARCH §8 / SECURITY A-34: the CI row that runs on packages/auth/**, packages/tenancy/** and any better-auth or @better-auth/passkey version change. It runs the route-policy test, the routing-pool test and the drizzleAdapter lint that POLY-86 writes, so a dependency-bot bump cannot merge without them.

## Acceptance criteria

- [ ] A PR that bumps better-auth and adds an unclassified route fails; the same PR with the route classified passes.
- [ ] The job is part of the app aggregate check.
