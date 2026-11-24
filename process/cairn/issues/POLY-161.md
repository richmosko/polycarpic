---
id: POLY-161
title: Web server in the release image
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-100]
assignee: frontend-lead
labels: [app, deploy]
priority: null
pr: null
created: 2026-11-23
updated: 2026-11-23
---

The release image serves no web app today: it never runs `vite build`, and `apps/web/src/main.ts` starts only the internal status listener. The work was inside POLY-88 (Sign-in providers), so the first page depended on an OAuth feature and the first staging deploy (POLY-104) could never have shown one. Split out by the Principal's decision of 2026-11-24 (`process/DECISIONS.md`), ahead of POLY-104. POLY-100 ships a minimal health-only listener as a stand-in; this issue replaces it and it never runs beside it.

## Acceptance criteria

- [ ] The image build runs `vite build`, and the production web server is mounted on 3000 serving the SvelteKit app.
- [ ] `/api/v1/health` is served by the real server; POLY-100's minimal listener is removed, with a test that only one listener answers on 3000.
- [ ] The startup zone check moved here from POLY-88 runs before the server listens.
- [ ] T-real (the end-to-end deploy test) passes against the new image, and its trigger covers the files this issue adds.
- [ ] POLY-88's criteria that describe this work are removed there and point here.
