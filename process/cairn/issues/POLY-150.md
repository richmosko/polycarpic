---
id: POLY-150
title: Second-step screens
status: done
milestone: POLY-M1
parent: null
blocked_by: []
assignee: ux-designer
paths: [process/cairn/issues/POLY-150.md, process/cairn/reviews/POLY-150/**, docs/DESIGN/**, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, apps/web/**, apps/auth/**, packages/**, tests/**, infra/**, layers.json, eslint.config.js, scripts/layers/**, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .gitignore, .gitleaksignore]
labels: [design, security]
priority: null
pr: https://github.com/richmosko/polycarpic/pull/141
created: 2026-11-16
updated: 2026-11-20
---

POLY-89 shipped the second sign-in step as database guards and auth routes, with a placeholder at `/settings/second-step`. No screen reaches enrolment, so nobody can enrol in a browser, and no one can create a non-Person entity or send an invitation until these exist (ruling R7 in `process/cairn/reviews/POLY-89/ruling.md`; it fails closed). POLY-139 covers only Sign-in and Sessions. ux-designer designs, frontend-lead builds. Lands before POLY-110 and POLY-144.

## Acceptance criteria

- [x] DESIGN carries the set-up flow (`#flow-second-step`): password, emailed code, then the factor (authenticator app or passkey), with the backup codes shown once. (DESIGN 0.20.5: `styled-screens/second-step-dialog.html` states `#password`, `#offered`, `#no-mail`, `#email`, `#email-error`, `#app`, `#app-scan`, `#app-error`, `#passkey`, `#passkey-wait`, `#passkey-error`, `#restart`, `#backup-codes`, `#done`, `#done-passkey`; `second-step-required.html` `#page`, `#selector`, `#dialog`; `entities.html#second-step-first`; flow 5.11 and spec § Second step. Shape changed by the Principal: one set-up dialog over the page in use, not a bare page; held users land on Settings; `process/DECISIONS.md` 2026-11-19.)
- [x] DESIGN carries `/sign-in/second-step` for an enrolled user on a new device, and the Confirm it's you prompt. (DESIGN 0.20.5: `styled-screens/sign-in-second-step.html` states `#code`, `#wrong`, `#backup`, `#backup-wrong`, `#passkey`, `#locked` with its three bands and no-band text, `#expired`; Confirm it's you in `settings.html#step-up-states`: password and code, wrong code with both fields cleared, paused with no band, backup code, passkey only, passkey not accepted; spec § Second step. Every new sign-in asks, not only a new device; `process/DECISIONS.md` 2026-11-19.)
- [x] The screens are built in web and replace the `/settings/second-step` placeholder. (Proved by `second-step.spec.ts` specs 1 and 2, `second-step-misc.spec.ts`, `web-boundary.test.ts`; `process/cairn/reviews/POLY-150/gate.md`.)
- [x] A browser test shows an enrolled user held at `/sign-in` until the second step passes (ruling R7, criteria C4/C5 of POLY-89; proved only in `tests/db` today). (`second-step-held.spec.ts` specs 3, 4, 5; `second-step-locked.spec.ts`.)
- [x] A browser test enrols a user end to end against the real handler. (`second-step.spec.ts` spec 1 by app and spec 2 by passkey.)

## Comments

### @team-lead — 2026-11-16

Filed from the POLY-89 loop (merged 2026-11-17, PR #131). The lead's check of the sign-in gate was over HTTP only, because the app needs `x-forwarded-for` to resolve a client address and a plain browser has none; the browser tests here should run behind a proxy that sets it.

### @team-lead — 2026-11-19

Feature started. Branch: `feature/poly-150-second-step-screens`. Stages: POLY-150a (design), b (ruling), c (security review), d (tests), e (build), f (verdict). The Principal reviews the screens before the build starts.

### @team-lead — 2026-11-19

PR opened: https://github.com/richmosko/polycarpic/pull/141. Gate code sha 3607aa34; docs and tracker only since. Carries POLY-151.

### @team-lead — 2026-11-20

Validate passed; merging via PR #141. Closing.
