---
id: POLY-123
title: Throwaway UX prototype
status: done
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

### @ux-designer — 2026-11-08

**UX fidelity review @ a66339c: faithful with listed deltas.**

Method: each of the 15 routes against its DESIGN source, full-page pixel diff at 960 and 1280, light and dark, plus 9 hash states (`login`/`sign-up` `#local` `#second-step`, `transactions` `#pending` `#exceptions`, `general-ledger` `#journal-entries` `#balance-sheet-map` `#je-000213`). That is 96 pairs: 95 identical, 1 off by a single antialiasing pixel (allocation, 960 light). No hex colours in `prototype/src` outside the generated screens; shell, active nav (account-register lights General Ledger), tokens and component classes match by construction (verbatim markup, DESIGN's own CSS).

By design, not deltas: the `.proto-theme` button; the avatar popover and Dashboard/Transactions more menu closed until clicked (DESIGN draws them open as reference); register and transaction tables scroll in `.table-wrap` at 960.

Prototype defects (frontend-lead):
1. Cross-route hash links never set `:target`: SvelteKit navigates with pushState. Transactions → `/general-ledger#je-000212` scrolls, opens Journal entries and expands the row, but the `tr:target td` highlight is missing; the same on `/settings#second-step` and `/transactions?account=…#pending`. Fix: `data-sveltekit-reload` on hashed cross-route links (in the generator).
2. More menu: on the 13 screens without a `.more-menu`, clicking "more" opens nothing; the spec (§ Top bar) says the menu opens empty rather than staying hidden.
3. Avatar popover: Escape doesn't close it, and the trigger never sets `aria-expanded`.
4. After the DESIGN fix lands: run `npm run gen` (entities re-lays out) and remove the try/catch around the inline script in `Screen.svelte`.

DESIGN defects (ux-designer, fixed on `worktree-ux-fixes`): entities overflowed by 283px at 960 (the `1fr` tracks' minimum was the cap table's width); transactions threw a TypeError on load with no hash; the entities tax select clipped "Pass-through to members". Flows: every link target in the screens resolves to a route; the click paths behave as in DESIGN apart from defect 1.

### @team-lead — 2026-11-08

Principal verdict (2026-11-09): look and feel approved as is, on the regenerated build @ 6ead8aa (15 routes, light and dark, 960 and 1280, smoke 0 failures). The ux-designer's fidelity review stands as "faithful with deltas"; the three prototype deltas are fixed (cc831bc) and the DESIGN deltas landed in PR #91. Merging via the feature PR; closing.
