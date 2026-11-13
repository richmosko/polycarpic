---
id: POLY-89
title: Second sign-in step
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-86, POLY-62, POLY-87, POLY-147]
assignee: backend-lead
paths: [packages/auth/**, packages/tenancy/**, packages/db/migrations/**, apps/web/src/routes/**, apps/cli/**]
labels: [auth, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-13
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

## Comments

### @team-lead — 2026-11-11

From the POLY-86 loop: (1) the enrolment class's grant check replaces POLY-86's flat refusal, and this issue adds the `recent_auth_at` writers (ruling follow-up 5). (2) In migration 0004 `two_factor.verified` defaults to true, BetterAuth's default; it must default to false so a write that omits it never marks a factor verified (seceng build review @ 04bd75b).

### @team-lead — 2026-11-12

From the POLY-87 loop. (1) Sign-up claims a manager or owner invitation without seating it (`claimed_at` set, `accepted_at` null); this issue's enrolment write seats those rows, beside the 1 → 2 owner rule (POLY-87 ruling R1, R2; seceng review §6). `accept_invitations` seats viewers only and its policy is viewer-only. (2) Ordering rule (seceng, 2026-11-13): the database gates that end the own-Person exemption (no Trust, Business, Household or Holding, no sharing, no step-up while unenrolled; SECURITY §4.1, C-03) are this issue's and are not built; `seat_creator` seats any creator as owner today. They must land before, or with, the first route that creates a non-Person entity or sends an invitation.

### @architect — 2026-11-13

POLY-145 is decided: the target is (e1), and this issue lands after stage 1 and before stage 2 (`process/cairn/reviews/POLY-145/`). Specify the guards against the stage-1 marker, not against the setting:
- Identity is read through `app.current_user_id()`, which then reads `app.tx_identity`.
- The session is read from the marker's `session_id`, never from `current_setting('app.session_id')`. This covers `email_challenge`, `enrolment_grant` and the session-INSERT stamp.
- Every new `enter_*` or definer refuses a transaction without a marker.

Write the guards as triggers on BetterAuth's tables that are indifferent to the calling role. Where a check must name a role, it names the role set {poly_app, poly_auth}, and stage 2 flips that set under test. The existing example is `app.stamp_signup_user()` (`0007:139`, `current_user <> 'poly_app'`); `gate_owner_changes` names poly_govern and poly_purge, which stay (seceng #20). Stage 2 moves BetterAuth's writes from poly_app transactions to poly_auth ones; built that way, only the test fixtures change role (priced at +2–3 loop-days in stage 2). Do not grant poly_app anything new on BetterAuth's tables. Stage 2 revokes all of them.
