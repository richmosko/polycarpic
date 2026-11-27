---
id: POLY-129
title: Entities screen: create, members, invite
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-62, POLY-86, POLY-89, POLY-90]
assignee: null
paths: [apps/web/src/routes/**/entities/**, apps/web/src/routes/api/v1/entities/**, packages/tenancy/**]
labels: [story, tenancy]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-27
---

Gap filed at POLY-126's trace: POLY-M1's definition of done says a user "creates an entity, and grants another user a viewer membership", and POLY-106 checks it end to end, but no issue built the screen or the API. The Entities screen per ARCH §2.4 (EntityList, MembershipList, the invite command → packages/tenancy) and DESIGN #flow-entity-membership: create a Person, Trust, Business, Household or Holding; list members with their role in force; invite a user as viewer, manager or owner. Creating an entity and granting access are forcing actions for the second step (POLY-89). The founder and multi-owner gate are POLY-90, held raises POLY-91, the cap table POLY-93; this issue only calls them.

## Acceptance criteria

- [ ] An enrolled owner creates each entity type from the Entities screen through /api/v1 (Zod-validated); the creator holds owner and is the founder.
- [ ] An owner invites an existing user as viewer; once accepted, that user sees exactly that entity and its members list, and nothing of the owner's other entities (POLY-84 battery row).
- [ ] An invite to an email with no account issues the invitation POLY-87 accepts.
- [ ] A viewer or manager sees no invite or create-for-entity control, and the API refuses the same calls (ARCH §3.1, SECURITY §4.2.1).
- [ ] An unenrolled user attempting create or invite is sent to enrolment first (POLY-89).
- [ ] The OpenAPI document regenerates with the new routes and CI's staleness check passes.

## Comments

### @team-lead — 2026-11-24

From the M1 regroup (2026-11-25; architect's and product-manager's reviews). (1) The cap table (POLY-93) moved to POLY-1.0: this screen shows no cap table and calls none; read any mention of POLY-93 here as out of scope. (2) Now blocked by POLY-90: the own-Person guard lands before the accept path this issue ships. POLY-91 before this issue is preferred (an invited viewer is otherwise marked accepted without the raise). (3) Answer at the start: does this screen's invite send email to an address with no account (POLY-144's open question; the product walk on staging needs it to). (4) The forged-form test from POLY-134 lands with this issue at the latest. Design first: the ux-designer styles the screen before the build.

### @team-lead — 2026-11-27

From POLY-90 (seceng-90, `process/cairn/reviews/POLY-90/seceng-conditions.md` §7; decided in `process/DECISIONS.md`, 2026-11-27). Two conditions on this issue. (1) A claim with no invitation token (provider callback, magic-link verify) seats viewer rows only; a manager or owner invitation needs the token on every path (SECURITY R-23). (2) Existing-user acceptance: the signed-in user accepts with the token and an explicit consent action, never an email match alone; the acceptance definer locks the entity first and is a membership write under POLY-90's rules (R-22).
