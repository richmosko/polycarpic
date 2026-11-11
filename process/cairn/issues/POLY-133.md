---
id: POLY-133
title: Shell entity selector
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-62, POLY-86]
assignee: frontend-lead
paths: [apps/web/src/lib/shell/**, apps/web/src/routes/+layout.server.ts, apps/web/tests/e2e/**]
labels: [frontend, tenancy]
priority: null
pr: null
created: 2026-11-10
updated: 2026-11-10
---

The root layout loads `EntityList` from `@poly/tenancy` under `withTenant` and feeds `EntitySelector` through the seam POLY-128 left (ruling R5: `entities: readonly { id: string; name: string }[]`, `current: string | null`). Until this lands the selector renders a disabled "No entity" trigger. Drafted by the architect at the POLY-128 gate-1 ruling; `blocked_by` POLY-62 (merged) and POLY-86 (the session).

## Acceptance criteria

- [ ] The root layout loads the signed-in user's entities under `withTenant` and passes them to `EntitySelector`; a user sees exactly the entities `app.visible_entities()` returns.
- [ ] Switching entity re-renders the current screen for the chosen entity (DESIGN §5.7).
- [ ] The avatar cluster follows DESIGN's "max 3 + N" rule.
- [ ] With no entity the trigger stays disabled with the accessible name "No entity".
- [ ] The Playwright smoke covers one entity, several entities and a switch, in light and dark.
