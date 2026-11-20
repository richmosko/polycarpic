---
id: POLY-150h
title: Confirm it's you ruling
status: done
milestone: POLY-M1
parent: POLY-150
blocked_by: []
assignee: architect
paths: [process/cairn/issues/POLY-150.md, process/cairn/reviews/POLY-150/**, process/cairn/issues/POLY-151.md, process/cairn/issues/POLY-150h.md, docs/ARCH/**]
stage: plan
estimate.cost_usd: "7.00"
estimate.gate_cycles: 3
actual.cost_usd: "15.1993"
actual.tokens: 40593566
actual.gate_cycles: 15
actual.wall_clock: 264
ratio: "2.17"
labels: [design, security, bloat]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-19
---

The Principal brought POLY-151 into this loop (2026-11-19). The architect rules the Confirm it's you route before any test is written.

## Acceptance criteria

- [x] An addendum to `process/cairn/reviews/POLY-150/ruling.md` names the route, what it accepts (authenticator code or passkey, and the password), its rate limit and its route class, and how a passed re-check writes `recent_auth_at` through a definer with no new grant for poly_app on BetterAuth's tables.
- [x] It says how the database is protected from a forged or replayed re-check, given that it cannot check a code itself, and how the growing lock and the sign-in record apply.
- [x] seceng has reviewed it at an exact sha.
