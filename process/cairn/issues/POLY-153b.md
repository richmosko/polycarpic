---
id: POLY-153b
title: Handle entry security review
status: done
milestone: POLY-M1
parent: POLY-153
blocked_by: [POLY-153a]
assignee: seceng
paths: [process/cairn/issues/POLY-153.md, process/cairn/reviews/POLY-153/**, process/cairn/issues/POLY-153b.md, docs/SECURITY/**, process/cairn/issues/POLY-149.md, process/cairn/issues/POLY-137.md]
stage: plan
estimate.cost_usd: "9.00"
estimate.gate_cycles: 3
actual.cost_usd: "4.1481"
actual.tokens: 8593675
actual.gate_cycles: 0
actual.wall_clock: null
ratio: "0.46"
labels: [security, auth]
priority: null
pr: null
created: 2026-11-18
updated: 2026-11-18
---

seceng reviews the ruling before the build and the build before the verdict, each at an exact sha.

## Acceptance criteria

- [x] `process/cairn/reviews/POLY-153/ruling-review.md` reviews the ruling at a named sha: ACCEPT or findings.
- [x] `process/cairn/reviews/POLY-153/build-review.md` reviews the build at the gate sha, including every grant and definer in the migration and the cookie attributes.
- [x] SECURITY is updated for what this loop changes (R-2's wording for the handle; nothing is retired before POLY-149).
- [x] Any risk that needs the Principal is written as a plain-language brief for the lead to relay.
