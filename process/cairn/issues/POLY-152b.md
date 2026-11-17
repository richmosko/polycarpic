---
id: POLY-152b
title: Sign-in service security review
status: backlog
milestone: POLY-M1
parent: POLY-152
blocked_by: [POLY-152a]
assignee: seceng
paths: [process/cairn/issues/POLY-152.md, process/cairn/reviews/POLY-152/**, process/cairn/issues/POLY-152b.md, docs/SECURITY/**]
stage: plan
estimate.cost_usd: "10.00"
estimate.gate_cycles: 2
labels: [security, auth]
priority: null
pr: null
created: 2026-11-17
updated: 2026-11-17
---

seceng reviews the ruling before any test is written, and the build at the sha qa measured green.

## Acceptance criteria

- [ ] A review of the ruling at `process/cairn/reviews/POLY-152/ruling-review.md`, on the exact sha, with an attack list the tests must cover (checks #16 to #19 included).
- [ ] A build review at `process/cairn/reviews/POLY-152/build-review.md` with seceng's own re-run and probes; every PASS that rests on a stand-in is marked.
- [ ] Any SECURITY edit states the current state only.