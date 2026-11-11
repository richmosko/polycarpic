# POLY-128 ruling — app shell + DESIGN tokens

Gate 1 (architect). Seam, placement, guards. Claims not measured here are tagged `(unmeasured)`; each names who measures it and when.

## R1 Scaffold placement

- The SvelteKit project is rooted at `apps/web`. New: `svelte.config.js` (`@sveltejs/adapter-node`, ARCH §8.1), `vite.config.ts` (`sveltekit()`, `@tailwindcss/vite`), `src/app.html`, `src/app.d.ts`, `src/app.css`, `src/hooks.server.ts`, `src/routes/**`, `src/lib/shell/**`, `src/lib/components/ui/**` (shadcn-svelte, sidebar-07 block, as DESIGN names it), `components.json`, `playwright.config.ts`, `tests/e2e/**`, `apps/web/.gitignore` (`.svelte-kit/`, `build/`, `test-results/`, `playwright-report/`), `apps/web/turbo.json`.
- The POLY-85 code stays where it is and is not touched: `src/main.ts`, `src/startup.ts`, `src/index.ts`, `src/ops/**`. None of it is a route; SvelteKit only reads `src/routes`, `src/lib`, `src/hooks*`, `src/app.*`. `bin/polycarpic web` still runs `main.ts`. Mounting the SvelteKit handler in the public server is POLY-88's, not this loop's.
- Versions: current releases of `@sveltejs/kit`, `svelte` 5, `vite`, `tailwindcss` 4, `@playwright/test`, `@axe-core/playwright`, `bits-ui`, `@fontsource-variable/space-grotesk`, pinned exact in `apps/web/package.json` **devDependencies**, except `bits-ui` and the font, which are `dependencies` (they ship in the bundle). The prototype's versions are a floor, not a pin.
- Vitest in `apps/web`: `include: ['src/**/*.test.ts']`, so Playwright's `tests/e2e/*.spec.ts` never runs under vitest.
- `typecheck` becomes `svelte-kit sync && svelte-check --fail-on-warnings`; `tsconfig.json` extends `["../../tsconfig.base.json", "./.svelte-kit/tsconfig.json"]`. svelte-check against the repo's TypeScript 6 pin is (unmeasured): frontend-lead measures it first; a refusal is a measured objection that reopens this ruling once.
- Imports: relative or `$lib`. `$lib` does not resolve in the layers resolver and so is invisible to the layer rules; it only ever points inside `apps/web`, so that is safe. `@poly/*` imports from `.svelte` files are covered by R7.
- Spacing: Tailwind's default scale. DESIGN defines no spacing tokens; radius and fonts come from DESIGN through `@theme inline`.
- `docs/DESIGN/screen.css` and `prototype/` are references. Neither is imported.

## R2 Tokens and the hex guard (criterion 1)

