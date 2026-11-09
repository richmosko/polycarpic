---
id: POLY-129
title: Entities screen: create, members, invite
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-62, POLY-86, POLY-89]
assignee: null
paths: [apps/web/src/routes/**/entities/**, apps/web/src/routes/api/v1/entities/**, packages/tenancy/**]
labels: [story, tenancy]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

Gap filed at POLY-126's trace: POLY-M1's definition of done says a user "creates an entity, and grants another user a viewer membership", and POLY-106 checks it end to end, but no issue built the screen or the API. The Entities screen per ARCH §2.4 (EntityList, MembershipList, the invite command → packages/tenancy) and DESIGN #flow-entity-membership: create a Person, Trust, Business, Household or Holding; list members with their role in force; invite a user as viewer, manager or owner. Creating an entity and granting access are forcing actions for the second step (POLY-89). The founder and multi-owner gate are POLY-90, held raises POLY-91, the cap table POLY-93; this issue only calls them.

## Acceptance criteria

- [ ] An enrolled owner creates each entity type from the Entities screen through /api/v1 (Zod-validated); the creator holds owner and is the founder.
- [ ] An owner invites an existing user as viewer; once accepted, that user sees exactly that entity and its members list, and nothing of the owner's other entities (POLY-84 battery row).
- [ ] An invite to an email with no account issues the invitation POLY-87 accepts.
- [ ] A viewer or manager sees no invite or create-for-entity control, and the API refuses the same calls (ARCH §3.1, SECURITY §4.2.1).
- [ ] An unenrolled user attempting create or invite is sent to enrolment first (POLY-89).
- [ ] The OpenAPI document regenerates with the new routes and CI's staleness check passes.
