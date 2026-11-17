---
id: POLY-150
title: Second-step screens
status: backlog
milestone: POLY-M1
parent: null
blocked_by: []
assignee: ux-designer
labels: [design, security]
priority: null
pr: null
created: 2026-11-16
updated: 2026-11-16
---

POLY-89 shipped the second sign-in step as database guards and auth routes, with a placeholder at `/settings/second-step`. No screen reaches enrolment, so nobody can enrol in a browser, and no one can create a non-Person entity or send an invitation until these exist (ruling R7 in `process/cairn/reviews/POLY-89/ruling.md`; it fails closed). POLY-139 covers only Sign-in and Sessions. ux-designer designs, frontend-lead builds. Lands before POLY-110 and POLY-144.

## Acceptance criteria

- [ ] DESIGN carries the set-up flow (`#flow-second-step`): password, emailed code, then the factor (authenticator app or passkey), with the backup codes shown once.
- [ ] DESIGN carries `/sign-in/second-step` for an enrolled user on a new device, and the Confirm it's you prompt.
- [ ] The screens are built in web and replace the `/settings/second-step` placeholder.
- [ ] A browser test shows an enrolled user held at `/sign-in` until the second step passes (ruling R7, criteria C4/C5 of POLY-89; proved only in `tests/db` today).
- [ ] A browser test enrols a user end to end against the real handler.

## Comments

### @team-lead — 2026-11-16

Filed from the POLY-89 loop (merged 2026-11-17, PR #131). The lead's check of the sign-in gate was over HTTP only, because the app needs `x-forwarded-for` to resolve a client address and a plain browser has none; the browser tests here should run behind a proxy that sets it.
