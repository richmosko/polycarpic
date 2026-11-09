---
id: POLY-123
title: Throwaway UX prototype
status: in-progress
milestone: POLY-C
parent: null
blocked_by: []
assignee: frontend-lead
paths: [prototype/**]
labels: [plan, prototype, design]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

The Plan gate's "design system encoded" clause is judged on running pages, not static mockups (kickoff §2.9; DECISIONS 2026-09-27). Build `prototype/`: a throwaway SvelteKit dev server serving the DESIGN styled screens as mocked pages with fake data, so the Principal can approve look-and-feel before Implement. The frontend-lead builds it; the ux-designer reviews fidelity against `docs/DESIGN/`.

## Acceptance criteria

- [ ] `prototype/` is its own SvelteKit app with its own `package.json`; no file under `apps/` or `packages/` imports from it and no workspace manifest lists it (a grep for `prototype/` outside `prototype/` returns nothing).
- [ ] It imports `docs/DESIGN/tokens.css`, the tokens the real app will import; no palette value is hard-coded in a component.
- [ ] Every screen in `docs/DESIGN/styled-screens/` has a route, with static fake data; the sidebar navigation and the click flows between screens work; chart layouts render; light and dark modes switch.
- [ ] One documented command (`prototype/README.md`) starts the dev server locally.
- [ ] The ux-designer's fidelity review and the Principal's look-and-feel verdict are recorded as comments on this issue; any DESIGN delta is routed to the ux-designer, not patched in the prototype only.
- [ ] The deletion trigger is written in `prototype/README.md`: removed once the real app's first screens ship; DESIGN keeps the screenshots as the durable record.

## Comments

### @team-lead — 2026-11-08

Feature started. Branch: `feature/poly-123-ux-prototype`. frontend-lead builds in a worktree; ux-designer reviews fidelity; the Principal records the look-and-feel verdict here.
