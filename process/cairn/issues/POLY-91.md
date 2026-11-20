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
updated: 2026-11-20
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

seceng-150's assessment of the per-entity gate from the POLY-150 loop (2026-11-19, read at 82608edf), filed by team-lead for this issue's ruling. Option (a) was built in POLY-150; option (c) is the work recorded here. Costs are guesses.


Read at `82608edf`: `apps/web/src/hooks.server.ts`, migrations 0003, 0013 and 0018, and POLY-91. Tags: **measured**, **code-read**, **spec**, **guessed**. I ran nothing.

## 0. Who is held today, and how strong the redirect is

**Who is held.** The gate holds a user while `app.second_step_required()` is true: they have no second step, and they are manager or owner of an entity other than their own unshared Person. Three things make that state hard to reach (code-read, 0013):
- A manager or owner seat for an unenrolled user is refused (`membership_05`).
- An invited manager is seated only when they enrol (`seat_claimed_invitations`). Until then they are not held: they see only their own Person.
- Removing the last method is refused while the user needs one (`refuse_last_method`).

So **in practice the only held user is a manager after the operator's `reset-mfa`**. Reset leaves memberships unchanged. The forced case is rare, and it is exactly the case an attacker aims for: persuade the operator to reset, then sign in with the password alone. The new-invitee case the Principal may be picturing already works his way: the user sees their own Person, and the shared entity appears once they enrol.

**What the redirect is** (code-read, `hooks.server.ts:84`):
- **One check point, closed by default.** It runs in `handle` before `resolve`, for every path that is not public. That covers every page, every `__data.json`, every form action and every `+server.ts`, including routes not written yet. One path is exempt.
- **The database decides.** The answer is `app.second_step_required()`, read in the same transaction as the session marker.
- **It fails closed.** If the call raises, `enter` throws and nothing is served.
- **Its weakness is that only web enforces it.** No RLS policy and no guard reads `second_step_at` for ordinary reads and writes. `app.has_role()` checks the membership role alone, and POLY-91's held role is not built (backlog). So the database would let a held manager do every manager write. Only web's choke point stops it.
- **How strong it is: strong against a page someone forgot**, because there are no per-page checks to forget. **Weak against a bug in those five lines** or a future widening of the exemption. **No protection against code execution in web**, which R-2 already gives the run of every active user. SQL injection by a held user has almost nothing to aim at, since only the exempt page is served to them.

## 1. The options

### (a) Keep the redirect; its target becomes the Settings panel
- **Mechanism.** As today, but the exempt path becomes the Settings route that hosts the set-up.
- **Who can use a gap:** a password holder for a reset manager.
- **What a gap reaches.** Whatever the exempt page loads and does. This needs two rules, or (a) gets weaker than today:
  1. **Exempt exactly one route** (and its `__data.json`), never the `/settings` tree. Settings also holds Sessions, export, and later account deletion.
  2. **The exempt page loads no entity data.** That includes the app shell's entity selector, if the panel is rendered in the shell. Either render it without shell data, or have the shell show only the own Person.
- **Strength:** the same as today.
- **Cost:** small, inside Addendum 3 (guessed: under $5).

### (b) A per-entity gate in web's loaders
- **Mechanism.** The global redirect goes. Each loader, action and endpoint that touches an entity checks "shared, and the user has no second step" and refuses or greys it out.
- **Who can use a gap:** the same password holder.
- **What a gap reaches.** Any loader, action or `+server.ts` that forgets the check, now or later, gives **full manager or owner rights on that shared entity**. Entity ids come from URL parameters and the selector, so a hand-typed URL is all it takes.
  - A shared helper (`withEntity(id)`) with a lint rule narrows the risk but does not remove it. It is still only web, and still something each page opts into.
  - **This is weaker than today.** It replaces one check that is closed by default with many checks that are open by default, while the attacker in question is the one this population invites.
- **Stronger option:** (a) or (c).
- **Cost:** guessed $25–35 now, and a check in every future entity page for good. I advise against (b) alone.

### (c) A per-entity gate in the database
- **Mechanism.** `app.has_role(entity, role)`, which every RLS policy and guard uses, returns false for manager or owner rights on an entity where `own_person_exempt` is false while the user has no second step. That is the same rule as `second_step_needed`, applied per entity.
  - Greying out needs the names of the locked entities: one narrow definer that returns id and name only.
  - This is the machinery POLY-91 already plans: a held role keeps viewer access until enrolment. The two should be one design. The choice is whether a held entity is invisible, viewer-only, or name-only.
  - The own Person keeps working through the exemption.
- **Who can use a gap:** a gap would be a bug in `has_role` itself, pinned by pgTAP like every policy.
- **What it holds against:** a forgotten page, a web bug, and SQL injection as poly_app. It does **not** hold against code execution in web, which is R-2's reach whatever is chosen.
- **What a gap reaches.** If web shows something it shouldn't, the database still refuses, so the greying is cosmetic and safe. Once (c) lands, the global redirect can go.
- **Costs and risks:**
  - `has_role` is on the hot path of every policy, so one extra lookup per check (guessed small; qa should measure it).
  - Its effect on `owner_count` and approvals: a reset sole owner leaves the entity with no effective owner until they enrol. That is safe and closed, but it needs stating.
- **Cost:** guessed one loop, $60–80 and 3–4 h. **It is its own issue, merged with or right after POLY-91, not this loop.**

## 2. Recommendation for the Principal
- **Now (this loop): (a).** It is the only shape as strong as today, and the case it bites is rare (after a reset). Settings is the redirect target, and the set-up dialog opens there.
- **Next: (c) with POLY-91**, so that the database enforces "own Person usable, shared entities greyed". The redirect is then replaced by web greying entities in a way the database backs.
- **Never (b) on its own.**
- **Until (c):** the reset-mfa runbook's identity check (INFRA, devops) carries even more weight, because a reset is the one way into the held state.
