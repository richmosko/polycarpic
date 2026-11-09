---
id: POLY-115
title: Account deletion in-flow
status: backlog
milestone: POLY-1.0
parent: null
blocked_by: [POLY-114, POLY-112]
assignee: null
paths: [packages/tenancy/**, packages/auth/**, apps/web/src/routes/**]
labels: [auth, tenancy, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

On a request to delete their account, the user sees every entity where they are sole owner and chooses per entity: transfer to a named existing member, purge, or abort the whole deletion (PRD §5; ARCH §3.4a; SECURITY §4.6, C-52, A-30). Choices come first, effects last. A founder of a multi-owner entity names a successor. Placed in POLY-1.0 (PM recommendation, adopted).

## Acceptance criteria

- [ ] Deletion lists each solely owned entity and requires a choice for each; transfer is never preselected.
- [ ] Aborting before the final confirmation leaves the account and every entity unchanged.
- [ ] Transfer targets only an existing member with a second step and reports who becomes owner and founder; members without one show as needing a second step.
- [ ] Leaving a shared entity notifies the remaining members and blocks nothing.
- [ ] A founder of a multi-owner entity cannot delete without naming a successor owner.
- [ ] An account with no second step deletes with the password plus the email confirmation; that stamp authorises only this run.
- [ ] The plan is held server-side and bound to its session; a failed revocation stops the run with per-entity status.
- [ ] The tombstone transaction re-checks no sole-owned entity and no multi-owner founder, removes credentials, sessions and memberships, marks connections principal_invalid, and re-evaluates pending requests.
- [ ] Tests: SECURITY §4.6 deletion-flow negatives and the unenrolled-deletion items.
