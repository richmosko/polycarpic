---
id: POLY-151
title: Confirm it's you route
status: backlog
milestone: POLY-M1
parent: null
blocked_by: []
assignee: backend-lead
labels: [security]
priority: null
pr: null
created: 2026-11-16
updated: 2026-11-16
---

Nothing writes `recent_auth_at` after first enrolment, so an enrolled user cannot add or remove a second-step method once the first 5 minutes pass. BetterAuth 1.7.18 has no TOTP re-check against an existing session, so the re-authentication route is ours to design and needs its own ruling with seceng's review before any test is written. Lands before POLY-110 and POLY-144. The screen is in the Second-step screens issue.

## Acceptance criteria

- [ ] A ruling names the route, what it accepts (authenticator code or passkey), its rate limit and its route class, reviewed by seceng.
- [ ] A passed re-check writes `recent_auth_at` through a definer; `poly_app` gets no new grant on BetterAuth's tables.
- [ ] An enrolled user can add and remove a method after the 5-minute window, proved in `tests/db` through the real handler.
- [ ] A failed or replayed re-check leaves `recent_auth_at` unchanged.
