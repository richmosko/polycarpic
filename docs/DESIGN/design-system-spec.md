# Design System Spec

> The written companion to `tokens.css` + `screen.css`. The CSS files are the machine-readable source of truth; this doc explains the *why* and the usage rules. Owned by the `ux-designer` agent. Generate/refine with `/generate-designdoc`.

**Revision history (all 2026-09-28):** Pass 1 replaced an earlier revision that documented the cairn tracker's own board/dashboard UI, but inherited that tool's palette — rejected by the Principal same day (diverging from cairn is the goal). Pass 2 hand-authored an indigo/violet identity "inspired by" Monarch Money and Origin, but from general/training knowledge rather than an actual look — rejected: the guessed primary hue matched neither product, and "Origin" was misidentified (`originfinancial.com` is an unrelated Hawaii advisory firm; the product is **Origin, `useorigin.com`**). **This revision (pass 3) is derived from measurements**, not memory — team-lead captured live `getComputedStyle` reads and product screenshots off both actual sites (`temp/design-refs/README.md` + 5 images, gitignored, not in this repo — figures reproduced below). Every color/type/radius decision below traces to a specific measured value.

## What governs this system

This project's UI direction is **SvelteKit + shadcn-svelte** (Tailwind, headless primitives, LayerChart for charts) — PRD §8, kickoff §2.9. `tokens.css` is the downstream, machine-readable deliverable `frontend-lead` consumes into `apps/web`'s `app.css`. `screen.css` is component-level overrides on top of shadcn-svelte's shipped component CSS.

**The palette is hand-authored from measured references, not a vendored shadcn preset** (unlike cairn's own tokens — see **Provenance & shared tooling**) and not OKLCH (plain sRGB hex; this system doesn't need cairn's multi-preset theme-variant precision).

---

## Inspiration: Monarch & Origin — measured, not remembered

**Sources:** live capture in Chrome, 2026-09-28 (`temp/design-refs/`) — `monarch-home-hero.jpg`, `monarch-tracking-page.jpg`, `monarch-app-accounts-zoom.png` (an actual **app** screenshot, not marketing — load-bearing for the typography decision below); `origin-home-hero.jpg`, `origin-product-cards.jpg`. Figures below are reproduced from that capture's README, not re-derived.

### What was measured

**Monarch (monarch.com):** page bg `#FFFAEC` warm cream (marketing only — the app canvas is off-white with pure-white cards); ink `#2A2926` near-black warm, secondary text `#65625D`; primary/CTA `#F86713` orange, pill-radius **on the marketing hero only**; accent `#EFB921` mustard (illustrations/promo); body face "ABC Oracle" (grotesque sans); display serif used **only** for emphasis words in marketing headlines ("your money", "Tracking that doesn't feel like a chore") — **the app screenshot's own page title ("Accounts") is bold sans, not serif**; mono "Beltram Mono" for small figures. App shell: left sidebar (Dashboard, Accounts, Transactions, Cash Flow, Reports, Budget, Recurring, Goals, Investments, Advice); top bar = page title + outline "Refresh all" + filled "+ Add account". Net-worth hero: eyebrow label, big figure (`$687,041.79`), signed delta with arrow + percentage + period, a **single-line area chart with soft gradient fill**, $K-formatted y-axis. Account rows grouped by type (Cash / Credit Cards / Investments), collapsible, group-level delta, row = institution logo + name + subtype + sparkline + balance + relative freshness ("16 hours ago"). Right-column summary: Assets/Liabilities each as a horizontal **segmented stacked bar** + colored-dot legend, Totals/Percent toggle. Measured card radius ~12px, button/input radius ~8px (the pill shape is the marketing hero's CTA only).

