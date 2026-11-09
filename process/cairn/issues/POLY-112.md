---
id: POLY-112
title: Co-owner approvals + founder
status: backlog
milestone: POLY-1.0
parent: null
blocked_by: [POLY-90, POLY-91, POLY-93]
assignee: null
paths: [packages/tenancy/**, packages/db/migrations/**, apps/worker/**, apps/web/src/routes/**, apps/cli/**]
labels: [db, tenancy, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

On an entity with more than one owner, inviting a member or raising a role, removing or demoting a co-owner, and any cap-table edit take effect only once every other owner approves (P5b, R-19; ARCH §3.1b; SECURITY §4.2.2, A-20, A-22, C-28). Placed in POLY-1.0, not M1 as the PM drafted (lead ruling, 2026-11-08, per ARCH §11): the M1 database gate refuses these actions on multi-owner entities until this ships. POLY-70 carries the viewer experience.

## Acceptance criteria

- [ ] On a two-owner entity, an invite or role raise stays pending, no email is sent, and the invitee has no access until the other owner approves.
- [ ] One decline from any other owner ends the request; the requester sees who declined.
- [ ] A request unanswered for 14 days expires as declined, with a reminder to the approvers at day 7.
- [ ] A departing owner's approvals stop counting; a request then complete waits for the requester to confirm.
- [ ] Removing or demoting a co-owner needs every other owner, including the target, to vote.
- [ ] After a decline or expiry the founder can force the removal, with second-factor step-up and an audit event; every owner, the target included, is notified.
- [ ] The founder has no other extra power; the role leaves only by stepping down or transfer (founder-only, step-up, notified).
- [ ] Sole-owner entities behave as before; removing a viewer or manager and lowering one's own role are immediate.
- [ ] change_request / change_approval with the poly_govern definers apply_change (approvers recomputed, payload re-validated or declined as stale), withdraw_change, expire_changes (daily, poly_worker), force_change, transfer_founder.
- [ ] One open request per kind and target (a held raise counts); re-raise at most once per 7 days; the gate extends to equity_holder_label.
- [ ] polycarpic entity set-founder (operator, audited, notifies every owner).
- [ ] Tests: ARCH §3.1b Tests, request and force items, plus the integration items (no email before apply; 403 without step-up).
