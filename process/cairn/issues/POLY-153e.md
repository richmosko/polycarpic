---
id: POLY-153e
title: Handle entry compose and Caddy
status: done
milestone: POLY-M1
parent: POLY-153
blocked_by: [POLY-153a]
assignee: devops-engineer
paths: [process/cairn/issues/POLY-153.md, process/cairn/reviews/POLY-153/**, process/cairn/issues/POLY-153e.md, infra/**, docs/INFRA/**, tests/infra/**]
stage: execute
estimate.cost_usd: "4.00"
estimate.gate_cycles: 2
actual.cost_usd: "0.2090"
actual.tokens: 515250
actual.gate_cycles: 1
actual.wall_clock: 44
ratio: "0.05"
labels: [security, auth]
priority: null
pr: null
created: 2026-11-18
updated: 2026-11-18
---

devops-engineer makes the deployment match the ruling.

## Acceptance criteria

- [ ] The interim internal listener, its network and its env (`AUTH_INTERNAL_*`) are removed from compose, or kept refusing web, as the ruling says; if kept, POLY-152's follow-up N1 is done here.
- [ ] Caddy and INFRA match the new cookie paths and the handle cookie.
- [ ] `tests/infra` is green.
