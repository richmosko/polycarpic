---
id: POLY-138
title: Caddy and edge follow-ups
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
paths: [process/cairn/issues/POLY-138.md, process/cairn/reviews/POLY-138/**, infra/caddy/**, infra/compose/**, infra/lint/**, infra/postgres/**, tests/infra/**, .dockerignore, Dockerfile, renovate.json, .github/renovate.json, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, tests/**, layers.json, eslint.config.js, scripts/layers/**, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .gitignore, .github/workflows/**, infra/ci/**]
labels: [ops, security]
priority: null
pr: null
created: 2026-11-11
updated: 2026-11-21
---

Umbrella for the Caddy and edge-network findings from the POLY-95 and POLY-86 loops (`process/cairn/reviews/POLY-95/`, `process/cairn/reviews/POLY-86/seceng-client-ip.md`). The first item gates the first deploy.

## Items

- [ ] **Caddy overwrites the client IP (gates POLY-104).** `header_up X-Forwarded-For {remote_host}` on both sites, no `trusted_proxies`, and a container test that a forged header arrives as one entry. Until it lands every `/api/auth/*` request answers 503 outside development, because the app trusts only a single-entry header (seceng S19 @ a7a22c3; POLY-86 verdict follow-up 11).
- [ ] Drop the xcaddy rebuild and its `--replace golang.org/x/net` when a Caddy release carries x/net ≥ 0.62.0; the image guard then returns to +150 s (POLY-95 verdict F9; seceng @ 0e54cb0: nothing in the build may disable Go checksum verification meanwhile).
- [ ] A lint rule so a staging container cannot take prod's alias on the edge networks (POLY-95 seceng build review F11).
- [ ] A Renovate rule for the single Postgres `FROM` line and the pinned `age` version (INFRA §6.1a, §5), if no issue owns Renovate config (POLY-95 ruling F4).
- [ ] **The Postgres image runs the minor its tag names.** `infra/postgres/Dockerfile` pins `postgres:17.10@sha256:…`, but line 2's `apt-get upgrade -y` moves the server to 17.12; the digest pins only the base layer (POLY-147 ruling R11; devops finding, not verified against a live apt run). Drop the upgrade and bump the digest when a new minor is wanted, or hold the postgres packages; a test asserts `SHOW server_version` matches the tag.
- [ ] **Caddy refuses any request carrying `Service-Worker: script`.** The app registers no service worker. One planted by a compromised web would keep serving altered pages, the sign-in page included, after the server is cleaned up. Measured in Chromium to stop registration (POLY-148 spike §2c, `spikes/POLY-148/caddy/Caddyfile.sw`). Part of the Principal's decision that the sign-in pages stay in web (`process/DECISIONS.md`, 2026-11-15). A config test pins the rule on both sites.

## Comments

### @team-lead — 2026-11-12

From seceng on POLY-140 (2026-11-12): `.dockerignore` excludes `**/*.test.ts` and root `tests`, but not the other names the lint counts as tests (`.spec.*`, `.test.mjs`, `.test.mts` and the like). No such file exists today. Add the exclusions with this issue's edge work.

### @team-lead — 2026-11-12

From the POLY-87 loop (seceng): the invitation token sits in the `/sign-up` query string, so Caddy's access log format must drop the query before the first deploy.

### @team-lead — 2026-11-15

Follow-up from POLY-147 (merged via PR #127) added to the list above; source: `process/cairn/reviews/POLY-147/` (ruling, security-review, verdict) and devops-147's findings.

### @team-lead — 2026-11-15

Follow-ups from POLY-148 (merged via PR #129) added above; source: `process/cairn/reviews/POLY-148/spike.md` (§1, §2, §6 and seceng's reading in §7).

### @team-lead — 2026-11-20

From POLY-150 (devops and seceng, 2026-11-20). This issue is a prerequisite for even a staging deploy. Until Caddy sets `X-Forwarded-For` explicitly, and that is tested, the client address the sign-in service limits on and records rests on Caddy's untested default. SECURITY C-04 says so.

### @team-lead — 2026-11-21

Feature started. Branch: `feature/poly-138-caddy-edge-follow-ups`. Runs in parallel with POLY-137.
