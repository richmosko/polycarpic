---
id: POLY-76a
title: Spike checks, red
status: todo
milestone: POLY-M1
parent: POLY-76
blocked_by: []
assignee: qa-engineer
paths: [spikes/poly-76/checks/**]
stage: execute
estimate.cost_usd: "4.00"
estimate.gate_cycles: 2
labels: [spike, db]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

The POLY-76 checks written as executable assertions before the spike exists, so the builder does not grade their own work. Each of (a), (b), (b′), (c), (e) and (f) is one script under `spikes/poly-76/checks/` that exits non-zero with a named reason until the spike satisfies it. A short README states the contract the spike must expose (commands, database URL, role names) and nothing more.

## Acceptance criteria

- [ ] One check per item (a), (b), (b′), (c), (e), (f), each asserting the issue's wording against the real database catalog or the real command output, never against a file's presence.
- [ ] A single entry point runs them all and prints pass or fail per item; with no spike present every check fails for the stated reason (red), and that run's output is recorded in a comment on this issue.
- [ ] (f) is a measurement, not a pass/fail on the tool: its check reports which of the two behaviours was observed.
- [ ] `spikes/poly-76/checks/README.md` states the contract the spike must meet to be checked.
