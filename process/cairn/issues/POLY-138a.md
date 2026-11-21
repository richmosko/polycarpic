---
id: POLY-138a
title: Caddy and edge ruling
status: done
milestone: POLY-M1
parent: POLY-138
blocked_by: []
assignee: architect
paths: [process/cairn/issues/POLY-138.md, process/cairn/reviews/POLY-138/**, process/cairn/issues/POLY-138a.md, docs/ARCH/**]
stage: plan
estimate.cost_usd: "4.00"
estimate.gate_cycles: 2
actual.cost_usd: "0.8446"
actual.tokens: 2939121
actual.gate_cycles: 3
actual.wall_clock: 67
ratio: "0.21"
labels: [ops, security, bloat]
priority: null
pr: null
created: 2026-11-21
updated: 2026-11-21
---

The architect rules the design for POLY-138's items and comments before any test is written.

## Acceptance criteria

- [x] A ruling at `process/cairn/reviews/POLY-138/ruling.md` covers every item and comment on POLY-138: the exact Caddy directives for the client address, the log format without the query string, the `Service-Worker: script` refusal on both sites, the alias lint rule, the Postgres minor pin and its test, the Renovate rule, and the `.dockerignore` names.
- [x] It says, from a measurement, whether a Caddy release now carries x/net 0.62.0 or later, and so whether the xcaddy rebuild goes or stays.
- [x] POLY-138's items are rewritten in place as acceptance criteria where the ruling changes them.
- [x] seceng's review of the ruling is answered; any re-issue is a single replacement ruling.