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

Required items as seceng set them (`process/cairn/reviews/POLY-161/ruling-review.md` @ 08f95376, "the edge gate"; `build-review.md` F4):

- [ ] Request rate per client at Caddy (the TCP peer; IPv6 counted by /64), on every path to `web` except `/_app/immutable/*`. A stricter bucket for any request carrying a handle cookie, `__data.json` included, since each opens a transaction. The excess is 429 at Caddy and never reaches `web`.
- [ ] Slow connections, which a request counter never counts: Caddy's `read_header`, `read_body` and write timeouts, and a cap on connections per address (host firewall). None is set today. The write timeout must bound the slow reader measured in POLY-161 (S6): a client reading 1 byte every 20 s kept its socket open 160 s against web's 60 s `server.timeout`, so web's own timeouts do not bound it and today the only bound is web's 512-connection cap.
- [ ] Bounded state in the limiter itself (keys, memory), and prod and staging counted apart.
- [ ] Shown by: one address over the limit is refused while a second address and the loopback health check still get 200; 512 slow bodies from one address leave health at 200. Both red with the limit off.
- [ ] A limiter plugin compiled into Caddy is new code at TLS termination: pinned, scanned, and reviewed by seceng (SECURITY R-25 relies on Caddy being out of `web`'s reach).
- [ ] SECURITY states the control and what it does not cover: a distributed flood stays accepted (loss of service only).

Measured in POLY-161 (S7, `process/cairn/reviews/POLY-161/gate.md`): web idle 99 MiB, 512 slow bodies 144 MiB, 512 open-header sockets 153 MiB against staging's 384m.
