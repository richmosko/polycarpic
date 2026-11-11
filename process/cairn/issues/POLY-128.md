---
id: POLY-128
title: App shell + DESIGN tokens
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-82]
assignee: frontend-lead
paths: [apps/web/**, tests/**, layers.json, eslint.config.js, turbo.json, apps/*/package.json, packages/*/package.json, pnpm-lock.yaml, pnpm-workspace.yaml, package.json, docs/DESIGN/**, docs/ARCH/**, process/cairn/issues/POLY-128.md, process/cairn/reviews/POLY-128/**]
labels: [enabler, frontend]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-10
---

Gap filed at POLY-126's trace: POLY-M1's definition of done says "the app shell renders DESIGN tokens" and POLY-106 checks it, but no issue built it. The SvelteKit root layout per ARCH §2.4: the seven-item sidebar with its avatar foot, the single top row (sidebar toggle, title and breadcrumbs, entity selector, per-page more menu), no persistent header, and DESIGN's tokens (docs/DESIGN #tokens, #flow-sidebar) as the only source of colour, type and spacing. The entity selector reads EntityList from packages/tenancy once POLY-62 lands; until then it renders empty. The root layout's session projection carries no token (ARCH §3.1c, POLY-86).

## Acceptance criteria

- [ ] Every DESIGN token (surfaces, actions, financial, lines, charts, categorical, sidebar) is defined once as a CSS variable in apps/web, and a lint or test refuses a raw hex colour in apps/web/src outside that file.
- [ ] The shell renders the seven sidebar items in DESIGN's order, the avatar popover at the foot, and the one-row top bar; there is no persistent header.
- [ ] A Playwright smoke test loads the signed-in shell in light and dark mode and asserts token values on the sidebar and top row.
- [ ] The shell meets DESIGN #accessibility for keyboard focus order and contrast on its own elements.
- [ ] Lint refuses `{@html}` in every .svelte file under apps/ and packages/ (SECURITY C-41). The one sanitizing component is the only allowed exception; it is named in the rule when it lands, and until then there is none. A fixture using `{@html}` fails, and so does the same fixture with an inline `eslint-disable` for that rule (SECURITY A-39).

## Comments

### @team-lead — 2026-11-10

Feature started. Branch: `feature/poly-128-app-shell-design-tokens`. Runs in parallel with POLY-62 (tenancy schema); the two share only config files (`eslint.config.js`, `package.json`, `pnpm-lock.yaml`), so the second PR to merge takes main first. `paths` widened from the shell files to `apps/web/**`: `apps/web` has no SvelteKit scaffold yet, so this loop adds it.
