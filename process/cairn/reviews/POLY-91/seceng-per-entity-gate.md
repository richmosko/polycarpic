# POLY-91: the per-entity gate, seceng's assessment

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
