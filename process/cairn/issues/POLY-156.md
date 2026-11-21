---
id: POLY-156
title: Edge follow-ups 2
status: backlog
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
paths: [infra/caddy/**, infra/renovate/**, renovate.json, .github/workflows/**, tests/infra/**, packages/auth/**]
labels: [ops, security]
priority: null
pr: null
created: 2026-11-21
updated: 2026-11-21
---

Umbrella for what the POLY-138 loop left open (`process/cairn/reviews/POLY-138/verdict.md`, `build-review.md`). Add later Caddy, edge and Renovate nits here.

## Acceptance criteria

- [ ] The xcaddy rebuild and its `--replace golang.org/x/net` are dropped when a Caddy release carries x/net 0.62.0 or later; the image guard returns to +150 s. Until then the replaced x/net version is watched by nothing (F1).
- [ ] The Renovate check also covers the app's Node base image, pnpm and GitHub Actions (F3; SECURITY C-80 assumes it).
- [ ] The sign-in service trusts `X-Forwarded-For` only from Caddy's fixed address, so a compromised `web` cannot choose the address it is limited and recorded under (F6; seceng brief B; SECURITY R-2).
- [ ] Recorded, not built: a registry that returns a stale or truncated tag list with no warning reads as "nothing due" in the weekly check. Say in SECURITY C-80 whether a second source is wanted.
