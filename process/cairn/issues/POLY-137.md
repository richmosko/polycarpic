---
id: POLY-137
title: Auth follow-ups
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: []
assignee: backend-lead
paths: [process/cairn/issues/POLY-137.md, process/cairn/reviews/POLY-137/**, apps/auth/**, apps/web/**, apps/worker/**, apps/migrate/**, packages/**, docs/DESIGN/**, infra/postgres/**, infra/compose/**, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, tests/**, layers.json, eslint.config.js, scripts/layers/**, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .gitignore, .github/workflows/**, infra/ci/**]
labels: [auth, security]
priority: null
pr: null
created: 2026-11-11
updated: 2026-11-21
---

Umbrella for the non-blocking findings from the POLY-86 loop (ruling, verdict and seceng reviews under `process/cairn/reviews/POLY-86/`). One loop for the batch; add later auth nits here.

## Acceptance criteria (this loop)

Scope decided by the Principal on 2026-11-21 (`process/DECISIONS.md`): this loop takes what gates the first deploy, plus the small fixes. Each row's source is the item or comment below that it names; the architect's ruling amends these rows in place.

- [x] The mailer caps token emails (magic link, password reset, second-step code) at 10 per address per rolling 60 minutes, one shared in-memory counter keyed on the stored address, counted before the send; notices are never counted or refused. A capped magic link or reset answers exactly as an unknown address does; a capped second-step code answers 429 `mail_capped`. A magic link goes only to an address with an account; the reset token travels only in a URL fragment and GET `/reset-password/:token` is blocked (ruling R1.8, R1.9, R2.1; Principal, 2026-11-21; seceng brief B1). **Proof:** tests/db/auth-mail-flows.test.ts (R1.8 cap, R1.9 members only), packages/mail/src/mail.test.ts (RecipientCap).
- [x] The Resend mailer (`@poly/mail`, ruling R1) is used by `sendMagicLink`, `sendSecondStepCode` and password reset; with no mailer configured (development only) each answers as today, and staging or production refuse to start without `RESEND_API_KEY_FILE` and `MAIL_FROM`. Password reset is wired with a 900-second token lifetime and a test for the expiry, revokes every session, never changes its answer with the mailer, and has its two pages (R2; comment 2026-11-13). **Proof:** tests/db/auth-mail-flows.test.ts (R2.6 a-g, 900 s, sessions), packages/auth/src/options-137.test.ts, packages/config/src/mail-137.test.ts (R1.3), apps/web/src/auth-pages-137.test.ts.
- [x] The account's owner is emailed whenever a second-step method is added or removed: the database writes the notice in the same transaction (`app.mail_outbox`) and the worker sends it (R3.2, R3.6, R5.2). The email address cannot be changed by any login role (D1); replaced backup codes and a changed password are notified too (D2, D4) (comment 2026-11-19). **Proof:** tests/db/auth-method-hold.test.ts (R3.2, R3.10.7), auth-notice-triggers.test.ts (D1, D2, D4), worker-mail-jobs.test.ts, apps/worker/src/jobs/jobs.test.ts.
- [x] A method added after the first (R3.3's rule) works only after 24 hours and after its email was accepted by the provider (`app.method_hold`, refused by the database's triggers and definers, R3.1, R3.4); the email says so and carries a cancel link that removes it and signs the user out everywhere (R3.7). Shown red first: refused for 24 hours and accepted after; a cancelled method never works. The deploy-gate check (INFRA §7.1 step 16) gains lines 15–24 and refuses when the hold, the outbox, the timeout or the purges are missing (R3.8, R4.2, R5.3; comment 2026-11-19). **Proof:** tests/db/auth-method-hold.test.ts (R3.10.1-8, cancel), tests/db/gate-check.test.ts lines 15-24 plants, gate-check-role-setting.test.ts.
- [x] `/callback/*`, `/magic-link/verify`, `/reset-password` and `/second-step/cancel-hold` are on C-04's limited list, keyed on the client address and path, which rests on POLY-138's Caddy header. `poly_auth` has `idle_in_transaction_session_timeout = 15s` (R4; SECURITY R-24; comments 2026-11-12 and 2026-11-17). **Proof:** packages/auth/src/options-137.test.ts, tests/db/auth-mail-flows.test.ts (R4.1), auth-notice-triggers.test.ts (R4.2), gate-check-role-setting.test.ts (line 21).
- [x] The S9 dist-enumeration test exists, classifies every writer site by R6.3's rule, and fails if the lockfile holds two versions of `better-auth`, `@better-auth/passkey`, `@better-auth/core`, `@simplewebauthn/server` or `@better-auth/utils` (R6; item 1; comment 2026-11-20 no. 5). **Proof:** packages/auth/src/dist-enumeration.test.ts (sections A and B, refused-by-hook through routePolicyHook), tests/layers/mail-137.test.ts.
- [x] A held sign-in by magic link answers a browser navigation with a 302 to `/sign-in/second-step?with=code`, with its two-factor cookie kept (R7; comment 2026-11-20 no. 1). **Proof:** tests/db/auth-mail-flows.test.ts (R7: both shapes, ordinary sign-in untouched).
- [x] The worker schedules `app.purge_tx_identity()` every 15 minutes, and `app.purge_sign_in_record()` and the new `app.purge_mail_outbox()` daily, as `poly_worker`; a missed run shows in the logs and fails the deploy gate (R5; comment 2026-11-19). **Proof:** apps/worker/src/jobs/jobs.test.ts, tests/db/worker-mail-jobs.test.ts, gate-check.test.ts lines 22-24.
- [x] The routing pool refuses a transaction-control statement passed as a query-config object (R8; item 2). **Proof:** packages/auth/src/routing-pool-config.test.ts.
- [x] `/change-password` refuses unless `revokeOtherSessions` is true (R8; item 3). **Proof:** tests/db/auth-mail-flows.test.ts (R8 change-password).
- [x] Settings → Sessions: revoking with an id that is not a uuid answers 404 (R8; item 4). **Proof:** packages/auth/src/web/sessions.test.ts.
- [x] One test for `/API/AUTH/...` on the raw pathname, in web and in the auth service (R8; item 6). **Proof:** apps/web/src/auth-pages-137.test.ts (signed out and signed in), apps/auth/src/raw-path-137.test.ts.
- [x] The e2e step-up stamp is written inside the revoke spec (R8; item 7). **Proof:** tests/ci/e2e-stamp.test.ts; the Sessions spec passes, also after a 6-minute wait (apps/web/tests/e2e/sign-in-flow.spec.ts, stampStepUp).
- [x] SECURITY R-12 carries no plain-token sentence: met as it stands (measured, R8); seceng rewrites T1's reset sentence at the verdict (comment 2026-11-13). **Proof:** measured at the ruling (grep -c -i plain on R-12 is 0); seceng rewrote T1 at the build review (SECURITY 1.15.0).
- [x] seceng reviews the ruling for the 24-hour delay and the method-change emails before any test is written. **Proof:** process/cairn/reviews/POLY-137/ruling-review.md section 5 (ACCEPT at fab91743).

**Deferred to a second auth loop, filed after this one merges:** the second-step cap after 3 locks and the lock notice; the per-email sign-in limit; refusing a reused sign-in code; the backup-codes-left count; the recent-changes view; emails on a voided code and on an operator reset; `/change-email`; avatar upload. Their rows stay below, unticked.

## Items

- [x] **S9 dist-enumeration test (gates any upgrade).** Grep the pinned better-auth dist for `createUser`, `createOAuthUser`, `createSession` and `setSessionCookie` and classify each path against `route-policy.ts`. No `better-auth` or `@better-auth/passkey` pin change merges before this test exists (seceng build review @ 04bd75b; verdict follow-up 13). — done in this loop; see the matching row above.
- [x] The routing pool refuses a transaction-control statement passed as a query-config object, as it already does for a string (seceng build review, follow-up 1). — done in this loop; see the matching row above.
- [x] `/change-password` forces `revokeOtherSessions` (SECURITY C-02); today the caller decides. — done in this loop; see the matching row above.
- [x] Settings → Sessions: revoking with an id that is not a uuid answers 404, not 500. — done in this loop; see the matching row above.
- [ ] A per-email sign-in limit, which C-04 calls for and BetterAuth lacks (seceng S19). — deferred to the second auth loop (Principal, 2026-11-21; filed after this merges).
- [x] One test for `/API/AUTH/...` once routes exist under `/api`: the handle's tree test runs on the raw pathname (verdict follow-up 9). — done in this loop; see the matching row above.
- [x] qa: write the e2e step-up stamp inside the revoke spec, not in `serve.ts` before `vite build`; the spec fails if a run takes over 5 minutes to reach it (verdict follow-up 12). — done in this loop; see the matching row above.
- [x] The Resend mailer for `sendMagicLink`; apps/web passes one that answers 503 until it exists (ruling follow-up 3). — done in this loop; see the matching row above.
- [ ] Avatar upload to our own origin, with the same-origin rule on `/update-user` image (ruling follow-up 2; seceng). — deferred to the second auth loop (Principal, 2026-11-21; filed after this merges).

- [ ] **Second-step cap and lock notice (`process/DECISIONS.md` 2026-11-17).** Needs the mailer above. Each sub-item is shown red first: — deferred to the second auth loop (Principal, 2026-11-21; filed after this merges).
  - On a fake clock, the 3rd lock of one factor within a rolling 24 hours shuts the code step. While it is shut, a correct TOTP or backup code is refused, creates no session, and counts toward nothing.
  - It opens only when the user confirms a code emailed to their account's address (the `app.email_challenge` machinery, its own purpose, single use, 15-minute expiry, 5 wrong entries end it).
  - The emailed code never shortens or clears the growing lock: confirming it during a lock leaves `locked_until` and the doubling unchanged, and the right TOTP is refused until the lock lapses.
  - A passkey sign-in passes the second step while it is shut and while it is locked. `reset-mfa` still clears a shut user.
  - At the first lock of a run, the user is emailed once. The mail holds no code and no link that changes anything, and says that someone with their first step tried codes. Later locks in the same run send no further notice; the shut mail is the next.
  - The shut state lives in the database. A write by poly_auth that clears it is refused, except the confirmation definer, by its exact call.

## Comments

### @team-lead — 2026-11-12

From the POLY-87 loop (seceng, SECURITY R-24, approved by the Principal 2026-11-13 until the first production deploy): `/callback/:id` holds a `poly_app` pool connection across BetterAuth's outbound call to the IdP, and neither it nor `/magic-link/verify` is rate-limited. Add both routes to C-04's limited list and set `idle_in_transaction_session_timeout` for `poly_app`. This must land before the first deploy.

### @team-lead — 2026-11-12

Added from POLY-145 (seceng-145, threat-model.md S1 and S5 at 53f129b; lead checked against the tree at eb7d195). Verification tokens are stored in the clear. `packages/auth/src/options.ts` sets neither `verification.storeIdentifier` nor the magic-link plugin's `storeToken`; better-auth 1.7.18's magic-link default is `"plain"` (`dist/plugins/magic-link/index.mjs:42`). `public.verification` has no row-level security and `poly_app` holds SELECT on it (`0001_app_foundation.sql:27`). So SQL run as `poly_app` can request a reset or magic link for any user, read the token, and take the account. SECURITY R-12's "a DB read alone cannot forge one" covers the session cookie only.

To do in this issue, whatever POLY-145 decides: set both options to `"hashed"`, add a test that a stored verification value never equals the token sent, and correct R-12's wording. This is a must-have before the first deploy.

### @team-lead — 2026-11-13

The hashed reset and magic-link token item (my comment of 2026-11-13) has moved to POLY-146 (Identity hardening), by the Principal's POLY-145 decision that the hardening fixes land first. What stays here: once POLY-146 hashes the tokens, remove the plain-token sentence from SECURITY R-12 if POLY-146 has not already done so.

### @team-lead — 2026-11-13

From POLY-146 (seceng-146's read of better-auth 1.7.18; architect-146's gate-1 ruling R4): password reset is not wired today (`sendResetPassword` is unset, so the route answers `RESET_PASSWORD_DISABLED`). When this issue wires the mailer and turns reset on, set the reset token's lifetime to 900 seconds in the same change: the library default is one hour and SECURITY says 15 minutes. Add a test for the expiry.

### @team-lead — 2026-11-16

From the POLY-89 loop (merged 2026-11-17, PR #131). `sendSecondStepCode` throws "mailer not configured" until the Resend mailer lands, so second-step enrolment in production waits on this issue. Also email the user when an emailed code is voided at five wrong tries, and when an operator resets their second step (seceng C-f and build review N6, `process/cairn/reviews/POLY-89/build-review.md`).

### @team-lead — 2026-11-17

From POLY-152's ruling review (seceng F3, 2026-11-17): SECURITY R-24 now covers every OAuth callback, not only a first sign-in, because the sign-in service holds one transaction across the provider exchange on every callback (ruling R9). The rate limit and the idle-in-transaction timeout here must cover every callback; say so in the criterion when this issue is started.

### @team-lead — 2026-11-19

From the POLY-149 loop (ruling R3 and its "Decisions for the lead" 4). **Schedule the two purge functions in the worker:** `app.purge_sign_in_record()` (400-day retention and deleted accounts) and `app.purge_tx_identity()`. Neither has a caller today. Until a job calls the first, the 400-day retention is not enforced.

### @team-lead — 2026-11-19

From the POLY-150 loop (Principal, 2026-11-19; `process/DECISIONS.md`; seceng `process/cairn/reviews/POLY-150/ruling-review.md` §13.2). **Gates the first deploy with real household data.** Three additions once the mailer exists:
- Email the account's owner at once whenever a second-step method is added or removed.
- A method added through Confirm it's you (as opposed to first set-up) works only after 24 hours; the email says so and lets the owner cancel it. Shown red first: the method is refused for 24 hours and accepted after; a cancelled method never works.
- seceng's ruling review of both before any test is written. The deploy-gate check (INFRA §7.1 step 16) refuses when either is missing.
Also from that loop: a held sign-in through a magic link answers JSON to a browser navigation and must become a 302 to `/sign-in/second-step?with=code` (ruling "Open 1"); `/change-email` stays disabled until it notifies the old address and writes a record row (Addendum 3, Open 6).

### @team-lead — 2026-11-20

From POLY-150 (merged 2026-11-20, PR #141). These join the 24-hour delay and method-change emails already recorded here as a condition of the first real deploy.

1. **Held sign-in by magic link (ruling "Open 1").** It answers JSON to a browser navigation; turn it into a 302 to `/sign-in/second-step?with=code`. The Google and GitHub half is on POLY-88.
2. **Backup codes left (ruling "Open 3").** Settings shows no count. It needs a count-only route in the anchor plugin.
3. **Recent changes to your sign-in methods.** An owner-readable view built from the `second_step.method_added` and `second_step.method_removed` audit rows. A planted method is recorded with the victim as actor and `marker_kind = 'auth'`.
4. **Reused sign-in code (Addendum 3, Open 5).** BetterAuth's sign-in verify still accepts a reused code within its window. Refusing it needs a before-hook on `/two-factor/verify-totp`. Confirm it's you already refuses a reused code.
5. **S9 pin test (seceng build-review §6).** `packages/auth` now pins `@simplewebauthn/server` 13.3.3 and `@better-auth/utils` 0.5.1 directly, beside better-auth and `@better-auth/passkey` at 1.7.18. A bump must move all four together, or a second copy installs. S9 fails if the lockfile holds two versions of either.

### @team-lead — 2026-11-21

Feature started. Branch: `feature/poly-137-auth-follow-ups`. Runs in parallel with POLY-138.