**Origin (`useorigin.com` — corrects an earlier misidentification of `originfinancial.com`, an unrelated firm):** near-black base `#050505`, white ink, surfaces as `rgba(255,255,255,0.04–0.08)` overlays; body face "Suisse Intl" (neo-grotesque); display face "Lyon Display" serif with italic emphasis words, marketing-headline-only (no evidence it reaches the product UI — Origin's own product-card screenshots show only the mono/sans system, no serif); labels/buttons in **"Roboto Mono", uppercase, letterspaced** ("GET STARTED →", "UPCOMING TRANSACTIONS", "HOLDINGS") — this one reaches actual product-card modules, not just marketing copy; primary CTA = white button, black text, 8px radius; semantic colors measured directly: positive `#009C5A`, negative `#FC4A4A`, info `#195F97`, savings-chart line warm gold. Product cards: dark surfaces, mono uppercase section header, ticker rows (logo, ticker, name, sparkline, signed-% pill), a stat-trio pattern (`$8,000` / `5.52%` / `$577/yr`).

### What was taken, and why

| Decision | Taken from | Why |
|---|---|---|
| Primary brand hue = blue (`#195F97`) | Origin's own measured "info" semantic color; corroborated by Monarch's net-worth chart line also being light blue | The one hue **both** products independently reach for in a calm/informational role, rather than an urgent one — every other strong hue in this system (orange-red destructive, green positive, mustard warning) is already spoken for by a financial semantic, so a shared, meaning-free hue for brand/primary avoids diluting those signals. Not simply "picked" — it's the one point where both references agree |
| One grotesque sans throughout the **app** (Inter), no serif | Both products' actual app/product-card screenshots (not their marketing pages) | The serif emphasis both products use is confirmed, by direct comparison, to be a **marketing-headline-only** device — neither app screen (Monarch's Accounts screenshot; Origin's product cards) carries it. This design system governs the app, not a future marketing site, so the serif is deliberately not adopted here — a more careful reading of the evidence than the previous (rejected) pass's assumption |
| Uppercase, letterspaced mono for section/eyebrow labels (`--font-mono`, Roboto Mono) | Origin's product-card headers ("HOLDINGS", "UPCOMING TRANSACTIONS") | A real in-product pattern (not marketing-only), and a strong, cheap, on-brand signature for a ledger product's account numbers, tickers, and section headers |
| Warm off-white canvas + near-black warm ink (light mode) | Monarch's measured app-canvas convention and ink color | Confirmed against the **app** screenshot specifically (not the cream marketing hero) — off-white canvas, pure-white cards, warm near-black text |
| Near-black dark mode, subtle white-overlay surfaces | Origin's measured base and surface convention | Origin is dark-first; adopted verbatim as this system's dark-mode foundation rather than inventing one |
| Card radius 12px, button/input radius 8px | Both products' measured app-level values (Monarch app screenshot ~12px cards; Origin's stated 8px buttons, corroborated by Monarch's own app-level button radius, distinct from its marketing-only pill) | Direct measurement, not a guess — and explicitly **not** the pill shape, which only appears on Monarch's marketing CTA |
| Net-worth-over-time as a single-line **area chart** with gradient fill | Monarch's hero chart, exactly this pattern | Matches PRD §4.1 directly and is the most literal transferable pattern available |
| Grouped account rows (type group → institution rows, sparkline, freshness) | Monarch's Accounts screen | The closest existing analogue to our own Accounts/Dashboard wireframes — adopted close to verbatim, adapted for GL-vs-custodial grouping |
| Segmented stacked bar + legend for allocation | Monarch's Assets/Liabilities summary panel | Directly reusable for our asset-allocation actual-vs-target view |
| Positive/negative/warning hues sourced from measured brand values, not invented | Origin's measured green/red; Monarch's measured mustard | Real evidence over invention — each darkened only as far as needed to clear WCAG AA (see Accessibility), hue/saturation otherwise preserved |
| Destructive/CTA colors NOT copied at brand saturation | Both products' raw brand values | Monarch's orange (3.03:1) and Origin's red/green (3.4–3.6:1) only clear the 3:1 large-text/UI floor at their raw marketing saturation — this system needs 4.5:1 for normal text, so each was darkened (documented per-token below), not used as-is |

**What was deliberately not copied:** the pill-shaped CTA button (marketing-only, not app-level, on either product); the serif display face (marketing-only); Origin's dark-first default for our *primary* mode (see below) — polycarpic's dashboard is a daily-use tool checked in normal daylight conditions more often than a marketing moment, so **light is the primary/default mode**, styled closely on Monarch's own app screenshot; dark mode (styled on Origin's measured base) is the secondary, equally real but not-designed-first mode. Chart library, motion design, and exact information density beyond what's listed above were not reverse-engineered — original composition for the screens with no direct analogue (Ledger, GL-vs-custodial toggle, entity/membership).

---

## Foundations

### Color

Every value below traces to a specific measured hex from **Inspiration**, above, adjusted only where noted for WCAG AA. Contrast figures were computed via the standard WCAG relative-luminance formula against these exact hex values (script in `temp/`, full pair-by-pair results in **Accessibility**).

