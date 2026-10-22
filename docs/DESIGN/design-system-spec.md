# Design System Spec

> The written companion to `tokens.css` + `screen.css`. The CSS files are the machine-readable source of truth; this doc explains the *why* and the usage rules. Owned by the `ux-designer` agent. Generate/refine with `/generate-designdoc`.

## What governs this system

This project's UI direction is **SvelteKit + shadcn-svelte** (Tailwind, headless primitives, LayerChart for charts) — PRD §8, kickoff §2.9. `tokens.css` is the downstream, machine-readable deliverable `frontend-lead` consumes into `apps/web`'s `app.css`. `screen.css` is component-level overrides on top of shadcn-svelte's shipped component CSS.

**The palette is hand-authored from measured references, not a vendored shadcn preset** (unlike cairn's own tokens — see **Provenance & shared tooling**) and not OKLCH (plain sRGB hex; this system doesn't need cairn's multi-preset theme-variant precision).

---

## Inspiration: Monarch & Origin — measured, not remembered

**Sources:** live captures in Chrome of Monarch Money (https://www.monarchmoney.com) — its home hero, its tracking page, and a zoomed view of the app's Accounts screen (an actual **app** screenshot, not marketing — load-bearing for the typography decision below) — and of Origin (https://useorigin.com) — its home hero and its product cards. The screenshots themselves are third-party material and are not kept in the repo; the figures below were measured from them.

### What was measured

**Monarch (monarch.com):** page bg `#FFFAEC` warm cream (marketing only — the app canvas is off-white with pure-white cards); ink `#2A2926` near-black warm, secondary text `#65625D`; primary/CTA `#F86713` orange, pill-radius **on the marketing hero only**; accent `#EFB921` mustard (illustrations/promo); body face "ABC Oracle" (grotesque sans); display serif used **only** for emphasis words in marketing headlines ("your money", "Tracking that doesn't feel like a chore") — **the app screenshot's own page title ("Accounts") is bold sans, not serif**; mono "Beltram Mono" for small figures. App shell: left sidebar (Dashboard, Accounts, Transactions, Cash Flow, Reports, Budget, Recurring, Goals, Investments, Advice); top bar = page title + outline "Refresh all" + filled "+ Add account". Net-worth hero: eyebrow label, big figure (`$687,041.79`), signed delta with arrow + percentage + period, a **single-line area chart with soft gradient fill**, $K-formatted y-axis. Account rows grouped by type (Cash / Credit Cards / Investments), collapsible, group-level delta, row = institution logo + name + subtype + sparkline + balance + relative freshness ("16 hours ago"). Right-column summary: Assets/Liabilities each as a horizontal **segmented stacked bar** + colored-dot legend, Totals/Percent toggle. Measured card radius ~12px, button/input radius ~8px (the pill shape is the marketing hero's CTA only).

**Origin (`useorigin.com`, not the unrelated `originfinancial.com`):** near-black base `#050505`, white ink, surfaces as `rgba(255,255,255,0.04–0.08)` overlays; body face "Suisse Intl" (neo-grotesque); display face "Lyon Display" serif with italic emphasis words, marketing-headline-only (no evidence it reaches the product UI — Origin's own product-card screenshots show only the mono/sans system, no serif); labels/buttons in **"Roboto Mono", uppercase, letterspaced** ("GET STARTED →", "UPCOMING TRANSACTIONS", "HOLDINGS") — this one reaches actual product-card modules, not just marketing copy; primary CTA = white button, black text, 8px radius; semantic colors measured directly: positive `#009C5A`, negative `#FC4A4A`, info `#195F97`, savings-chart line warm gold. Product cards: dark surfaces, mono uppercase section header, ticker rows (logo, ticker, name, sparkline, signed-% pill), a stat-trio pattern (`$8,000` / `5.52%` / `$577/yr`).

### What was taken, and why

| Decision | Taken from | Why |
|---|---|---|
| A calm blue for the secondary/informational role | Origin's measured "info" semantic color (`#195F97`); corroborated by Monarch's net-worth chart line also being light blue | The one hue **both** products independently reach for in a calm/informational role rather than an urgent one. Every other strong hue (orange-red destructive, green positive, orange warning) is already spoken for by a financial semantic, so a meaning-free blue for secondary surfaces and charts avoids diluting those signals. The brand's own primary is the neon green (see Foundations) |
| One grotesque sans throughout the **app** (Inter), no serif | Both products' actual app/product-card screenshots (not their marketing pages) | The serif emphasis both products use is, by direct comparison, a **marketing-headline-only** device — neither app screen (Monarch's Accounts screenshot; Origin's product cards) carries it. This design system governs the app, not a marketing site, so the serif is deliberately not adopted |
| Uppercase, letterspaced mono for section/eyebrow labels (`--font-mono`, Roboto Mono) | Origin's product-card headers ("HOLDINGS", "UPCOMING TRANSACTIONS") | A real in-product pattern (not marketing-only), and a strong, cheap, on-brand signature for a ledger product's account numbers, tickers, and section headers |
| Warm off-white canvas + near-black ink (light mode) | Monarch's measured app-canvas convention and ink color | Confirmed against the **app** screenshot specifically (not the cream marketing hero) — off-white canvas, pure-white cards, near-black text |
| Near-black dark mode, subtle white-overlay surfaces | Origin's measured base and surface convention | Origin is dark-first; adopted as this system's dark-mode foundation rather than inventing one |
| Card radius 12px, button/input radius 8px | Both products' measured app-level values (Monarch app screenshot ~12px cards; Origin's stated 8px buttons, corroborated by Monarch's own app-level button radius, distinct from its marketing-only pill) | Direct measurement, not a guess — and explicitly **not** the pill shape, which only appears on Monarch's marketing CTA |
| Net-worth-over-time as a single-line **area chart** with gradient fill | Monarch's hero chart, exactly this pattern | Matches PRD §4.1 directly and is the most literal transferable pattern available |
| Grouped account rows (type group → institution rows, sparkline, freshness) | Monarch's Accounts screen | The closest existing analogue to our own Dashboard account list — adopted close to verbatim, adapted for GL-vs-custodial grouping |
| Segmented stacked bar + legend for allocation | Monarch's Assets/Liabilities summary panel | Directly reusable for the asset-allocation summary |
| Positive/negative/warning hues sourced from measured brand values, not invented | Origin's measured green/red; Monarch's measured orange | Real evidence over invention — each darkened only as far as needed to clear WCAG AA (see Accessibility), hue/saturation otherwise preserved |
| Destructive/CTA colors NOT copied at brand saturation | Both products' raw brand values | Monarch's orange (3.03:1) and Origin's red/green (3.4–3.6:1) only clear the 3:1 large-text/UI floor at their raw marketing saturation — this system needs 4.5:1 for normal text, so each was darkened (documented per-token below), not used as-is |

**What was deliberately not copied:** the pill-shaped CTA button (marketing-only, not app-level, on either product); the serif display face (marketing-only); Origin's dark-first default for our *primary* mode — polycarpic's dashboard is a daily-use tool checked in normal daylight more often than a marketing moment, so **light is the primary/default mode**, styled closely on Monarch's own app screenshot; dark mode (styled on Origin's measured base) is the secondary, equally real but not-designed-first mode. Chart library, motion design, and exact information density beyond what's listed above were not reverse-engineered — original composition for the screens with no direct analogue (Transactions review, General Ledger vs. Custodial Accounts, entity/membership).

---

## Foundations

### Color

**Brand hue: neon green.** `#2CFF05`, chosen because "the project name relates to fruiting plants... likely a dominant color in the logo." Measured: hue 110.6°, full saturation, L 0.51, **relative luminance 0.72 — only 1.36:1 against white**. It is kept as the literal `--brand` value everywhere it measures well (dark surfaces, dark-mode `--primary`), with a darkened same-hue value (`#148100`, L 0.253) serving light-mode `--primary` — one number doing both the fill-with-white-text job and the plain-text-on-card job.

**Secondary brand hue: sky blue.** `#05A9FF`, "a desaturated blue would complement well." Measured: hue 200.6°, full saturation, L 0.51 — **2.44:1 against the light background**, the same "fails as a light-surface fill/text" shape as the green brand. Same resolution pattern: **`#05A9FF` is the literal `--brand-2` value** (dark-surface/decorative use — the sidebar's focus ring, see **Secondary accent** below); **a darkened same-hue value (`#096FA5`) does the light-mode job** (`--secondary-foreground`, 4.72:1 on `--secondary`, 5.48:1 on `--card`) instead of a separately invented color.

**Neutrals carry a faint tint of the blue hue** (`--foreground`, the dark-mode scale, the sidebar), at low saturation (3–9%), so the whole system carries one consistent cast. "Lighter" means *less saturated*: the lightness levels sit near-white/near-black already, so what reads is how strongly the tint shows as a hue at all. The light page canvas and its borders are the exception: a near-neutral warm off-white (below).

**`--warning` is a true orange, paired with dark ink.** An orange darkened far enough for white text to clear 4.5:1 reads as brown — the trap destructive/positive avoid only because red and green stay legible when darkened; orange does not. **So: a vivid orange (`#EA6A0A`, hue 25.7°, matching Monarch's own measured orange hue of 22° — see Inspiration) paired with a dark orange-black ink (`#2A1200`) instead of white.** One literal value does both jobs this system normally splits across two: 5.54:1 for fill-with-text, and (unlike `--brand`/`--brand-2`) 3.20:1 against `--card`, so it also clears the non-text floor used directly as a border/icon color. Dark mode gets the same treatment, lightened for a dark surface (`#FF9452`, hue ≈23°) with the same dark ink (`#2A1200`) — not a white/dark flip like `--destructive`, because orange never pairs with white text AA-safely at a saturation that still reads as orange, in either mode. A warm hue pulled toward yellow to stay bright reads as mustard, so the hue is held and only lightness moves. **Used for:** the caution status tier — an aged Cash-in-Transit exceptions-window item, a stale provider link, or a safe-harbor due date more than 14 days out (see Financial semantics § Status tiers).

**Chart ramp: a gradient of `--brand-2`.** Sampled at `--brand-2`'s hue (200.6°, S=0.90), light mode L 0.46→0.30 (step −0.04), dark mode L 0.88→0.42 (step −0.12). **Ordered light→dark, `--chart-1` brightest → `--chart-5` darkest, in both modes**, so no `chart-N` meaning flips between modes. A ramp that runs too dark at its tail reads as "almost black"; this one keeps every step clearly a blue. Checked against **both** backgrounds, not just `--card`: light mode's floor is `--chart-1` at 3.07:1 against `--background` (and in a `--muted` well) / 3.26:1 against `--card` — the tightest pair in the ramp, still clearing 3:1. It is 2.92:1 on `--accent`, so no chart sits inside a hover fill. Dark mode is never the tight constraint (floor 5.04:1→5.23:1 at `--chart-5`). Adjacent steps sit ~1.18–1.21:1 apart in light mode (~1.27–1.44:1 in dark): modest but perceptible. `--positive`/`--warning`/`--destructive` are separate hues; this is the sequential/magnitude chart ramp only.

Light: `--chart-1` `#0C96DF` · `--chart-2` `#0B89CB` · `--chart-3` `#0A7CB8` · `--chart-4` `#096FA5` · `--chart-5` `#086291`.
Dark: `--chart-1` `#C5E9FC` · `--chart-2` `#8BD3F9` · `--chart-3` `#51BDF6` · `--chart-4` `#16A7F3` · `--chart-5` `#0B89CB`.

**Two-series charts use two hues.** Because the sequential ramp is blue, the two-series comparison job (nominal vs. inflation-adjusted, actual vs. target) puts series 1 on `--chart-3` (blue) and series 2 on the green identity — literal `--brand` on dark surfaces, `--primary` (`#148100`) on light surfaces — the same "literal-on-dark/derived-on-light" split every brand hue follows. See **Secondary accent** below.

**Warm off-white canvas.** "Can we set --background to some subtle shade of grey with a hint of brown?" A canvas tint at L ~0.996 (`#FEFEFE`) is white in all but name: no tint survives at that lightness. Because the sidebar-07 shell paints the inset/main area with `--background` itself, a near-white canvas becomes the whole page and cards stop floating. **`#F9F8F8`** (L 0.97) is near-neutral with a touch of warmth, light enough that the page doesn't read as grey while white cards still float on it. The neutrals around it carry the warm hue (30–33°), not `--brand-2`'s blue:

- `--card`/`--popover` are pure `#FFFFFF` — they float on the canvas (1.06:1 step plus the hairline): Monarch's "white cards on an off-white canvas" convention.
- **`--muted` = `--background` (`#F9F8F8`).** Its job is **in-card** wells, tab/progress tracks, skeletons and placeholder blocks, where it reads at **1.06:1 against white**. On the page itself it is invisible by design.
- **Every hover/active fill is `--accent`** `#EBF4F9` (shadcn's own hover token), with `--accent-foreground` for text and icons — never `--muted`, which would vanish on the page. That covers the sidebar toggle, icon buttons (hover and active), the entity selector, popover/menu items and table rows. `--accent` reads on both surfaces: 1.05:1 against the page, 1.12:1 against a card. **Exception:** in dark mode a destructive menu item ("Log out") hovers on a 20% destructive tint, shadcn's `bg-destructive/20`: red on dark `--accent` is only 3.25:1; on the tint it is 4.64:1. **Dark table-row hover, same pattern:** a faint sky tint, 40% `--accent` over `--card` (`#12232C`, 1.20:1 vs `--card`), not dark `--accent`, where red amounts are 3.25:1 and meta text 4.40:1. On the tint: body text 14.41:1, `--destructive` 4.89:1, `--muted-foreground` 6.61:1, `--positive` 9.64:1, `--primary` 11.83:1. The tint is not red because rows are not destructive.
- `--muted-foreground` `#5E5A55` (warm 33°) — 6.45:1 on the page/`--muted`, 6.14:1 on `--accent`.
- `--border` `#E6E2DE`, a step darker than the page (1.29:1 on `--card`, 1.22:1 on the page); `--input` `#DCD8D4` one step stronger (1.42:1 on `--card`).
- **Inks are checked on page, card and `--accent`.** `--accent` is the binding surface, because amounts and menu items sit on it when hovered. Each ink sits at the lightest value that still clears AA there:
  - `--primary`/`--ring` `#148100`: 4.75 page / 4.52 accent / 5.04 white-on-fill.
  - `--destructive` `#DE0404`: 4.80 / 4.57 / 5.09 white-on-fill.
  - `--positive` `#147F3C`: 4.80 / 4.56 / 5.08 white-on-fill. (One hex step lighter is 4.4999:1 on `--accent`, strictly a fail.)
  - `--secondary-foreground` `#096FA5`: 5.17 page / 4.92 accent.
- Dark mode's light sidebar is `#F7F8F8`, a blue-tinted near-white; it does not mirror the warm light canvas.

Contrast figures are computed via the standard WCAG relative-luminance formula against these exact hex values (full pair-by-pair results in **Accessibility**).

#### Light (`:root`) — primary/default mode

| Token | Value | Role |
|---|---|---|
| `--background` | `#F9F8F8` | Page canvas — near-neutral off-white, a touch of warmth |
| `--foreground` | `#1D1F20` | Default body text — near-black, barely blue |
| `--card` | `#FFFFFF` | Card surface |
| `--popover` | `#FFFFFF` | Popover/dropdown surface |
| `--primary` | `#148100` | Primary action fill — darkened brand green, same hue as `--brand`; 4.52:1 on a hovered `--accent` row |
| `--primary-foreground` | `#FFFFFF` | Text on primary fill |
| `--secondary` | `#E3F0F7` | Secondary button/surface — pale blue tint |
| `--secondary-foreground` | `#096FA5` | Darkened `--brand-2`, same hue — see Secondary accent |
| `--muted` | `#F9F8F8` | = `--background`. In-card wells, tab/progress tracks, placeholders (1.06:1 vs `--card`). Not a hover fill |
| `--muted-foreground` | `#5E5A55` | Muted/meta text, warm |
| `--accent` | `#EBF4F9` | **The hover/active fill** — same blue family as `--secondary`; 1.05:1 vs page, 1.12:1 vs card |
| `--accent-foreground` | `#096FA5` | |
| `--brand` | `#2CFF05` | Literal, undarkened neon green — logo, decorative highlights, dark-surface call-outs only; never text or a light-surface fill |
| `--brand-2` | `#05A9FF` | Literal, undarkened sky blue — same dark-surface-only rule as `--brand`; see Secondary accent for its job |
| `--destructive` | `#DE0404` | Destructive fill — 4.57:1 on `--accent` |
| `--destructive-foreground` | `#FFFFFF` | Text on destructive fill |
| `--border` | `#E6E2DE` | Default hairline border — warm, a step darker than the page |
| `--input` | `#DCD8D4` | Input border — one step stronger than `--border` |
| `--ring` | `#148100` | Focus ring — follows `--primary` |
| `--chart-1`…`--chart-5` | `#0C96DF` → `#086291` | Sequential/magnitude ramp in `--brand-2`'s blue hue |
| `--sidebar` | `#1F2528` | Inverted — a dark blue-tinted surface floating on the light page (see Sidebar) |
| `--sidebar-foreground` | `#F2F2F3` | |
| `--sidebar-accent` | `#303B40` | |
| `--sidebar-accent-foreground` | `#F2F2F3` | |
| `--sidebar-ring` | `#05A9FF` | The raw secondary blue, so no green cast reaches this component |
| `--sidebar-brand` | `#2CFF05` | Brand-mark stroke in the sidebar — 11.39:1 on the dark card (see Brand mark) |
| `--positive` | `#147F3C` | Gain / income / surplus — 4.56:1 on `--accent` |
| `--positive-foreground` | `#FFFFFF` | Text on positive fill |
| `--warning` | `#EA6A0A` | True orange — caution tier: aged CIT exceptions, stale provider link, safe-harbor due date >14 days out |
| `--warning-foreground` | `#2A1200` | Dark ink — orange can't clear 4.5:1 with white without reading brown |

#### Dark (`.dark`) — secondary mode

| Token | Value | Role |
|---|---|---|
| `--background` | `#070808` | Page background — blue-tinted near-black |
| `--foreground` | `#F2F2F3` | Default body text |
| `--card` | `#0D0E0F` | Card surface |
| `--primary` | `#2CFF05` | The raw brand green itself |
| `--primary-foreground` | `#070808` | Dark ink — clears 14.7:1; white on this bright fill only clears 1.4:1 |
| `--secondary` | `#173C4F` | |
| `--secondary-foreground` | `#68C3F3` | |
| `--muted` | `#0F1112` | |
| `--muted-foreground` | `#A0A7AB` | |
| `--accent` | `#194257` | |
| `--accent-foreground` | `#68C3F3` | |
| `--brand` | `#2CFF05` | Same literal value both modes |
| `--brand-2` | `#05A9FF` | Same literal value both modes |
| `--destructive` | `#FC4F4F` | |
| `--destructive-foreground` | `#2A0507` | |
| `--border` | `rgba(255,255,255,0.08)` | |
| `--chart-1`…`--chart-5` | `#C5E9FC` → `#0B89CB` | `--brand-2`'s blue hue, lightened; `--chart-5` here equals light mode's `--chart-2` by coincidence — both ramps sample the same hue/saturation function |
| `--sidebar` | `#F7F8F8` | Inverted the other way — a light, blue-tinted card floating on the dark page |
| `--sidebar-foreground` | `#1D1F20` | |
| `--sidebar-accent` | `#E3F0F7` | |
| `--sidebar-accent-foreground` | `#096FA5` | |
| `--sidebar-ring` | `#0078B8` | A derived blue ink, since the raw `--brand-2` reads too close to this light sidebar's near-white surface |
| `--sidebar-brand` | `#148100` | Brand-mark stroke — 4.73:1 on the light card; the raw neon would be 1.28:1 (see Brand mark) |
| `--positive` | `#52E0A4` | |
| `--positive-foreground` | `#052E13` | |
| `--warning` | `#FF9452` | True orange, same hue family as light mode (≈23°), lightened for a dark surface |
| `--warning-foreground` | `#2A1200` | Same dark ink as light mode (not a white/dark flip like `--destructive`; orange never pairs with white text AA-safely at a legible saturation, in either mode) |

**Character read:** two brand hues, each following the same rule — literal where it clears AA (dark surfaces), darkened at the same hue where it doesn't (light-mode surfaces): neon green (`--brand`/`--primary`, 110.6°) for the main/primary identity, sky blue (`--brand-2`/secondary family, 200.6°) for secondary surfaces, info-weight badges, and anywhere the system needs a calm non-primary affordance. The dark neutral scale and the sidebar carry the blue tint rather than the green, so the green stays a deliberate signal instead of a cast over everything. `--positive` (gain green, hue ≈150°) is a third, deliberately distinct green — checked against `--brand` (110.6°) so it is never mistaken for a brand hue.

### Secondary accent — job definition

A second brand hue needs an explicit job or it fights the first one for meaning. `--brand-2` / the blue `--secondary` family is used for:
- **Secondary buttons and surfaces** — anywhere `--secondary`/`--accent` applies.
- **Info-weight badges and callouts** — a step above `--muted-foreground` neutral, a step below `--warning`'s caution — e.g. "new feature," "beta," informational tooltips. Not a Financial-semantics status tier (those stay `--positive`/`--warning`/`--destructive`, see Financial semantics) — this is for product-chrome informational messaging, a different axis.
- **Selected / non-primary-active states** — e.g. a selected row in a list that isn't *the* primary action of the screen, distinct from `--primary`'s "main CTA" meaning.
- **Chart series 1** in genuine two-series comparison charts (nominal vs. inflation-adjusted, actual vs. target): `--chart-3`, mid-ramp blue. Series 2 takes the green identity: literal `--brand` on dark surfaces, `--primary` (`#148100`) on light surfaces. One representative green accent per mode is enough for a 2-series case; no second ramp is needed.

**Not used for:** anything `--primary` already owns (main CTAs, the brand's "default interactive" meaning) or anything a Financial-semantics tier already owns (gain/loss/caution/danger) — the point of giving it a job is so it doesn't become a second, redundant way to say what green or the semantic tiers already say.

### Typography

**One grotesque sans throughout the app** (`Inter`) — confirmed against both references' actual product UI, not their marketing pages (see Inspiration for why the serif device both products use is deliberately not adopted). `--font-heading` is an alias onto the same family — hierarchy is by weight/size, not face.

| Token | Stack | Notes |
|---|---|---|
| `--font-sans` | `'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` | Everywhere — body, buttons, inputs, table cells, headings, stat values |
| `--font-heading` | `var(--font-sans)` | Alias — no second family |
| `--font-mono` | `'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace` | Origin's own measured choice — uppercase letterspaced section/eyebrow labels, account numbers, ticker symbols, tabular figures |

**Two web fonts (Inter + Roboto Mono).** Roboto Mono is a real added cost over a system-mono stack — justified because its uppercase-letterspaced treatment is an adopted signature (Origin's section headers), not decoration. frontend-lead should subset it to uppercase Latin + digits if the eyebrow-label usage is the dominant one, to keep the request small.

| Token | Size | Line-height | Weight | Used for |
|---|---|---|---|---|
| `text-xs` | 12px | 16px | 400/500 | Badge/chip text, table meta, timestamps |
| `text-sm` | 14px | 20px | 400 | **Base UI size** — buttons, inputs, table cells, nav items |
| `text-base` | 16px | 24px | 400 | Prose body copy |
| `text-lg` | 18px | 28px | 600 | Card title, dialog title |
| `text-xl` | 20px | 28px | 600 | Section heading |
| `text-2xl` | 24px | 32px | 700 | Page title on shell-less pages (e.g. Admin) |
| `text-2xl`/`text-3xl` as **stat/display value** | 24–30px | 1.1–1.2 | 700 | Net-worth figure, pending liability — bold, tabular numerals |
| `text-xs` uppercase, `--font-mono`, letterspaced | 11–12px | — | 500–600 | Eyebrow labels, section headers (Origin pattern: "NET WORTH", "HOLDINGS") |

### Dashboard scale

A generic spacing rhythm, not measured against either reference at pixel precision.

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

### Brand mark

**Source:** `brand/logo.jpeg` (1024px, neon-green seedling line art on a dark slate square, no alpha). Kept unmodified as the source of truth.

**Traced, not embedded.** The JPEG can't sit on the sidebar: its slate square would show as a grey tile on both cards, and it has no alpha. So the line art is traced to a 24×24 SVG of open strokes in `currentColor` (`stroke-linecap/linejoin: round`, like Lucide) and inlined in the markup. No tile or background goes behind it; the strokes sit directly on the surface, as they do on the source's slate.

| Variant | File | Use | Stroke |
|---|---|---|---|
| Full: two leaves, both midribs, stem, ground arc | `brand/brand-mark.svg` | 32px and up (Home hero, any large placement) | 1.25 |
| Simplified: midribs dropped | `brand/brand-mark-24.svg`, inlined as `.brand-icon > .brand-mark` | 24px: the sidebar brand row (expanded and rail), the shell-less app bar, Login | 1.5 |

**Why two variants.** At 24px the midribs close up the leaf interiors into solid blobs (checked by eye at 1.25, 1.5 and 2.0 strokes). Dropping them keeps the leaf outlines open. Stroke 1.5 at 24px is a 1.5px line, the same weight as the 18px Lucide nav icons beside it (2 × 18/24). The silhouette (leaf pair, stem, ground arc) is unchanged.

**Colour: `--sidebar-brand`.**

| Mode | Sidebar card | Mark | Contrast |
|---|---|---|---|
| Light | `#1F2528` (dark card) | `#2CFF05`, the literal `--brand` | 11.39:1 |
| Dark | `#F7F8F8` (light card) | `#148100`, the light-mode `--primary` | 4.73:1 (the raw neon would be 1.28:1) |

Both clear the 3:1 non-text floor, and the dark-mode value clears 4.5:1 too. Off the sidebar, the mark takes `--primary`: 4.75:1 on the light page, 14.72:1 on the dark page.

| Placement | Variant and size | Colour | Contrast |
|---|---|---|---|
| Sidebar brand row, expanded | 24px, left of the wordmark | `--sidebar-brand` | see above |
| Sidebar rail, collapsed | 24px, the expand button's resting face; swaps to `panel-left-open` on hover or keyboard focus | `--sidebar-brand` | see above |
| Brand app bar, plain pages (Membership setup, Admin) | 24px, left of the wordmark | Literal `--brand` on the bar (`#070907`) | 14.72:1 |
| Brand app bar, Home | Full, 32px, left of the "Polycarpic" wordmark | Literal `--brand` on the bar (`#070907`) | 14.72:1 |
| Login form pane (`.auth-logo`) | 24px, left of the wordmark, top-left | `--primary` | 4.75:1 light, 14.72:1 dark |

`.brand-mark` is the SVG's own class; the brand app bar's lockup container is `.brand-bar-lockup`.

### Layout & shell

The shell is shadcn's **sidebar-07** block (https://ui.shadcn.com/view/new-york-v4/sidebar-07).

1. **The sidebar fills the vertical *screen*, not the vertical *page*, and is a floating card with a gutter on every side.** `position: fixed; top/left/bottom: var(--shell-gutter)` (16px), `border-radius` on all four corners. Composition, top to bottom: brand row → nav (seven items) → avatar trigger (opens the user-menu popover to its right — see § Sidebar).
2. **No persistent header.** Nothing at the top of the main area stays put while the rest scrolls, and everything there shares the content's background token: "anything in the top part of the main viewing window should have the same background (token color) as the rest." The top row (`.topbar`) is not sticky, has no bottom border, and uses `--background` (not `--card`), so it is identical to the content below it and scrolls away with the page.
3. **The top row starts to the right of the sidebar**, expanded or collapsed; it never spans the full width.

`.shell-main` carries a `margin-left` of `2 × gutter + sidebar width` (left gutter, sidebar, a matching gutter before the content starts) because the sidebar is out of normal document flow (`position: fixed`).

See `styled-screens/` for the built version.

### Header → "Top row"

This is not a header in any surface sense (see § Layout & shell). "Top row" describes what it is: the first row of the scrollable main area.

| Side | Items, in order |
|---|---|
| **Left** | Current page view **>** breadcrumbs (`.breadcrumbs`). No icon and no separator before it: the expand/collapse control lives in the sidebar's brand row (§ Sidebar). |
| **Right** | Entity selector (name + avatar cluster) → vertical separator → "more" icon (Lucide `ellipsis-vertical`, `.more-menu-wrap`) |

- **Breadcrumbs are the only place a page's title renders** — screens do not repeat it as an on-page heading. Most screens have a single crumb; the account register is the multi-crumb example ("General Ledger **>** Primary Checking").
- **AI/agent, search, notifications, and a settings gear are not in this row.** They are not deleted as product surfaces — ARCH §2.4 keeps Search and Notifications as real screens/overlays and Settings as a real screen — only their *entry point in the top row* is absent. **Where they go instead is proposed, not decided:**
  - **Settings, Notifications** — proposed as items under the avatar popover (see § Sidebar). Marked "proposed" in the styled screens (`.proposed-tag`).
  - **Search** — proposed via a keyboard shortcut, plus a "Search…" entry in the "more" menu where relevant. No specific key combination chosen yet.
  - **AI/agent** — no entry point proposed; no icon or disabled placeholder exists anywhere.
- **The "more" menu is contextual per page view** — its contents are that page's global actions, not a fixed list. Defined per screen:

| Screen | "More" menu contents |
|---|---|
| Dashboard | Refresh |
| Transactions | Sync Transactions, New entry |
| General Ledger (tree + register) | Export |
| Custodial Accounts | Sync, New provider item |
| Allocation | *(none specified yet — target-save stays inline in the content column)* |
| Reports | *(none specified yet)* |
| Entities | *(none specified yet — "+ Invite member" stays inline per-row)* |
| Settings | *(none — this screen has no further global action of its own)* |

  A screen with no defined actions still shows the "more" icon (consistent chrome), and its menu is empty when opened rather than hidden. Dashboard and Transactions show the menu "open" in the styled screens as the reference, the same "shown open as reference" convention as the avatar popover.
- **Entity selector / avatar cluster** — the first item in the top row's right-justified group.

**Avatar cluster.** Overlapping circles representing the entity's membership:
- 24px diameter, `-8px` overlap (each circle's `margin-left`), a 2px border in whatever surface color it sits on to cut a visible ring between overlapping circles.
- **Fallback is always initials** on a `--secondary` fill — no avatar-image asset exists for this product, so this isn't a "fallback for the rare case," it's the only case.
- **Max 3 shown**; a 4th+ member folds into a "+N" chip in the same slot and style, continuing the overlap. Not shown live in a styled screen (every shown entity has ≤2 members); the rule is stated here for frontend-lead to implement against a real membership count.

### Sidebar

"Play with an inverted background color for the sidebar... make it a card with the same rounded edges... the ability to compact the sidebar to just icons."

- **Inverted:** in light mode the sidebar is a dark surface (`--sidebar` = `#1F2528`) floating on the light page; in dark mode it's a light surface (`--sidebar` = `#F7F8F8`) floating on the dark page. A user never sees two dark (or two light) surfaces stacked with no separation across a mode switch — "inverted" means relative to the page, in both directions.
- **Blue-tinted, not green and not neutral grey.** A dark sidebar at the brand green's hue reads as a green bias, not a deliberate choice. It takes the same blue hue (200.6°) as the dark neutral scale, so the system carries one consistent "barely blue" cast instead of a third hue family. The sidebar's focus ring is `--brand-2`, not the green `--brand`, so no green cast reaches this component; the one deliberate green in it is the brand mark.
- **Card:** `border-radius` on **all four corners** (`var(--radius-lg)`), "with the appropriate border spacing": a `--shell-gutter` (16px) insets `top`/`left`/`bottom` so the card floats with visible space on every side, as in the sidebar-07 reference.
- **Collapsible to an icon rail:** a compact state (~64px wide) showing only nav icons, no labels — expand restores the full ~240px width with labels.

**Composition, top to bottom:**
1. **Brand row** (`.sidebar-top`) — the seedling mark + "Polycarpic" wordmark, plus the expand/collapse control (below). Collapses to the mark alone in the icon rail.
2. **Nav** (`.sidebar-nav`) — seven flat items (see § Sidebar information architecture). Settings is not a sidebar item; its entry point is a proposed avatar-popover item.
3. **Avatar trigger** (`.sidebar-bottom`) — opens a user-menu popover to its right (see below). Collapses to the avatar circle alone in the icon rail.

**Expand/collapse cue — in the brand row (the gemini.google.com pattern).** The expand/contract icon sits on the right of the sidebar, inline with the logo; when contracted, the rail shows just the logo, and on hover that logo switches to the expand icon.

| State | Brand row | Control |
|---|---|---|
| Expanded | Mark + "Polycarpic" left; collapse button right-aligned in the same row | `.sidebar-collapse` — Lucide `panel-left-close`, `aria-label`/tooltip "Collapse sidebar", `aria-expanded="true"` |
| Collapsed, at rest | Mark alone, centred in the rail | `.sidebar-expand` — the mark *is* the button, `aria-label` "Expand sidebar", `aria-expanded="false"` |
| Collapsed, hover **or** keyboard focus | Mark swaps to Lucide `panel-left-open` on a `--sidebar-accent` fill; tooltip "Expand sidebar" opens to the right (`.sidebar-tooltip`, shadcn Tooltip look: `--foreground` fill, `--background` ink) | Same button; `:focus-visible` adds the `--sidebar-ring` outline. The swap is a hover/focus *affordance* only — a click on the mark expands whether or not the swap is showing, so touch devices (no hover) still work |

Why here rather than in the top row: the control sits on the thing it controls, the top row stays short, and the collapsed rail stays at three permanent elements (mark, nav, avatar) with no extra icon. Mockups render both buttons and toggle them with `.collapsed`; the real app renders one or the other from the sidebar's collapsed store (shadcn `Sidebar`'s `open` state; the block's `SidebarTrigger` is replaced by these two buttons calling the same `toggleSidebar()`). Never the hamburger `menu` icon: the glyphs are Lucide `panel-left-close` / `panel-left-open`.

**Full viewport height.** "The entire vertical *screen* space. Not the vertical *page* space." `position: sticky` against the shell's flex row tracks the **page's** scroll position, not the **viewport**: any content above the shell in the DOM pushes a sticky sidebar's bottom edge below the visible viewport. `position: fixed` pins it to the viewport itself. `top`/`left`/`bottom` are all `var(--shell-gutter)`, so the card's height is implicit (the gap between the top and bottom insets) rather than a literal `100vh` — which is what allows a gutter on every side, including the bottom. `.shell-main` carries a `margin-left` of `2 × gutter + sidebar width` to avoid being covered.

**Avatar popover.** The sidebar's bottom item (`.sidebar-avatar-trigger`) opens a popover to the RIGHT of the trigger, bottom-aligned with it (`left: calc(100% + 8px); bottom: 0`), as in the sidebar-07 block's own user menu (https://ui.shadcn.com/view/new-york-v4/sidebar-07). The same in the collapsed icon rail: it opens to the right of the icon-only trigger.

| Order | Item | Status |
|---|---|---|
| 1 | Profile | decided |
| 2 | **Settings** | **proposed** — entry point not decided, see § Header |
| 3 | **Notifications** | **proposed** — same caveat |
| 4 | Preferences | decided |
| 5 | Theme | decided |
| 6 | Keyboard shortcuts | decided |
| — | divider | |
| 7 | **Log out** (last, `--destructive`-styled) | decided |

Settings/Notifications carry a `.proposed-tag` badge in the styled screens — visually distinct from the decided items, so a reviewer can tell at a glance which parts of this popover are still open questions. Shown "open" as the built reference on `styled-screens/dashboard.html` and `styled-screens/settings.html` (there with Settings marked current, to show its own proposed entry point); every other screen shows the trigger closed. This is a Popover, not a Sheet or Dialog — it doesn't block the rest of the screen and dismisses on outside click (see § shadcn-svelte reuse map for the exact primitive).

### Sidebar information architecture

"I kind of feel like the transactions, Ledger entries, General Ledger, Custodial Accounts, and security views are mixed together. Needs some conceptual clean up." (From the Principal's sidebar interview.) The underlying issue is a **flow-vs-state conflation**: three pipeline stages (imported transaction → draft → posted journal entry) stacked on one screen, and two different concept layers (the GL abstraction vs. a physical custodial account) sharing one screen behind a silent toggle. The IA separates them.

**Seven flat sidebar items, no nesting, plus one proposed avatar-popover entry (Settings).** The icon-rail collapse works because every item is flat.

| # | Nav item | Absorbs | What it is |
|---|---|---|---|
| 1 | **Dashboard** | — | Cross-cutting summary — net worth, cash flow, tax, allocation snapshot. |
| 2 | **Transactions** | the journal and import status | The time-ordered journal: three accordion cards in urgency order — Exceptions, Pending, Posted. The Pending card is the bank-feed review/match inbox (see § Transactions workflow). Import stats/status and the Sync Transactions / New entry actions live here; there is no separate "Import" item. Not the chart of accounts; see General Ledger for that. |
| 3 | **General Ledger** | the GL side of accounts | Opens to a chart-of-accounts **tree** (category → account → sub-account, balances, a custodial marker on accounts that mirror a physical account). Clicking an account opens that account's **register** — a separate page, breadcrumbed back to the tree — showing every line that hit it, in date order, with a running balance; each line links to its full journal entry. The register is account-scoped and running-balance-shaped; Transactions is entry-scoped and time-ordered — genuinely different questions, not two views of one screen. |
| 4 | **Custodial Accounts** | the physical side of accounts, and securities | The physical-account view — per-institution cards, reported balance, reconciliation status against the GL. Each account has a **lots sub-card**: a pull-down per security showing its lots and short/long/total current gain or loss, summed per security and per account. Book-vs-market is implicit here (the lots themselves), not a separate chart. New custodial accounts and provider links are created via a New provider item dialog on this screen (aggregator, manual, or file-import source type; a discovered-account mapping step; token refresh; unlink, with the ≤24h revocation-lag note on the Vercel target). Link health (expired token, lost access, stale) shows as a badge on the card and a banner on Transactions. Sync here pulls positions and balances. |
| 5 | **Allocation** | allocation vs. target | A dedicated actual-vs-target page. |
| 6 | **Reports** | — | Balance Sheet, Income Statement, Cash Flow — the Dashboard's empty-state pattern (§ Component inventory) until POLY-M5 ships statements. |
| 7 | **Entities** | — | Entity list, memberships, invite. |
| — *(proposed avatar-popover item, not a sidebar item)* | **Settings** | import scheduling | Batch-import schedule and options, plus app-level preferences. Reached from the avatar popover (proposed, `.proposed-tag`). No sidebar nav item is active on this screen. |

There is no "Securities" item (lots live in Custodial Accounts' sub-card; allocation is its own page) and no "Import" item (setup is a Custodial Accounts action; stats live on Transactions; scheduling lives in Settings).

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
| Caution | `--warning` | Safe-harbor gap open, due date >14 days out; an unmatched transfer leg aged inside the Cash-in-Transit exceptions window; a stale/expired provider link that still has cached data to show |
| Danger / overdue | `--destructive` | Safe-harbor payment overdue; exceptions-threshold breach; reconciliation break |

### Entity, account, and category badges — label + icon, not per-category hue

Meaning by label/icon/variant weight, not a dedicated hue per category.

| Category | Variant | Icon (Lucide, indicative) |
|---|---|---|
| Entity type — Person / Trust / Business / Household | `secondary` | `User` / `Landmark` / `Building2` / `Home` |
| Account — GL / Custodial | `outline` | `BookText` / `Landmark` |
| Transaction — Draft / Posted / Reversed / **Corrected** | `secondary` / `outline` / `outline` italic / **`outline` + `brand-2`-tinted dot** | `Clock` / `Check` / `RotateCcw` / `Pencil` |
| Role — Owner / Manager / Viewer | `default` / `secondary` / `outline` | — |

**Open item:** a genuine 3+-hue categorical chart need isn't solved by this doc yet — decide against a concrete spec when one arises.

### Correcting a posted entry — "Correct entry," not "edit" or "reverse"

The user-facing action and the underlying mechanism are two different claims. "The UI never offers an edit affordance on a posted row, only reverse" describes the *mechanism* correctly, but it is not what the user should be told to click.

- **Import is the immutable baseline.** An imported bank transaction is never altered after import, and the user never corrects an import row directly.
- **Nothing reaches the GL without a confirmation step.** Between import and posting, a draft is fully editable — category, tax-treatment tag, counterparty, amount allocation — as flow 5.2 describes. This is where a user fixes a mistake *before* it is load-bearing.
- **After posting, the user-facing action is "Correct entry," not "edit."** Clicking it does not mutate the posted row — under the hood it posts a full reversal of the original entry plus a new corrected entry (reversal-only, PRD §5) — but the user is never shown "reverse" as a verb for this, and never asked to construct the reversing entry themselves.
- **A corrected row carries a badge** (see table above) distinguishing it from a plain Posted or a standalone Reversed (e.g. a reversal with no replacement) row.
- **Click-through reveals the mechanism.** Opening a corrected entry's detail view shows the full underlying pair — the original entry's lines rendered shaded/struck-through, the reversal lines, and the new corrected entry — so the double-entry trail stays fully auditable (Overview principle: "every number earns trust") without the top-level row ever using the word "reverse" as the primary affordance.
- **Auto-posted rows get the identical treatment.** A row posted by a recurring rule rather than a manual confirm shows the same `Posted` badge plus a small `posted by rule — <rule name>` attribution line underneath it, and offers the exact same **Correct entry** action as any other posted row. There is no separate "edit" affordance for a rule-posted row, and no different correction mechanism — actor attribution (user / auto-post rule / system job, PRD §5) changes who gets credited, never how a mistake gets fixed.

See flow 5.2 (§ User Flows) for the decision diagram and `styled-screens/transactions.html` for the built row action, badge, and click-through state.

---

## Transactions workflow

The product specification for the Plaid bank-feed → journal-entry pipeline (starting point: the Principal's sidebar interview). Governs the **Pending** accordion card on Transactions — see § Sidebar information architecture for where this sits in the nav, and flow 5.2 for the full decision diagram.

**Layout:** a high-density table/list of unposted raw rows. Clicking a row expands it vertically (Accordion/Expansion pattern) — the matching workspace opens inline, no navigation away from the feed.

**The two-line preview (every expanded row starts here):**
- **Line 1, the locked leg.** Always the custodial cash side — debited or credited per the Plaid transaction type. Locked because it represents verified bank reality; never editable, here or in Split/Group.
- **Line 2, the suggested offset leg.** The system scans historical rules and the Plaid category to pre-fill an educated guess (e.g. Accounts Receivable, Software Expense, Custodial Clearing). Shown as an inline search dropdown the user can override in place — never a blank field.

**Flow A — Split (one raw row → one multi-leg entry).** For a transaction that represents multiple contexts (e.g. a $1,200 payout that nets a $20 platform fee). The expanded row morphs into a multi-column grid; the user adds unlimited offsetting rows. A live validation loop disables "Approve & Post" until the split rows' total exactly matches the raw transaction's absolute total — never a partial or over/under split.

**Flow B — Group (many raw rows → one entry).** For compressing many micro-transactions into one summary entry (prevents GL bloat). The user checkbox-selects rows in the primary table; a floating bulk-action bar appears; "Group & Summarize" opens the **same journal-entry modal** used everywhere else, pre-filled with one aggregated primary line and the user's chosen balancing distributions. **This is the system's one many-to-one draft→entry relationship** — every other posting path (manual entry, simple match, Split) is one draft (or one manual action) to one entry.

**The journal-entry modal, one component reused everywhere.** Header (date, memo) + legs (account, Dr/Cr, amount) — a near-full-screen `Dialog`, not a drawer, because entering legs needs most of the screen. The same modal serves manual **"+ New entry"**, **"Correct entry"** (§ Correcting a posted entry, above), **Split**, and **Group & Summarize** — only the pre-fill differs per entry point.

**Posting gate:** a transaction cannot leave the Pending card unless **all** of the following hold —
1. Σ debits = Σ credits (balanced).
2. The accounting equation holds, per entity (Assets = Liabilities + Equity).
3. The entry date matches the bank date — or, for a date mismatch, the Cash-in-Transit clearing rule applies.
4. The posted draft links to exactly one journal entry (except Group, which links many drafts to the one entry it produced).

Any gate failure keeps the item in Pending — there is no partial post and no silent failure. **"Approve & Post"** collapses the expanded panel with a fade-out and removes the item from the unposted inbox once the gate passes.

**"show N" selector:** each of the three accordion cards (Exceptions, Pending, Posted) has its own limit selector — a user with a large Posted history isn't forced to render all of it; Posted is paged, Exceptions/Pending show their full (usually small) count by default.

**Permissions:** New entry, Sync, Split, Group, Approve & Post, and the rule auto-post opt-in are Manager/Owner actions — a Viewer sees none of these affordances anywhere on this screen (SECURITY §4.2.1 matrix, ARCH §2.4 permissions table).

---

## General Ledger: tree & register

General Ledger opens to a **chart-of-accounts tree** — category → account → sub-account, each row showing its balance. Clicking an account opens that account's **register** as its own page, breadcrumbed back to the tree.

- **The custodial marker.** A tree row for a GL account that mirrors a physical custodial account (e.g. "Primary Checking") carries a small custodial badge (`landmark` icon + institution) — a cross-reference only, not a second data source; the figure shown is always the GL's own balance. Not every account has one (Owner's Equity, Cash in Transit never do).
- **The register is account-scoped and running-balance-shaped:** every line that hit this one account, in date order, with a running balance, each linking to its full journal entry (every leg, not just the one that hit this account) — the same "every number earns trust" principle as the Dashboard.
- **Distinct from Transactions, deliberately.** Transactions (§ Transactions workflow, above) is entry-scoped and time-ordered across every account in the entity — the journal. The register is the opposite cut: one account, every entry that ever touched it. Neither view replaces the other.

See `styled-screens/general-ledger.html` and `styled-screens/account-register.html`.

---

## Custodial Accounts: lots & provider setup

"Sub-card in the Custodial view... pull downs of each security to show lots. And for the Allocation vs target to be a dedicated page. The book vs market should be implicit in the custodial view, shown as whether the lots (and sum of lots) show the short/long/total current gains/losses." Lots live here; allocation vs. target is its own screen (§ Allocation, Reports & Settings).

**Per-account card:** institution name, reported balance, link-health badge, and a reconciliation line against the GL (clean / stale / break, per the status tiers — the danger tier surfaces on the Dashboard too, per flow 5.4).

**The lots sub-card (only on accounts that hold securities):**
- One row per security, collapsed by default — a pull-down (chevron) reveals its individual lots.
- Each lot shows book value, market value, and its own short-term or long-term unrealized gain/loss.
- The security's own row shows its summed book/market/gain across all its lots.
- The account's lots sub-card totals short, long, and total unrealized gain/loss across every security — this **is** the book-vs-market comparison; there is no separate book-vs-market chart.

**The New provider item dialog:**
- **Source type**, chosen first: aggregator (Plaid/SimpleFIN/fake), a manual account (no live link), or an imported file (CSV/OFX).
- **Discovered-account mapping** (aggregator path only): a provider item can surface several accounts at once (e.g. a bank's checking + savings); each discovered account maps to an existing or new custodial account — a provider item is a first-class record that owns its discovered accounts (ARCH §3 data-model note), not folded directly into one custodial account.
- **Token refresh** and **unlink** live in the same dialog. Unlink states the revocation lag explicitly on the Vercel deployment target: access may persist up to 24h after unlinking.
- **Sync** (on Custodial Accounts, with a Sync Transactions counterpart on Transactions) pulls **both** balances and positions here — not transactions-only, which is what Sync means on Transactions.
- **Import file** is the manual/file-source counterpart to Sync — same place, different action, for an account with no live aggregator link.

**Link health** (expired token, lost access, stale) is a badge on the custodial-account card here, and a banner at the top of Transactions — one state, shown in both places a user would reasonably look for it.

**Permissions:** New provider item, token refresh, unlink, and Sync/Import file are Manager/Owner actions — a Viewer sees none of them (same posture as Transactions' posting actions, ARCH §2.4 permissions table).

See `styled-screens/custodial-accounts.html`: the lots sub-card shows one security pulled down, and the provider-item dialog is shown open below the cards as the reference.

---

## Allocation, Reports & Settings

**Allocation.** A dedicated actual-vs-target page. Pulls from the same lot data as Custodial Accounts' lots sub-card, aggregated by asset class across every custodial account for the entity — not a new data source, a different aggregation. The nominal/inflation-adjusted (CPI-U) toggle (PRD §4.9) is orthogonal and applies here like any time-series view. Includes a target editor (targets must sum to 100%).

**Reports.** A nav item **from day one**: "its own sidebar item from day one... built in POLY-M5 (Statements); until then it shows the Dashboard's empty-state pattern." Three statements — Balance Sheet, Income Statement, Cash Flow — behind the same `Tabs` pattern used elsewhere. Before M5, every tab uses the empty-state convention (real card chrome, "Not set up yet," no milestone/version naming) rather than being hidden or disabled — the nav item itself is never gated on the feature shipping.

**Settings.** Batch-import scheduling ("all the option selections for batch scheduled imports") plus general app preferences. Two scopes that must not be conflated: **per-entity** (import schedule, CIT exceptions threshold, duplicate-detection window — a Household's schedule doesn't touch a Person entity) and **per-user** (theme, default entity on login, reduced motion). Viewers can view this page, but the Manager/Owner-only settings (schedule, import options) are read-only for them — same posture as every other write action in this system (ARCH §2.4 permissions table).

See `styled-screens/allocation.html`, `styled-screens/reports.html`, `styled-screens/settings.html`.

---

## Component inventory

Map to shadcn-svelte's shipped components; install via `bunx shadcn-svelte@latest add <name>`.

| shadcn-svelte component | polycarpic usage |
|---|---|
| **Card** | KPI/stat cards; containment for every section |
| **Chart** (LayerChart, Area) | **Net-worth hero** — single-line area chart, gradient fill, `--chart-1..5` — direct Monarch pattern |
| **Table / custom grouped-row list** | **Grouped account list** (Monarch pattern) — type group header with group delta, rows with sparkline + relative freshness; also plain Table for the account register, lots, and exceptions |
| **Segmented bar + legend** (custom, tokens-driven) | Allocation actual-vs-target, Assets/Liabilities summary — direct Monarch pattern |
| **Badge** | Entity/account/transaction/role badges, safe-harbor status pill, link-health badge, Origin-style signed-% pill on ticker/delta rows |
| **Accordion** | Transactions' three urgency-ordered cards (Exceptions, Pending, Posted); the Pending card's row expansion (two-leg preview) |
| **Tabs** | Entity switcher, nominal-vs-inflation-adjusted toggle, Totals/Percent toggle (Monarch pattern), Reports' statement switcher. General Ledger and Custodial Accounts are two nav items, never a tab pair |
| **Sheet / Dialog** | Transaction detail drawer; new-entity/membership dialog; provider-item dialog (Custodial Accounts) |
| **Dialog, near-full-screen** | The journal-entry modal (header + legs) — manual "+ New entry", "Correct entry", Split, and Group & Summarize all reuse this one modal |
| **Select / Combobox** | Category, tax-treatment tag, jurisdiction pickers; the suggested-offset-leg inline search dropdown (Pending inbox); per-card "show N" limit selector |
| **Sidebar** | Primary nav, seven flat items (Settings proposed under the avatar popover) — inverted, a floating card (gutter on every side), collapsible to an icon rail, brand row on top (mark + wordmark + collapse control) + avatar-popover trigger on bottom (opens to the right) — see Sidebar information architecture |
| **Button** | Variants: `default` (primary green fill: the one main action per view), `secondary`, `outline`, `ghost`, `destructive`, and `dark` (a solid `--foreground` fill with `--background` ink: near-black in light mode, near-white in dark). **Rule: never an outline button standing alone on `--background`.** Its `--border` edge is only 1.22:1 on the light page (~1.17:1 dark), so it all but disappears. Outline is for a secondary action set beside a filled one, or inside a card or bar that gives it a surface. A standalone secondary action uses `dark` instead (15.61:1 light / 17.92:1 dark against the page): Login's "Continue with Google" (with the Google G glyph). Hierarchy then comes from colour and position, not weight: the dark button is the heavier mass, so the primary stays the only green fill and sits last, after the divider |
| **Skeleton** | Every async fetch boundary |
| **Switch** | Settings' on/off preferences (auto-post matched recurring transactions, reduced motion), `.switch[role=switch]` |
| **Brand app bar** | Every page without the app shell (Home, Membership setup, Admin): fixed near-black bar, lockup left, the page's trailing items right, a fade below — see Public screens § Brand app bar |
| **Sonner (toast)** | Import batch complete, entry posted, reconciliation break |
| **Progress** | Import batch progress, safe-harbor paid-vs-required |
| **Top row** | Starts right of the sidebar, not full-width, not sticky/bordered, same background token as the content below it: breadcrumb (left); entity selector + separator + "more" menu (right) — see Layout & shell, Header |
| **Separator** | The top row's vertical divider before the "more" menu |
| **Popover / DropdownMenu** | Avatar popover at the sidebar's bottom — profile, **Settings (proposed)**, **Notifications (proposed)**, preferences, theme, keyboard shortcuts, Log out last (see Sidebar); the same primitive backs the top row's "more" menu |
| **Breadcrumb** | The top row's "page title > breadcrumbs" — single crumb on most screens, multi-crumb on drill-downs (the account register) |
| **Avatar cluster** | Overlapping initials-on-`--secondary` circles in the entity selector — membership at a glance, max 3 + overflow (see Header) |
| **Landing illustration + feature call-outs** | Home — under the brand app bar: the mountains illustration, then headline, subhead and three feature cards |
| **Split screen login** | Login — theme-aware form pane (full field list: OAuth, email, password + reveal + forgot-password, sign-in, the invite / own-instance account line, legal footer) + always-branded visual pane, stacks on phone width |

**Page actions live in the "more" menu.** Monarch puts a page's actions in its top bar as visible buttons (page title + an outline action + a filled CTA). Here, a page's global actions (Dashboard's Refresh; Transactions' Sync Transactions and New entry) live in the top row's contextual "more" menu instead (§ Header), and posting happens per item in the Pending inbox, never as a single batch "confirm all".

### Icon inventory — Lucide name per control

**Lucide, shadcn's own icon set, everywhere.** `lucide-svelte` is the package (MIT licensed); every icon below is named so Implement pulls the real component (`<PanelLeftClose />`, not a reinvented glyph). The styled screens embed simplified inline SVG stand-ins (same visual shape, hand-authored, not the literal `lucide-svelte` output) — close enough to review, not a substitute for the real package at Implement.

| Control | Lucide name | Notes |
|---|---|---|
| Sidebar collapse (expanded brand row, right-aligned) | `panel-left-close` | Never the hamburger `menu` icon |
| Sidebar expand (collapsed rail, the mark swaps to it on hover/focus) | `panel-left-open` | Tooltip "Expand sidebar" |
| "More" menu trigger | `ellipsis-vertical` | Top row, right-justified |
| Breadcrumb separator | `chevron-right` | |
| Dashboard nav | `layout-dashboard` | |
| Transactions nav | `arrow-left-right` | |
| General Ledger nav | `book-text` | |
| Custodial Accounts nav | `landmark` | |
| Allocation nav | `pie-chart` | |
| Reports nav | `file-text` | |
| Entities nav | `users` | |
| Avatar popover: Profile | `user` | |
| Avatar popover: Settings *(proposed)* | `settings` | |
| Avatar popover: Notifications *(proposed)* | `bell` | |
| Avatar popover: Preferences | `sliders-horizontal` | |
| Avatar popover: Theme | `moon` | Light/dark/auto toggle lives behind this item |
| Avatar popover: Keyboard shortcuts | `keyboard` | |
| Avatar popover: Log out | `log-out` | Always last, `--destructive`-styled |
| "More" menu: Refresh (Dashboard) | `refresh-cw` | |
| "More" menu: Sync (Transactions, Custodial Accounts) | `refresh-cw` | Same icon as Refresh — both are "pull fresh data," same verb |
| "More" menu: New entry / New provider item | `plus` | |
| "More" menu: Export (General Ledger) | `download` | |
| Locked leg indicator (Pending inbox, Split grid) | `lock` | § Transactions workflow |
| Correct entry / edit account (inline) | `pencil` | |
| Link-health warning banner | `triangle-alert` | |
| Search *(proposed entry point, not in the top row)* | `search` | Reserved for the keyboard-shortcut / "more"-menu entry point, § Header |
| GL tree group disclosure; lots security pull-down | `chevron-down` (open) / `chevron-right` (closed) | Same pair for every disclosure row |
| Custodial cross-reference badge (GL tree, register) | `landmark` | Same glyph as the Custodial Accounts nav item |
| GL account badge (register) | `book-text` | Same glyph as the General Ledger nav item |
| Provider dialog: Refresh token | `key` | |
| Provider dialog: Unlink | `link-2-off` | `--destructive` text |
| Entities: Invite member | `user-plus` | |
| Entities: Create entity | `plus` | |
| Entity type badges: Person / Household / Trust / Business | `user` / `house` / `landmark` / `building-2` | Per § Entity, account, and category badges |
| Admin: operator-session badge | `terminal` | |
| Login: reveal password | `eye` (`eye-off` when revealed) | |
| Get started: "I have an invite" card | `mail` | |
| Get started: "I'm setting up my own instance" card; walkthrough Requirements | `server` | |
| Walkthrough: Deploy / First operator sign-in / Invite members | `terminal` / `log-in` / `user-plus` | |
| Get started: Create your account / Start the walkthrough | `arrow-right` / `arrow-down` | Trailing icon inside the button |
| Sign up: valid-invite badge | `circle-check` | |
| Login: Continue with Google | **not Lucide**: the Google "G" mark, four-colour | Google's own brand glyph on the dark button, as its sign-in branding asks |
| Brand mark (sidebar brand row, rail expand button, app bar, Login, Home) | **not Lucide**: `brand/brand-mark-24.svg` / `brand/brand-mark.svg` | The seedling, traced; the one deliberate non-Lucide glyph |

Every icon in use is named above. Add a row whenever a new control lands, rather than guessing ahead of the actual screen.

**Empty-state pattern (ARCH §2.4 — Dashboard ships in M3 with the tax panel empty until 1.0, allocation panel empty until M4):** an empty panel keeps its real card chrome (eyebrow label, card shape, dashboard-scale padding) and states plainly that the feature isn't set up yet, in `--muted-foreground` body text — no illustration, no skeleton (a skeleton implies "loading," not "not built yet" — conflating the two is misleading). **Copy never names an internal milestone or version id** — "Not set up yet," not "Available in v1.0"/"Available at M4": neutral copy survives however OQ-8 (0.x releases) resolves, without leaking internal roadmap language to a user. Example: the tax-liability card shows the eyebrow "PENDING TAX LIABILITY" and "Not set up yet" — the same card shape as the live version will have, so the dashboard's layout doesn't visibly shift when the feature ships. See `styled-screens/dashboard.html` for the built example.

**Still ours to set:** reduced-motion policy; loading-state discipline (per-feature).

---

## shadcn-svelte reuse map

"How much of shadcn-svelte's components and blocks are we reusing? Ideally we would stick to the already designed stuff as much as possible for stability." Answered here, directly: every component and screen region in this system, mapped to the shadcn-svelte component or official block it's built from, or `custom` with one line why. The bias throughout is toward an existing component/block over a bespoke build — `custom` rows are the exception, not the default, and each states what shadcn-svelte doesn't already cover.

**Registry, version, and vendoring:** shadcn-svelte (https://shadcn-svelte.com, the Svelte port of shadcn/ui) follows shadcn's own distribution model — components are **copied into the repo** via `bunx shadcn-svelte@latest add <name>` (see Component inventory, above), not installed as a versioned npm dependency. There is no single "shadcn-svelte version" pin the way there is for a normal package — each component is vendored source, owned and modified in-repo once added. **What is pinned:** the `shadcn-svelte` CLI/registry version used *at the moment each `add` command runs*, recorded as a decision in `process/DECISIONS.md` by frontend-lead at Implement kickoff (not a design-time decision — this spec fixes *which* components/blocks to use, not which CLI version generates them). Official **blocks** (pre-assembled multi-component screens — sidebar, dashboard, login blocks) are vendored the same way and are the preferred starting point wherever one exists close to our own screen shape.

| Component / region | shadcn-svelte component or block | Notes |
|---|---|---|
| App shell (sidebar + top row) | **Sidebar**, specifically the **sidebar-07** block (`https://ui.shadcn.com/view/new-york-v4/sidebar-07`) | Direct reuse — our brand row ≈ its `SidebarHeader` (team-switcher slot), nav ≈ `SidebarMenu`, avatar trigger + right-opening popover ≈ its `SidebarFooter` pattern almost exactly. Its `SidebarTrigger` is replaced by the brand-row collapse/expand buttons calling the same `toggleSidebar()` |
| Avatar popover (user menu) | **Popover** + **DropdownMenu** (the popover is the container; its items are a DropdownMenu's item list) | Matches sidebar-07's footer example (avatar + name, opens a menu to the side) closely; two items (Settings, Notifications) are **proposed** |
| Breadcrumbs | **Breadcrumb** | Direct reuse — single-crumb pages render a one-item Breadcrumb |
| Top row separator | **Separator**, vertical orientation | One, before the "more" menu |
| "More" menu (top row) | **DropdownMenu**, triggered by an `ellipsis-vertical` icon button | Same primitive as the avatar popover, different trigger and contents (per-page global actions, not the user menu) |
| Search *(proposed entry point)* | **Command** (the `⌘K`-style command palette primitive) | Not a top-row icon — proposed as a keyboard shortcut + a "more"-menu entry, opening the same Command dialog either way; the keyword/account/report-view search domains are three command groups within it |
| Notification centre *(proposed entry point)* | `custom` | No official shadcn-svelte notification-center block exists; built from **Popover** (container) + **Badge** (unread count) + plain list markup. Its entry point is the avatar popover, proposed |
| Settings *(proposed entry point)* | **Button** (icon variant), inside the avatar popover | A plain nav affordance (page link, not a menu) nested inside the avatar `DropdownMenu` |
| AI/Agent | — | No entry point proposed yet — not a component-mapping question until there's a surface to map |
| Icon library | **lucide-svelte** (`https://lucide.dev`, shadcn-svelte's own icon set) | Every icon in § Icon inventory names its exact `lucide-svelte` component |
| Entity selector | `custom` | shadcn-svelte has no "entity switcher" block; closest primitive is **DropdownMenu**, but the avatar-cluster trigger is bespoke (no shadcn component composes avatars this way) |
| Avatar cluster | `custom` | Overlapping-avatars-with-overflow-chip is a known pattern (Origin, Monarch, GitHub) but not a shadcn-svelte component; built from **Avatar** primitives, manually overlapped |
| KPI / stat cards | **Card** | Direct reuse everywhere |
| Net-worth hero chart | **Chart** (LayerChart-backed `Chart` component, Area variant) | Direct reuse |
| Grouped account list | **Table**, `custom` grouping | Table primitive; the type-group header + sparkline + freshness row composition is ours |
| Segmented bar + legend | `custom` | No shadcn equivalent; tokens-driven custom component |
| Badge (status, role, link-health) | **Badge** | Direct reuse, variants only |
| Accordion (Transactions' 3 cards) | **Accordion** | Direct reuse |
| Pending row expansion | **Accordion** (nested item), **Select** (suggested-offset inline search) | The two-leg preview itself is custom content inside an Accordion item |
| Split grid | `custom` | A dynamic multi-row form grid with live-sum validation; no shadcn block matches |
| Bulk action bar | `custom` | A "floating selection toolbar" pattern (seen in many apps) but not a shadcn-svelte component |
| Journal-entry modal | **Dialog**, sized near-full-screen | Direct reuse — a non-default Dialog size, not a different primitive |
| Transaction/account-register tables | **Table** | Direct reuse |
| Chart-of-accounts tree | `custom` | No shadcn tree component; built from nested disclosure rows (could adopt a community tree primitive later if one matures) |
| Lots sub-card pull-down | **Collapsible** | Direct reuse — a simpler primitive than Accordion for a single expand/collapse row |
| Settings on/off preferences | **Switch** | Direct reuse |
| Settings theme picker (Light / Dark / Auto) | **Toggle Group** (single) | Rendered with the `.tabs` look; semantically a radio group, not tabs |
| Brand app bar (Home, Membership setup, Admin) | `custom`, with **Button** / **Badge** / **Avatar** for the trailing items | One component for every shell-less page: a fixed bar with a lockup, trailing items and a fade; too small and too brand-specific to be a block. No sidebar because no entity exists (setup), none applies (operator), or the visitor is not signed in (Home) |
| Register / any wide table | **Table** (its own overflow-x wrapper) | `.table-wrap` mirrors shadcn Table's built-in scroll container, so a wide table scrolls inside its card at 960px instead of spilling |
| Allocation actual-vs-target track | `custom` on **Progress** | A Progress track plus a target marker; shadcn Progress has no marker |
| Provider-item dialog | **Dialog**, **Tabs** (source-type picker), **Select** (account mapping) | Composed from three existing primitives, no custom chrome |
| Tabs (nominal/real toggle, Totals/Percent, Reports statements) | **Tabs** | Direct reuse |
| Transaction detail drawer | **Sheet** | Direct reuse |
| Select / Combobox (category, tax-treatment, jurisdiction) | **Select**, **Combobox** | Direct reuse |
| Toasts (import complete, entry posted, reconciliation break) | **Sonner** | Direct reuse |
| Progress (import batch, safe-harbor paid-vs-required) | **Progress** | Direct reuse |
| Skeleton | **Skeleton** | Direct reuse |
| Tooltip (icon-button titles, truncated text, the rail's "Expand sidebar") | **Tooltip** | Direct reuse — used wherever an icon-only control needs a text label on hover |
| Landing illustration (Home) | `custom` | A full-bleed decorative image under the brand app bar; no shadcn block fits |
| Split-screen login | shadcn-svelte's own **login block** (`https://shadcn-svelte.com/blocks/login`, the two-pane pattern) as a starting point, customized | The split-screen login reference the Principal supplied is close to this official block's shape; adopted as the base rather than built from scratch, then customized for our exact field list (§ Public screens: Home & Login) |

**What's deliberately `custom` and why that's still "sticking to the designed stuff":** every `custom` row above is custom because shadcn-svelte genuinely has no matching primitive or block — not because an existing one was skipped. Each is built *from* shadcn-svelte primitives (Avatar, Popover, Card, Button) rather than from scratch, so the stability this is after — consistent tokens, consistent interaction patterns, one accessibility baseline — still holds even where the composition itself is ours.

---

## Screen list

**One fidelity tier.** Every page is a styled screen in `styled-screens/`, on `tokens.css` + `screen.css` and the sidebar-07 shell. Each screen supports light and dark (`.dark` on `<html>`) and must render with no console errors and no overflow at 960px and 1280px. That is the review check, run headless in both modes.

| Screen | File | Shell | Shown open as reference |
|---|---|---|---|
| Dashboard | `dashboard.html` | sidebar | "more" menu, avatar popover |
| Transactions | `transactions.html` | sidebar | "more" menu, expanded Pending row, split grid, bulk bar, journal-entry modal |
| General Ledger | `general-ledger.html` | sidebar | — |
| Account register | `account-register.html` | sidebar (multi-crumb) | — |
| Custodial Accounts | `custodial-accounts.html` | sidebar | lots sub-card (AAPL pulled down), provider-item dialog |
| Allocation | `allocation.html` | sidebar | — |
| Reports | `reports.html` | sidebar | dimmed statement previews (review only, not shipped) |
| Entities | `entities.html` | sidebar | — |
| Settings | `settings.html` | sidebar, no nav item active | avatar popover with Settings current |
| Home | `home.html` | none (public) | — |
| Login | `login.html` | none (split screen) | — |
| Get started | `get-started.html` | brand app bar | — |
| Sign up | `sign-up.html` | none (split screen) | invite code pre-filled and validated |
| Membership setup | `membership-setup.html` | brand app bar | — |
| Admin *(operator surface)* | `admin.html` | brand app bar + operator badge | — |

## Public screens: Home & Login

**Home is the public landing page a visitor sees before authentication, not a signed-in screen.** There is no signed-in entity-picker page: for a multi-entity user, entity selection is the top row's entity selector (§ Header), which is sufficient. Login is the **"split screen login page"** pattern by name, with a fully specified form-pane content list.

### Home — public landing page

**What it is:** the marketing/landing page a visitor sees before signing in — not a Dashboard, not authenticated, no ledger data. Top to bottom:

- **Brand app bar** at the top (see **Brand app bar**, below): neon lockup left; **Get started** (neon fill, near-black ink) and **Sign in** (outline) right; the deep fade, so the illustration rises out of the black.
- **The mountains illustration** (`.landing-art`), full width, 560px tall (360px below 760px), starting directly under the bar. At rest, the bar's fade lies over the image's top edge and the sky shows through it. Neon and near-white text sit only on the bar's solid black, never on the sky.
- **Headline and subhead** (`.landing-intro`), then the **three feature call-outs** and a minimal **footer**. These follow the user's stored theme like the rest of the app.

Clearance, keyboard order and the edge-to-edge background come from the brand app bar (below).

**Image:** `brand/polycarpic-bg-mountains.jpeg` (1600w, 242 KB) and `polycarpic-bg-mountains-3200.jpeg` (3200w, 607 KB), served by `srcset` with `sizes="100vw"`. Both are derived from a 4096px Real-ESRGAN (Upscayl, digital-art) upscale; no smaller original exists, and the PNG is not committed. Decorative: empty alt, hidden from assistive tech.

See `styled-screens/home.html`.

### Brand app bar

The one top bar of every page without the app shell: Home, Membership setup, Admin. Markup: `<body class="has-brand-bar">` with `<header class="brand-bar">` first in the DOM.

- **The bar:** fixed, near-black `#070907` (the brand's dark surface, the same in both themes), 72px tall (64px below 760px).
  - Left: the lockup (`.brand-bar-lockup`), a link, in the literal `--brand` (14.72:1).
  - Right: the page's trailing items, re-inked for the black bar — Home's Get started + Sign in, Membership setup's account avatar button, Admin's operator-session status badge.
- **The fade:** hangs under the bar and moves with it, so the page scrolls under the black and emerges through the gradient. Neon and near-white text only ever sit on the bar's solid black.
  - Over Home's illustration: deep (88px, black → transparent), so the image rises out of the black.
  - Over a plain page background (`.brand-bar--plain`): short (28px, starting at 28% black). A deep black fade on the light page reads as a dirty smear; the short one reads as the bar's shadow.
  - Dark mode: the page is already near-black, so the plain fade is close to invisible and a 1px hairline marks the bar's edge.
- **Clearance:** the body pads by the bar's height, so nothing renders under the bar at rest; `scroll-padding-top` keeps anchors and focus scrolling clear of it.
- **Keyboard order:** the bar is first in the DOM, so Tab goes lockup, trailing items, then the page.
- **Background:** the page paints `--background` edge to edge (the global body canvas is `--muted`, which differs in dark mode).

See `styled-screens/home.html`, `styled-screens/membership-setup.html`, `styled-screens/admin.html`.

### Get started and Sign up

There is no public sign-up: every instance is self-hosted, and accounts on it come by invitation from an entity owner. Home's "Get started" therefore leads to a fork, and Login's account line offers the same two branches. See flow 5.6.

- **Get started** (`get-started.html`, brand app bar with Sign in on the right): one page, not a modal. On top are two cards:
  - "I have an invite", which leads to Sign up (primary button);
  - "I'm setting up my own instance", which scrolls to the walkthrough (`dark` button).

  The walkthrough sits directly below as four numbered steps: requirements, deploy, first operator sign-in, invite members. It is an outline that grows as the deployment docs are written.
- **Sign up** (`sign-up.html`, Login's split layout with its own visual pane, the sunrise; see **Visual-pane image sources**), invite-gated:
  - Fields, in order: the invite code, then the account (the `dark` Google button, or email + password).
  - From an invite link, the code arrives pre-filled and validated, with a line naming who invited the visitor and to which entity. An invalid or used code shows an inline error under the field.
  - "Create account" hands off to Membership setup, where the invited entity is waiting.
  - Footer: "Already have an account? Sign in", then "No invite? Set up your own instance".
- **Login's account line:** "Have an invite? **Create your account**" leads to Sign up; "No invite? **Set up your own instance**" leads to Get started.

### Login — split screen login page

Two references: `useorigin.com`'s own login (dark, brand pane + form card — behind a splash loader under automation, no direct capture) and a split-screen login example the Principal supplied (form pane left with a labeled email/password pair, a "Forgot password?" link and a reveal-eye icon, OAuth button, divider, primary button, sign-up link, legal footer at the very bottom; a full-bleed moody photo right, inset with rounded corners and a margin rather than flush to the viewport edge).

**Form pane content, in order:** mark + wordmark (top-left), "Welcome back" heading + one-line subtext, an OAuth button, a divider ("or"), email field (labeled), password field (labeled, with a "Forgot password?" link and a show/hide reveal icon), primary "Sign in" button, the two-way account line ("Have an invite? Create your account" / "No invite? Set up your own instance"), and a legal footer ("By signing in you agree to...") at the bottom.

**OAuth button:** "Continue with Google" is a `dark` button with the Google G glyph, not an outline one; see the Button row in § Component inventory for why.

**Ours, adapted:**
- **Form pane:** sits on the theme-aware neutral (`--card`/`--background`) — follows the user's stored light/dark preference like the rest of the app, unlike the visual pane. The heading, subtext, and fields are centered both vertically and horizontally as a fixed-max-width (380px) column within the pane; the mark + wordmark is the one element pinned top-left, overriding the pane's own centering. Field labels, inputs, and links stay left-aligned *within* that centered column (only the heading/subtext text itself is center-aligned) — centering every line of text, including form labels, would read oddly for a form.
- **Visual pane:** always carries the brand identity regardless of the user's theme preference — inset with rounded corners and a margin, matching the captured reference's proportions rather than flush edges. It shows the forest illustration, `brand/polycarpic-bg-forest.jpeg` (dark-green illustrated forest, a cabin with chimney smoke, a glowing sky-blue stream and plants along the bottom third), as an `<img class="visual-art">` with `object-fit: cover`. The pane is tall and the art is square, so the sides crop; `object-position: 78% 70%` keeps the cabin and the whole stream in frame from a 960px viewport (pane ~456×852) up. The pane carries no caption: the illustration stands on its own, and nothing overlays it; the pane's own background is the art's deep green (`#0D2E07`) while the image loads. The image is decorative (`alt=""`, `aria-hidden`). See **Visual-pane image sources** below.
- **Responsive:** collapses to a single stacked pane (form only, visual pane hidden) below the phone-width breakpoint — a login form doesn't need to fight a hero image on a 375px-wide screen.

**Visual-pane image sources.** Three JPEGs in `brand/`, served by `srcset` width descriptors with `sizes="(min-aspect-ratio: 2/1) calc(50vw - 24px), calc(100vh - 48px)"`. Because the art covers the pane, its rendered side is the larger of the pane's height and width, and width wins only on viewports wider than about 2:1. The browser multiplies that side by the device pixel ratio and picks:

| File | Pixels | Size | Picked when (measured in headless Chrome) |
|---|---|---|---|
| `polycarpic-bg-forest.jpeg` | 1024 | 156 KB | 1× desktops (960×900, 1280×900: pane 852px tall) — the original export |
| `polycarpic-bg-forest-2048.jpeg` | 2048 | 527 KB | 2× at 1280×900 (needs 1704px); 1× ultra-wide 2560×1000 (pane 1256px wide) |
| `polycarpic-bg-forest-3072.jpeg` | 3072 | 575 KB | 2× at 1440×1440 (needs 2784px); 3× screens |

The 2048/3072 files come from a 3× Real-ESRGAN upscale of the 1024px original (Upscayl, digital-art model), encoded as progressive JPEG (quality 95 and 89, chosen to land in a 400–700 KB budget). The upscale is faithful in structure. Compared with the original it carries a slight teal/saturation lift: hue +3–5°, saturation up to +7% in the glow plants and stream, lightness unchanged; mean difference 2–4/255 per channel. It also has cleaner, slightly simplified leaf edges, a faint light rim around the glow plants, and a few isolated single specks in the canopy. None of these reads at panel size. A native high-resolution export from the source artwork would remove them, if one is ever produced. The lossless 3072px PNG upscale is not committed.

**Sign up's pane** shows the sunrise over the peaks (`visual-art--sunrise`), so joining an instance reads differently from returning to it. The art is portrait (3:4), so `cover` crops the sides; `object-position: 50% 62%` keeps the sun and the lit peaks centred at 960 and 1280. Because the image is not square, its `sizes` differs from Login's: the rendered width is the pane height × 0.75, or the pane width on viewports wider than about 3:2 (`sizes="(min-aspect-ratio: 3/2) calc(50vw - 24px), calc((100vh - 48px) * 0.75)"`). With the square formula, a 3× screen would fetch the 3072 file where the 2048 covers it.

| File | Pixels | Size | Picked when (measured in headless Chrome) |
|---|---|---|---|
| `polycarpic-bg-sunrise-tall.jpeg` | 1024×1371 | 290 KB | 1× desktops (960×900, 1280×900: needs ~640px) |
| `polycarpic-bg-sunrise-tall-2048.jpeg` | 2048×2743 | 690 KB | 2× at 1280×900 (needs ~1280px); 3× at 1280×900 (~1920px); 1× ultra-wide 2560×1000 (pane 1256px wide) |
| `polycarpic-bg-sunrise-tall-3072.jpeg` | 3072×4114 | 917 KB | 2× at 1440×1440 (needs ~2090px) |

The 1024 file is encoded from the 1792×2400 original; the 2048/3072 files from its 2× Real-ESRGAN upscale (Upscayl, digital-art model). All are progressive JPEGs under 1 MB. Neither source file is committed.

**Masters** (the original exports and the Upscayl PNGs) are kept outside the repo and are not tracked; only the encoded JPEGs above are committed.

See `styled-screens/login.html`.

---

## Screen data contract

For architect's Screen DTO work (ARCH §2.4, OQ-11 resolved in outline). Model constraints: amounts are signed per line with Dr/Cr derived for display; drafts are separate from posted entries and posted entries are immutable; Cash-in-Transit open items get an exceptions view; access comes from membership only (no parent/child inheritance); `import_batch` holds new/duplicate/needs-category counts.

This mirrors ARCH §2.4's screen→DTO table exactly — the DESIGN-owned half of that same contract, not a second source of truth.

| Screen / surface | Data shown | DTO(s) → owning package | Milestone note |
|---|---|---|---|
| Dashboard | Net worth + delta; cash-flow by period; recent activity; pending tax liability + safe-harbor gap; allocation actual-vs-target | `NetWorthSeries`, `CashFlowByPeriod`, `RecentActivity` → ledger; `TaxPosition` → tax; `AllocationVsTarget` → portfolio | M3 (panels fill in at M4 and 1.0) — see Component inventory § Empty-state pattern |
| Transactions — three accordion cards (Exceptions, Pending, Posted), each with a "show N" limit | Aged CIT exceptions + link-health banners; the Pending review/match inbox (locked custodial leg + suggested offset leg); posted, paged journal entries with correction badges; import stats/status | `ExceptionList`, `PendingInbox`, `ImportStatus` → posting + import; `PostedJournal` → ledger | M2 (CIT exceptions in M3) |
| Journal-entry modal (header + legs) — split, group, manual "+ New entry", "Correct entry" | Entry draft in, posting-gate result out | `EntryDraft` in, `GateResult` out → posting | M2 |
| General Ledger — chart-of-accounts tree | Category → account → sub-account, balances, custodial marker | `ChartTree` → ledger | M2 |
| General Ledger — account register page | Lines on one account, date order, running balance, link to entry | `AccountRegister` → ledger | M2 |
| Custodial Accounts | Balance, reconciliation status, link-health badge; lots sub-card per security (lots, short/long/total unrealized gain, per lot and summed) | `CustodialAccountList` → posting + import; `LotsCard` → securities | M3 (lots card at M4) |
| Provider-item dialog (New provider item on Custodial Accounts) | Source type (aggregator / broker API / file / manual); discovered accounts mapped to custodial accounts; token refresh; unlink + revocation-lag note | `ProviderItem` → import | M2 (fake + file); real aggregators at 1.0 |
| Sync (Transactions, Custodial Accounts) / "Import file" | Job status; on Custodial Accounts also pulls balances and positions | `SyncRequest` → import | M2 |
| Allocation | Actual vs. target allocation; target editor | `AllocationVsTarget`, target editor → portfolio | M4 |
| Reports | Balance Sheet, Income Statement, Cash Flow; NAV and NAV delta | `ReportTable` → reports | M5; empty state until then |
| Entities | Entity list; memberships; invite action | `EntityList`, `MembershipList`, invite command → tenancy | M1 |
| Settings | Per-entity batch-import schedule and options; app preferences | `ImportSchedule` → import; app preferences → tenancy | M2 |
| Home | **No DTO** — public landing page, static marketing content, unauthenticated, no membership/ledger data at all | — | Not a package concern |
| Login | Unauthenticated — email/password, OAuth provider list (Google/Apple/GitHub, PRD §8); no ledger data | → `packages/auth` | |

---

## Provenance & shared tooling

polycarpic's own `cairn` tracker (`scripts/cairn/`) is a separate shadcn-svelte app with its own vendored preset and its own generated theme-variant pipeline. **This product's palette does not inherit cairn's tokens** — it's a fully separate identity derived from Monarch/Origin measurements. A CI assertion of token parity with cairn's board (`scripts/cairn/tests/test_board_tokens_parity.py`) was removed (POLY-78); cairn's generated `variants.css` belongs to cairn's generator, not to `docs/DESIGN/`.

---

## Accessibility

**Target: WCAG AA.** Every pair below is computed via the standard WCAG relative-luminance formula against the exact hex values in `tokens.css`. See `tokens.html` for every token's value in both modes with a rendered swatch, alongside this written derivation.

**The brand app bar's and Login's visual-pane colors are not new values** — `.brand-bar`/`.auth-visual-pane` use the same hex already verified in the dark-mode table below rather than reading `.dark`-scoped tokens, since these two surfaces are deliberately always-dark regardless of the page's own theme.

**Light mode — text pairs (floor 4.5:1), all PASS (canvas = `--muted` = `#F9F8F8`, hover fill `--accent` `#EBF4F9`):**

| Pair | Contrast |
|---|---|
| `--foreground` / `--background`(=`--muted`) · `--card` · `--accent` | 15.61:1 · 16.55:1 · 14.85:1 |
| `--primary-foreground` / `--primary` (fill) | 5.04:1 |
| `--primary` / `--background` · `--card` · `--accent` (text, e.g. links, row actions) | 4.75:1 · 5.04:1 · 4.52:1 — `--accent` is the binding pair that sets `#148100` (one notch lighter is 4.30:1 there) |
| `--secondary-foreground` / `--secondary` (fill) | 4.72:1 |
| `--secondary-foreground` / `--background` · `--card` | 5.17:1 · 5.48:1 |
| `--accent-foreground` / `--accent` (hovered text/icons) | 4.92:1 |
| `--muted-foreground` / `--background` · `--card` · `--accent` | 6.45:1 · 6.84:1 · 6.14:1 |
| `--muted-foreground` / `--secondary` | 5.89:1 |
| `--destructive-foreground` / `--destructive` | 5.09:1 |
| `--destructive` / `--background` · `--card` · `--accent` (text, incl. hovered "Log out") | 4.80:1 · 5.09:1 · 4.57:1 (one notch lighter is 4.27:1 on `--accent`) |
| `--positive-foreground` / `--positive` (fill) | 5.08:1 |
| `--positive` / `--background` · `--card` · `--accent` (text, incl. hovered table rows) | 4.80:1 · 5.08:1 · 4.56:1 (one hex step lighter is 4.4999:1 on `--accent`) |
| `--sidebar-foreground` / `--sidebar` | 13.87:1 |
| `--sidebar-accent-foreground` / `--sidebar-accent` | 10.28:1 |
| `--warning-foreground` / `--warning` (fill) | 5.54:1 |

**Light mode — non-text pairs (floor 3:1):**

| Pair | Contrast | Result |
|---|---|---|
| `--ring` / `--background` · `--card` | 4.75:1 · 5.04:1 | PASS |
| `--primary` icon / `--accent` (`.icon-btn.active`) | 4.52:1 | PASS |
| `--sidebar-ring` / `--sidebar` | 6.00:1 | PASS |
| `--sidebar-brand` / `--sidebar` (brand mark) | 11.39:1 | PASS |
| `--chart-1`…`--chart-5` / `--card` | 3.26:1 → 6.63:1 | PASS all 5 |
| `--chart-1`…`--chart-5` / `--background` (= `--muted`) | 3.07:1 → 6.26:1 | PASS all 5 |
| `--chart-1` / `--accent` | 2.92:1 | **Below floor** — no chart inside a hover fill |
| `--warning` / `--card` · `--background` (border/icon use) | 3.20:1 · 3.02:1 | PASS |
| `--warning` / `--accent` | 2.87:1 | **Below floor** — a bare warning icon on a hovered row needs its label |
| `--card` / `--background` | 1.06:1 | Surface step, not a content pair — cards also carry the `--border` hairline |
| `--muted` / `--card` | 1.06:1 | In-card wells/tracks/placeholders (`--muted` = page) |
| `--accent` / `--background` · `--card` | 1.05:1 · 1.12:1 | Hover/active fill, visible on both |
| `--border` / `--card` · `--background` | 1.29:1 · 1.22:1 | Below floor — decorative hairline, accepted |
| `--input` / `--card` | 1.42:1 | Below floor — same posture as `--border` (the field's label and placeholder carry identification) |
| `--brand` / `--background` | 1.29:1 | **Expected fail** — never a light-surface fill/text |
| `--brand-2` / `--background` | 2.44:1 | **Expected fail** — same rule |

**Dark mode — text pairs (floor 4.5:1), all PASS:**

| Pair | Contrast |
|---|---|
| `--foreground` / `--background` | 17.92:1 |
| `--primary-foreground` / `--primary` (fill) | 14.72:1 |
| `--primary` / `--card` (text-only) | 14.18:1 |
| `--secondary-foreground` / `--secondary` (fill) | 5.95:1 |
| `--secondary-foreground` / `--card` (text-only) | 9.83:1 |
| `--muted-foreground` / `--muted` | 7.76:1 |
| `--muted-foreground` / `--card` | 7.92:1 |
| `--accent-foreground` / `--accent` | 5.46:1 |
| `--destructive-foreground` / `--destructive` | 5.67:1 |
| `--sidebar-foreground` / `--sidebar` | 15.55:1 |
| `--sidebar-accent-foreground` / `--sidebar-accent` | 4.72:1 |
| `--positive-foreground` / `--positive` (fill) | 8.93:1 |
| `--warning-foreground` / `--warning` (fill, same dark ink as light mode) | 8.11:1 |

**Dark mode — hover fills, text pairs, all PASS:**

| Pair | On the row-hover tint `#12232C` | On the "Log out" tint (20% `--destructive` over `--popover`) |
|---|---|---|
| `--foreground` | 14.41:1 | — |
| `--destructive` | 4.89:1 | 4.64:1 |
| `--muted-foreground` | 6.61:1 | — |
| `--positive` | 9.64:1 | — |
| `--primary` | 11.83:1 | — |

**Dark mode — non-text pairs (floor 3:1):**

| Pair | Contrast | Result |
|---|---|---|
| `--ring` / `--card` | 14.18:1 | PASS |
| `--sidebar-ring` / `--sidebar` (derived blue ink) | 4.51:1 | PASS |
| `--sidebar-brand` / `--sidebar` (brand mark) | 4.73:1 | PASS |
| `--brand-2` / `--background` | 7.76:1 | PASS — this dark surface is exactly what `--brand-2` is for |
| `--chart-1`…`--chart-5` / `--card` | 5.04:1 → 15.12:1 | PASS all 5 |
| `--chart-1`…`--chart-5` / `--background` | 5.23:1 → 15.69:1 | PASS all 5 — light mode sets the ramp's floor |
| `--warning` / `--card` | 8.84:1 | PASS |

| Concern | Standard / approach |
|---|---|
| Color contrast | WCAG AA — measured, every pair, both modes |
| Color-alone signaling | Never — delta always carries a sign/arrow (see Financial semantics) |
| Keyboard | shadcn primitives ship this by default |
| Screen readers | Semantic markup; delta sign readable from text content |
| Motion | Respect `prefers-reduced-motion` (open item) |

**Open items:**
- No CVD simulation run on the palette yet — two brand hues (green 110.6°, blue 200.6°) to check; high priority, since both carry meaning.
- `--border`/`--card` is a low-contrast hairline by design (1.29:1) — decorative, consistent with common practice.
- `--warning` and `--chart-1` fall under 3:1 only on an `--accent` hover fill (2.87:1 / 2.92:1) — no chart inside a hover; a bare warning icon on a hovered row keeps its label.
- Reduced-motion policy not yet written.
- Radius-xl (sheets) not measured against either reference — extrapolated.

---

## Open questions

- Native iOS/macOS token export format (kickoff §2.10) — not yet decided, non-blocking for web.
- Categorical (3+ hue) chart palette for transaction-category breakdowns — deferred until a concrete chart spec exists.
- Compare `styled-screens/dashboard.html` against Monarch Money's Accounts screen (https://www.monarchmoney.com) component-by-component once frontend-lead builds the real screen.
- **CVD check on the brand hues:** flagged in Accessibility — two brand hues (green, blue) to check, not yet simulated.
