---
id: POLY-151
title: Confirm it's you route
status: done
milestone: POLY-M1
parent: null
blocked_by: []
assignee: backend-lead
labels: [security]
priority: null
pr: https://github.com/richmosko/polycarpic/pull/141
created: 2026-11-16
updated: 2026-11-20
---

Nothing writes `recent_auth_at` after first enrolment, so an enrolled user cannot add or remove a second-step method once the first 5 minutes pass. BetterAuth 1.7.18 has no TOTP re-check against an existing session, so the re-authentication route is ours to design and needs its own ruling with seceng's review before any test is written. Lands before POLY-110 and POLY-144. The screen is in the Second-step screens issue.

## Acceptance criteria

- [x] A ruling names the route, what it accepts (authenticator code or passkey), its rate limit and its route class, reviewed by seceng. (`process/cairn/reviews/POLY-150/ruling.md` Addenda 3–7: A1 the routes, class `reauth`, `LIMITED`; Addendum 4 the shapes; seceng's `ruling-review.md` §13, ACCEPT 671d219e once RC6 is fixed, fixed at fa3bac5c.)
- [x] A passed re-check writes `recent_auth_at` through a definer; `poly_app` gets no new grant on BetterAuth's tables. (`step-up-reauth.test.ts` T3, T4; pgTAP 08 and 11.)
- [x] An enrolled user can add and remove a method after the 5-minute window, proved in `tests/db` through the real handler. (`step-up-reauth.test.ts` C3, `method-audit.test.ts`, `last-method-guard.test.ts`; browser: `second-step-reauth.spec.ts`.)
- [x] A failed or replayed re-check leaves `recent_auth_at` unchanged. (`step-up-reauth.test.ts` T1, T2, the error table, the lock and reuse-rollback cases.)

## Comments

### @team-lead — 2026-11-19

The Principal brought this issue into the POLY-150 loop (2026-11-19; `process/DECISIONS.md`). Its ruling is an addendum to `process/cairn/reviews/POLY-150/ruling.md`, its stages are POLY-150h (ruling) and POLY-150i (route build), and it ships in POLY-150's PR. This issue closes with that PR.

### @team-lead — 2026-11-20

Validate passed; merging via PR #141. Closing.
