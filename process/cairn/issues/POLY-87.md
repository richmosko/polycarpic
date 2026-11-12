---
id: POLY-87
title: Invite-only sign-up
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-62, POLY-86, POLY-140, POLY-141]
assignee: null
paths: [packages/auth/**, packages/tenancy/**, apps/web/src/routes/**, apps/cli/**]
labels: [auth]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-11
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
- [ ] The step refuses a provisioned user's id planted in the setting by set_config; a rollback to the savepoint clears the recorded id.
- [ ] A membership on an invited entity is written only by the invitation-accept definer: `poly_app` holds no INSERT on `membership` (POLY-62 ruling R4). The definer seats `app.current_user_id()` against a matching live invitation, and for manager or owner only after the second step is enrolled.
- [ ] Operator invitations with no entity have their own definer path: `invitation` rows with `entity_id IS NULL` pass no `poly_app` policy, and `app.gate_owner_changes()` refuses them today (POLY-62 verdict).

## Comments

### @team-lead — 2026-11-11

From the POLY-86 loop (ruling follow-up 6): this issue builds the real `claimInvitation`, the new-user step and `provisionPerson` at sign-up. Until then `packages/auth` passes a stub that refuses every sign-up, and the check runs in `user.create.before` inside `withContextFreeTx` on every user-creating route.

### @team-lead — 2026-11-11

From the POLY-136 loop. **Order:** POLY-140 (layer lint, relative imports) and POLY-141 (db battery parallel and area-split) run first (Principal, 2026-11-12). **Room in the `db` job:** about 5 s of CI time at the median (125 s against the 130 s target; `process/cairn/reviews/POLY-136/ruling.md`, addendum 3). The bound is two-part: median ≤ 130 s and the fastest three of five runs averaging ≤ 120 s; POLY-141 resets it. The configured budget is 180 s and only warns (`infra/ci/budgets.json`). **New-user step:** `apps/migrate/src/run.ts` shows the pattern POLY-140 generalises: a file importable only from named callers, by package path and by relative path.
