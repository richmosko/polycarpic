---
id: POLY-165
title: Deploy follow-ups: before prod
status: backlog
milestone: POLY-M6
parent: null
blocked_by: [POLY-160]
assignee: devops-engineer
labels: [ops, deploy, security]
priority: null
pr: null
created: 2026-11-24
updated: 2026-11-24
---

The part of POLY-160 that gates prod and real data, not staging. Split out by the Principal's decision of 2026-11-25 (`process/DECISIONS.md`), which amends the decision of 2026-11-24 that all of POLY-160 precedes the first staging deploy. The items are described where they were found: POLY-160's body and comments, `process/cairn/reviews/POLY-100/build-review.md`, `process/cairn/reviews/POLY-162/` and `process/cairn/reviews/POLY-161/`. POLY-164 (first prod deploy) is blocked by this issue. seceng reviews the ruling and the build. Add later deploy items that gate prod here.

## Acceptance criteria

- [ ] **Before the first prod deploy and any `v1.*` tag:** every service's `healthcheck` is pinned and environment keys outside a per-service list are refused (U1; `NODE_OPTIONS` in `environment` passes the guard today, for every app service).
- [ ] **Before the first prod deploy:** a wrong `current` on a first deploy (H3): the release runs with its timers, prod's backup timers included, not enabled, and a rerun is refused `already-deployed`.
- [ ] **Before real household data:** Docker's own apt repository is covered by automatic security updates, or fixed if POLY-104's measurement on the box shows it is not.
- [ ] **Before real household data:** a Renovate rule for the pinned Compose version file, so a Compose security fix arrives as a PR that the end-to-end deploy test proves; seceng's assessment of the alternative (pin the minor version only).
- [ ] The lint reads the pinned command and health values from `compose-allow.json` (U2), with committed guard cases for prod's `backup` and `uploader` and for caddy, and the lint comparing web's whole healthcheck object.
- [ ] A test runs the deploy test's undo and looks at what is left (U3).
- [ ] The weekly re-scan of the published image reads the bundle's package list; bits-ui becomes a dev dependency so `svelte` leaves the runtime install.
- [ ] The lesser findings: H7, H10, one-off containers "gone" by listing, the deploy test's rollback lower bound, the CI sweep's absent-input case.
- [ ] `self-update` installs the ops bundle from the attested release, or gets its own issue with the reason; the provision CI time is re-measured.
