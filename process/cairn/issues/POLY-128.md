---
id: POLY-128
title: App shell + DESIGN tokens
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-82]
assignee: frontend-lead
paths: [apps/web/**, tests/**, layers.json, eslint.config.js, turbo.json, apps/*/package.json, packages/*/package.json, pnpm-lock.yaml, pnpm-workspace.yaml, package.json, docs/DESIGN/**, docs/ARCH/**, docs/SECURITY/**, process/cairn/issues/POLY-128.md, process/cairn/reviews/POLY-128/**, scripts/layers/**, infra/ci/changes.mjs, .github/workflows/ci.yml]
labels: [enabler, frontend]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-10
---

Gap filed at POLY-126's trace: POLY-M1's definition of done says "the app shell renders DESIGN tokens" and POLY-106 checks it, but no issue built it. The SvelteKit root layout per ARCH §2.4: the eight-item sidebar with its avatar foot, the single top row (sidebar toggle, title and breadcrumbs, entity selector, per-page more menu), no persistent header, and DESIGN's tokens (docs/DESIGN #tokens, #flow-sidebar) as the only source of colour, type and spacing. The entity selector reads EntityList from packages/tenancy once POLY-62 lands; until then it renders empty. The root layout's session projection carries no token (ARCH §3.1c, POLY-86).

## Acceptance criteria

- [x] Every DESIGN token (surfaces, actions, financial, lines, charts, categorical, sidebar) is defined once as a CSS variable in apps/web, and a lint or test refuses a raw hex colour in apps/web/src outside that file. — apps/web/src/tokens.test.ts: `:root block equals DESIGN…`, `.dark block equals DESIGN…`, `no raw colour literal outside app.css and *.test.ts`
- [x] The shell renders the eight sidebar items in DESIGN's order (§5.10, Tax after Allocation), the avatar popover at the foot, and the one-row top bar; there is no persistent header. — apps/web/src/lib/shell/nav.test.ts: `lists the eight items in order`; apps/web/tests/e2e/shell.spec.ts: `eight nav items in order, current marked, popover at the foot, one top row, no other header` (both modes)
- [x] A Playwright smoke test loads the shell, with no session, in light and dark mode and asserts token values on the sidebar and top row. Loading it signed in, with the user's name and avatar at the foot, is POLY-86's. — apps/web/tests/e2e/shell.spec.ts: `html class and token values on sidebar and top row` (light and dark), `auto follows the OS scheme…`
- [x] The shell meets DESIGN #accessibility for keyboard focus order and contrast on its own elements. — apps/web/tests/e2e/shell.spec.ts: `axe: zero A/AA violations on sidebar and top row incl. contrast`, `Tab order: brand control, eight items, avatar trigger…`; apps/web/tests/e2e/shell-geometry.spec.ts: `rail is keyboard reachable`
- [x] Lint refuses `{@html}` in every .svelte file under apps/ and packages/ (SECURITY C-41). The one sanitizing component is the only allowed exception; it is named in the rule when it lands, and until then there is none. A fixture using `{@html}` fails, and so does the same fixture with an inline `eslint-disable` for that rule (SECURITY A-39). — tests/layers/lint.test.ts over tests/layers/fixtures/24-svelte-html: `fail-html-bare`, `fail-html-disable-next-line`, `fail-html-disable-block`, `fail-html-script-disable`, `fail-html-in-packages`

## Comments

### @team-lead — 2026-11-10

Feature started. Branch: `feature/poly-128-app-shell-design-tokens`. Runs in parallel with POLY-62 (tenancy schema); the two share only config files (`eslint.config.js`, `package.json`, `pnpm-lock.yaml`), so the second PR to merge takes main first. `paths` widened from the shell files to `apps/web/**`: `apps/web` has no SvelteKit scaffold yet, so this loop adds it.

### @architect — 2026-11-10

**Ruling (gate 1):** `process/cairn/reviews/POLY-128/ruling.md`. Seam and guards in brief:
- SvelteKit (adapter-node) rooted at `apps/web`; POLY-85's `main.ts`, `startup.ts`, `ops/` untouched; the image does not serve the shell (POLY-88 mounts it). Dockerfile and `layers.json` unchanged.
- Tokens: `apps/web/src/app.css` is the one colour-literal file, `:root`/`.dark` copied from DESIGN `tokens.css`; a parity test holds them equal and a hex/colour-function scan refuses literals elsewhere in `apps/web/src`. DESIGN's token file joins the turbo inputs and the CI `node` filter.
- Seven nav items from one `NAV` list (DESIGN says eight with Tax: open with the lead).
- No session stand-in in the app: the layout returns `{ session: locals.session ?? null }` (`ShellSession`, no token); criterion 3 amended in place, the signed-in half moves to POLY-86.
- Entity selector takes `[]`; no `@poly/tenancy` import.
- Theme by the `poly-theme` cookie, set server-side; `kit.csp` per SECURITY C-07.
- Lint in `scripts/layers/generate.mjs`: `.svelte` joins the layer rules; `svelte/no-at-html-tags` with `noInlineConfig` on `.svelte` files (C-41, A-39).
- Playwright + axe in the `unit` job behind `turbo run e2e --affected`; ≤ 150 s added (unmeasured, reported at build-green).
- Needs paths: `scripts/layers/**`, `infra/ci/changes.mjs`, `.github/workflows/ci.yml`.

### @architect — 2026-11-10

**Ruling addendum 1:** eight sidebar items, with Tax after Allocation (lead ruling: DESIGN owns the sidebar IA). See ruling.md → Addendum 1. Criterion 2 and the description are amended in place, and ARCH §2.4 is corrected.

### @architect — 2026-11-10

**Ruling addendum 2:** theme choices Light / Dark / Auto, defaulting to light. Auto works through one same-origin `static/theme.js` under R8's CSP; this supersedes R6. See ruling.md → Addendum 2. ARCH §2.4 collapse-control wording aligned with R3. This is the last addendum within the ruling budget.

### @architect — 2026-11-10

**Verdict (gate 4), first issue: superseded** by the re-issued verdict below. The visual leg (V1–V5) went back through tests-red and build-green.

### @architect — 2026-11-10

**Verdict (gate 4) at `daac457`: HELD** until V6 and V7 (below) pass tests-red and build-green, qa-engineer-128 has issued its gate-3 line and seceng-62 has posted `reviewed`; this table is then re-issued at the new sha. As drafted at `daac457`: PASS, on one condition. In the first CI run, the e2e group must add ≤ 150 s to `unit` (R9) and the `image` job (Trivy) must be green. Neither can be measured before that run. The earlier condition 2 is superseded: the sidebar was fixed in this loop (lead).

| Axis | Result | Evidence |
|---|---|---|
| C1: tokens in one file, equal to DESIGN; colour-literal scan; drift trigger | pass | `958804d` `src/tokens.test.ts`; `6c160f5` `apps/web/turbo.json`, `infra/ci/changes.mjs` + test; icons are path data with `stroke="currentColor"`, no hex |
| C2: eight items in DESIGN order, with icons, all from `NAV` | pass | `49e29b3` `nav.ts` (`icon` per entry), `icons.ts`, `Icon.svelte` |
| C2: popover at the foot, opening to the right; one top row; no other header | pass | `49e29b3`; `f21665a` `shell-geometry.spec.ts` |
| V1: collapsed icon rail, eight named, clickable, keyboard-reachable icons | pass | `f21665a` red, `49e29b3` green |
| V2: floating card (gutter, four rounded corners) | pass | `shell-geometry.spec.ts` |
| V3: brand mark (DESIGN brand-mark-24, `currentColor`) and nav icons | pass | `49e29b3` `icons.ts` `mark` |
| V4: popover to the right of the trigger | pass | `shell-geometry.spec.ts` |
| V5 / R3: collapse state remembered (`sidebar:state` cookie, server-set `data-sidebar`) | pass | `717356e` red, `49e29b3` `hooks.server.ts`, `sidebar-state.ts` |
| C3: smoke in Light / Dark / Auto, token values | pass (e2e 26/26, as the builder reported) | `daac457` |
| C4: axe A/AA and contrast, Tab order, Esc returns focus | pass | `daac457` (sr-only names fix label-content-name-mismatch) |
| C5: `{@html}` refused, inline disable inert, `.svelte` under the layer rules | pass | `6c160f5` `generate.mjs` `poly/svelte`; fixtures `24-svelte-html`. The icons render without `{@html}` |
| R4: session projection carries no token | pass | `958804d` `layout.server.test.ts` |
| R5: entity selector empty, no tenancy import | pass | `a75ff93` |
| R8 / C-07: CSP in `vite.config.ts`; no inline script | pass | `958804d`; e2e CSP test; SECURITY C-06/C-07 "Lives at" fixed by `fcdefae` |
| R9: e2e in `unit`, affected-gated | pass; added time unmeasured | `6c160f5` `ci.yml`, `tests/ci/ci-e2e.test.ts` |
| R11: Dockerfile and `layers.json` unchanged; no `@poly/*` import | pass; Trivy pending | diff `53fd538..daac457` |
| ARCH drift | none open: the `packages/ui` and frontend-framework rows match the build | `7a0837f`, `7a8c81b` |

Accepted deviations:
- The SvelteKit 3 layout (ruling.md → Record).
- The Playwright browser cache is keyed on the lockfile hash.
- Duplicate `e2e` and `test:e2e` scripts.
- sr-only names on the collapse toggle and the avatar trigger.

Two items to build, ruled here:
- **V6, rail expand cue** (sidebar-flow.md line 25, spec § Sidebar). In the rail, while the brand button is hovered or has keyboard focus, the mark is hidden and Lucide `panel-left-open` (path data in `icons.ts`) is shown in its place on a `--sidebar-accent` fill. A tooltip reading "Expand sidebar" opens to the right, with a `--foreground` fill and `--background` ink. At rest the mark shows, so the brand-mark visibility test holds; it asserts at rest only. The test, collapsed, in both modes: hover shows the open icon and hides `brand-mark`; Tab focus does the same; moving away restores the mark; the tooltip is visible to the right of the button.
- **V7, current theme visible.** Each Theme radio item shows a check indicator (Lucide `check`, `currentColor`) only when it is checked; the bold weight alone is not enough (DESIGN #accessibility: never signal by one weak cue). bits-ui already sets `aria-checked`. The test, for cookies unset / `dark` / `auto`: exactly one item has `aria-checked="true"` (Light / Dark / Auto respectively), and only that item's indicator has a non-zero box.
