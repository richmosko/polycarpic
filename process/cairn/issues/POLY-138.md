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

Acceptance criteria as ruled in `process/cairn/reviews/POLY-138/ruling.md` (R-numbers below); the ruling holds the exact text.

- [ ] **Caddy overwrites the client address (gates POLY-104; R1).** Every `reverse_proxy` on both sites imports one `(upstream)` snippet: `header_up X-Forwarded-For {remote_host}`, `header_up -X-Real-IP`, `header_up -Forwarded`; no `trusted_proxies` anywhere. A container test sends a forged two-entry header plus a second header line to web and auth on both sites, and the upstream sees one entry equal to the peer, and no `X-Real-IP` or `Forwarded`. Until it lands every `/api/auth/*` request answers 503 outside development (seceng S19 @ a7a22c3).
- [ ] **The xcaddy rebuild stays (R7).** Measured 2026-11-21: no Caddy release carries x/net ≥ 0.62.0 (v2.11.9 bundles 0.60.0). Tests: the built binary's effective x/net is ≥ 0.62.0, and nothing in the Caddy build disables Go checksum verification. Dropping the rebuild is a follow-up.
- [ ] **Edge alias lint (R5).** `edge-alias`: on `polycarpic-edge-<p>` a service's aliases are exactly `<p>-<service>`, with no `container_name` or links; `caddy-upstream`: the `app.` site proxies only to `prod-*`, `staging.` only to `staging-*`. Plus `caddy-xff`, `caddy-sw` and `caddy-log`, each with a fail fixture, and two new fixtures for the existing `edge-network` rule (a staging service named `prod-web`; a second service in `edge.yml`).
- [ ] **Renovate config for the Postgres, age and Caddy pins (R8).** `renovate.json` as ruled: only those two Dockerfiles, 3-day minimum age, no automerge, no Postgres major. What runs it is the lead's decision D1.
- [ ] **The Postgres image runs the minor its tag names (R6).** `FROM postgres:17.12@sha256:b60e9004…`; the server packages are held (`apt-mark hold`) before `apt-get upgrade`, in the image and in the pgtap test image. `SHOW server_version` matches the tag's minor on the compose-run container and in the DB harness (measured: today the upgrade moves 17.10 to 17.12).
- [ ] **Caddy refuses any request carrying a `Service-Worker` header (R2).** `@sw header Service-Worker *` → 403 in both HTTPS sites' `route`, before `basic_auth` and any proxy. The app registers no service worker, so this stops one planted by a compromised web from outliving the clean-up (POLY-148 spike §2c). A container test pins the 403 and its security headers on both sites, on a web path and an `/api/auth/*` path, and once with the lowercase header name.
- [ ] **No query string or path token in any Caddy log (R3; comment of 2026-11-12).** The default logger's filter strips the query and fragment, and everything after the first segment under `/api/auth/`, and deletes `Referer`; no site writes an access log; no `debug` and no `log_credentials`. Measured: without the filter, Caddy's error log writes the full URI on a 502. A container test finds no token in the logs, for a stopped upstream and for one that accepts and closes.
- [ ] **Only if the Principal takes D3 (R10): Caddy sends `Cache-Control: no-store` on everything outside `/_app/immutable/*`,** so a compromised web cannot pin an altered page in browser caches. A container test shows an upstream `max-age` replaced on `/sign-in` and kept on `/_app/immutable/x.js`.
- [ ] **`lb_try_duration 10s` in `(upstream)` (R4)**, so ARCH §8.1 and INFRA §4.6 are true.
- [ ] **`.dockerignore` excludes every test name the lint counts (R9; comment of 2026-11-12):** `**/*.test.*`, `**/*.spec.*`, and the same two under `packages/secrets/**` after its negation.

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
