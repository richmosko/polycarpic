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

**Verdict (gate 4) at `89f020a`: PASS, on one condition.** In the first CI run, the e2e group must add ≤ 150 s to `unit` (R9; e2e measured about 16 s locally) and the `image` job (Trivy) must be green. Lint-clean rests on frontend-lead-128's report and the PR's `lint` job: qa ran lint but did not read the result.

Gate inputs: qa-engineer-128 gate 3 @ `89f020a` (turbo test+typecheck 35/35; tests/layers+ci+workflow 418/418; tests/config+image+log 92; e2e 37/37; tests/db not run, untouched). seceng-62 reviewed @ `89f020a` (nothing blocks). Lead visual leg chrome-passed @ `89f020a` (V1–V7).

| Axis | Result | Evidence |
|---|---|---|
| C1: tokens in one file, equal to DESIGN; colour-literal scan; drift trigger | pass | `958804d` `src/tokens.test.ts`; `6c160f5` `apps/web/turbo.json`, `infra/ci/changes.mjs` + test |
| C2: eight items in DESIGN order with icons, from `NAV`; popover at the foot opening right; one top row | pass | `49e29b3` `nav.ts`, `icons.ts`; `shell-geometry.spec.ts` |
| V1–V5: icon rail, floating card, mark and icons, popover side, remembered state | pass | `f21665a`, `717356e` red → `49e29b3` green; visual leg |
| V6: rail expand cue (mark swaps to `panel-left-open` on hover or focus, with a tooltip) | pass | `d20ec1a` red → `93a8a5f`, `89f020a` green; `shell-cues.spec.ts` |
| V7: current theme shown by a check indicator | pass | `d20ec1a` red → `93a8a5f` green |
| C3: smoke in Light / Dark / Auto, token values | pass | e2e 37/37 @ `89f020a` (qa) |
| C4: axe A/AA and contrast, Tab order, Esc returns focus | pass | e2e @ `89f020a` |
| C5: `{@html}` refused, inline disable inert, `.svelte` under the layer rules | pass | `6c160f5` `generate.mjs` `poly/svelte`; fixtures `24-svelte-html`; icons are data, not `{@html}` |
| R4: session projection carries no token | pass | `958804d` `layout.server.test.ts` |
| R5: entity selector empty, no tenancy import | pass | `a75ff93` |
| R8 / C-07: CSP in `vite.config.ts`; no inline script | pass | e2e CSP test; SECURITY 1.9.5 (`674fc88`) |
| R9: e2e in the `unit` job, affected-gated | pass; CI time pending | `6c160f5` `ci.yml`, `tests/ci/ci-e2e.test.ts` |
| R11: Dockerfile and `layers.json` unchanged; no `@poly/*` import | pass; Trivy pending | diff `53fd538..89f020a` |
| ARCH drift | none open (ARCH 1.15.12, PDF regenerated in `23c91e3`) | `7a0837f`, `7a8c81b` |

Accepted deviations:
- The SvelteKit 3 layout (ruling.md → Record).
- The Playwright browser cache is keyed on the lockfile hash.
- Duplicate `e2e` and `test:e2e` scripts.
- sr-only names on the collapse toggle and the avatar trigger.
