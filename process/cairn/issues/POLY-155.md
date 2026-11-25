---
id: POLY-155
title: Auth follow-ups 2
status: backlog
milestone: POLY-M6
parent: null
blocked_by: []
assignee: backend-lead
labels: [auth, security]
priority: null
pr: null
created: 2026-11-21
updated: 2026-11-25
---

The second auth loop: what POLY-137 deferred by the Principal's scope decision of 2026-11-21 (`process/DECISIONS.md`), plus the follow-ups that loop's ruling, reviews and verdict recorded (`process/cairn/reviews/POLY-137/`). Not a condition of the first deploy. Add later auth nits here.

## Acceptance criteria

- [ ] **Recent changes to your sign-in methods**, shown in Settings from the `second_step.method_added` and `second_step.method_removed` audit rows. The architect recommends this first: it is the only warning outside the mailbox (SECURITY R-28).
- [ ] **Second-step cap and lock notice** (`process/DECISIONS.md` 2026-11-17): the code step shuts at the 3rd lock in 24 hours and opens on an emailed code; one notice at the first lock. The sub-rows are on POLY-137 and are shown red first.
- [ ] A per-email sign-in limit (SECURITY C-04; seceng S19).
- [ ] BetterAuth's sign-in verify refuses a reused code within its window (a before-hook on `/two-factor/verify-totp`).
- [ ] Settings shows how many backup codes are left (a count-only route).
- [ ] The owner is emailed when an emailed code is voided at five wrong tries and when an operator resets their second step.
- [ ] `/change-email` is turned on with a notice to the old address and a record row; it replaces the "no login role changes email" trigger with a definer.
- [ ] Avatar upload to our own origin, with the same-origin rule on `/update-user` image.
- [ ] A notice for a reset that creates a user's first password (POLY-137 ruling follow-up 5).
- [ ] A failed account lookup behind a magic-link request writes a log line (seceng N1).
- [ ] The older pages say "tries", not "attempts" (wording review).
- [ ] An e2e browser test walks a real reset and a real cancel with a mailed token; a pgTAP case covers the user-delete cascade; `claim_mail` is tested under two workers.
- [ ] **For the Principal:** whether newly generated backup codes are held for 24 hours while the old ones keep working (about $10, the architect's guess; a change to the library's verify path).

## Comments

### @team-lead — 2026-11-22

From POLY-98 (Principal, 2026-11-22; `process/DECISIONS.md`; ruling §D1, M3): enable `polycarpic-ops cli user reset-mfa <email>` as a pass-through verb, with seceng's review of the identity-check procedure in INFRA §7.5. No grant changes: `poly_operator` already holds EXECUTE on `app.reset_second_step`. The wrapper refuses the verb by name until then. Due before prod is opened to a second person; it pairs with this issue's "owner is emailed when an operator resets their second step".

### @team-lead — 2026-11-24

Placed in POLY-M6 (Production readiness) at the M1 regroup, 2026-11-25. The architect's proposed cut, for seceng to confirm at this issue's ruling (`architect-m1r`, review of 2026-11-25): **gate part, before prod is opened to a second person:** the `reset-mfa` operator verb with the email to the owner, the per-email sign-in limit (C-04), the reused-code refusal, the second-step cap and lock notice, the recent-changes view, and POLY-153's F1 (a sign-in from a browser that already carries a live session ends that earlier session; the comment of 2026-11-19 on POLY-139). **Not a prod gate, to POLY-1.0 as their own issue once the cut is confirmed:** the backup-code count, `/change-email`, avatar upload, the first-password notice, the failed-lookup log line, the wording pass, the e2e reset walk, and the Principal's open question on holding new backup codes for 24 hours.

### @team-lead — 2026-11-25

Flaky test seen on PR #158 (run 45664122857, first attempt; green on rerun): `tests/db/auth-service-main.test.ts`, "the database lost under the auth service (POLY-160 R5)", failed with `listen EADDRINUSE 0.0.0.0:41208`. The file takes `AUTH_PUBLIC_PORT` from `41000 + (pid % 500) * 4` and counts up, which sits inside Linux's ephemeral range (32768 to 60999), so any other process's outgoing connection or `listen(0)` can already hold the port. Fix: take a free port from the OS (listen on 0 and read it back) or retry on EADDRINUSE; check the worker and web outage tests for the same scheme. `db` is behind the required `app` check, so this can block any PR at random; do it as the first commit of the next loop that touches `tests/db` (POLY-90 or POLY-91) rather than waiting for this issue's turn.
