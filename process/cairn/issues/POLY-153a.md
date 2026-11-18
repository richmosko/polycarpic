---
id: POLY-153a
title: Handle entry ruling
status: done
milestone: POLY-M1
parent: POLY-153
blocked_by: []
assignee: architect
paths: [process/cairn/issues/POLY-153.md, process/cairn/reviews/POLY-153/**, process/cairn/issues/POLY-153a.md, docs/ARCH/**]
stage: plan
estimate.cost_usd: "6.00"
estimate.gate_cycles: 2
actual.cost_usd: "4.1924"
actual.tokens: 7948892
actual.gate_cycles: 2
actual.wall_clock: 21
ratio: "0.70"
labels: [security, auth]
priority: null
pr: null
created: 2026-11-18
updated: 2026-11-18
---

The architect rules the design for POLY-153 from the spike record (`process/cairn/reviews/POLY-148/spike.md` §1 H, §4, §7) and `process/cairn/reviews/POLY-145/pricing.md` §1 blocks E and H, on top of POLY-152's ruling (R6, R7, R9), before any test is written.

## Acceptance criteria

- [ ] A ruling at `process/cairn/reviews/POLY-153/ruling.md` covers every one of POLY-153's 6 criteria: `app.enter_session` and `app.session_handle`, the handle plugin and its place in `plugins[]` on all 13 session paths, the cookie names and paths, the commit-together rule on the four no-session sign-in paths, the Sessions/revoke/`requireRecentAuth` definers, and the removal of the interim `/session` listener.
- [ ] It names what happens to `enter_asserted_user` in this loop and what is left for POLY-149, and the migration order.
- [ ] It says how the dev and e2e harness's seeded `storageState` carries the handle cookie and its row.
- [ ] seceng's review of the ruling is answered; any re-issue is a single replacement ruling, not an addendum chain.
