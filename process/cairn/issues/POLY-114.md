---
id: POLY-114
title: Entity purge + former holder
status: backlog
milestone: POLY-1.0
parent: null
blocked_by: [POLY-110, POLY-93]
assignee: backend-lead
paths: [packages/tenancy/**, packages/db/migrations/**, apps/worker/**, apps/web/src/routes/**]
labels: [db, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-10
---

A sole owner's whole-entity purge through app.purge_entity (poly_purge) with its guards in order (ARCH §3.4; SECURITY §4.5, OQ-4, OQ-23), and the purge of an entity that holds units on other cap tables (ARCH §3.4b, A-19, OQ-33): the id-only tombstone, the former-holder notice and label, and the split read rule.

## Acceptance criteria

- [ ] Purge requires a fresh sign-in, the typed entity name, a fresh export with fingerprint and the retention warning ("up to 35 days in backups", A-35); every member is emailed at once and nothing waits.
- [ ] Guards run in the ARCH §3.4 order, including provider revocation by the worker and the zero-rows plus tombstone-shape assert.
- [ ] entity.purged records row counts, the final chain head and the cap tables it held units on.
- [ ] Purge leaves only an id-and-date tombstone; another entity's cap table reads Former holder (purged <date>), and its units count as outside owners from that date.
- [ ] Owners of each such entity are notified, including owners the purging user cannot see; they may type an optional label, gated as a cap-table edit and purged only with their own entity.
- [ ] A new row naming a former holder is refused; a pending cap_table request naming it is declined as stale.
- [ ] No purge by a job, of a partial range, or while a second owner exists.
- [ ] Tests: ARCH §3.4 purge negatives (C-50) and §3.4b Tests.

## Comments

### @team-lead — 2026-11-10

Gap found in the 2026-11-11 doc cleanup (devops and seceng, independently): the purge confirmation must tell the user that purged data stays in backups for up to 35 days. ARCH, INFRA and SECURITY state it (SECURITY §12.3 keeps it as an open ask on PRD and DESIGN), but neither `docs/PRD/index.html` nor `docs/DESIGN/index.html` carries the wording (grep "35 days": 0 hits each). Before this issue builds the purge screen, product-manager adds the requirement to PRD §5 and ux-designer adds the screen copy to DESIGN.
