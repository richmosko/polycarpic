---
id: POLY-166
title: Per-entity second-step lock
status: backlog
milestone: POLY-M2
parent: null
blocked_by: [POLY-91]
assignee: backend-lead
labels: [auth, security]
priority: null
pr: null
created: 2026-11-24
updated: 2026-11-24
---

A user who must have a second step and has none can view and manage their own Person; shared entities where they are owner or manager are greyed out until they set one up, enforced in the database (`app.has_role` refusing manager and owner rights on a shared entity while the user has no second step; option (c)). Decided by the Principal on 2026-11-19 (`process/DECISIONS.md`) and placed in POLY-91; split out of POLY-91 by the Principal on 2026-11-25 so that POLY-M1 closes on the held raise alone. **Designed in POLY-91's ruling as one mechanism with the held raise; built here.** Until this ships, POLY-150's single redirect stays: a user who needs a second step and has none is sent to set one up before anything else. It must land before shared entities become common, so POLY-110 and POLY-144 are blocked by it. Sources: POLY-91's comments of 2026-11-19 and 2026-11-20 (the designer's greyed-out state), `process/cairn/reviews/POLY-91/seceng-per-entity-gate.md`. seceng reviews the ruling and the build. Guessed at $45 to $80.

## Acceptance criteria

- [ ] `app.has_role` refuses manager and owner rights on a shared entity while the user has no second step; the user's own Person stays usable. Never per-loader checks on their own.
- [ ] Decided with seceng and recorded: whether a locked entity shows its name or only a count; a reset sole owner, who leaves the entity with no effective owner until they enrol; a shared own Person.
- [ ] The greyed-out state in the entity selector, the Entities screen and the roll-up map as the designer described it on POLY-91; colour never carries the state alone.
- [ ] POLY-150's redirect is removed only when the lock is in force, in the same change, with a test that neither state lets an unenrolled manager act on a shared entity.