**Dashboard canvas convention: cards-on-muted, not cards-on-background.** Confirmed directly from Monarch's app screenshot: warm off-white canvas (`--muted`), pure-white cards (`--card`) on top.

#### Light (`:root`) — primary/default mode, modeled on Monarch's app UI

| Token | Value | Role |
|---|---|---|
| `--background` | `#FFFFFF` | Page background |
| `--foreground` | `#2A2926` | Default body text — Monarch's measured ink |
| `--card` | `#FFFFFF` | Card surface |
| `--popover` | `#FFFFFF` | Popover/dropdown surface |
| `--primary` | `#195F97` | Primary action fill — Origin's measured "info" blue, used as-is (5.18:1→ see Accessibility for exact figure) |
| `--primary-foreground` | `#FFFFFF` | Text on primary fill |
| `--secondary` | `#E8F1FA` | Secondary button/surface — pale blue tint |
| `--secondary-foreground` | `#0B2942` | Text on secondary |
| `--muted` | `#F7F4EE` | Muted background — warm off-white canvas |
| `--muted-foreground` | `#65625D` | Muted/meta text — Monarch's measured secondary text |
| `--accent` | `#EEF4FB` | Hover/active surface accent |
| `--accent-foreground` | `#0B2942` | Text on accent |
| `--destructive` | `#E70404` | Destructive fill — darkened from Origin's measured `#FC4A4A` (hue/sat preserved) to clear 4.5:1; the raw value only clears 3.38:1 |
| `--destructive-foreground` | `#FFFFFF` | Text on destructive fill |
| `--border` | `#E8E4DB` | Default hairline border — warm-toned |
| `--input` | `#E8E4DB` | Input border |
| `--ring` | `#195F97` | Focus ring |
| `--chart-1`…`--chart-5` | `#3A95DE` → `#0B2942` | Sequential/magnitude ramp (brand blue) — net-worth-over-time, book-vs-market |
| `--sidebar` | `#F7F4EE` | Sidebar background |
| `--sidebar-accent` | `#E8F1FA` | Sidebar hover/accent (active nav item) |
| `--positive` | `#00854D` | Gain / income / surplus — darkened from Origin's measured `#009C5A`; raw value only clears 3.56:1 |
| `--positive-foreground` | `#FFFFFF` | Text on positive fill |
| `--warning` | `#8F6C0A` | Caution tier — darkened from Monarch's measured mustard `#EFB921` (used there for illustrations/promos; repurposed here as caution, a standard convention); raw value only clears 1.81:1 |
| `--warning-foreground` | `#FFFFFF` | Text on warning fill |

#### Dark (`.dark`) — secondary mode, modeled on Origin's measured base

| Token | Value | Role |
|---|---|---|
| `--background` | `#050505` | Page background — Origin's measured base, used as-is |
| `--foreground` | `#F2F2F0` | Default body text |
| `--card` | `#141416` | Card surface — a lifted plane, echoing Origin's `rgba(255,255,255,0.04–0.08)` overlay convention |
| `--primary` | `#50A1E2` | Primary action fill, lightened for dark bg |
| `--primary-foreground` | `#08202E` | Dark text — clears 6.00:1; white on this fill only clears 2.79:1 |
| `--secondary` | `#16324A` | |
| `--secondary-foreground` | `#BDDCF4` | |
| `--muted` | `#1A1A1C` | |
| `--muted-foreground` | `#A6A6A3` | |
| `--accent` | `#1C3A54` | |
| `--accent-foreground` | `#BDDCF4` | |
| `--destructive` | `#FC4F4F` | Origin's own hue at a lighter step for dark-bg legibility |
| `--destructive-foreground` | `#2A0507` | Dark text — clears 5.67:1 |
| `--border` | `rgba(255,255,255,0.08)` | Origin's measured overlay convention |
| `--chart-1`…`--chart-5` | `#BDDCF4` → `#1E74B8` | Ramp re-lightened for dark mode |
| `--sidebar` | `#0A0A0C` | |
| `--positive` | `#52E0A4` | Origin's green hue, saturation eased from its raw 100% so the dark-mode fill doesn't read neon |
| `--positive-foreground` | `#052E13` | |
| `--warning` | `#F3CA59` | Monarch's mustard hue, lightened for dark-bg legibility |
| `--warning-foreground` | `#33230A` | |

