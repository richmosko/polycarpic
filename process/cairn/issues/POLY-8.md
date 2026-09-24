---
id: POLY-8
title: finish-feature JS gate: token-chart-logic.test.js needs the dashboard's node_modules installed
status: backlog
milestone: null
parent: null
blocked_by: []
assignee: null
labels: [workflow, cairn, tests]
priority: P3
pr: null
created: 2026-09-23
updated: 2026-09-23
---


## Comments

### @team-lead — 2026-09-23

Found at POLY-4's finish gate (2026-09-23). `scripts/cairn/tests/js/token-chart-logic.test.js` errors with ENOENT on `scripts/cairn/dashboard/node_modules/layerchart/...` whenever the dashboard has not been `npm install`ed locally — identical on `main`, 47/48 JS tests pass. The `/finish-feature` gate treats that as red. Either the test should skip (with a loud NOTE, like the svelte-check step already does) when `dashboard/node_modules` is absent, or the gate's pre-flight should install it.

## Acceptance criteria

- [ ] `node --test scripts/cairn/tests/js/**/*.test.js` passes on a clone with no `dashboard/node_modules`, or the finish-feature gate installs it first
