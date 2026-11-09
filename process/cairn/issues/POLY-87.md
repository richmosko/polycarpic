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
updated: 2026-11-09
---

After the first (operator) user, an invitation is the only way into an instance; no setting reopens public sign-up (Principal P6, 2026-11-07). An invitee creates an account from the invite and lands on the invited entity, or on their own Person if invited with no entity. The operator can issue a standalone single-use, audited invitation from the box; that person gets only their own Person. PRD §4 invite story.

## Acceptance criteria

- [ ] With no invitation, the sign-up route refuses account creation; no config flag, env var or admin setting changes that.
- [ ] The first user on an empty instance is created only by polycarpic user invite <email> --bootstrap, once; an empty instance accepts no other first sign-up (INFRA S-1).
- [ ] An invitation link works once and expires; an accepted, revoked or expired link cannot be replayed.
- [ ] An invitee with an entity invite lands on that entity; one without lands on their own Person.
- [ ] polycarpic user invite <email> issues a single-use invitation sharing no entity and writes an audit event; that user sees only their own Person.
- [ ] /sign-up/email without a live invitation is refused at the route allowlist (ARCH §3.1c).
- [ ] Sign-up by invitation commits the user row, the Person, the owner membership and the seeded accounts together; after a forced rollback of our transaction none of them exists (ARCH v1.14 §3.1).
- [ ] Inside the sign-up transaction the hook sets `app.user_id` with `is_local = true` through packages/db before provisionPerson, and provisionPerson's inserts succeed as poly_app under FORCE RLS; with the step removed, the same sign-up is refused by RLS and leaves no user row.
- [ ] A throw inside provisionPerson fails the sign-up and leaves no user row, Person, membership or account.
- [ ] After the sign-up transaction commits, `app.user_id` is unset on that pooled backend (a context-free query there sees zero tenant rows).
- [ ] The new-user step is reachable only through withContextFreeTx's handle, not from the db/auth index. It refuses an existing user's id, a second call, a call outside withContextFreeTx, and an id whose insert was rolled back to a savepoint (SECURITY C-84, T-90).
- [ ] A throw after the new-user step leaves no user, entity or membership row. After both a commit and a rollback, the next checkout of that backend reads app.user_id empty.
- [ ] The invitation is checked and consumed in the sign-up transaction. Two sign-ups racing on one invitation yield exactly one user, and the loser leaves no user row.
