---
id: POLY-138b
title: Caddy and edge security review
status: done
milestone: POLY-M1
parent: POLY-138
blocked_by: [POLY-138a]
assignee: seceng
paths: [process/cairn/issues/POLY-138.md, process/cairn/reviews/POLY-138/**, process/cairn/issues/POLY-138b.md, docs/SECURITY/**]
stage: plan
estimate.cost_usd: "5.00"
estimate.gate_cycles: 2
actual.cost_usd: "1.3870"
actual.tokens: 4639153
actual.gate_cycles: 6
actual.wall_clock: 106
ratio: "0.28"
labels: [ops, security, bloat]
priority: null
pr: null
created: 2026-11-21
updated: 2026-11-21
---

seceng reviews the ruling before any test is written and the build before the verdict, each at an exact sha.

## Acceptance criteria

- [x] `process/cairn/reviews/POLY-138/ruling-review.md` reviews the ruling at a named sha: ACCEPT or findings.
- [x] `process/cairn/reviews/POLY-138/build-review.md` reviews the build at the gate sha: the forged-header test, the log format, the service-worker refusal and the image build's checksum verification.
- [x] SECURITY is updated for what this loop changes (C-04's client-address wording, R-25's Caddy mitigation).
- [x] Any risk that needs the Principal is written as a plain-language brief for the lead to relay.