**Character read:** a warm, near-black-on-off-white light mode and a true-near-black dark mode (not a cool navy-grey shift on either), a single restrained blue accent shared by both reference products in a calm role, and financial-semantic hues (green/red/mustard) sourced from measured brand values rather than invented. Both light and dark are real, designed modes — light is primary/default (see Inspiration), dark is not an afterthought.

### Typography

**One grotesque sans throughout the app** (`Inter`) — confirmed against both references' actual product UI, not their marketing pages (see Inspiration for why the serif device both products use is deliberately not adopted). `--font-heading` is an alias onto the same family — hierarchy is by weight/size, not face.

| Token | Stack | Notes |
|---|---|---|
| `--font-sans` | `'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` | Everywhere — body, buttons, inputs, table cells, headings, stat values |
| `--font-heading` | `var(--font-sans)` | Alias — no second family |
| `--font-mono` | `'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace` | Origin's own measured choice — uppercase letterspaced section/eyebrow labels, account numbers, ticker symbols, tabular figures |

**Two web fonts (Inter + Roboto Mono), not cairn's three, not the one-font pass-2 claimed.** Roboto Mono is a real added cost over a system-mono stack — justified here because its uppercase-letterspaced treatment is an actual adopted signature (Origin's section headers), not decoration; frontend-lead should subset it to uppercase Latin + digits if the eyebrow-label usage is the dominant one, to keep the request small.

| Token | Size | Line-height | Weight | Used for |
|---|---|---|---|---|
| `text-xs` | 12px | 16px | 400/500 | Badge/chip text, table meta, timestamps |
| `text-sm` | 14px | 20px | 400 | **Base UI size** — buttons, inputs, table cells, nav items |
| `text-base` | 16px | 24px | 400 | Prose body copy |
| `text-lg` | 18px | 28px | 600 | Card title, dialog title |
| `text-xl` | 20px | 28px | 600 | Section heading |
| `text-2xl` | 24px | 32px | 700 | Page title (e.g. Monarch's "Accounts") |
| `text-2xl`/`text-3xl` as **stat/display value** | 24–30px | 1.1–1.2 | 700 | Net-worth figure, pending liability — bold, tabular numerals |
| `text-xs` uppercase, `--font-mono`, letterspaced | 11–12px | — | 500–600 | Eyebrow labels, section headers (Origin pattern: "NET WORTH", "HOLDINGS") |

### Dashboard scale

Kept from the prior pass on its own merits (generic spacing rhythm), not re-measured against either reference at pixel precision.

| Element | Value |
|---|---|
| Page margins | 28px |
| Gap between cards | 24px |
| Card padding | 24px |
| Display/stat values | 28px, `--font-sans` bold, tabular numerals |
| Card/section titles | 17–18px, 600 weight |
| Eyebrow labels | 11–12px, `--font-mono`, uppercase, letter-spacing 0.06em, `--muted-foreground` |
| Base UI text | 14–15px |
| Table rows | 13px text, `16px` cell padding |

### Radius scale

**Measured**, not formula-derived — see Inspiration.

| Token | Value | Used for |
|---|---|---|
| `--radius-sm` | 6px | Badge, checkbox |
| `--radius-md` | 8px | Button, input, select — matches both products' measured **app-level** button radius |
| `--radius-lg` | 12px | Card, dialog, popover — matches Monarch's measured app card radius |
| `--radius-xl` | 20px | Sheet/drawer — no direct measurement, a reasonable extrapolation; flag before lock |

### Shadows

No custom `--shadow-*` overrides — inherits shadcn-svelte's default scale.

### Sidebar tokens

Persistent left sidebar — confirmed as the correct pattern by both references' actual app/product structure (Monarch's own sidebar: Dashboard, Accounts, Transactions, Cash Flow, Reports, Budget, Recurring, Goals, Investments, Advice — validates our own sidebar-nav wireframes).

---

## Financial semantics

### Delta coloring (gains, losses, income vs. expense)

| Situation | Token | Notes |
|---|---|---|
| Positive delta | `--positive` | Pair with a `+`/up-arrow, never color alone. Both references put the delta **on the signed figure itself**, not on the row (Monarch: `↑ $23,542.96 (3.5%)` next to the net-worth figure; Origin: signed-% pill on the ticker row) — adopt that placement, not a separate delta column |
| Negative delta | `--destructive` | Pair with a `−`/down-arrow, same placement rule |
| Neutral / no change | `--muted-foreground` | |

### Status tiers (three, not more)

