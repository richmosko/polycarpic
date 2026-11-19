---
id: POLY-150g
title: Second-step service and database build
status: done
milestone: POLY-M1
parent: POLY-150
blocked_by: []
assignee: backend-lead
paths: [process/cairn/issues/POLY-150.md, process/cairn/reviews/POLY-150/**, process/cairn/issues/POLY-150g.md, packages/**, apps/auth/**, apps/web/vite.config.ts, apps/web/tests/e2e/**, infra/**, layers.json, eslint.config.js, scripts/layers/**, package.json, pnpm-lock.yaml]
stage: execute
estimate.cost_usd: "6.00"
estimate.gate_cycles: 4
actual.cost_usd: "1.6060"
actual.tokens: 7300866
actual.gate_cycles: 0
actual.wall_clock: null
ratio: "0.27"
labels: [design, security]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-19
---

backend-lead builds the parts of the ruling that are not screens, until qa's service and database tests are green.

## Acceptance criteria

- [x] `app.my_second_step()` and its grant; send-code answers 503 `mailer_unavailable` first when no mailer is passed; `deps.sendSecondStepCode` accepted only in development; `trustDevice` refused; a client address required everywhere; `Cache-Control: no-store` as ruled.
- [x] The Caddy `X-Frame-Options: DENY` header with its lint entry, and the Vite proxy setting the client address.
- [x] qa's db, auth-seam and tests/ci suites for these are green; lint and typecheck exit 0.
