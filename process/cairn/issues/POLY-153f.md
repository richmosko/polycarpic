---
id: POLY-153f
title: Handle entry verdict
status: done
milestone: POLY-M1
parent: POLY-153
blocked_by: [POLY-153d]
assignee: architect
paths: [process/cairn/issues/POLY-153.md, process/cairn/reviews/POLY-153/**, process/cairn/issues/POLY-153f.md, docs/ARCH/**]
stage: review
estimate.cost_usd: "5.00"
estimate.gate_cycles: 3
actual.cost_usd: "3.3294"
actual.tokens: 10878013
actual.gate_cycles: 4
actual.wall_clock: 57
ratio: "0.67"
labels: [security, auth, bloat]
priority: null
pr: null
created: 2026-11-18
updated: 2026-11-18
---

The architect checks the build against the ruling at the gate sha.

## Acceptance criteria

- [ ] `process/cairn/reviews/POLY-153/verdict.md`: APPROVE or findings at the gate sha, with what was checked directly and what was taken from others.
- [ ] ARCH is updated for what this loop changes.