| Tier | Token | Product examples |
|---|---|---|
| Normal / on track | `--positive` or plain `--foreground` | Safe-harbor gap ≤ 0; reconciliation clean; import fully matched |
| Caution | `--warning` | Safe-harbor gap open, due date >14 days out; unmatched transfer leg inside the exceptions window |
| Danger / overdue | `--destructive` | Safe-harbor payment overdue; exceptions-threshold breach; reconciliation break |

### Entity, account, and category badges — label + icon, not per-category hue

Unchanged principle from prior passes: meaning by label/icon/variant weight, not a dedicated hue per category.

| Category | Variant | Icon (Lucide, indicative) |
|---|---|---|
| Entity type — Person / Trust / Business / Household | `secondary` | `User` / `Landmark` / `Building2` / `Home` |
| Account — GL / Custodial | `outline` | `BookText` / `Landmark` |
| Transaction — Draft / Posted / Reversed | `secondary` / `outline` / `outline` italic | `Clock` / `Check` / `RotateCcw` |
| Role — Owner / Manager / Viewer | `default` / `secondary` / `outline` | — |

**Open item:** a genuine 3+-hue categorical chart need isn't solved by this doc yet — decide against a concrete spec when one arises.

---

## Component inventory

Map to shadcn-svelte's shipped components; install via `bunx shadcn-svelte@latest add <name>`.

| shadcn-svelte component | polycarpic usage |
|---|---|
| **Card** | KPI/stat cards; containment for every section |
| **Chart** (LayerChart, Area) | **Net-worth hero** — single-line area chart, gradient fill, `--chart-1..5` — direct Monarch pattern |
| **Table / custom grouped-row list** | **Grouped account list** (Monarch pattern) — type group header with group delta, rows with sparkline + relative freshness; also plain Table for ledger/lot/exceptions |
| **Segmented bar + legend** (custom, tokens-driven) | Asset-allocation actual-vs-target, Assets/Liabilities summary — direct Monarch pattern |
| **Badge** | Entity/account/transaction/role badges, safe-harbor status pill, Origin-style signed-% pill on ticker/delta rows |
| **Tabs** | Entity switcher, GL-vs-custodial toggle, nominal-vs-inflation-adjusted toggle, Totals/Percent toggle (Monarch pattern) |
| **Sheet / Dialog** | Transaction detail drawer; confirm-draft dialog; new-entity/membership dialog |
| **Select / Combobox** | Category, tax-treatment tag, jurisdiction pickers |
| **Sidebar** | Primary nav — validated against both references' own app structure |
| **Skeleton** | Every async fetch boundary |
| **Sonner (toast)** | Import batch complete, draft confirmed/posted, reconciliation break |
| **Progress** | Import batch progress, safe-harbor paid-vs-required |

**Top bar pattern (Monarch):** page title (left) + a secondary outline action + a primary filled CTA (right) — e.g. Dashboard: "Refresh" (outline) + nothing else; Ledger: "Confirm all" (filled, primary action for that screen).

**Empty-state pattern (ARCH §2.4 — Dashboard ships in M3 with the tax panel empty until 1.0, allocation panel empty until M4):** an empty panel keeps its real card chrome (eyebrow label, card shape, dashboard-scale padding) and states plainly what's coming and when, in `--muted-foreground` body text — no illustration, no skeleton (a skeleton implies "loading," not "not built yet" — conflating the two is misleading). Example: the tax-liability card shows the eyebrow "PENDING TAX LIABILITY" and a single line, "Available in v1.0" — same card shape as the live version will have, so the dashboard's layout doesn't visibly shift when the feature ships. See `styled-screens/dashboard.html` for the built example.

**Still ours to set:** reduced-motion policy; loading-state discipline (per-feature).

---

## Screen data contract

For architect's Screen DTO work (ARCH §2.4, OQ-11 resolved in outline). Model constraints: amounts are signed per line with Dr/Cr derived for display; drafts are separate from posted entries and posted entries are immutable; Cash-in-Transit open items get an exceptions view; access comes from membership only (no parent/child inheritance); `import_batch` holds new/duplicate/needs-category counts.

