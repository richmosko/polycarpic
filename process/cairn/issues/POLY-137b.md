---
id: POLY-137b
title: Auth follow-ups security review
status: todo
milestone: POLY-M1
parent: POLY-137
blocked_by: [POLY-137a]
assignee: seceng
paths: [process/cairn/issues/POLY-137.md, process/cairn/reviews/POLY-137/**, process/cairn/issues/POLY-137b.md, docs/SECURITY/**]
stage: plan
estimate.cost_usd: "10.00"
estimate.gate_cycles: 3
labels: [auth, security]
priority: null
pr: null
created: 2026-11-21
updated: 2026-11-21
---

seceng reviews the ruling before any test is written and the build before the verdict, each at an exact sha.

## Acceptance criteria

- [ ] `process/cairn/reviews/POLY-137/ruling-review.md` reviews the ruling at a named sha: ACCEPT or findings, with the 24-hour delay, its cancel link and the method-change emails read first.
- [ ] `process/cairn/reviews/POLY-137/build-review.md` reviews the build at the gate sha, including every grant and definer in the migration and what each email contains.
- [ ] SECURITY is updated for what this loop changes (R-12, R-24, C-02, C-04 and the Confirm it's you risk).
- [ ] Any risk that needs the Principal is written as a plain-language brief for the lead to relay.