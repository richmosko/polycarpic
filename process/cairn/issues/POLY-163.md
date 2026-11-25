---
id: POLY-163
title: Edge limits before prod
status: backlog
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
labels: [ops, edge, security]
priority: null
pr: null
created: 2026-11-24
updated: 2026-11-24
---

Rate and connection limits at Caddy for web's public routes, as a gate: prod is not opened to the internet before this is done. Filed from POLY-161 (`process/cairn/reviews/POLY-161/ruling.md` R4 residual; `ruling-review.md` P2, F3 @ 08f95376), decided by the lead on 2026-11-25 under the Principal's delegation. No "first prod deploy" issue exists yet; when it is filed it is blocked by this one. seceng reviews the ruling and the build.

Mechanism: once the image serves the app, anyone on the internet reaches sign-in, sign-up, reset, second-step, cancel, the static files and health on prod (staging is behind the allowlist). They can fill web's 512 connections or the database pool (a request carrying any handle cookie opens a transaction); health goes red, and in a deploy window the deploy rolls back. It is loss of service, never disclosure.

## Acceptance criteria

- [ ] A per-address request limit at Caddy for web's routes, with a stricter bucket for requests that carry a handle cookie.
- [ ] Caddy read and write timeouts and a per-address connection cap (none are set today), so slow connections are bounded as well as fast requests.
- [ ] Each limit has a test shown red with the limit off, and the health readers (the compose healthcheck and the deploy tool's probe) still pass under a driven flood.
- [ ] SECURITY states the control and what it does not cover.
