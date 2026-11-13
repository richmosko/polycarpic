---
id: POLY-139
title: Sign-in and Sessions screens
status: backlog
milestone: POLY-M1
parent: null
blocked_by: []
assignee: ux-designer
labels: [design]
priority: null
pr: null
created: 2026-11-11
updated: 2026-11-12
---

POLY-86 shipped placeholder pages for `/sign-in` and Settings → Sessions because DESIGN has no screen for either (ruling follow-up 1; verdict follow-up 14).

## Acceptance criteria

- [ ] DESIGN carries a Sign-in screen (bare page, no app shell) including the failed-attempt and rate-limited states.
- [ ] DESIGN carries a Settings → Sessions screen: readable timestamps, a device label per session, the current-device marker, and revoke with its step-up prompt. The breadcrumb names the page; it reads "polycarpic" today.
- [ ] The account menu's Profile, Notifications, Preferences and Shortcuts entries are either designed with a destination or removed; they are disabled placeholders today.

## Comments

### @team-lead — 2026-11-12

From the POLY-87 loop: `/sign-up` exists as a minimal page (reads `?invitation=`, strips it from the address bar, offers Google and GitHub) and `/` redirects to `/dashboard?entity=<id>`. When one sign-up seats several viewer invitations (the token-less paths match every live invitation for the address), the landing entity is the newest membership with an arbitrary but stable tie-break on `entity_id`; the entity selector is where the user gets the choice.
