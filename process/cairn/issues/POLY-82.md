---
id: POLY-82
title: Monorepo skeleton + layer lint
status: backlog
milestone: POLY-M1
parent: null
blocked_by: []
assignee: backend-lead
paths: [package.json, pnpm-workspace.yaml, turbo.json, packages/*/package.json, apps/*/package.json, eslint.config.*, tsconfig*.json, packages/*/src/index.ts, packages/*/src/*.test.ts, apps/*/src/**]
labels: [enabler]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

The pnpm + Turborepo workspace with every ARCH §2.2 package and app stubbed, each with a Vitest file that runs alone, and the layer-boundary lint of ARCH §2.1 enforced. Scaffolding only; every other M1 issue builds in it. CI change detection is POLY-96.

## Acceptance criteria

- [ ] The workspace holds the ARCH §2.2 packages plus apps/web and apps/worker, each with one passing Vitest test runnable alone.
- [ ] eslint-plugin-boundaries (or dependency-cruiser) refuses an upward import and a packages/* → SvelteKit import; a fixture violation fails lint.
- [ ] Lint refuses a database connection opened outside packages/db and any session-level SET (ARCH §3.3).
