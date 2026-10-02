# Design System Spec

> The written companion to `tokens.css` + `screen.css`. The CSS files are the machine-readable source of truth; this doc explains the *why* and the usage rules. Owned by the `ux-designer` agent. Generate/refine with `/generate-designdoc`.

**Revision history:** Pass 1 (2026-09-28) inherited the cairn tracker's own palette — rejected, diverging from cairn is the goal. Pass 2 (2026-09-28) hand-authored an indigo/violet identity "inspired by" Monarch Money and Origin from general/training knowledge — rejected: the guessed hue matched neither product, and "Origin" was misidentified. Pass 3 (2026-09-28) derived a blue-primary, warm-neutral palette from team-lead's measured screenshots of the actual products (`temp/design-refs/`) — accepted as the base, most of **Inspiration** and **Typography** below is still that pass's work and still current. Pass 4 (2026-09-30) is the Principal's first review of the pass-3 result: the brand hue becomes neon green (`#2CFF05`), the neutral scale replaces warm/brown with a faint tint of that hue, the sidebar inverts, the shell layout changes (full-width header, sidebar below it), and two new screens (Home, Login) are added. Pass 5 (2026-09-30) adds a secondary blue brand hue (`#05A9FF`), re-tints the neutral scale and sidebar from green to that blue (less saturated), and fixes the flows section not rendering. **Pass 6 (2026-10-01)**, Principal review 4: `--warning` becomes a genuinely orange hue paired with dark ink (not a white-text-forcing darkened brown); the light-mode chart ramp brightens across all 5 steps (the old tail read as "almost black"); a new `tokens.html` example page decodes every token with swatches in both modes and a "used for" line; the Login wireframe is corrected to match the centered styled screen; a dashboard first-run/empty-state wireframe (the membership-setup page) is added and linked from flow 5.1; the skeleton-vs-spinner bullet is answered in plain words; flow 5.2 is reframed around what the user experiences (a "Correct entry" action with a badge and a struck/shaded reversal on click-through, the underlying reversal-only mechanism unchanged); flow 5.3 is redrawn so the app never initiates a payment — the user pays their bank, the payment lands as an imported transaction with no counterparty, and they post it against the custodial tax-authority account, which is what the gap is measured against. See **Foundations**, **Financial semantics**, the flow sections, and `tokens.html` for the detail. **Pass 7 (2026-10-02)** reworks the sidebar's information architecture end to end, per an interview with the Principal (`temp/2026-10-02-sidebar-interview.md`): "Ledger" becomes **Transactions** (three urgency-ordered accordion cards — Exceptions, Pending, Posted — the Pending card rebuilt around the Principal's Plaid bank-feed review/match workflow); "Accounts" splits into **General Ledger** (a chart-of-accounts tree + per-account register page) and **Custodial Accounts** (physical accounts, reconciliation, and a new lots sub-card absorbing "Securities"); **Allocation** and **Reports** become their own items; **Settings** is new; "Securities" and "Import" are gone as nav items. See **Sidebar information architecture**, and the **Screen data contract**; the Pending-inbox workflow mechanics (expansion panel, split grid, bulk-group modal) land as their own pass alongside the rebuilt Transactions screen. **Pass 8 (2026-10-02, this revision)**, Principal review 5: the app shell rebuilds on the shadcn Sidebar component's own pattern — the sidebar fills the viewport height (`position: fixed`, not `sticky`), carries the brand as its top item and an avatar-popover user menu as its bottom item, and drops to seven nav items as **Settings** moves to a header gear icon. The header now starts right of the sidebar: an expand/contract icon + breadcrumb on the left, entity selector/AI-icon/search/notifications/gear on the right. A new **shadcn-svelte reuse map** (below) answers which shadcn-svelte component or block backs every piece of this system. See **Layout & shell**, **Header**, **Sidebar**, and **shadcn-svelte reuse map**.

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

**Pass 4 (2026-09-30): brand hue is neon green.** The Principal's own choice: `#2CFF05`, "since the project name relates to fruiting plants... likely a dominant color in the logo." Measured: hue 110.6°, full saturation, L 0.51, **relative luminance 0.72 — only 1.36:1 against white**. Kept as the literal `--brand` value everywhere it measures well (dark surfaces, dark-mode `--primary`), with a darkened same-hue value (`#158500`, L 0.26) serving light-mode `--primary` — one number doing both the fill-with-white-text job and the plain-text-on-card job, both clearing 4.79:1.

