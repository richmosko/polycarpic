---
id: POLY-150a
title: Second-step screens design
status: done
milestone: POLY-M1
parent: POLY-150
blocked_by: []
assignee: ux-designer
paths: [process/cairn/issues/POLY-150.md, process/cairn/reviews/POLY-150/**, process/cairn/issues/POLY-150a.md, docs/DESIGN/**]
stage: plan
estimate.cost_usd: "8.00"
estimate.gate_cycles: 3
actual.cost_usd: "21.0479"
actual.tokens: 51071751
actual.gate_cycles: 10
actual.wall_clock: 279
ratio: "2.63"
labels: [design, security, bloat]
priority: null
pr: null
created: 2026-11-19
updated: 2026-11-19
---

ux-designer completes DESIGN for the second step from what is already there (flow 5.11 and the spec's Second step section).

## Acceptance criteria

- [x] DESIGN carries the set-up flow (`#flow-second-step`): password, emailed code, then the factor (authenticator app or passkey), with the backup codes shown once, as styled screens. (DESIGN 0.20.5: `second-step-dialog.html`, all states; `second-step-required.html`; `entities.html#second-step-first`. As one dialog, not a bare page, per the Principal; `process/DECISIONS.md` 2026-11-19.)
- [x] DESIGN carries `/sign-in/second-step` for an enrolled user on a new device, with its wrong-code, locked and backup-code states, and the Confirm it's you prompt. (DESIGN 0.20.5: `sign-in-second-step.html` `#code`, `#wrong`, `#backup`, `#backup-wrong`, `#passkey`, `#locked`, `#expired`; `settings.html#step-up-states`.)
- [x] The Principal has reviewed the screens before the build starts. (Review of DESIGN 0.18.3 and the answers that followed: one set-up dialog, the forced case held on Settings, sign-up asks the emailed code, no backup codes for a passkey, three lock bands, Confirm it's you built here, a backup code accepted there; `process/DECISIONS.md` 2026-11-19.)
