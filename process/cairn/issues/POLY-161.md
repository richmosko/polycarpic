---
id: POLY-161
title: Web server in the release image
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-100]
assignee: frontend-lead
paths: [process/cairn/issues/POLY-161.md, process/cairn/issues/POLY-88.md, process/cairn/reviews/POLY-161/**, apps/web/**, packages/config/**, infra/**, .github/workflows/**, Dockerfile, .dockerignore, tests/**, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, package.json, pnpm-lock.yaml, packages/*/package.json, layers.json, eslint.config.js, scripts/layers/**, .gitleaksignore, process/STATE.md, process/DECISIONS.md]
labels: [app, deploy]
priority: null
pr: null
created: 2026-11-23
updated: 2026-11-24
---

The release image serves no web app today: it never runs `vite build`, and `apps/web/src/main.ts` starts only the internal status listener. The work was inside POLY-88 (Sign-in providers), so the first page depended on an OAuth feature and the first staging deploy (POLY-104) could never have shown one. Split out by the Principal's decision of 2026-11-24 (`process/DECISIONS.md`), ahead of POLY-104. POLY-100 ships a minimal health-only listener as a stand-in; this issue replaces it and it never runs beside it.

## Acceptance criteria

- [x] The image build runs `vite build`, and the production web server is mounted on 3000 serving the SvelteKit app. — tests/infra/web-stage.test.ts: "the real file breaks no rule" (vite build once, in the web stage, under `--network=none`); tests/infra/deploy-real/1-web-served.test.ts: "B22: /sign-in is the app's HTML page"
- [x] `/api/v1/health` is served by the real server; POLY-100's minimal listener is removed, with a test that only one listener answers on 3000. — tests/infra/deploy-real/1-web-served.test.ts: "B5, B6: web's listening sockets ... are exactly 0.0.0.0:3000 and 127.0.0.1:8081"; tests/db/web-server.test.ts: "GET is 200 with byte-equal body"; tests/ci/one-listener.test.ts: "the stand-in listener and its test are gone"
- [x] The startup zone check moved here from POLY-88 runs before the server listens. — tests/db/web-server-start.test.ts: "while the resolvers are held silent, 3000 refuses connections" and "both resolvers say NXDOMAIN: exit 1, one zone.refused"; apps/web/src/ops/zone.test.ts: "the answer table"
- [x] T-real (the end-to-end deploy test) passes against the new image, and its trigger covers the files this issue adds. — tests/infra/deploy-real/1-web-served.test.ts (24 of 24 in the container at 35908f5b); tests/ci/deploy-key.test.ts: one row per added path
- [x] POLY-88's criteria that describe this work are removed there and point here. — process/cairn/issues/POLY-88.md (commit 3eb1a089)

## Comments

### @team-lead — 2026-11-24

From the POLY-162 loop (2026-11-24), all about `apps/web/src/ops/public-health.ts` and its test, which this issue removes (`process/cairn/reviews/POLY-162/verdict.md` follow-up 5, `build-review.md`, `g15-mutants.md`):
- T-real now runs in its own CI job, `deploy-real`; criterion 4's "its trigger covers the files this issue adds" means the `deploy` key in `infra/ci/changes.mjs`, pinned in `tests/ci/deploy-key.test.ts`.
- If any of the listener's behaviour is kept in the real server: the test's weak assertions (the port regexp is met by a comment; "starts once" accepts two calls; a bind failure reads exit 1 without the message; no test spawns `main.ts`); a logged object (`console.log(req.headers)`) still passes the log-capture case; four timeout limits are held by reading the server's properties, not by driving a timeout; "flushed before the close" has no test (seceng ruled the mutant equivalent); the bind failure is written as hand-made JSON outside the log schema (architect D1).

### @team-lead — 2026-11-24

Feature started. Branch: `feature/poly-161-web-server-release-image`. This loop has a ruling stage: the image serves the whole web app for the first time. Order: architect ruling with its pre-registered checklist (a), seceng's review of the ruling (b), then tests (c), the build in apps/web (d) and the image and CI (e), seceng's build review (b), verdict (f).