**Pass 5 (2026-09-30): a second brand hue, sky blue.** The Principal: "Can we explore adding a secondary brand color? something in a desaturated blue would complement well like `#05A9FF`." Measured: hue 200.6°, full saturation, L 0.51 — **2.56:1 against the light background, same "fails as a light-surface fill/text" shape as the green brand.** Same resolution pattern: **`#05A9FF` is kept as the literal `--brand-2` value** (dark-surface/decorative use — the sidebar's focus ring, and the dark-mode half of the chart series-2 job, see **Secondary accent** below); **a darkened same-hue value (`#0078B8`, L 0.36) does the light-mode job** (`--secondary-foreground`, 4.72:1 on `--secondary`/5.48:1 on `--card`) instead of a separately-invented color.

**Neutrals re-tinted from green to blue, lighter (pass 5).** Pass 4 tinted every neutral (`--background`/`--muted`/`--border`/`--foreground`) at the green brand's hue, 6–14% saturation. The Principal: "the background: can we use the secondary blue shade above in the same style? A slight hint of the secondary color but much lighter" — and separately flagged the inverted sidebar as reading green-biased. **Both re-tinted to the new blue hue (200.6°) at a lower saturation than pass 4's green** (3–9%, vs. pass 4's 6–14%) — "much lighter" read as *less saturated*, not *higher lightness* (the lightness levels were already near-white/near-black; what the Principal was reacting to was how strongly the tint read as a hue at all). `--card` still stays true white/near-black, same "cards-on-tinted-canvas" convention as every prior pass.

**`--warning` becomes genuinely orange, paired with dark ink (pass 6).** The Principal's review: "Can we make this something that is more definitively Orange rather than brown? Please remind me what this token would be used for?" The prior value (`#B45309`, hue 26°) is in the orange hue range by number, but at L=0.371 with white text forcing it dark enough to clear 4.5:1, it reads as brown — the same trap destructive/positive avoid only because red and green stay legible when darkened; orange does not. **Fix: a true vivid orange (`#EA6A0A`, hue 25.7°, matching Monarch's own measured orange hue of 22° — see Inspiration) paired with a dark orange-black ink (`#2A1200`) instead of white.** One literal value does both jobs this system normally splits across two: 5.54:1 for fill-with-text, and (unlike `--brand`/`--brand-2`) 3.20:1 against `--card` too, so it also clears the non-text floor used directly as a border/icon color. Dark mode gets the same treatment, lightened for a dark surface (`#FF9452`, hue ≈23°) with the same dark ink (`#2A1200`) — not a white/dark flip like `--destructive`, because orange never pairs with white text AA-safely at a saturation that still reads as orange, in either mode. **Used for:** the caution status tier — an aged Cash-in-Transit exceptions-window item, a stale provider link, or a safe-harbor due date more than 14 days out (see Financial semantics § Status tiers).

**Chart ramp brightened (pass 6).** The Principal: "Can we make the chart sequencing brighter? it is really dark, with the final few colors almost rendered as black." The light-mode ramp (hue 110.6°, S≈0.90) spanned L 0.300→0.061 — `--chart-5` at L=0.061 is genuinely close to black (17.73:1 against `--card`). Re-derived at L 0.34→0.18, same hue/saturation: `--chart-1` is now brighter than the old `--chart-1` (3.26:1 vs white, was 4.11:1) and `--chart-5` is far lighter than the old tail (8.78:1, was 17.73:1) — every step still clears the 3:1 non-text floor, with margin at both ends. Dark mode's ramp (`#C1FBB6`→`#29CB0B`, 8.87:1→16.32:1 against `--card`) was already bright — the "almost black" complaint was a light-mode-only symptom, left unchanged.

Contrast figures were computed via the standard WCAG relative-luminance formula against these exact hex values (script in `temp/`, full pair-by-pair results in **Accessibility**).

#### Light (`:root`) — primary/default mode

| Token | Value | Role |
|---|---|---|
| `--background` | `#FEFEFE` | Page background |
| `--foreground` | `#1D1F20` | Default body text — near-black, barely blue, flatter than pass 4's green-cast ink |
| `--card` | `#FFFFFF` | Card surface |
| `--popover` | `#FFFFFF` | Popover/dropdown surface |
| `--primary` | `#158500` | Primary action fill — darkened brand green, same hue as `--brand`, unchanged from pass 4 |
| `--primary-foreground` | `#FFFFFF` | Text on primary fill |
| `--secondary` | `#E3F0F7` | **Pass 5, re-hued.** Secondary button/surface — pale *blue* tint (was pale green in pass 4) |
| `--secondary-foreground` | `#096FA5` | Darkened `--brand-2`, same hue — see Secondary accent |
| `--muted` | `#F7F8F8` | Muted background — the "faint hint of the secondary color... much lighter" canvas tint |
| `--muted-foreground` | `#60686C` | Muted/meta text |
| `--accent` | `#EBF4F9` | Hover/active surface accent — same blue family as `--secondary` |
| `--accent-foreground` | `#096FA5` | |
| `--brand` | `#2CFF05` | Literal, undarkened neon green — logo, decorative highlights, dark-surface call-outs only; never text or a light-surface fill |
| `--brand-2` | `#05A9FF` | **Pass 5, new.** Literal, undarkened sky blue — same dark-surface-only rule as `--brand`; see Secondary accent for its job |
| `--destructive` | `#E70404` | Destructive fill — unchanged |
| `--destructive-foreground` | `#FFFFFF` | Text on destructive fill |
| `--border` | `#E7E8E9` | Default hairline border — blue-tinted (was green in pass 4) |
| `--input` | `#E7E8E9` | Input border |
| `--ring` | `#158500` | Focus ring — unchanged (primary green) |
| `--chart-1`…`--chart-5` | `#21A509` → `#125705` | **Brightened pass 6** (was `#1D9108`→`#061D02`, tail read "almost black") — sequential/magnitude ramp, brand green |
| `--sidebar` | `#1F2528` | **Re-hued pass 5** (was green `#20291F`) — inverted, a dark blue-tinted surface floating on the light page (see Sidebar) |
| `--sidebar-foreground` | `#F2F2F3` | |
| `--sidebar-accent` | `#303B40` | |
| `--sidebar-accent-foreground` | `#F2F2F3` | |
| `--sidebar-ring` | `#05A9FF` | **Re-hued pass 5** (was raw `--brand` green) — the raw secondary blue, to fully remove the green cast from this component |
| `--positive` | `#15803D` | Gain / income / surplus — unchanged |
| `--positive-foreground` | `#FFFFFF` | Text on positive fill |
| `--warning` | `#EA6A0A` | **Pass 6, re-hued true orange** (was brown-reading `#B45309`) — caution tier: aged CIT exceptions, stale provider link, safe-harbor due date >14 days out |
| `--warning-foreground` | `#2A1200` | **Pass 6, now dark ink** (was white — orange can't clear 4.5:1 with white without reading brown) |

#### Dark (`.dark`) — secondary mode

| Token | Value | Role |
|---|---|---|
| `--background` | `#070808` | Page background — pass 5, blue-tinted (was green `#070907`) |
| `--foreground` | `#F2F2F3` | Default body text |
| `--card` | `#0D0E0F` | Card surface |
| `--primary` | `#2CFF05` | The raw brand green itself — unchanged from pass 4 |
| `--primary-foreground` | `#070808` | Dark ink — clears 14.7:1; white on this bright fill only clears 1.4:1 |
| `--secondary` | `#173C4F` | **Pass 5, re-hued** (was pale green `#161F14`) |
| `--secondary-foreground` | `#68C3F3` | |
| `--muted` | `#0F1112` | |
| `--muted-foreground` | `#A0A7AB` | |
| `--accent` | `#194257` | |
| `--accent-foreground` | `#68C3F3` | |
| `--brand` | `#2CFF05` | Same literal value both modes |
| `--brand-2` | `#05A9FF` | Same literal value both modes |
| `--destructive` | `#FC4F4F` | Unchanged |
| `--destructive-foreground` | `#2A0507` | |
| `--border` | `rgba(255,255,255,0.08)` | |
| `--chart-1`…`--chart-5` | `#C1FBB6` → `#29CB0B` | Unchanged, brand green — already bright, pass 6's "almost black" complaint was light-mode-only |
| `--sidebar` | `#F7F8F8` | Inverted the other way — a light card floating on the dark page, reusing the light-mode canvas tone directly (now blue-tinted, so this stays consistent automatically) |
| `--sidebar-foreground` | `#1D1F20` | |
| `--sidebar-accent` | `#E3F0F7` | |
| `--sidebar-accent-foreground` | `#096FA5` | |
| `--sidebar-ring` | `#0078B8` | **Re-hued pass 5** (was `--primary` green) — the light-mode derived blue ink, since the raw `--brand-2` reads too close to this light sidebar's own near-white surface |
| `--positive` | `#52E0A4` | Unchanged |
| `--positive-foreground` | `#052E13` | |
| `--warning` | `#FF9452` | **Pass 6, re-hued true orange** (was mustard-reading `#F3CA59`, H=44°) — same hue family as light mode (≈23°), lightened for a dark surface |
| `--warning-foreground` | `#2A1200` | **Pass 6** — same dark ink as light mode (not a white/dark flip like `--destructive`; orange never pairs with white text AA-safely at a legible saturation, in either mode) |

**Character read:** two brand hues now, each following the same rule — literal where it clears AA (dark surfaces), darkened at the same hue where it doesn't (light-mode surfaces): neon green (`--brand`/`--primary`, 110.6°) for the main/primary identity, sky blue (`--brand-2`/secondary family, 200.6°) for secondary surfaces, info-weight badges, and anywhere the system needs a calm non-primary affordance. The neutral scale and the sidebar both carry the blue tint now, not the green one — the Principal's read of the sidebar as "green-biased" generalizes to "the whole neutral scale was green-biased," and pass 5 fixes both the same way. `--positive` (gain green, hue ≈150°) stays a third, deliberately distinct green — checked against both `--brand` (110.6°) and against itself being mistaken for either brand hue.

### Secondary accent — job definition (pass 5)

A second brand hue needs an explicit job or it fights the first one for meaning. `--brand-2` / the blue `--secondary` family is used for:
- **Secondary buttons and surfaces** — anywhere `--secondary`/`--accent` already applied (unchanged role, just a new hue).
- **Info-weight badges and callouts** — a step above `--muted-foreground` neutral, a step below `--warning`'s caution — e.g. "new feature," "beta," informational tooltips. Not a Financial-semantics status tier (those stay `--positive`/`--warning`/`--destructive`, see Financial semantics) — this is for product-chrome informational messaging, a different axis.
- **Selected / non-primary-active states** — e.g. a selected row in a list that isn't *the* primary action of the screen, distinct from `--primary`'s "main CTA" meaning.
- **Chart series 2** in genuine two-series comparison charts (nominal vs. inflation-adjusted, actual vs. target): series 1 uses `--chart-3` (mid-ramp green); series 2 uses `--brand-2` on dark surfaces or `--secondary-foreground` on light surfaces — not a new 5-step ramp, just one representative accent value per mode, since a full categorical/sequential blue ramp isn't needed for a 2-series case.

**Not used for:** anything `--primary` already owns (main CTAs, the brand's "default interactive" meaning) or anything a Financial-semantics tier already owns (gain/loss/caution/danger) — the whole point of giving it a job is so it doesn't become a second, redundant way to say what green or the semantic tiers already say.

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

### Layout & shell (pass 4; superseded pass 8, 2026-10-02 — Principal review 5)

**Pass 4 history (superseded, kept for the record):** "Can we have the top header bar span the full width, and have the side-bar under the header?" — pass 4's shell had a full-width header on top, with the sidebar + content as a two-column body below it.

**Pass 8, current shell** — rebuilt on the shadcn Sidebar component's own pattern (https://ui.shadcn.com/docs/components/base/sidebar, `temp/design-refs/shadcn-sidebar.png`), per the Principal: "we should have the sidebar take up the entire vertical *screen* space. Not the vertical *page* space... The header row would start at the right of the expanded or contracted sidebar." The header no longer spans the full width — it starts to the right of the sidebar instead:

1. **Sidebar** — a fixed column, flush to the left edge, filling the full viewport height (`position: fixed; height: 100vh`, not `sticky` against the page — see § Sidebar for why `sticky` wasn't enough). Composition top to bottom: brand (logo + wordmark, moved here from the header) → nav (seven items) → avatar trigger (opens the user-menu popover).
2. **Shell main** (everything to the right of the sidebar) — a header row, then the content column below it. Each screen's own page-specific actions (Refresh, tabs, "Confirm all", Sync/+New entry, ...) still live at the top of the content column; the page **title** itself no longer does — it moved into the header's breadcrumb (see Header, below).

This is a genuine restructure, not a cosmetic tweak — see `wireframes/` and both styled screens for the built version. `.shell-main` carries a `margin-left` matching the sidebar's width, since a `position: fixed` sidebar is out of normal document flow.

### Header (pass 5 — Principal review 2; rebuilt pass 8 — Principal review 5)

**Pass 5 history (superseded, kept for the record):** brand lockup moved to the header's left, entity selector to the right, page title/actions moved out into the content column. The brand lockup has since moved again (pass 8, into the sidebar's own top item) — everything else pass 5 established about *what leaves the header* (page title, page-specific actions) still holds.

**Pass 8, current header — the Principal's spec, restated exactly:**

| Side | Items, in order |
|---|---|
| **Left** | Expand/contract icon (`.sidebar-toggle-header`, toggles the sidebar between full and icon-rail width) → page title **>** breadcrumbs (`.breadcrumbs`) |
| **Right** | Entity selector (name + avatar cluster) → AI/Agent icon (greyed, non-interactive in v1) → Search icon (keyword / account name / report view) → Notification centre icon → Gear icon → Settings |

- **Breadcrumbs are now the only place a page's title renders.** Most screens are a single crumb (e.g. "Transactions"); a drill-down page shows its full path — the account register is the canonical example: "General Ledger **>** Primary Checking." Screens no longer repeat their own title as an `<h1>` in the content column (pass 5 through pass 7 did this; removed in pass 8 to avoid saying the same thing twice two different ways).
- **The AI/Agent icon is deliberately inert in v1** — greyed out, `disabled`, present only to reserve its slot in the row for when agent features ship. Not a dead placeholder forever; a known future surface being designed for now.
- **Search** is one icon for three search domains (keyword, account name, report view) — a single entry point, not three separate controls; the exact command-palette behavior is architect/frontend-lead's to define against a real search index, this spec only fixes its header position and icon.
- **Settings left the sidebar** (see § Sidebar information architecture) — the gear is its only entry point now. On the Settings screen itself, no sidebar nav item is active (there isn't one to mark); the gear shows an `active` state instead (`.icon-btn.active`).
- **Entity selector / avatar cluster are unchanged from pass 5** — same component, same position (now the first item in the header's right-justified icon row rather than the header's only right-side item).

**Avatar cluster (pass 5, unchanged in pass 8).** Overlapping circles representing the entity's membership:
- 24px diameter, `-8px` overlap (each circle's `margin-left`), a 2px border in whatever surface color it sits on (`--card` in the header) to cut a visible ring between overlapping circles.
- **Fallback is always initials** on a `--secondary` fill — no avatar-image asset exists for this product yet, so this isn't a "fallback for the rare case," it's the only case today.
- **Max 3 shown**, a 4th+ member folds into a "+N" chip in the same slot and style, continuing the overlap (not yet built in the two reference screens — both shown entities have ≤2 members; the overflow rule is stated here for frontend-lead to implement against a real membership count).

### Sidebar (pass 4 — inverted, card, collapsible; pass 5 — option A chosen, full height, re-hued blue; pass 8 — shadcn pattern, viewport-fixed, avatar popover)

**Principal direction (pass 4):** "Maybe we can play with an inverted background color for the sidebar. And while we are at it: Make it a card with the same rounded edges. I also want the ability to compact the sidebar to just icons."

- **Inverted:** in light mode the sidebar is a dark surface (`--sidebar` = `#1F2528`, blue-tinted as of pass 5, was `#20291F` green) floating on the light page; in dark mode it's a light surface (`--sidebar` = `#F7F8F8`, the light mode's own canvas tone reused directly) floating on the dark page. A user should never see two dark (or two light) surfaces stacked with no separation across a mode switch — "inverted" means relative to the page, in both directions.
- **Re-hued blue (pass 5).** The Principal, reviewing the pass-4 result: "check the background on the side-bar. Is that green biased? I want it more flat or blue-biased." It was — same hue family as the pass-4 primary green, just dark. Moved to the same blue hue (200.6°) as the pass-5 re-tinted neutral scale, rather than a true neutral grey, so the whole system (page canvas + sidebar) carries one consistent "barely blue" cast instead of introducing a third hue family. The sidebar's own focus ring moved too (`--brand-2` instead of the green `--brand`) so no green survives anywhere in this component.
- **Card, pass-8 shape:** `border-radius` moved from all four corners (pass 4/5, a floating card with margin on every side) to **just the inner edge** (`0 var(--radius-lg) var(--radius-lg) 0`) — pass 8's sidebar is flush to the viewport's left and bottom edges (see "Full height," below), so only the edge touching the content column still reads as a rounded card seam.
- **Collapsible to an icon rail:** a compact state (~64px wide) showing only nav icons, no labels — expand restores the full ~240px width with labels.

**Composition, pass 8, top to bottom:**
1. **Brand item** (`.sidebar-top`) — logo + "Polycarpic" wordmark, moved here from the header (see § Header). Collapses to the logo mark alone in the icon rail.
2. **Nav** (`.sidebar-nav`) — seven items (was eight through pass 7; Settings left for the header's gear, see § Sidebar information architecture).
3. **Avatar trigger** (`.sidebar-bottom`) — opens a user-menu popover (profile, preferences, theme, keyboard shortcuts, … **Log out last**). Collapses to the avatar circle alone in the icon rail.

**Expand/collapse cue — Option A superseded (pass 8, Principal review 5).** Pass 5 chose "a chevron pinned at the sidebar's bottom edge." The Principal's pass-8 header spec gives that bottom slot to the avatar trigger instead and moves the expand/contract control into the header (`.sidebar-toggle-header`, left of the breadcrumb) — proposed by team-lead during the review, not objected to. **B (hover-reveal) and C (keyboard + remembered state) are still rejected**, for the same reasons as pass 5; A's own mechanism is superseded, not rejected — it just no longer lives on the sidebar. See `wireframes/sidebar-cues.html`, updated to record this.

**Full height (pass 5; mechanism fixed pass 8).** "Can we have the sidebar elongate down to fill the screen? ... the entire vertical *screen* space. Not the vertical *page* space." Pass 5 used `position: sticky` against `.shell-body`'s own flex row — this tracked the **page's** scroll position, not the **viewport**, and broke outright once a wireframe convention put an explanatory note above the shell: the sticky sidebar's natural document-flow offset pushed its bottom edge below the actual viewport. **Pass 8 fix:** `position: fixed; top: 0; left: 0; height: 100vh` — pinned to the viewport itself, independent of where the shell sits in the document and independent of scroll position. `.shell-main` carries a `margin-left` equal to the sidebar's width to avoid being covered, since a fixed element is out of normal flow.

**Avatar popover (pass 8, new component).** The sidebar's bottom item (`.sidebar-avatar-trigger`) opens a popover anchored above it (the trigger sits at the screen's bottom edge, so the popover always opens upward):

| Order | Item |
|---|---|
| 1 | Profile |
| 2 | Preferences |
| 3 | Theme |
| 4 | Keyboard shortcuts |
| — | divider |
| 5 | **Log out** (last, `--destructive`-styled) |

Shown "open" as the built reference on `styled-screens/dashboard.html` and `wireframes/dashboard.html`; every other screen shows the trigger closed. This is a Popover, not a Sheet or Dialog — it doesn't block the rest of the screen and dismisses on outside click (see § shadcn-svelte reuse map, below, for the exact primitive).

### Sidebar information architecture (pass 7, 2026-10-02)

**The Principal, pass 4 review:** "I kind of feel like the transactions, Ledger entries, General Ledger, Custodial Accounts, and security views are mixed together. Needs some conceptual clean up." Resolved via an interview (team-lead ran it; full transcript in `temp/2026-10-02-sidebar-interview.md`, held past this pass). The underlying issue was a **flow-vs-state conflation**: three pipeline stages (imported transaction → draft → posted journal entry) were stacked on one "Ledger" screen, and two different concept layers (the GL abstraction vs. a physical custodial account) shared one screen behind a silent toggle.

**Final sidebar, pass 7: eight flat items, no nesting. Amended pass 8: seven sidebar items + one header surface** (Settings moved to the header's gear icon, Principal review 5 — see § Header). The table below is pass 7's, with Settings' row marked to reflect where it actually lives now; everything else is unchanged, and the icon-collapsible mechanism is still flat-items-only.

| # | Nav item | Replaces / absorbs | What it is |
|---|---|---|---|
| 1 | **Dashboard** | unchanged | Cross-cutting summary — net worth, cash flow, tax, allocation snapshot. |
| 2 | **Transactions** | "Ledger" (renamed) | The time-ordered journal: three accordion cards in urgency order — Exceptions, Pending, Posted. The Pending card is the bank-feed review/match inbox (see § Transactions workflow). Import stats/status and the `[Sync Transactions]`/`[+ New entry]` actions live here too — "Import" as a separate nav item is gone. Not the chart-of-accounts; see General Ledger for that. |
| 3 | **General Ledger** | half of old "Accounts" (the GL side of its toggle) | Opens to a chart-of-accounts **tree** (category → account → sub-account, balances, a custodial marker on accounts that mirror a physical account). Clicking an account opens that account's **register** — a separate page, breadcrumbed back to the tree — showing every line that hit it, in date order, with a running balance; each line links to its full journal entry. The register is account-scoped and running-balance-shaped; Transactions is entry-scoped and time-ordered — genuinely different questions, not two views of one screen. |
| 4 | **Custodial Accounts** | the other half of old "Accounts"; absorbs "Securities" | The physical-account view — per-institution cards, reported balance, reconciliation status against the GL. Each account has a **lots sub-card**: a pull-down per security showing its lots and short/long/total current gain or loss, summed per security and per account. Book-vs-market is implicit here (the lots themselves), not a separate chart. New custodial accounts and provider links are created via a `[+ New]` modal on this screen (aggregator, manual, or file-import source type; a discovered-account mapping step; token refresh; unlink, with the ≤24h revocation-lag note on the Vercel target). Link-health (expired token, lost access, stale) shows as a badge on the row and a banner on Transactions. A `[Sync]` button here pulls positions and balances. |
| 5 | **Allocation** | the allocation-vs-target half of old "Securities" | A dedicated actual-vs-target page — promoted out of Securities now that Securities itself is gone as a nav item. |
| 6 | **Reports** | new | Balance Sheet, Income Statement, Cash Flow — the Dashboard's empty-state pattern (Component inventory, above) until POLY-M5 ships statements. Wireframe fidelity only for now. |
| 7 | **Entities** | unchanged | Entity list, memberships, invite. Never implicated in the "mixed together" complaint — intentionally left alone. |
| — *(pass 8: header gear, not a sidebar item)* | **Settings** | new; absorbs scheduling from old "Import" | Batch-import schedule and options, plus other app-level settings. Reached via the header's gear icon (§ Header) — no sidebar nav item is active on this screen; the gear itself shows the `active` state instead. |

**What's explicitly gone:** "Securities" (folded into Custodial Accounts' lots sub-card + the new Allocation page) and "Import" (its setup is now a Custodial Accounts action; its stats live on Transactions; its scheduling lives in Settings). **Pass 8 addition:** Settings itself also leaves the sidebar, for the header's gear icon. **What's unaffected:** the sidebar's own visual mechanism — inversion, card shape, icon-rail collapse — none of that changed; the expand/collapse *cue* did move (§ Sidebar, "Expand/collapse cue — Option A superseded").

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
| Caution | `--warning` | **(pass 6, the Principal asked what this is for)** Safe-harbor gap open, due date >14 days out; an unmatched transfer leg aged inside the Cash-in-Transit exceptions window; a stale/expired provider link that still has cached data to show |
| Danger / overdue | `--destructive` | Safe-harbor payment overdue; exceptions-threshold breach; reconciliation break |

### Entity, account, and category badges — label + icon, not per-category hue

Unchanged principle from prior passes: meaning by label/icon/variant weight, not a dedicated hue per category.

| Category | Variant | Icon (Lucide, indicative) |
|---|---|---|
| Entity type — Person / Trust / Business / Household | `secondary` | `User` / `Landmark` / `Building2` / `Home` |
| Account — GL / Custodial | `outline` | `BookText` / `Landmark` |
| Transaction — Draft / Posted / Reversed / **Corrected** *(pass 6)* | `secondary` / `outline` / `outline` italic / **`outline` + `brand-2`-tinted dot** | `Clock` / `Check` / `RotateCcw` / `Pencil` |
| Role — Owner / Manager / Viewer | `default` / `secondary` / `outline` | — |

**Open item:** a genuine 3+-hue categorical chart need isn't solved by this doc yet — decide against a concrete spec when one arises.

### Correcting a posted entry — "Correct entry," not "edit" or "reverse" (pass 6)

**The Principal's framing (review 4):** the user-facing action and the underlying mechanism are two different claims, and the prior wording of flow 5.2 (design-system-spec.md / flow 5.2's own bullet) conflated them — "the UI never offers an edit affordance on a posted row, only reverse" describes the *mechanism* correctly but is not what the user should be told to click.

- **Import is the immutable baseline.** An imported bank transaction is never altered after import — this hasn't changed, and the user never corrects an import row directly.
- **Nothing reaches the GL without a confirmation step.** Between import and posting, a draft is fully editable — category, tax-treatment tag, counterparty, amount allocation — exactly as today's flow 5.2 already describes. This is where a user fixes a mistake *before* it is load-bearing.
- **After posting, the user-facing action is "Correct entry," not "edit."** Clicking it does not mutate the posted row — under the hood it posts a full reversal of the original entry plus a new corrected entry (unchanged mechanism, reversal-only, PRD §5) — but the user is never shown "reverse" as a verb for this, and never asked to manually construct the reversing entry themselves.
- **A corrected row carries a badge** (see table above) distinguishing it from a plain Posted or a standalone Reversed (e.g. a reversal with no replacement) row.
- **Click-through reveals the mechanism.** Opening a corrected entry's detail view shows the full underlying pair — the original entry's lines rendered shaded/struck-through, the reversal lines, and the new corrected entry — so the double-entry trail stays fully auditable (Overview principle: "every number earns trust") without the top-level row ever using the word "reverse" as the primary affordance.
- **Auto-posted rows get the identical treatment (addendum, pass 6).** A row posted by a recurring rule rather than a manual confirm shows the same `Posted` badge plus a small `posted by rule — <rule name>` attribution line underneath it, and offers the exact same **Correct entry** action as any other posted row. There is no separate "edit" affordance for a rule-posted row, and no different correction mechanism — actor attribution (user / auto-post rule / system job, PRD §5) changes who gets credited, never how a mistake gets fixed. See `styled-screens/transactions.html` for the built example.

See flow 5.2 (§ User Flows) for the updated decision diagram and `styled-screens/transactions.html` for the built row action, badge, and click-through state.

---

## Transactions workflow (pass 7, 2026-10-02)

The Principal's own product specification for the Plaid bank-feed → journal-entry pipeline (`temp/2026-10-02-sidebar-interview.md`, kept as the starting point, refined here). Governs the **Pending** accordion card on Transactions — see § Sidebar information architecture for where this sits in the nav, and flow 5.2 for the full decision diagram.

**Layout:** a high-density table/list of unposted raw rows. Clicking a row expands it vertically (Accordion/Expansion pattern) — the matching workspace opens inline, no navigation away from the feed.

**The two-line preview (every expanded row starts here):**
- **Line 1, the locked leg.** Always the custodial cash side — debited or credited per the Plaid transaction type. Locked because it represents verified bank reality; never editable, here or in Split/Group.
- **Line 2, the suggested offset leg.** The system scans historical rules and the Plaid category to pre-fill an educated guess (e.g. Accounts Receivable, Software Expense, Custodial Clearing). Shown as an inline search dropdown the user can override in place — never a blank field.

**Flow A — Split (one raw row → one multi-leg entry).** For a transaction that represents multiple contexts (e.g. a $1,200 payout that nets a $20 platform fee). The expanded row morphs into a multi-column grid; the user adds unlimited offsetting rows. A live validation loop disables "Approve & Post" until the split rows' total exactly matches the raw transaction's absolute total — never a partial or over/under split.

**Flow B — Group (many raw rows → one entry).** For compressing many micro-transactions into one summary entry (prevents GL bloat). The user checkbox-selects rows in the primary table; a floating bulk-action bar appears; "Group & Summarize" opens the **same journal-entry modal** used everywhere else, pre-filled with one aggregated primary line and the user's chosen balancing distributions. **This is the system's one many-to-one draft→entry relationship** — every other posting path (manual entry, simple match, Split) is one draft (or one manual action) to one entry.

**The journal-entry modal, one component reused everywhere.** Header (date, memo) + legs (account, Dr/Cr, amount) — a near-full-screen `Dialog`, not a drawer, because the Principal wants it to take up most of the screen. The exact same modal serves: manual **"+ New entry"**, **"Correct entry"** (§ Correcting a posted entry, above), **Split**, and **Group & Summarize** — only the pre-fill differs per entry point.

**Posting gate, stated explicitly (team-lead ruling, 2026-10-02):** a transaction cannot leave the Pending card unless **all** of the following hold —
1. Σ debits = Σ credits (balanced).
2. The accounting equation holds, per entity (Assets = Liabilities + Equity).
3. The entry date matches the bank date — or, for a date mismatch, the Cash-in-Transit clearing rule applies (2026-09-27 decision).
4. The posted draft links to exactly one journal entry (except Group, which links many drafts to the one entry it produced).

Any gate failure keeps the item in Pending — there is no partial post and no silent failure. **"Approve & Post"** collapses the expanded panel with a fade-out and removes the item from the unposted inbox once the gate passes.

**"show N" selector:** each of the three accordion cards (Exceptions, Pending, Posted) has its own limit selector — a user with a large Posted history isn't forced to render all of it; Posted is paged, Exceptions/Pending show their full (usually small) count by default.

**Permissions:** New entry, Sync, Split, Group, Approve & Post, and the rule auto-post opt-in are Manager/Owner actions — a Viewer sees none of these affordances anywhere on this screen (SECURITY §4.2.1 matrix, ARCH §2.4 permissions table).

---

## General Ledger: tree & register (pass 7, 2026-10-02)

**Team-lead ruling during the sidebar interview (the Principal did not object):** General Ledger opens to a **chart-of-accounts tree** — category → account → sub-account, each row showing its balance. Clicking an account opens that account's **register** as its own page, breadcrumbed back to the tree.

- **The custodial marker.** A tree row for a GL account that mirrors a physical custodial account (e.g. "Primary Checking") carries a small `custodial: <institution>` tag — a cross-reference only, not a second data source; the figure shown is always the GL's own balance. Not every account has one (Owner's Equity, Cash in Transit never do).
- **The register is account-scoped and running-balance-shaped:** every line that hit this one account, in date order, with a running balance, each linking to its full journal entry (every leg, not just the one that hit this account) — the same "every number earns trust" principle as the Dashboard.
- **Distinct from Transactions, deliberately.** Transactions (§ Transactions workflow, above) is entry-scoped and time-ordered across every account in the entity — the journal. The register is the opposite cut: one account, every entry that ever touched it. Neither view replaces the other.

See `wireframes/general-ledger.html` and `wireframes/account-register.html` — wireframe fidelity only, consistent with the traffic-priority rule (Open Questions, index.html).

---

## Custodial Accounts: lots & provider setup (pass 7, 2026-10-02)

**The Principal, verbatim (sidebar interview):** "Sub-card in the Custodial view... pull downs of each security to show lots. And for the Allocation vs target to be a dedicated page. The book vs market should be implicit in the custodial view, shown as whether the lots (and sum of lots) show the short/long/total current gains/losses." This absorbs both halves of what the old "Securities" nav item did — lots live here now; allocation-vs-target gets its own item (§ below is Custodial Accounts only; see the Allocation screen for that half).

**Per-account card:** institution name, reported balance, link-health badge, and a reconciliation line against the GL (same clean/break tiers as before — danger tier surfaces on Dashboard too, per flow 5.4).

**The lots sub-card (only on accounts that hold securities):**
- One row per security, collapsed by default — a pull-down (disclosure triangle) reveals its individual lots.
- Each lot shows book value, market value, and its own short-term or long-term unrealized gain/loss.
- The security's own row shows its summed book/market/gain across all its lots.
- The account's lots sub-card totals short, long, and total unrealized gain/loss across every security — this **is** the book-vs-market comparison; there is no separate chart for it (the Principal's correction to the pre-pass-7 design, which had book-vs-market as its own line chart on the old Securities screen — that chart is retired).

**The `[+ New]` provider-item modal** (absorbs the old "Import" screen's linking step):
- **Source type**, chosen first: aggregator (Plaid/SimpleFIN/fake), a manual account (no live link), or an imported file (CSV/OFX).
- **Discovered-account mapping** (aggregator path only): a provider item can surface several accounts at once (e.g. a bank's checking + savings); each discovered account maps to an existing or new custodial account — a provider item is a first-class record that owns its discovered accounts (ARCH §3 data-model note), not folded directly into one custodial account.
- **Token refresh** and **unlink** live in the same modal. Unlink states the revocation-lag note explicitly on the Vercel deployment target: access may persist up to 24h after unlinking.
- **`[Sync]`** (top of Custodial Accounts, and a `[Sync Transactions]` counterpart on Transactions) pulls **both** balances and positions here — not transactions-only, which is what Sync means on Transactions.
- **`[Import file]`** is the manual/file-source counterpart to Sync — same place, different action, for an account with no live aggregator link.

**Link health** (expired token, lost access, stale) is a badge on the custodial-account row here, and a banner at the top of Transactions — one state, shown in both places a user would reasonably look for it.

**Permissions:** `[+ New]`, token refresh, unlink, and `[Sync]`/`[Import file]` are Manager/Owner actions — a Viewer sees none of them (same posture as Transactions' posting actions, ARCH §2.4 permissions table).

See `wireframes/custodial-accounts.html` — wireframe fidelity only, same traffic-priority rule as General Ledger.

---

## Allocation, Reports & Settings (pass 7, 2026-10-02)

The remaining three new sidebar items — all wireframe fidelity, all new as of this pass.

**Allocation.** A dedicated actual-vs-target page, promoted out of the old Securities screen per the Principal's own direction (§ Custodial Accounts, above). Pulls from the same lot data as Custodial Accounts' lots sub-card, aggregated by asset class across every custodial account for the entity — not a new data source, a different aggregation. The nominal/inflation-adjusted (CPI-U) toggle (PRD §4.9) is orthogonal and applies here like any time-series view. Includes a target editor (must sum to 100%).

**Reports.** A nav item **from day one**, per the Principal: "its own sidebar item from day one... built in POLY-M5 (Statements); until then it shows the Dashboard's empty-state pattern." Three statements — Balance Sheet, Income Statement, Cash Flow — behind the same `Tabs` pattern used elsewhere. Before M5, every tab uses the Component inventory's empty-state convention (real card chrome, "Not set up yet," no milestone/version naming) rather than being hidden or disabled — the nav item itself is never gated on the feature shipping.

**Settings.** Absorbs the scheduling half of the old Import screen ("the undefined Settings View... all the option selections for batch scheduled imports") plus general app preferences. Two scopes that must not be conflated: **per-entity** (import schedule, CIT exceptions threshold, duplicate-detection window — a Household's schedule doesn't touch a Person entity) and **per-user** (theme, default entity on login, reduced motion). Viewers can view this page but the Manager/Owner-only actions (schedule, import options) are read-only for them — same posture as every other write action in this system (ARCH §2.4 permissions table).

See `wireframes/allocation.html`, `wireframes/reports.html`, `wireframes/settings.html`.

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
| **Accordion** *(pass 7, new)* | Transactions' three urgency-ordered cards (Exceptions, Pending, Posted); the Pending card's row-expansion (two-leg preview) |
| **Tabs** | Entity switcher, nominal-vs-inflation-adjusted toggle, Totals/Percent toggle (Monarch pattern). **Pass 7:** the former GL-vs-custodial toggle is gone — General Ledger and Custodial Accounts are two separate nav items now, not a tab pair |
| **Sheet / Dialog** | Transaction detail drawer; new-entity/membership dialog; provider-item modal (Custodial Accounts) |
| **Dialog, near-full-screen** *(pass 7, new)* | The journal-entry modal (header + legs) — manual "+ New entry", "Correct entry", Split, and Group & Summarize all reuse this one modal |
| **Select / Combobox** | Category, tax-treatment tag, jurisdiction pickers; the suggested-offset-leg inline search dropdown (Pending inbox); per-card "show N" limit selector |
| **Sidebar** | Primary nav, seven flat items as of pass 8 (Settings moved to the header gear) — inverted, viewport-fixed full height, collapsible to an icon rail, brand item on top + avatar-popover trigger on bottom (pass 4/5/7/8, see Sidebar information architecture) |
| **Skeleton** | Every async fetch boundary |
| **Sonner (toast)** | Import batch complete, entry posted, reconciliation break |
| **Progress** | Import batch progress, safe-harbor paid-vs-required |
| **Header** *(pass 4/5, rebuilt pass 8)* | Starts right of the sidebar, not full-width: expand/contract icon + breadcrumb (left); entity selector, AI icon (greyed v1), search, notifications, settings gear (right) — see Layout & shell, Header |
| **Popover / DropdownMenu** *(pass 8, new)* | Avatar popover at the sidebar's bottom — profile, preferences, theme, keyboard shortcuts, Log out last (see Sidebar) |
| **Breadcrumb** *(pass 8, new)* | The header's "page title > breadcrumbs" — single crumb on most screens, multi-crumb on drill-downs (the account register) |
| **Avatar cluster** *(pass 5, new)* | Overlapping initials-on-`--secondary` circles in the entity selector — membership at a glance, max 3 + overflow (see Header) |
| **Public hero + feature call-outs** *(pass 4, corrected)* | Home — pre-auth landing page, product statement + brand identity + CTAs |
| **Split screen login** *(pass 4)* | Login — theme-aware form pane (full field list: OAuth, email, password + reveal + forgot-password, sign-in, sign-up link, legal footer) + always-branded visual pane, stacks on phone width |

**Top bar pattern (Monarch):** page title (left) + a secondary outline action + a primary filled CTA (right) — e.g. Dashboard: "Refresh" (outline) + nothing else; Transactions: `[Sync Transactions]` (outline) + `[+ New entry]` (filled) *(pass 7, was Ledger's "Confirm all," since posting now happens per-item in the Pending inbox, not as a single batch action)*. **Pass 8:** the page title itself moved into the header's breadcrumb (§ Header); this row now carries only the page-specific action button(s), right-aligned in the content column — not the header, which is global chrome (sidebar-adjacent, not full-width, as of pass 8).

**Empty-state pattern (ARCH §2.4 — Dashboard ships in M3 with the tax panel empty until 1.0, allocation panel empty until M4):** an empty panel keeps its real card chrome (eyebrow label, card shape, dashboard-scale padding) and states plainly that the feature isn't set up yet, in `--muted-foreground` body text — no illustration, no skeleton (a skeleton implies "loading," not "not built yet" — conflating the two is misleading). **Copy never names an internal milestone or version id** (architect's nit, 2026-09-28) — "Not set up yet," not "Available in v1.0"/"Available at M4": these panels are staging-only today, but neutral copy survives either way OQ-8 (0.x releases) resolves, without leaking internal roadmap language to a user. Example: the tax-liability card shows the eyebrow "PENDING TAX LIABILITY" and "Not set up yet" — same card shape as the live version will have, so the dashboard's layout doesn't visibly shift when the feature ships. See `styled-screens/dashboard.html` for the built example.

**Still ours to set:** reduced-motion policy; loading-state discipline (per-feature).

---

## shadcn-svelte reuse map (pass 8, 2026-10-02)

**The Principal's question:** "How much of shadcn-svelte's components and blocks are we reusing? Ideally we would stick to the already designed stuff as much as possible for stability." Answered here, directly: every component and screen region in this system, mapped to the shadcn-svelte component or official block it's built from, or `custom` with one line why. The bias throughout is toward an existing component/block over a bespoke build — `custom` rows are the exception, not the default, and each states what shadcn-svelte doesn't already cover.

**Registry, version, and vendoring (the Principal also asked how blocks get in):** shadcn-svelte (https://shadcn-svelte.com, the Svelte port of shadcn/ui) follows shadcn's own distribution model — components are **copied into the repo** via `bunx shadcn-svelte@latest add <name>` (already stated in Component inventory, above), not installed as a versioned npm dependency. That means there is no single "shadcn-svelte version" pin the way there is for a normal package — each component is vendored source, owned and modified in-repo once added. **What is pinned:** the `shadcn-svelte` CLI/registry version used *at the moment each `add` command runs*, recorded as a decision in `process/DECISIONS.md` by frontend-lead at Implement kickoff (not a design-time decision — this spec fixes *which* components/blocks to use, not which CLI version generates them). Official **blocks** (pre-assembled multi-component screens — sidebar, dashboard, login blocks) are vendored the same way and are the preferred starting point wherever one exists close to our own screen shape, per the Principal's "stick to the already designed stuff" direction.

| Component / region | shadcn-svelte component or block | Notes |
|---|---|---|
| App shell (sidebar + header) | **Sidebar** (`https://ui.shadcn.com/docs/components/base/sidebar`) — official component, used close to its own documented composition (`SidebarProvider`, `Sidebar`, `SidebarHeader`, `SidebarContent`, `SidebarFooter`, `SidebarMenu`) | Direct reuse, per the Principal's own reference screenshot (`temp/design-refs/shadcn-sidebar.png`) — our brand item ≈ its `SidebarHeader`, nav ≈ `SidebarMenu`, avatar trigger ≈ its `SidebarFooter` pattern |
| Avatar popover (user menu) | **Popover** + **DropdownMenu** (the popover is the container; its items are a DropdownMenu's item list) | Matches shadcn's own sidebar-footer example (avatar + name, opens a menu) almost exactly |
| Breadcrumbs | **Breadcrumb** | Direct reuse — single-crumb pages just render a one-item Breadcrumb |
| Search icon / command entry point | **Command** (the `⌘K`-style command palette primitive) | The icon opens a Command dialog; the keyword/account/report-view search domains are three command groups within it, not three components |
| Notification centre | `custom` | No official shadcn-svelte notification-center block exists; built from **Popover** (container) + **Badge** (unread count) + plain list markup — closest primitives, not a named block |
| AI/Agent icon (v1) | **Button**, `disabled` | Just a disabled icon button reserving its slot — no agent UI exists yet to back it with anything more |
| Gear → Settings | **Button** (icon variant) | A plain nav affordance, not a menu — it's a page link, not a dropdown |
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
| Journal-entry modal | **Dialog**, sized near-full-screen | Direct reuse — just a non-default Dialog size, not a different primitive |
| Transaction/account-register tables | **Table** | Direct reuse |
| Chart-of-accounts tree | `custom` | No shadcn tree component; built from nested disclosure rows (could adopt a community tree primitive later if one matures) |
| Lots sub-card pull-down | **Collapsible** | Direct reuse — a simpler primitive than Accordion for a single expand/collapse row |
| Provider-item modal | **Dialog**, **Tabs** (source-type picker), **Select** (account mapping) | Composed from three existing primitives, no custom chrome |
| Tabs (entity switcher pre-pass-8, nominal/real toggle, Totals/Percent) | **Tabs** | Direct reuse |
| Transaction detail drawer | **Sheet** | Direct reuse |
| Select / Combobox (category, tax-treatment, jurisdiction) | **Select**, **Combobox** | Direct reuse |
| Toasts (import complete, entry posted, reconciliation break) | **Sonner** | Direct reuse |
| Progress (import batch, safe-harbor paid-vs-required) | **Progress** | Direct reuse |
| Skeleton | **Skeleton** | Direct reuse |
| Tooltip (icon-button titles, truncated text) | **Tooltip** | Direct reuse — used wherever an icon-only control needs a text label on hover |
| Public hero (Home) | `custom` | Marketing/landing content; no shadcn block fits a bespoke brand hero |
| Split-screen login | shadcn-svelte's own **login block** (`https://shadcn-svelte.com/blocks/login`, the two-pane pattern) as a starting point, customized | The Principal's own reference screenshot (`temp/design-refs/split-login-example.png`) is close to this official block's shape; adopted as the base rather than built from scratch, then customized for our exact field list (§ New screens: Home & Login) |

**What's deliberately `custom` and why that's still "sticking to the designed stuff":** every `custom` row above is custom because shadcn-svelte genuinely has no matching primitive or block — not because an existing one was skipped. Each is built *from* shadcn-svelte primitives (Avatar, Popover, Card, Button) rather than from scratch, so the stability the Principal is asking for — consistent tokens, consistent interaction patterns, one accessibility baseline — still holds even where the composition itself is ours.

---

## New screens: Home & Login (pass 4, corrected same day)

**Correction, 2026-09-30 (same day as the original ask):** the first version of this section proposed "Home" as a signed-in entity-picker. The Principal's clarification: **Home is the public landing page a visitor sees before authentication, not a signed-in screen at all.** The entity-picker concept is dropped as a named screen — for a multi-entity user, entity selection is handled by the header's entity switcher (Layout & shell), already sufficient; no dedicated interstitial page is needed. Login also gained real specificity: it's the **"split screen login page"** pattern by name, with a fully specified form-pane content list, not just "email + continue + OAuth."

### Home — public landing page

**What it is:** the marketing/landing page a visitor sees before signing in — not a Dashboard, not authenticated, no ledger data. One screen, hero-led:
- **Hero:** product statement + the neon-green brand identity front and center (this is a prime "dark or brand surface" context, so `--brand` at full strength is appropriate here, unlike anywhere in the authenticated app).
- **What it does, in one screen:** a genuine double-entry ledger, multi-entity (Person/Trust/Business/Household), self-hosted — three short feature call-outs, not an exhaustive feature list.
- **Calls to action:** "Sign in" and "Get started" (routes to Login).
- **Footer:** minimal — links, no dense content.

Both themes apply here like any other doc page (unlike Login's visual pane, a landing page's whole canvas is content, not brand chrome, so it follows the user's stored preference same as the rest of the app). See `wireframes/home.html` and `styled-screens/home.html`.

### Login — split screen login page (pass 4, refined pass 5)

**Principal's exact pattern, named:** "split screen login page." Two references: `useorigin.com`'s own login (dark, brand pane + form card — behind a splash loader under automation, no direct capture) and a captured example (`temp/design-refs/split-login-example.png`, form pane left including a labeled email/password pair with a "Forgot password?" link and a reveal-eye icon, OAuth button, divider, primary button, sign-up link, legal footer at the very bottom; a full-bleed moody photo right, inset with rounded corners and a margin rather than flush to the viewport edge).

**Form pane content, in order** (per the Principal's explicit list): logo (top-left), "Welcome back" heading + one-line subtext, an OAuth button, a divider ("or"), email field (labeled), password field (labeled, with a "Forgot password?" link and a show/hide reveal icon), primary "Sign in" button, a "Don't have an account? Sign up" line, and a legal footer ("By signing in you agree to...") pinned at the bottom.

**Ours, adapted:**
- **Form pane:** sits on the theme-aware tinted neutral (`--card`/`--background`) — follows the user's stored light/dark preference like the rest of the app, unlike the visual pane. **Pass 5:** the heading, subtext, and fields are centered both vertically and horizontally as a fixed-max-width (380px) column within the pane — the logo is the one element that stays pinned top-left, overriding the pane's own centering. Field labels, inputs, and links stay left-aligned *within* that centered column (only the heading/subtext text itself is center-aligned) — a defensible reading of "centred," stated explicitly since the alternative (centering every line of text, including form labels) would read oddly for a form.
- **Visual pane:** full-bleed, always carries the neon-green brand identity regardless of the user's theme preference — inset with rounded corners and a margin, matching the captured reference's proportions rather than flush edges. **Pass 5:** currently a brand gradient placeholder (`linear-gradient`, `--brand` → dark) — the Principal will supply a real photo; the slot is `.auth-visual-pane`'s `background`, sized to fill its container (`background-size: cover` when a real image replaces the gradient), portrait-to-square aspect (the pane itself is roughly 1:1.3 at desktop widths, narrowing as the viewport does) is the target once an asset lands.
- **Responsive:** collapses to a single stacked pane (form only, visual pane hidden) below the phone-width breakpoint — a login form doesn't need to fight a hero image for a 375px-wide screen.

See `wireframes/login.html` and `styled-screens/login.html`.

---

## Screen data contract

For architect's Screen DTO work (ARCH §2.4, OQ-11 resolved in outline). Model constraints: amounts are signed per line with Dr/Cr derived for display; drafts are separate from posted entries and posted entries are immutable; Cash-in-Transit open items get an exceptions view; access comes from membership only (no parent/child inheritance); `import_batch` holds new/duplicate/needs-category counts.

**Pass 7 (2026-10-02):** rebuilt for the eight-item sidebar (§ Sidebar information architecture, above). Mirrors ARCH §2.4's screen→DTO table exactly — this is the DESIGN-owned half of that same contract, not a second source of truth.

| Screen / surface | Data shown | DTO(s) → owning package | Milestone note |
|---|---|---|---|
| Dashboard | Net worth + delta; cash-flow by period; recent activity; pending tax liability + safe-harbor gap; allocation actual-vs-target | `NetWorthSeries`, `CashFlowByPeriod`, `RecentActivity` → ledger; `TaxPosition` → tax; `AllocationVsTarget` → portfolio | M3 (panels fill in at M4 and 1.0) — see Component inventory § Empty-state pattern |
| Transactions — three accordion cards (Exceptions, Pending, Posted), each with a "show N" limit | Aged CIT exceptions + link-health banners; the Pending review/match inbox (locked custodial leg + suggested offset leg); posted, paged journal entries with correction badges; import stats/status | `ExceptionList`, `PendingInbox`, `ImportStatus` → posting + import; `PostedJournal` → ledger | M2 (CIT exceptions in M3) |
| Journal-entry modal (header + legs) — split, group, manual "+ New entry", "Correct entry" | Entry draft in, posting-gate result out | `EntryDraft` in, `GateResult` out → posting | M2 |
| General Ledger — chart-of-accounts tree | Category → account → sub-account, balances, custodial marker | `ChartTree` → ledger | M2 |
| General Ledger — account register page | Lines on one account, date order, running balance, link to entry | `AccountRegister` → ledger | M2 |
| Custodial Accounts | Balance, reconciliation status, link-health badge; lots sub-card per security (lots, short/long/total unrealized gain, per lot and summed) | `CustodialAccountList` → posting + import; `LotsCard` → securities | M3 (lots card at M4) |
| Provider-item modal ("+ New" on Custodial Accounts) | Source type (aggregator / broker API / file / manual); discovered accounts mapped to custodial accounts; token refresh; unlink + revocation-lag note | `ProviderItem` → import | M2 (fake + file); real aggregators at 1.0 |
| Sync (Transactions, Custodial Accounts) / "Import file" | Job status; on Custodial Accounts also pulls balances and positions | `SyncRequest` → import | M2 |
| Allocation | Actual vs. target allocation; target editor | `AllocationVsTarget`, target editor → portfolio | M4 |
| Reports | Balance Sheet, Income Statement, Cash Flow; NAV and NAV delta | `ReportTable` → reports | M5; empty state until then |
| Entities | Entity list; memberships; invite action | `EntityList`, `MembershipList`, invite command → tenancy | M1 |
| Settings | Per-entity batch-import schedule and options; app preferences | `ImportSchedule` → import; app preferences → tenancy | M2 |
| Home *(pass 4, corrected)* | **No DTO** — public landing page, static marketing content, unauthenticated, no membership/ledger data at all | — | Not a package concern |
| Login *(pass 4)* | Unauthenticated — email/password, OAuth provider list (Google/Apple/GitHub, PRD §8); no ledger data | → `packages/auth` | |

**Gone as of pass 7:** "Ledger" (renamed Transactions), "Accounts" (split into General Ledger / Custodial Accounts), "Securities" (folded into Custodial Accounts' lots sub-card + the new Allocation page), "Import" (its setup is the provider-item modal on Custodial Accounts; its stats live on Transactions; its scheduling lives in Settings).

---

## Provenance & shared tooling

polycarpic's own `cairn` tracker (`scripts/cairn/`) is a separate shadcn-svelte app with its own vendored preset and its own generated theme-variant pipeline (`gen_variants.py` → `docs/DESIGN/variants.css`). **This product's palette does not inherit cairn's tokens** (rejected at pass 1) — it's a fully separate identity derived from Monarch/Origin measurements (pass 3, this revision).

**CI hazard, in progress (POLY-78):** `scripts/cairn/tests/test_board_tokens_parity.py` asserts `docs/DESIGN/tokens.css` parity with cairn's board tokens and runs in the required `cairn` CI check — this divergence fails it until POLY-78 merges. Expected, not to be worked around. `docs/DESIGN/variants.css` has been removed from this branch (it belongs to cairn's generator, not the product) — expect a trivial merge conflict against POLY-78's own removal.

---

## Accessibility

**Target: WCAG AA.** Every pair below re-run for pass 6's palette via the standard WCAG relative-luminance formula against the exact hex values in `tokens.css` (script in `temp/`, `2026-09-30-ux-designer-wcag-contrast-check-pass3.py`; pass 6's warning/chart figures computed via a successor script in the same `temp/` directory). See `tokens.html` for every token's value in both modes with a rendered swatch, alongside this written derivation.

**Login/Home's fixed dark hero and visual-pane colors are not new values** — `.landing-hero`/`.auth-visual-pane` hardcode the same hex already verified in the dark-mode table below rather than reading `.dark`-scoped tokens, since these two surfaces are deliberately always-dark regardless of the page's own theme.

**Pass 5 header/sidebar/login-centering changes (review 2) introduced no new token values** — unchanged from the prior revision's note.

**Light mode — text pairs (floor 4.5:1), all PASS:**

| Pair | Contrast |
|---|---|
| `--foreground` / `--background` | 16.41:1 |
| `--primary-foreground` / `--primary` (fill) | 4.79:1 |
| `--primary` / `--card` (text-only, e.g. links) | 4.79:1 |
| `--secondary-foreground` / `--secondary` (fill, NEW blue) | 4.72:1 |
| `--secondary-foreground` / `--card` (text-only, NEW blue) | 5.48:1 |
| `--muted-foreground` / `--muted` | 5.34:1 |
| `--muted-foreground` / `--card` | 5.68:1 |
| `--accent-foreground` / `--accent` | 4.92:1 |
| `--destructive-foreground` / `--destructive` | 4.75:1 |
| `--sidebar-foreground` / `--sidebar` (NEW blue-tinted sidebar) | 13.87:1 |
| `--sidebar-accent-foreground` / `--sidebar-accent` | 10.28:1 |
| `--positive-foreground` / `--positive` (fill) | 5.02:1 |
| `--warning-foreground` / `--warning` (fill, **pass 6, re-hued true orange + dark ink**) | 5.54:1 |

**Light mode — non-text pairs (floor 3:1):**

| Pair | Contrast | Result |
|---|---|---|
| `--ring` / `--card` | 4.79:1 | PASS |
| `--sidebar-ring` / `--sidebar` (NEW `--brand-2`) | 6.00:1 | PASS |
| `--chart-1`…`--chart-5` / `--card` (**pass 6, brightened**) | 3.26:1 → 8.78:1 | PASS all 5 — narrower band than pass 5 (was 4.11:1→17.73:1), both ends now closer to the 3:1 floor by design, fixing the "almost black" tail |
| `--warning` / `--card` (**pass 6, new** — this token, unlike `--brand`/`--brand-2`, is also used directly as a border/icon color) | 3.20:1 | PASS |
| `--border` / `--card` | 1.23:1 | Below floor — decorative hairline, accepted (unchanged posture since pass 3) |
| `--brand` / `--background` | 1.35:1 | **Expected fail** — `--brand` (green) must never be a light-surface fill/text; regression tripwire, not a bug |
| `--brand-2` / `--background` | 2.56:1 | **Expected fail** — same rule, new hue: `--brand-2` (blue) must never be a light-surface fill/text either |

**Dark mode — text pairs (floor 4.5:1), all PASS:**

| Pair | Contrast |
|---|---|
| `--foreground` / `--background` | 17.92:1 |
| `--primary-foreground` / `--primary` (fill) | 14.72:1 |
| `--primary` / `--card` (text-only) | 14.18:1 |
| `--secondary-foreground` / `--secondary` (fill, NEW blue) | 5.95:1 |
| `--secondary-foreground` / `--card` (text-only, NEW blue) | 9.83:1 |
| `--muted-foreground` / `--muted` | 7.76:1 |
| `--muted-foreground` / `--card` | 7.92:1 |
| `--accent-foreground` / `--accent` | 5.46:1 |
| `--destructive-foreground` / `--destructive` | 5.67:1 |
| `--sidebar-foreground` / `--sidebar` | 15.55:1 |
| `--sidebar-accent-foreground` / `--sidebar-accent` | 4.72:1 |
| `--positive-foreground` / `--positive` (fill) | 8.93:1 |
| `--warning-foreground` / `--warning` (fill, **pass 6, re-hued true orange, same dark ink as light mode**) | 8.11:1 |

**Dark mode — non-text pairs (floor 3:1):**

| Pair | Contrast | Result |
|---|---|---|
| `--ring` / `--card` | 14.18:1 | PASS |
| `--sidebar-ring` / `--sidebar` (NEW, derived light-mode blue ink) | 4.51:1 | PASS |
| `--brand-2` / `--background` | 7.76:1 | PASS — this dark surface is exactly what `--brand-2` is for |
| `--chart-1`…`--chart-5` / `--card` | 8.87:1 → 16.32:1 | PASS all 5 (unchanged, pass 6 only touched the light-mode ramp) |
| `--warning` / `--card` (**pass 6, new**) | 8.84:1 | PASS |

| Concern | Standard / approach |
|---|---|
| Color contrast | WCAG AA — measured, every pair, both modes |
| Color-alone signaling | Never — delta always carries a sign/arrow (see Financial semantics) |
| Keyboard | shadcn primitives ship this by default |
| Screen readers | Semantic markup; delta sign readable from text content |
| Motion | Respect `prefers-reduced-motion` (open item) |

**Open items:**
- No CVD simulation run on the new palette yet — now TWO brand hues (green 110.6°, blue 200.6°) to check, not just one; higher priority with each pass that adds more meaning-bearing color.
- `--border`/`--card` is a low-contrast hairline by design (1.23:1) — decorative, consistent with common practice.
- Reduced-motion policy not yet written.
- Radius-xl (sheets) not measured against either reference — extrapolated.
- Sidebar expand/collapse cue is decided (option A) — no longer an open item as of pass 5.

---

## Open questions

- Native iOS/macOS token export format (kickoff §2.10) — not yet decided, non-blocking for web.
- Categorical (3+ hue) chart palette for transaction-category breakdowns — deferred until a concrete chart spec exists.
- Compare `styled-screens/dashboard.html` against `temp/design-refs/monarch-app-accounts-zoom.png` component-by-component once frontend-lead builds the real screen — this pass matched structure and the net-worth hero closely but did not build the full grouped-account-list + segmented-bar right column (time-boxed to the highest-traffic pattern); flag as a fast-follow if the gap matters before Implement.
- **Login's visual pane (pass 4):** built as a brand gradient, since no photography/illustration asset exists for this product — the captured `dribbble` reference and `useorigin.com`'s own (relayed, uncaptured) login both use a real photo there. A real asset would likely read stronger; this is a design-asset gap to fill before final, not a layout uncertainty.
- **CVD check on the brand hues (pass 4/5):** flagged in Accessibility — two brand hues now (green, blue) to check, not yet simulated.
- **Resolved pass 6:** `--warning` re-hued to a true orange with a dark ink (was brown-reading); light-mode chart ramp brightened (old tail read "almost black"); a `tokens.html` example page added; Login wireframe corrected to match the centered styled screen; a dashboard first-run/empty-state wireframe (membership setup) added and linked from flow 5.1; the skeleton-vs-spinner bullet answered in plain words; flow 5.2 reframed around the user-facing "Correct entry" action; flow 5.3 redrawn to remove the app-initiates-payment step.
- **Resolved pass 5:** flows weren't rendering — `index.html` §flows linked to raw `flows/*.md`, which the browser serves as plain text, so the fenced `mermaid` blocks never reached the page's own loader. All five are now embedded inline under their own `<h3>`; the `.md` files stay as the diffable source. Fixing this also surfaced a real, previously-untested syntax error in the dashboard-glance flow (an unescaped quote inside a node label) — fixed in both the embedded copy and the source. All five confirmed ≤782px (the content-column width) via the architect's render.py measurement method plus a live browser check; four of five exceed the raw 720px mmdc threshold intrinsically (954/886/896/1200px) but fit the real container through the same CSS scale-down already proven for ARCH's diagrams.
