---
id: POLY-138
title: Caddy and edge follow-ups
status: backlog
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
paths: [infra/caddy/**, infra/compose/**, infra/lint/**, tests/infra/**]
labels: [ops, security]
priority: null
pr: null
created: 2026-11-11
updated: 2026-11-11
---

Umbrella for the Caddy and edge-network findings from the POLY-95 and POLY-86 loops (`process/cairn/reviews/POLY-95/`, `process/cairn/reviews/POLY-86/seceng-client-ip.md`). The first item gates the first deploy.

## Items

- [ ] **Caddy overwrites the client IP (gates POLY-104).** `header_up X-Forwarded-For {remote_host}` on both sites, no `trusted_proxies`, and a container test that a forged header arrives as one entry. Until it lands every `/api/auth/*` request answers 503 outside development, because the app trusts only a single-entry header (seceng S19 @ a7a22c3; POLY-86 verdict follow-up 11).
- [ ] Drop the xcaddy rebuild and its `--replace golang.org/x/net` when a Caddy release carries x/net ≥ 0.62.0; the image guard then returns to +150 s (POLY-95 verdict F9; seceng @ 0e54cb0: nothing in the build may disable Go checksum verification meanwhile).
- [ ] A lint rule so a staging container cannot take prod's alias on the edge networks (POLY-95 seceng build review F11).
- [ ] A Renovate rule for the single Postgres `FROM` line and the pinned `age` version (INFRA §6.1a, §5), if no issue owns Renovate config (POLY-95 ruling F4).
