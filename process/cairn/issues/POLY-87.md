---
id: POLY-87
title: Invite-only sign-up
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-62, POLY-86]
assignee: null
paths: [packages/auth/**, packages/tenancy/**, apps/web/src/routes/**, apps/cli/**]
labels: [auth]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

After the first (operator) user, an invitation is the only way into an instance; no setting reopens public sign-up (Principal P6, 2026-11-07). An invitee creates an account from the invite and lands on the invited entity, or on their own Person if invited with no entity. The operator can issue a standalone single-use, audited invitation from the box; that person gets only their own Person. PRD §4 invite story.

## Acceptance criteria

- [ ] With no invitation, the sign-up route refuses account creation; no config flag, env var or admin setting changes that.
- [ ] The first user on an empty instance is created only by polycarpic user invite <email> --bootstrap, once; an empty instance accepts no other first sign-up (INFRA S-1).
- [ ] An invitation link works once and expires; an accepted, revoked or expired link cannot be replayed.
- [ ] An invitee with an entity invite lands on that entity; one without lands on their own Person.
- [ ] polycarpic user invite <email> issues a single-use invitation sharing no entity and writes an audit event; that user sees only their own Person.
- [ ] /sign-up/email without a live invitation is refused at the route allowlist (ARCH §3.1c).
