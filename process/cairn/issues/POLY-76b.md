---
id: POLY-76b
title: Spike build and record
status: in-progress
milestone: POLY-M1
parent: POLY-76
blocked_by: [POLY-76a]
assignee: backend-lead
paths: [spikes/poly-76/**, process/cairn/reviews/POLY-76/spike.md]
stage: execute
estimate.cost_usd: "8.00"
estimate.gate_cycles: 2
labels: [spike, db]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

The throwaway spike under `spikes/poly-76/`: a Postgres in Docker with the ARCH roles, Drizzle Kit with a schema carrying the policy, FORCE RLS and BetterAuth cases, a custom SQL migration with a trigger and definer functions, and the real runner applying as `poly_migrator`. Run the checks from the red sub-issue and record the truth; a failed check is a valid result and is not coded around.

## Acceptance criteria

- [x] The spike meets the contract in `spikes/poly-76/checks/README.md` and the checks run against it unmodified.
- [x] Each of (a), (b), (b′), (c), (e) passes or fails on its own evidence; (f) reports the observed behaviour.
- [x] `process/cairn/reviews/POLY-76/spike.md` records versions, exact commands, and pass or fail per item with the output that shows it.
- [x] Nothing in `packages/*` or `apps/*` imports the spike; no file outside `spikes/poly-76/` and the record is touched.
