---
id: POLY-144
title: In-app instance invite
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-89, POLY-137, POLY-142]
assignee: null
labels: [story, auth]
priority: null
pr: null
created: 2026-11-12
updated: 2026-11-12
---

A signed-in user invites a new person to the instance from the app, by email, without inviting them to any group entity. The invitee gets an account with only their own Person, exactly as POLY-142's plain `polycarpic user invite <email>` gives from the command line. Mandatory per the Principal (2026-11-13, POLY-142 kickoff): "there should be an email invite option that doesn't include inviting a new user to a group Entity", and "the mechanism should be an email invite with the link embedded". The reason given: nobody sees the CLI's stdout except perhaps during initial setup.

It builds on POLY-142's issuing path and POLY-87's claim and accept definers. It needs the Resend mailer, which is an item in POLY-137 and is not built (`apps/web/src/lib/server/auth.ts` answers 503 for a magic link; `RESEND_API_KEY_FILE` is registered for web and worker). Ordering rule (STATE.md, seceng 2026-11-13): POLY-89's database gates land before, or with, the first route that sends an invitation, so this issue is blocked by POLY-89.

## Acceptance criteria

- [ ] From the app, a permitted signed-in user invites an email address without naming an entity; the invitee who signs up sees only their own Person.
- [ ] The invitation is delivered by email with the link embedded. The plaintext token is never stored or logged.
- [ ] The invitation is single-use, expires after 7 days, and writes an `invitation.issued` audit event that names the inviting user.
- [ ] A user who is not permitted sees no control, and the API refuses the same call.
- [ ] A failed send does not leave a live invitation the inviter cannot see or revoke.

## Open for the Principal at this issue's start

- Who may issue an instance invitation. Today only the operator (shell access) admits a new person; this issue gives that power to some signed-in users, and which ones is undecided.
- Whether POLY-142's CLI invite also sends the email once the mailer exists, keeping stdout for `--bootstrap`.
- Whether POLY-129's entity invite to an email with no account uses the same email delivery (the lead's reading of the Principal's words is yes; not confirmed).

## For the owners

- product-manager: PRD §4 invite story needs this path.
- seceng: the invite route joins the rate-limit and mail-abuse review (C-04, R-24); the token travels through Resend.
- ux-designer: where the control lives (DESIGN has no flow for it).
