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
updated: 2026-11-27
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

### @team-lead — 2026-11-19

From the POLY-150 loop (Principal, 2026-11-19; `process/DECISIONS.md`; ruling Addendum 3, Part 2 option (c)). **A per-entity second-step lock, enforced in the database.** A user who must have a second step and has none can view and manage their own Person; shared entities where they are owner or manager are greyed out until they set one up. Design it together with this issue's held role, as one mechanism.
- `app.has_role()` and `app.visible_entities()` answer only for the own-Person exemption while the user is held; `app.enter_session` computes the held flag once and writes it on the marker. Web then drops the all-pages redirect (POLY-89 R5) and greys the rest.
- The permission matrix gains a held actor across every tenant table; a held user's writes to their own Person pass.
- Decide with seceng: a locked entity shows its name or only a count; a reset sole owner leaves the entity with no effective owner until they enrol; a shared own Person leaves nothing usable.
- Needs its own ruling and seceng review; land before POLY-110 and POLY-144 make shared entities common. Guessed at $45 to $80 and 2.5 to 4 hours. DESIGN's sketch of the greyed state is in the POLY-150 record.

### @team-lead — 2026-11-20

From POLY-150: the designer's description of a greyed-out shared entity, for when the per-entity lock is built here (Principal, 2026-11-19: `process/DECISIONS.md`). Not drawn. It is a presentation only; the database or the loaders enforce it.


Applies to a user who holds owner or manager on a shared entity but has no second step. Their own unshared Person works normally.

## Entity selector (topbar dropdown)
- Their own Person sits at the top, enabled and selectable.
- Each shared entity is still listed, so the user can see what they belong to, but is disabled: `aria-disabled="true"`, muted ink (`--muted-foreground`), not focusable as a choice. A `lock` icon sits in place of the avatar cluster, and a small outline badge reads `Needs second step`. Colour never carries the state alone.
- One row is pinned at the foot of the list: "Set up a second step to open shared entities", plus **Set up second step**, which opens the set-up dialog.
- Picking a disabled row does nothing. Keyboard users hear it read as "The Moskos, Household, unavailable, needs a second step".

## Entities page
- The roll-up map: shared entities are drawn with a dashed outline and no fill, labelled with the name and a `lock`. They are not clickable. The user's Person is drawn as usual.
- The entity cards: each shared entity's card collapses to its header only (name, type badge, the user's role badge, then outline `Needs second step`). The body (members, cap table, Includes/Included in) is not rendered. In its place is one line, "Set up a second step to open The Moskos.", with **Set up second step**.
- The second-step message at the top of the page (already drawn) changes its words to "You own or manage shared entities. Set up a second step to open them."

## Elsewhere
- Dashboard, Transactions and other pages work on the Person only. Entity-scoped pages can be reached only through the selector, which offers no shared entity.
- A deep link to a shared entity's page shows an empty state in the shell: "This entity opens once you set up a second step.", with **Set up second step**. It never shows a redirect page or a blank one.

## Design notes
- Hiding shared entities entirely would make the user think they had lost access. Greying them keeps them visible and explains the reason in one place.
- This is a presentation only. Whatever enforces it (web loaders or the database) is architect-150's and seceng-150's call. The greyed state should never be the only barrier.

### @team-lead — 2026-11-20

seceng-150's assessment of the per-entity gate from the POLY-150 loop is at `process/cairn/reviews/POLY-91/seceng-per-entity-gate.md`. Option (a), the single redirect, was built in POLY-150. Option (c), `app.has_role` refusing manager and owner rights on a shared entity while the user has no second step, is the work for this issue (guessed $60 to $80). Never (b), per-loader checks, on its own.

### @team-lead — 2026-11-24

**Scope cut by the Principal, 2026-11-25** (`process/DECISIONS.md`): this issue builds the held raise and the two 0013 fixes (N4 and the narrowed policy), which are POLY-M1's definition of done. The per-entity second-step lock placed here on 2026-11-19 is built in its own POLY-M2 issue, blocked by this one and blocking POLY-110 and POLY-144. **The ruling for this issue still designs both as one mechanism,** as the Principal asked, so the lock's issue builds to it with no second design. The comments above about the lock and its greyed-out state are that issue's sources. Preferred before POLY-129 (N4: an invited viewer is otherwise marked accepted without the raise).

### @team-lead — 2026-11-27

From POLY-90 (ruling `process/cairn/reviews/POLY-90/ruling.md` §F @ 80607cfa). Extend `app.owner_transition()` to cancel direct-path held raises under the same lock. `promote_held_roles` locks the entity before counting owners. A held owner raise does not revoke; its promotion does.
