---
id: POLY-137f
title: Auth follow-ups pages
status: done
milestone: POLY-M1
parent: POLY-137
blocked_by: [POLY-137c]
assignee: frontend-lead
paths: [process/cairn/issues/POLY-137.md, process/cairn/reviews/POLY-137/**, process/cairn/issues/POLY-137f.md, apps/web/src/routes/**, apps/web/src/lib/**, apps/web/src/hooks.server.ts, apps/web/src/app.d.ts]
stage: execute
estimate.cost_usd: "5.00"
estimate.gate_cycles: 2
actual.cost_usd: "0.5050"
actual.tokens: 953699
actual.gate_cycles: 2
actual.wall_clock: 165
ratio: "0.10"
labels: [auth, security]
priority: null
pr: null
created: 2026-11-21
updated: 2026-11-21
---

frontend-lead builds the three bare pages the ruling's D3 adds: `/sign-in/forgot`, `/sign-in/reset` and `/sign-in/cancel-method`.

## Acceptance criteria

- [x] The three pages exist with the ruling's wording, word for word, and DESIGN's tokens; no new component.
- [x] The reset and cancel tokens are read from the URL fragment only and never sent in a path or query; a plain visit to the cancel page changes nothing until the button is pressed.
- [x] qa's page tests are green without any test being changed by the builder.