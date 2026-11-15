---
id: POLY-148b
title: Spike build and record
status: in-progress
milestone: POLY-M1
parent: POLY-148
blocked_by: [POLY-148a]
assignee: backend-lead
paths: [spikes/POLY-148/**, process/cairn/reviews/POLY-148/**, process/cairn/issues/POLY-148.md, process/cairn/issues/POLY-148b.md]
stage: execute
estimate.cost_usd: "15.00"
estimate.gate_cycles: 3
labels: [security, auth, spike]
priority: null
pr: null
created: 2026-11-15
updated: 2026-11-15
---

backend-lead builds the throwaway harness under `spikes/POLY-148/` (a second Node process serving `/api/auth/*` behind Caddy as poly_auth, on the pinned better-auth) to the contract in seceng's checks README, runs the measurements, and writes the record. No product code changes.

## Acceptance criteria

- [x] The harness satisfies the contract in `spikes/POLY-148/checks/README.md`; seceng's entry point runs against it and every item reports a measured pass or fail (a measured fail is a valid result; an unmeasured item is not). (evidence: `run.mjs` at checks 9fda8f8d, harness c3055b0e: 28 PASS, 4 FAIL, 4 REPORT, 0 UNMEASURED; measured FAILs are named in spike.md §1; seceng accepted, §7)
- [x] If any session path fails the hashed-handle option, option 2 (symmetric rewrite in the adapter) is measured the same way. (evidence: no session path failed option 1, so option 2 was not built; spike.md header and §1 say why it would not cure H.forgery or H.refresh)
- [x] `process/cairn/reviews/POLY-148/spike.md` gives each item's command, predicate and result; lists every grant poly_auth needs beyond BetterAuth's tables and the existing definers; sizes the sign-in pages move (DESIGN, CSP, Caddy routes) and the dev and e2e two-server needs; and ends with any change to stage 2's blocks S, E and H and their price. (evidence: spike.md §1 command, predicate and result per line, §1 grants list, §3 pages, §4 dev and e2e, §6 changes to blocks S, E, H)
- [x] Nothing outside `spikes/POLY-148/` and the record changes. (evidence: changes are under `spikes/POLY-148/`, `process/cairn/reviews/POLY-148/` and these issue files; `git diff --stat` against the branch base checked by guard-push)
