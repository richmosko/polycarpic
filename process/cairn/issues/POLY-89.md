---
id: POLY-89
title: Second sign-in step
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-86, POLY-62, POLY-87]
assignee: backend-lead
paths: [packages/auth/**, packages/tenancy/**, packages/db/migrations/**, apps/web/src/routes/**, apps/cli/**]
labels: [auth, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

Owners and managers must enrol a second factor (authenticator app or passkey); viewers may (P1). It is asked on a new device and as a step-up before export, purge, granting access and linking a bank. A user's own unshared Person is exempt until a forcing action (OQ-34). First enrolment is anchored on a code sent to the account email in addition to the password (ARCH §3.1c; SECURITY §4.1, C-03, A-28..A-30, A-32). Held raises are POLY-91.

## Acceptance criteria

- [ ] A new user whose only entity is their own unshared Person reaches the dashboard with no enrolment prompt.
- [ ] Each of these forces enrolment first: creating a Person, Trust, Business, Household or Holding; sharing the own Person (first invite or a roll-up edge); accepting an owner or manager invitation; export, purge, grant, bank link on the own Person. Viewing shared entities never does.
- [ ] Enrolment requires the password (or a fresh IdP round trip) plus a confirmed emailed code; without it the factor does not become active.
- [ ] A new device prompts for the factor; a known device within its session does not; step-up actions always prompt; a completed first enrolment counts as the step-up.
- [ ] A passkey and an authenticator app each satisfy the step; Google and GitHub sign-in satisfy neither.
- [ ] polycarpic user reset-mfa clears a user's factors, revokes every session, writes an audit event, and the user must re-enrol.
- [ ] user.second_step_at is written only by app.sync_second_step(); poly_app has no UPDATE on it.
- [ ] email_challenge: hashed, session-bound, 10 minutes, single use, 5 tries, 3 sends per 15 minutes with an indistinguishable response; enrolment_grant: one live per user, session_id ON DELETE SET NULL, consumed_txid recorded.
- [ ] Database guards in BetterAuth's measured order (twoFactorEnabled flip, twoFactor.verified, passkey INSERT, session INSERT stamp) plus the hooks.before enrolment class.
- [ ] app.own_person_exempt() is the one predicate for the hold, the last-method trigger, the sign-in gate and SecondStep.required; the last-method trigger refuses removing a manager's or owner's last factor.
- [ ] Tests: ARCH §3.1c Tests, the OQ-34, email-anchoring, A-28 and integration items.