| Screen | Data shown | Milestone note |
|---|---|---|
| Dashboard | Net worth + delta; cash-flow by period; recent activity; pending tax liability + safe-harbor gap; allocation actual-vs-target | Ships M3; tax panel empty until 1.0, allocation panel empty until M4 — see Component inventory § Empty-state pattern |
| Ledger | Draft transactions; posted transactions; reversals; Cash-in-Transit exceptions; actor attribution | |
| Accounts | Balance sheet by GL account and by custodial account (toggle); NAV delta; reconciliation status | |
| Entities | Entity list; memberships; invite action | |
| Securities | Lot table; allocation actual-vs-target; book-vs-market time series | |
| Import | Linked providers; batch progress; `import_batch` new/duplicate/needs-category counts | |

---

## Provenance & shared tooling

polycarpic's own `cairn` tracker (`scripts/cairn/`) is a separate shadcn-svelte app with its own vendored preset and its own generated theme-variant pipeline (`gen_variants.py` → `docs/DESIGN/variants.css`). **This product's palette does not inherit cairn's tokens** (rejected at pass 1) — it's a fully separate identity derived from Monarch/Origin measurements (pass 3, this revision).

**CI hazard, in progress (POLY-78):** `scripts/cairn/tests/test_board_tokens_parity.py` asserts `docs/DESIGN/tokens.css` parity with cairn's board tokens and runs in the required `cairn` CI check — this divergence fails it until POLY-78 merges. Expected, not to be worked around. `docs/DESIGN/variants.css` has been removed from this branch (it belongs to cairn's generator, not the product) — expect a trivial merge conflict against POLY-78's own removal.

---

## Accessibility

**Target: WCAG AA.** Every pair below computed via the standard WCAG relative-luminance formula against the exact hex values in `tokens.css` (script in `temp/`).

**Light mode — text pairs (floor 4.5:1), all PASS:**

| Pair | Contrast |
|---|---|
| `--foreground` / `--background` | 14.55:1 |
| `--primary-foreground` / `--primary` | 6.72:1 |
| `--muted-foreground` / `--muted` | 5.53:1 |
| `--muted-foreground` / `--card` | 6.07:1 |
| `--destructive-foreground` / `--destructive` | 4.75:1 |
| `--positive-foreground` / `--positive` (fill) | 4.71:1 |
| `--warning-foreground` / `--warning` (fill) | 4.86:1 |

**Light mode — non-text pairs (floor 3:1):**

| Pair | Contrast | Result |
|---|---|---|
| `--chart-1`…`--chart-5` / `--card` | 3.21:1 → 14.89:1 | PASS all 5 |
| `--border` / `--card` | 1.27:1 | Below floor — decorative hairline, accepted (see Open items) |

**Dark mode — text pairs (floor 4.5:1), all PASS:**

| Pair | Contrast |
|---|---|
| `--foreground` / `--background` | 18.18:1 |
| `--primary-foreground` / `--primary` | 6.00:1 (dark text — white on this fill only clears 2.79:1) |
| `--muted-foreground` / `--card` | 7.54:1 |
| `--destructive-foreground` / `--destructive` | 5.67:1 |
| `--positive-foreground` / `--positive` (fill) | 8.93:1 |
| `--warning-foreground` / `--warning` (fill) | 9.56:1 |

**Dark mode — non-text pairs (floor 3:1):**

| Pair | Contrast | Result |
|---|---|---|
| `--chart-1`…`--chart-5` / `--card` | 3.72:1 → 12.89:1 | PASS all 5 |

| Concern | Standard / approach |
|---|---|
| Color contrast | WCAG AA — measured, every pair, both modes |
| Color-alone signaling | Never — delta always carries a sign/arrow (see Financial semantics) |
| Keyboard | shadcn primitives ship this by default |
| Screen readers | Semantic markup; delta sign readable from text content |
| Motion | Respect `prefers-reduced-motion` (open item) |

**Open items:**
- No CVD simulation run on the new palette yet.
- `--border`/`--card` is a low-contrast hairline by design (1.27:1) — decorative, consistent with common practice.
- Reduced-motion policy not yet written.
- Radius-xl (sheets) not measured against either reference — extrapolated.

---

## Open questions

- Native iOS/macOS token export format (kickoff §2.10) — not yet decided, non-blocking for web.
- Categorical (3+ hue) chart palette for transaction-category breakdowns — deferred until a concrete chart spec exists.
- Compare `styled-screens/dashboard.html` against `temp/design-refs/monarch-app-accounts-zoom.png` component-by-component once frontend-lead builds the real screen — this pass matched structure and the net-worth hero closely but did not build the full grouped-account-list + segmented-bar right column (time-boxed to the highest-traffic pattern); flag as a fast-follow if the gap matters before Implement.
