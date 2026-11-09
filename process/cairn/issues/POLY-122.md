---
id: POLY-122
title: Sign in with Apple
status: backlog
milestone: null
parent: null
blocked_by: []
assignee: backend-lead
paths: [packages/auth/**]
labels: [auth, post-ga-candidate]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

Deferred to the native iOS milestone (Principal, 2026-11-08); web v1 ships Google and GitHub. Blocked by the native iOS work, which is not yet filed, so blocked_by stays empty until it is. Known requirements are listed below.

## Acceptance criteria

- [ ] Apple Developer Program (paid) enrolment; the Services ID, Sign in with Apple key and team id held as operator secrets.
- [ ] Works only on a real public domain; disabled in .local mode like the other providers.
- [ ] Private-relay email: our sending domain registered with Apple's relay so mail reaches relay addresses.
- [ ] Hide My Email vs the C-05 invite-match rule: a relay address never matches an invitation, so linking happens while signed in; SecEng rules on the flow.
- [ ] Name and email arrive only on the first sign-in and are stored at that callback.
- [ ] Apple tokens are revoked on account deletion.
- [ ] ARCH §2.2 / §7.8 / A-27, PRD and DESIGN sign-in wording updated.
