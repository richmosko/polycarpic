---
id: POLY-89
title: Second sign-in step
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-86, POLY-62, POLY-87, POLY-147]
assignee: backend-lead
paths: [process/cairn/issues/POLY-89.md, process/cairn/reviews/POLY-89/**, packages/auth/**, packages/tenancy/**, packages/db/**, packages/config/**, apps/web/**, apps/worker/**, tests/**, infra/ci/**, layers.json, eslint.config.js, scripts/layers/**, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .gitignore, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, docs/DESIGN/**]
labels: [auth, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-16
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
- [ ] `app.promote_held_roles` and every other POLY-89 definer take the user from `app.current_user_id()` (the POLY-147 marker), never from a transaction-local setting; ARCH §3.1c is corrected in the same PR.
- [ ] No POLY-89 guard treats the marker's `session_id` as proof that a session exists or is recent: until POLY-149 it is the value web passed (SECURITY R-2, C-86; POLY-147 seceng S3). A test forges it and the guard still refuses.
- [ ] **`user.two_factor_enabled` is guarded (POLY-148 spike §7.3, requirement).** It turns on only in the transaction that verifies the factor, and off only in the transaction that deletes the factor after a step-up. The role that runs BetterAuth must hold UPDATE on the column, and without the guard one injected statement switches the second factor off for any user, silently.
- [ ] **The first-verify rotation can insert its session.** `0005_auth_second_step_grants.sql` line 9 leaves `recent_auth_at` out of poly_app's INSERT on `session`, and BetterAuth copies that column when it replaces a session, so the rotation is refused once enrolment opens (confirmed from the shipped grants, POLY-148 spike §7). Strip the column in a `session.create.before` hook or grant it; seceng prefers stripping (§7.4).

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

### @team-lead — 2026-11-15

Follow-up from POLY-147 (merged via PR #127) added to the list above; source: `process/cairn/reviews/POLY-147/` (ruling, security-review, verdict) and devops-147's findings.

### @team-lead — 2026-11-15

Follow-ups from POLY-148 (merged via PR #129) added above; source: `process/cairn/reviews/POLY-148/spike.md` (§1, §2, §6 and seceng's reading in §7).

### @team-lead — 2026-11-15

Feature started. Branch: `feature/poly-89-second-sign-in-step`. `paths` front-loaded with the issue file, the review folder, tests, the lint and layer config, the lockfile and the four docs the ruling may bump.

### @architect — 2026-11-16

Ruling for POLY-89 (89a): `process/cairn/reviews/POLY-89/ruling.md`. seceng-89 reviews it before any test is written. Each of the 15 criteria (C1–C15) maps to a section there.
- R1, rules every guard follows: the user comes from `app.current_user_id()`. The marker's session id only narrows a check and never proves anything. The proof is always a row only a definer writes: the grant, its `consumed_xid`, or `recent_auth_at`. The forge triple is the C13 test. Guards name no login role, and no new poly_app grant is made on BetterAuth's tables.
- `user.two_factor_enabled` (C14) is written only by `app.set_two_factor_enabled()`, a poly_govern definer called from `userUpdateBefore` on the request's transaction. A trigger refuses any other write, and a deferred check holds the flag equal to "a verified two_factor row exists". So no role needs UPDATE on the column, stage 2's included.
- `recent_auth_at` (C15): stripped in `session.create.before`. The stamp trigger sets it once, only on the TOTP session swap whose grant this transaction consumed; every other INSERT gets NULL. Passkey registration refuses `createSession`, `/two-factor/enable` refuses `method: otp`, and the factor rows carry their own guards: owner match, step-up, the last method and the unmarked sign-in columns (R3).
- `second_step_at` (C7): the only writer is `app.sync_second_step()`.
- Exemption (C10): `app.own_person_exempt(entity)` is the one predicate; `app.second_step_required()` serves both the sign-in gate and `SecondStep.required`.
- Order (C9): the TOTP flip, the session stamp, the grant's FK set null, verified, the passkey INSERT. Migrations 0012 (tables) and 0013 (guards).
- reset-mfa (C6): lives here, as `apps/worker/src/cli/user-reset-mfa.ts` beside `user invite`, over the definer `app.reset_second_step(email)` with EXECUTE to poly_operator only. The issue's `apps/cli/**` path becomes `apps/worker/**`.
- Screens: POLY-139 does not cover the set-up, second-step or Confirm it's you screens. This loop ships only a placeholder at `/settings/second-step`; R7 lists what an e2e can show.
- Open: Confirm it's you has no `recent_auth_at` writer. It needs its own issue.

### @seceng — 2026-11-16

**Ruling review (seceng) of `41a52277`: changes requested, four blocking.** The full mechanism and fix for each finding are in `process/cairn/reviews/POLY-89/ruling-review.md`. The database guards on factor rows, the on/off flag and the step-up stamp are sound. No new poly_app grant is added.

Blocking:
- **B1. Sign-in breaks.** At sign-in there is no marker yet, but BetterAuth still writes the factor rows: the TOTP failure count and lock, backup codes, and the passkey counter. R3 #5 refuses every write without a marker. Nobody gains access; enrolled users simply cannot sign in. Fix: with no marker, allow UPDATE of only those columns; the passkey counter may not go down.
- **B2. Passkey `createSession: true`.** A first passkey registration creates a second session (measured), and #3 then marks it as recently confirmed. A stolen cookie gets a session that survives revoking the stolen one, with 5 minutes of step-up (change email, revoke other sessions). Fix: the enrolment class refuses `createSession`. #3 stamps only the TOTP replacement session, once per grant.
- **B3. Backup-code copy (needs a decision).** All backup codes are encrypted with one shared secret, so one statement can copy the attacker's own codes into a victim's row. Add the magic link R-2 already lets poly_app plant, and the attacker signs in as any TOTP-enrolled user with no password and no factor, until POLY-149. Option (a), my recommendation: block both backup-code routes, so a lost phone is recovered with a passkey or `reset-mfa`. Option (b): accept it in R-2 with the Principal's approval.
- **B4. A race defeats the exemption.** Deleting the last factor and inviting someone to the own Person (or creating an entity) can run at once, and each passes on the other's uncommitted state. The result is a shared Person, or an owned Trust, with no second factor. Only the user's own step-up actions reach this. Fix: #6, #10, #11, `set_two_factor_enabled` and `sync_second_step` lock the user row first; add a two-connection test.

Not blocking:
- **N1. Sliding refresh.** Not a gap. No `session` UPDATE trigger is ruled, and poly_app cannot write `recent_auth_at`. Add one regression test.
- **N2. `method: otp`.** Already refused by #5 and #9 even if configured. Add a route refusal and a config test.
- **N3. R3 #5's passkey stamp is acceptable.** The proof is the consumed grant, not the session id. Stamp `id = grant.session_id`, exactly one row. Residual: with a stolen poly_app password, an attacker can name the victim's own freshly stamped session within its 5 minutes. That is R-2's reach, recorded there, closing at POLY-149.
- **N4.** Catalog test: only `sync_second_step` writes `second_step_at`; only the two named definers write the flag; only reset deletes factor rows.
- **N5.** The password half of the anchor is an app check. For a user with no password account, a magic-link session passes it, so first enrolment needs only the mailbox. State this in ARCH and SECURITY.
- **N6.** Add a 24-hour cap of 10 code requests per user, and a notice when a code is voided after 5 wrong tries.
- **N7. R6 grant to poly_operator: approved**, with conditions: lower-cased email match; refuse when no user is found or the user is tombstoned; a notification to the user (email once POLY-137 lands).
- **N8.** poly_app's unguarded UPDATE on `user.email` redirects the anchor. That is R-2's reach; SECURITY names it.

For the lead: after this loop nobody can enrol, because there are no screens and nothing besides first enrolment writes `recent_auth_at`. So R-25's second-factor mitigation is built in the database but not reachable by users. Two issues are needed: the second-step screens and the "Confirm it's you" re-authentication route.

### @seceng — 2026-11-16

**Ruling review (seceng) of `7e73fd7e`: accepted on one decision (D1), with conditions.** This replaces my review of `41a52277`. Details: `process/cairn/reviews/POLY-89/ruling-review.md`. B1, B2 and B4 are fixed. I checked all 19 [Sn] answers against my list; each holds, with the conditions below.

**Blocking:**
- **D1. Backup codes. The ruling accepts this risk itself, but only the Principal can.**
  - How: every user's backup codes are encrypted with the same key. #5 must let them change without a marker, because a backup-code sign-in rewrites them.
  - Reach: one injected statement copies an attacker's own codes into any user's row. Add the magic link R-2 already lets poly_app plant, and the attacker signs in as any authenticator-app user with no password and no factor, unseen, until POLY-149.
  - (a) Recommended: turn backup codes off (Blocked class; refuse unmarked rewrites). Under an hour of work (a guess). A lost phone is recovered with a passkey or `reset-mfa`.
  - (b) Keep them, with that exact text in R-2, approved by the Principal.
  - qa can write every test except this carve-out's backup-code half.

**Conditions (not blocking; each is checked at the build review):**
- **C-a.** Add tests that real sign-ins still work as poly_app: authenticator app, wrong-code lockout, passkey, and backup code if kept.
  - #9 and #8 must compute for the changed row's own user, not the marker's. Otherwise sign-in fails at commit, and `reset-mfa` leaves `second_step_at` set, breaking C6.
  - The unmarked carve-out applies to verified rows only. The passkey counter may not go down.
- **C-b.** The locks only work if each check reads after taking its lock, in a later statement and in a VOLATILE function. Add a test that runs two connections at once.
- **C-c. The passkey stamp (#6) is accepted.**
  - The proof is the consumed grant, which is tied to the session that asked for the code. The stamp must hit exactly one row.
  - Leftover risk, for R-2: with a stolen poly_app password, someone can name a victim's freshly stamped session within its 5 minutes. Record it as a fourth forge case that passes by design.
- **C-d. The passkey delete/rename claim is wrong.** Both routes run BetterAuth's `requireResourceOwnership` check before the handler. Keep #6 and #7 as the floor against SQL, and fix the sentence.
- **C-e.** For a user with no password, a magic-link session counts as the "fresh IdP round trip", so first enrolment needs only the mailbox. ARCH and SECURITY must say so.
- **C-f. The poly_operator grant (R6) is approved, with conditions.**
  - Reach of a stolen poly_operator: it can remove anyone's factors and end their sessions. That is a lockout and a downgrade, not a takeover, without the password and the mailbox.
  - Conditions: match the email lower-cased; refuse an unknown or deleted user with a non-zero exit; notify the user.

**For the lead:** after this loop nobody can enrol. So R-25's second-factor protection is built in the database but cannot be reached by users. Two issues are needed: the second-step screens and the "Confirm it's you" route.
