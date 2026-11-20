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
updated: 2026-11-20
---

POLY-86 shipped placeholder pages for `/sign-in` and Settings → Sessions because DESIGN has no screen for either (ruling follow-up 1; verdict follow-up 14).

## Acceptance criteria

- [ ] DESIGN carries a Sign-in screen (bare page, no app shell) including the failed-attempt and rate-limited states.
- [ ] DESIGN carries a Settings → Sessions screen: readable timestamps, a device label per session, the current-device marker, and revoke with its step-up prompt. The breadcrumb names the page; it reads "polycarpic" today.
- [ ] The account menu's Profile, Notifications, Preferences and Shortcuts entries are either designed with a destination or removed; they are disabled placeholders today.

## Comments

### @team-lead — 2026-11-12

From the POLY-87 loop: `/sign-up` exists as a minimal page (reads `?invitation=`, strips it from the address bar, offers Google and GitHub) and `/` redirects to `/dashboard?entity=<id>`. When one sign-up seats several viewer invitations (the token-less paths match every live invitation for the address), the landing entity is the newest membership with an arbitrary but stable tie-break on `entity_id`; the entity selector is where the user gets the choice.

### @team-lead — 2026-11-19

From the POLY-153 loop (seceng build-review §3 and §6, `process/cairn/reviews/POLY-153/build-review.md`). **F1:** a sign-in from a browser that already carries a live session ends that earlier session in the same transaction. POLY-153 clears the handle cookie when a sign-in is held at the second step; this is the stronger option seceng filed for later (about a quarter-day, a guess).

### @team-lead — 2026-11-20

From POLY-150 (designer's build review).

1. **Shell on Settings (items 7 and 9).** The breadcrumb reads "Home / polycarpic" and the entity selector reads "No entity" for a signed-in user, who always has a Person.
2. **Split layout.** `/sign-in` and `/sign-in/second-step` are plain columns; DESIGN draws the split layout with the forest art. Build both with Sign-in's look.
3. **Accepted look gaps in the second-step screens (items 11 to 17).** Method cards without icons or ring, the On pill, icons on Copy all, Download and the Entities message, and the viewer's entity name.
