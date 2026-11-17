---
id: POLY-152e
title: Sign-in service compose and Caddy
status: done
milestone: POLY-M1
parent: POLY-152
blocked_by: [POLY-152a]
assignee: devops-engineer
paths: [process/cairn/issues/POLY-152.md, process/cairn/reviews/POLY-152/**, process/cairn/issues/POLY-152e.md, infra/**, docs/INFRA/**, tests/infra/**]
stage: execute
estimate.cost_usd: "9.00"
estimate.gate_cycles: 2
actual.cost_usd: "0.8358"
actual.tokens: 2684334
actual.gate_cycles: 1
actual.wall_clock: 36
ratio: "0.09"
labels: [security, auth]
priority: null
pr: null
created: 2026-11-17
updated: 2026-11-17
---

devops-engineer adds the auth service to compose with its secret mount, routes `/api/auth/*` to it in Caddy, and keeps the image and CI checks true.

## Acceptance criteria

- [ ] The auth service runs from the app image as poly_auth with the auth secret mounted for it alone; the rendered-compose test (seceng #17) passes.
- [ ] Caddy routes `/api/auth/*` to the service on the app origin, and web's handle refuses that tree.
- [ ] INFRA states the service, its secret and its resource allocation as they stand; the image smoke check and CI job filters cover the new process.