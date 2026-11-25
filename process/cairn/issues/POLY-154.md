---
id: POLY-154
title: Trust this device
status: backlog
milestone: POLY-1.0
parent: null
blocked_by: []
assignee: backend-lead
labels: [security, auth]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-24
---

The Principal chose to offer "trust this device" at the second sign-in step (2026-11-19; `process/DECISIONS.md`), unticked by default. BetterAuth 1.7.18's own version renews on every use, survives a password change and has no list, so it is not used as it stands. Until this issue ships, the sign-in service keeps refusing `trustDevice` (POLY-150 ruling R7). Design sources: POLY-150's ruling, Addendum 2 (`process/cairn/reviews/POLY-150/ruling.md` at faa43102), and seceng's assessment in `process/cairn/reviews/POLY-150/ruling-review.md`. Needs its own ruling and seceng review before any test is written.

## Acceptance criteria

- [ ] A ruling, reviewed by seceng, settles the two choices the Principal has not made: who may use it (every role, or not owners and managers of shared entities) and the lifetime (30 or 14 days). Both are brought to the Principal with costs.
- [ ] The tick-box is unticked by default and offered on the code step only, never after a backup code.
- [ ] Trust has a fixed lifetime from the tick and does not renew; it is kept in our own table, so deleting the row ends it while the cookie is still in the browser.
- [ ] Trust is never honoured on a magic-link or Google/GitHub sign-in: the password is always required (seceng's finding).
- [ ] Trust ends, on every device, on a password change or reset, removing a method, turning off the authenticator app, an email change, `reset-mfa`, and Forget in Settings. The ruling decides "sign out everywhere".
- [ ] Settings lists trusted devices (browser, address, when trusted, last used, expires) with Forget and Forget all.
- [ ] Every sign-in that skipped the second step adds a marked line to the sign-in record; granting and ending trust add lines too.
- [ ] SECURITY carries the new open risk (a copied browser profile with a saved password signs in without the second step until the password changes), with the Principal as approver, and updates R-26, C-88 and C-89.
- [ ] Each control is shown red before the build.

## Comments

### @team-lead — 2026-11-20

seceng-150's assessment of "Trust this device" from the POLY-150 loop is at `process/cairn/reviews/POLY-154/seceng-assessment.md`: how the cookie works in better-auth 1.7.18, who can use it and what they reach, and eight conditions with guessed costs. Five are "must" (C1 to C5, about $26). Still open with the Principal: who may use it (C5) and the lifetime (C6).