- `apps/web/src/app.css` is the one file that holds colour literals: `@import 'tailwindcss'`, then DESIGN's `:root` and `.dark` blocks copied verbatim from `docs/DESIGN/tokens.css`, then `@theme inline` mapping each token to Tailwind (`--color-background: var(--background)` and so on). The `@font-face` comes from `@fontsource-variable/space-grotesk` (same Fontsource face, same family name), not the docs path.
- **Parity test** `apps/web/src/tokens.test.ts`: parse custom properties out of the `:root` and `.dark` blocks of both files, comments stripped (DESIGN's comments contain `--warning:` and `--brand-2:` text). The two maps must be equal, name for name and value for value, in each mode. A token missing, extra or different fails.
- **Hex guard**, same test file: every `.svelte`, `.ts`, `.js` and `.css` file under `apps/web/src` except `app.css` and `*.test.ts` is scanned; a match of `#[0-9a-fA-F]{3,4}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b` not preceded by `[\w&]`, or a `rgb(`/`rgba(`/`hsl(`/`hsla(`/`oklch(` call with a numeric first argument, fails and names file:line. The scanner gets a self-test on in-memory strings (a hex in markup, in a Tailwind arbitrary value `bg-[#fff]`, in `<style>`; and `href="#main"`, `&#123;` as passes). A fragment that happens to spell hex (`#add`) is renamed, never exempted.
- **Drift trigger.** The parity test reads `docs/DESIGN/tokens.css`, which neither turbo nor the CI change filter watches. Two lines close that: `apps/web/turbo.json` (`extends: ["//"]`, `test.inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/docs/DESIGN/tokens.css"]`) and `infra/ci/changes.mjs` adds `/^docs\/DESIGN\/tokens\.css$/` to `node`, with a case in `tests/ci/changes.test.ts`. A DESIGN token change then runs the web tests on its own PR.

## R3 Shell structure (criterion 2)

- `src/lib/shell/nav.ts` exports the one `NAV` list, in ARCH §2.4 / PRD order: Dashboard `/dashboard`, Transactions `/transactions`, General Ledger `/general-ledger`, Custodial Accounts `/custodial-accounts`, Allocation `/allocation`, Reports `/reports`, Entities `/entities`. The sidebar renders from it; nothing else lists items. Each href gets a stub `+page.svelte` (title + DESIGN's empty-state pattern, ARCH §2.4). `/` answers 307 to `/dashboard`. The current item carries `aria-current="page"`.
- **Seven, not eight.** DESIGN #flow-sidebar and the Sidebar component row say eight (with Tax); ARCH §2.4, PRD and this issue say seven. Proceeding on seven unless the lead rules otherwise; adding Tax is one line in `NAV` plus a stub.
- Root `+layout.svelte`: the sidebar (brand row with the collapse control, `NAV`, avatar trigger at the foot) and the main region, whose first child is the single top row: page title + breadcrumbs, `EntitySelector`, the per-page more menu (rendered from a `more` snippet the page may pass; empty means no button). No other header element; no `<header>` outside that row.
- **Collapse control.** DESIGN puts it in the brand row; ARCH §2.4 lists a sidebar toggle in the top row. Proceeding on DESIGN's brand-row control, with the top-row toggle rendered only below shadcn's mobile breakpoint, where the sidebar is off-canvas. Remembered state: shadcn's `sidebar:state` cookie.
- Avatar popover items, DESIGN #flow-sidebar order: Profile, Settings (proposed tag), Notifications (proposed tag), Preferences, Theme, Shortcuts, Log out (last, `--destructive`). Only Theme acts in this loop (R6); the rest render `aria-disabled="true"` until their issues land.

## R4 Session stand-in (criterion 3)

- No session exists until POLY-86, and this loop adds **no** test-only sign-in, fixture user or env switch: anything that fakes a session in the app would ship.
- The seam POLY-86 fills: `src/lib/shell/session.ts` exports `type ShellSession = { user: { id: string; name: string; image: string | null }; expiresAt: string }` and `App.Locals.session?: ShellSession` in `app.d.ts`. Root `+layout.server.ts` returns exactly `{ session: locals.session ?? null }`. Nothing sets `locals.session` in this loop; POLY-86 sets it in `hooks.server.ts` and adds the signed-out redirect.
- A unit test calls the load with a fake `locals` and asserts the returned keys are exactly `session`, and a session's keys exactly `user`, `expiresAt` (user: `id`, `name`, `image`): the projection carries no token (ARCH §3.1c).
- With `session: null` the avatar foot shows a neutral placeholder and the label "Account".
- **Criterion 3 is amended in place:** the smoke test loads the shell with no session; loading it signed in, with the user's name and avatar at the foot, moves to POLY-86.
- The shell is reachable by anyone who can reach the dev or preview server. The image does not serve it (R1), and POLY-88 must not serve any route before POLY-86's guard is in: a condition for the lead to put on POLY-88.

## R5 Entity selector

- `src/lib/shell/EntitySelector.svelte` takes `entities: readonly { id: string; name: string }[]` and `current: string | null`. The layout passes `[]` and `null`. Empty renders a disabled trigger with the accessible name "No entity". No import from `@poly/tenancy`; `packages/tenancy` is not touched. Wiring `EntityList` in is a follow-up blocked by POLY-62 and POLY-86 (draft to the lead).

## R6 Light and dark

- `hooks.server.ts` `handle` reads cookie `poly-theme`; exactly `dark` gives `dark`, anything else gives `light`, and `transformPageChunk` replaces `%poly.theme%` in `<html class="%poly.theme%">`. Only those two literals ever reach the page. No inline script, no `localStorage`: the first paint is right and the CSP stays strict (R8).
- The Theme item flips the class on `<html>` and writes the cookie (`Path=/; SameSite=Lax; Max-Age=31536000`). Whether a "System" choice follows `prefers-color-scheme` is a DESIGN question for the lead; default light until answered.

## R7 Lint (criterion 5, and the layer map over `.svelte`)

All in `scripts/layers/generate.mjs`; `eslint.config.js` gains only a separate ignores object `{ ignores: ['**/.svelte-kit/**', 'apps/web/build/**', 'apps/web/playwright-report/**', 'apps/web/test-results/**'] }` on its own lines, to stay clear of POLY-62's edits.
- `SRC` gains `svelte`, so every layer block also covers `.svelte` files. Today a `.svelte` file could import `@poly/secrets/open` or `pg` and lint would not see it.
- A block for `**/*.svelte` sets `svelte-eslint-parser` with `parserOptions.parser: tseslint.parser`, loads `eslint-plugin-svelte`, sets `svelte/no-at-html-tags: 2`, and sets `linterOptions.noInlineConfig: true`. That last makes every inline directive in a `.svelte` file inert, whichever comment syntax it uses, so the A-39 bypass test does not depend on how `eslint-comments` sees HTML comments. The sanitizing component, when it lands, is exempted by a config block naming its one path; there is none now.
- Root `package.json` devDependencies gain `eslint-plugin-svelte`, `svelte-eslint-parser` and `svelte` (the plugin's peer, resolved from the root where ESLint runs). Nothing else in that file.
- Fixtures (tests/layers): the harness learns `.svelte` files and an `<!-- @virtual-path: -->` / `<!-- @expect: -->` header. Fail fixtures: `{@html x}` in `apps/web/src/routes/x.svelte`; the same with `<!-- eslint-disable-next-line svelte/no-at-html-tags -->`; the same with `<!-- eslint-disable -->`; the same under `packages/ui/src/x.svelte`; a `.svelte` script importing `@poly/secrets/open` (layer rule fires). Pass fixture: a clean component.
- Does `boundaries` / `poly/*` run correctly on svelte-eslint-parser's script AST? (unmeasured): the `@poly/secrets/open` fixture is the measurement, at tests-red.

## R8 CSP (SECURITY C-07)

`svelte.config.js` is C-07's home and this loop creates it, so it carries `kit.csp`: `mode: 'auto'`; `default-src 'self'`; `script-src 'self'`; `style-src 'self' 'unsafe-inline'` (bits-ui positions with style attributes; C-07 forbids unsafe-inline for script only); `img-src 'self' data:`; `font-src 'self'`; `connect-src 'self'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`. The smoke asserts the header has `frame-ancestors 'none'` and `object-src 'none'`, and that `script-src` has no `'unsafe-inline'`. HSTS, `nosniff` and `Referrer-Policy` stay at Caddy.

## R9 Playwright and CI

- `apps/web/playwright.config.ts`: Chromium only; `testDir: 'tests/e2e'`; `webServer` runs `vite build && vite preview --port $E2E_PORT --strictPort`, `E2E_PORT` defaulting to 4173 (worktrees override it). Script `test:e2e` = `playwright test`. Root `turbo.json` gains `"e2e": { "cache": false }`.
- `tests/e2e/shell.spec.ts`, per mode (cookie `poly-theme` unset, then `dark`): load `/dashboard`; assert `html` has / lacks `dark`; computed `background-color` of the sidebar equals `--sidebar` and its text `--sidebar-foreground`; the top row's background equals `--background` and the title colour `--foreground`. Expected values come from parsing `src/app.css` at test time (R2's parity test ties that file to DESIGN), converted to `rgb()`: no hex in the spec. Plus the R3 count and order, no second header, R8's headers, R10's checks.
- CI: one step group in the existing **`unit`** job, after the per-package tests, never a new top-level job, and not the `app` job: `app` is the aggregate over `needs` with a 5-minute timeout and runs no tests. It reaches `app` through `unit`. The group installs Chromium (`playwright install --with-deps chromium`, browser cache keyed on the Playwright version) and runs `turbo run e2e --affected` (all when `TURBO_SCM_BASE` is empty, as for `test`); the install is skipped when no `e2e` task is affected. Guard: the group adds ≤ 150 s to `unit` on a warm cache (unmeasured; frontend-lead reports it at build-green), and `unit` keeps its 15-minute timeout. `pnpm audit --audit-level high` must stay clean with the new dependencies.
- This needs `.github/workflows/ci.yml` (and any pin in `tests/ci/ci-workflow.test.ts`). It is outside `paths`; the lead widens it or routes the step to devops.

## R10 Accessibility (criterion 4)

- In the smoke, both modes: `@axe-core/playwright` over the sidebar and the top row with `color-contrast` and every WCAG 2 A/AA rule; zero violations.
- Keyboard: from page load, Tab visits the brand-row control, the seven nav items in order, the avatar trigger, then the top row in DOM order (breadcrumb links, entity selector; it is disabled and so skipped while empty). Enter opens the popover; Esc closes it and focus returns to the trigger. Every focused control shows a non-`none` outline (DESIGN: `--sidebar-ring` in the sidebar).

## R11 Image, layers.json

- `Dockerfile` unchanged: the new packages are web devDependencies, `pnpm install --prod` leaves them out, and `main.ts` imports none of them. `bits-ui` and the font enter the image as unused files (unmeasured: the `image` job's Trivy scan is the check).
- `layers.json` unchanged: the shell imports no `@poly/*` package.
- For POLY-88, not this loop: the image's build stage must run `vite build` with dev dependencies and copy only `apps/web/build` forward; `.dockerignore` gains `**/.svelte-kit`, `apps/web/build` and `apps/web/tests`.
- ARCH's `packages/ui` row now says the components and token stylesheet live in `apps/web` until a second Svelte consumer exists (`docs/ARCH/index.html`, this commit). `packages/ui` is not touched.

## Paths this ruling needs beyond the issue's current `paths`

`scripts/layers/**` (R7), `infra/ci/changes.mjs` (R2), `.github/workflows/ci.yml` (R9).

## Addendum 1: eight sidebar items

This addendum supersedes R3's "Seven, not eight" bullet and the "seven" in R3's `NAV` bullet and in R10. The lead ruled that DESIGN owns the sidebar IA.
- `NAV` has eight items, in DESIGN §5.10 order: Dashboard, Transactions, General Ledger, Custodial Accounts, Allocation, **Tax `/tax`**, Reports, Entities. `/tax` gets a stub page like the others.
- R10's Tab order visits all eight nav items. The smoke asserts the count (8) and this order.
- Criterion 2 and the description are amended in place. ARCH §2.4 now lists eight and carries a Tax screen row (`TaxPosition` → tax, POLY-1.0).
