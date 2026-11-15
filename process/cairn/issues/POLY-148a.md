---
id: POLY-148a
title: Spike predicates and review
status: in-progress
milestone: POLY-M1
parent: POLY-148
blocked_by: []
assignee: seceng
paths: [spikes/POLY-148/checks/**, process/cairn/reviews/POLY-148/**, process/cairn/issues/POLY-148.md, process/cairn/issues/POLY-148a.md]
stage: execute
estimate.cost_usd: "6.00"
estimate.gate_cycles: 2
labels: [security, auth, spike]
priority: null
pr: null
created: 2026-11-15
updated: 2026-11-15
---

seceng writes, before the harness exists, one executable check per measurable item of POLY-148 under `spikes/POLY-148/checks/`, so the builder does not grade their own work. Each check states its command and predicate and exits non-zero with a named reason until the spike satisfies it. seceng then reviews each result and owns the security reading in the record.

## Acceptance criteria

- [ ] One check per POLY-148 item (session handle per sign-in path, same-origin service and its grant list, cookie scope, sign-in pages, magic link and second factor), each asserting against real responses, cookies or the database catalog, never a file's presence.
- [ ] A single entry point runs them all and prints pass or fail per item; with no spike present every check fails for its stated reason, and that run is recorded in a comment on this issue.
- [ ] A short README states the contract the harness must expose (commands, ports, role names) and nothing more.
- [ ] After the build, seceng's review of each result is in `process/cairn/reviews/POLY-148/spike.md`, including the `__Host-` versus `__Secure-` trade-off and any gap handed to POLY-89.
