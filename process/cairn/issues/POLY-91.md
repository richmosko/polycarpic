---
id: POLY-91
title: Held role raise
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-89, POLY-90]
assignee: backend-lead
paths: [packages/db/migrations/**, packages/tenancy/**]
labels: [db, tenancy, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-16
---

A raise to manager or owner for an unenrolled member is parked on membership.pending_role while they keep viewer access, and promoted only by app.promote_held_roles() at enrolment (ARCH §3.1c; SECURITY A-25; DESIGN Waiting for second step).

## Acceptance criteria

- [ ] A raise to manager or owner stays pending, with viewer access intact, until the member enrols; then it takes effect with no second invitation.
- [ ] Four pending_* columns, null together; CHECK pending_role ⇒ role = viewer.
- [ ] app.hold_unenrolled_role(): an UPDATE raise is held with the member's notice and a role.held audit; an unenrolled INSERT as manager or owner is refused (second_step_required).
- [ ] app.promote_held_roles() (poly_govern) is the only upward write, in the enrolment transaction, one role.promoted audit per row; its write fires the 1 → 2 transition.
- [ ] An owner's cancel needs no approval and notifies raiser and member; the 1 → 2 transition cancels direct-path held raises and keeps approved ones.
- [ ] Tests: ARCH §3.1c held-role and held-raise items.

## Comments

### @team-lead — 2026-11-16

From the POLY-89 loop (merged 2026-11-17, PR #131), both in migration `0013_second_step_guards`. (1) `seat_claimed_invitations` inserts `ON CONFLICT DO NOTHING` and then sets `accepted_at` either way (lines 314-315), so an invitee who already holds a viewer seat is marked accepted without the raise. Refuse the claim or apply it as a raise (seceng build review N4). (2) The `membership_seat_claimed` policy (line 20) lets any poly_govern definer insert a manager or owner row for the marker's user on any entity; only `seat_claimed_invitations` uses it. Narrow it to a claimed, unaccepted invitation for that entity, user and role (architect verdict, finding 3).
