---
id: POLY-153d
title: Handle entry build
status: todo
milestone: POLY-M1
parent: POLY-153
blocked_by: [POLY-153c]
assignee: backend-lead
paths: [process/cairn/issues/POLY-153.md, process/cairn/reviews/POLY-153/**, process/cairn/issues/POLY-153d.md, packages/**, apps/**, layers.json, eslint.config.js, scripts/layers/**, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .gitignore, bin/**]
stage: execute
estimate.cost_usd: "14.00"
estimate.gate_cycles: 3
labels: [security, auth]
priority: null
pr: null
created: 2026-11-18
updated: 2026-11-18
---

backend-lead builds to qa's red tests and the ruling.

## Acceptance criteria

- [ ] The migration adds `app.session_handle` and `app.enter_session(handle)` as ruled; no grant beyond the ruling's list.
- [ ] The handle plugin is last in `plugins[]` and sets `__Host-poly_handle` on all 13 session paths; the session and its handle commit together.
- [ ] Web enters only by handle; `loadSession`, the `SessionUserId` brand and the interim `/session` call are gone.
- [ ] POLY-152's follow-up N3 (eslint refuses `better-auth` in apps/web) is done here.
- [ ] qa's suite is green without any test being changed by the builder.
