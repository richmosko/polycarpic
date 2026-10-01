# Design System Spec

> The written companion to `tokens.css` + `screen.css`. The CSS files are the machine-readable source of truth; this doc explains the *why* and the usage rules. Owned by the `ux-designer` agent. Generate/refine with `/generate-designdoc`.

**Revision history:** Pass 1 (2026-09-28) inherited the cairn tracker's own palette — rejected, diverging from cairn is the goal. Pass 2 (2026-09-28) hand-authored an indigo/violet identity "inspired by" Monarch Money and Origin from general/training knowledge — rejected: the guessed hue matched neither product, and "Origin" was misidentified. Pass 3 (2026-09-28) derived a blue-primary, warm-neutral palette from team-lead's measured screenshots of the actual products (`temp/design-refs/`) — accepted as the base, most of **Inspiration** and **Typography** below is still that pass's work and still current. **Pass 4 (2026-09-30, this revision)** is the Principal's first review of the pass-3 result (`temp/2026-09-30-design-review-1.md`): the brand hue becomes neon green (`#2CFF05`, chosen because the project name relates to fruiting plants and it's likely the logo's dominant color), the warm/brown neutral scale is replaced with a faint tint of that hue, the sidebar inverts, the shell layout changes (full-width header, sidebar below it), and two new screens (Home, Login) are added. See **Foundations** for the updated palette and every contrast figure, and **Layout & shell** / **Sidebar** / **New screens: Home & Login** for the rest.

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
| `--chart-1`…`--chart-5` | `#1D9108` → `#061D02` | Sequential/magnitude ramp — unchanged, brand green |
| `--sidebar` | `#1F2528` | **Re-hued pass 5** (was green `#20291F`) — inverted, a dark blue-tinted surface floating on the light page (see Sidebar) |
| `--sidebar-foreground` | `#F2F2F3` | |
| `--sidebar-accent` | `#303B40` | |
| `--sidebar-accent-foreground` | `#F2F2F3` | |
| `--sidebar-ring` | `#05A9FF` | **Re-hued pass 5** (was raw `--brand` green) — the raw secondary blue, to fully remove the green cast from this component |
| `--positive` | `#15803D` | Gain / income / surplus — unchanged |
| `--positive-foreground` | `#FFFFFF` | Text on positive fill |
| `--warning` | `#B45309` | Caution tier — unchanged |
| `--warning-foreground` | `#FFFFFF` | Text on warning fill |

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
| `--chart-1`…`--chart-5` | `#C1FBB6` → `#29CB0B` | Unchanged, brand green |
| `--sidebar` | `#F7F8F8` | Inverted the other way — a light card floating on the dark page, reusing the light-mode canvas tone directly (now blue-tinted, so this stays consistent automatically) |
| `--sidebar-foreground` | `#1D1F20` | |
| `--sidebar-accent` | `#E3F0F7` | |
| `--sidebar-accent-foreground` | `#096FA5` | |
| `--sidebar-ring` | `#0078B8` | **Re-hued pass 5** (was `--primary` green) — the light-mode derived blue ink, since the raw `--brand-2` reads too close to this light sidebar's own near-white surface |
| `--positive` | `#52E0A4` | Unchanged |
| `--positive-foreground` | `#052E13` | |
| `--warning` | `#F3CA59` | Unchanged |
| `--warning-foreground` | `#33230A` | |

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

### Layout & shell (pass 4, header contents corrected pass 5)

**Principal direction (pass 4):** "Can we have the top header bar span the full width, and have the side-bar under the header?" — a shell restructure from pass 3's side-by-side sidebar+content grid.

New shell, top to bottom:
1. **Header** — full page width, top row, global chrome only (see Header, below, for exactly what lives here — corrected in pass 5).
2. **Body** — below the header, a two-column region: sidebar (left, now full-height as of pass 5, see Sidebar) + content (right). Each screen's own page title and page-specific actions (Refresh, tabs, "Confirm all", ...) live at the top of the content column, not in the header.

This is a genuine restructure, not a cosmetic tweak. See `wireframes/` and both styled screens for the built version.

### Header (pass 5 — Principal review 2)

**Principal direction:** "Can we have the entity selector on the right of the header? Ideally it would be the entity name + a cluster of avatars representing the membership. And at the [left] of the header would be the Product Icon with name to the right (Polycarpic)."

- **Left: brand lockup** — a product icon (`.brand-icon`, currently a plain `--primary`-filled square placeholder pending a real mark) + the wordmark "Polycarpic," `--font-heading` 700.
- **Right: entity selector** — the current entity's name + an **avatar cluster** (below), opening the entity switcher on click. Replaces pass 4's plain-text "Person — Mosko ▾."
- **What moved out of the header (pass 4 → pass 5):** the page title (e.g. "Dashboard," "Ledger") and any page-specific actions (Refresh, tabs, "Confirm all") that pass 4 put in the header move into the **content column's own `.header-row`**, at the top of each screen — the header is global chrome (brand + entity) now, not per-page chrome. Every wireframe and both styled screens were updated to this shape.

**Avatar cluster — new component (pass 5).** Overlapping circles representing the entity's membership:
- 24px diameter, `-8px` overlap (each circle's `margin-left`), a 2px border in whatever surface color it sits on (`--card` in the header) to cut a visible ring between overlapping circles.
- **Fallback is always initials** on a `--secondary` fill — no avatar-image asset exists for this product yet, so this isn't a "fallback for the rare case," it's the only case today.
- **Max 3 shown**, a 4th+ member folds into a "+N" chip in the same slot and style, continuing the overlap (not yet built in the two reference screens — both shown entities have ≤2 members; the overflow rule is stated here for frontend-lead to implement against a real membership count).

### Sidebar (pass 4 — inverted, card, collapsible; pass 5 — option A chosen, full height, re-hued blue)

**Principal direction (pass 4):** "Maybe we can play with an inverted background color for the sidebar. And while we are at it: Make it a card with the same rounded edges. I also want the ability to compact the sidebar to just icons."

- **Inverted:** in light mode the sidebar is a dark surface (`--sidebar` = `#1F2528`, blue-tinted as of pass 5, was `#20291F` green) floating on the light page; in dark mode it's a light surface (`--sidebar` = `#F7F8F8`, the light mode's own canvas tone reused directly) floating on the dark page. A user should never see two dark (or two light) surfaces stacked with no separation across a mode switch — "inverted" means relative to the page, in both directions.
- **Re-hued blue (pass 5).** The Principal, reviewing the pass-4 result: "check the background on the side-bar. Is that green biased? I want it more flat or blue-biased." It was — same hue family as the pass-4 primary green, just dark. Moved to the same blue hue (200.6°) as the pass-5 re-tinted neutral scale, rather than a true neutral grey, so the whole system (page canvas + sidebar) carries one consistent "barely blue" cast instead of introducing a third hue family. The sidebar's own focus ring moved too (`--brand-2` instead of the green `--brand`) so no green survives anywhere in this component.
- **Card:** `border-radius: var(--radius-lg)` (12px, same as any other card), with its own `padding` and a visible edge against the page canvas (a subtle shadow, not flush) — it reads as a floating panel rather than a flush structural rail.
- **Collapsible to an icon rail:** a compact state (~64px wide) showing only nav icons, no labels — expand restores the full ~240px width with labels.

**Expand/collapse cue — Option A chosen (Principal review 2, 2026-09-30).** Three options were sketched; the Principal picked **A: a chevron pinned at the sidebar's bottom edge, always visible, click to toggle.** B (hover-reveal) and C (keyboard + remembered state) are kept below as rejected alternatives, for the record — not implemented.

| Option | Mechanism | Status |
|---|---|---|
| **A. Chevron at the rail's bottom edge** | A small chevron/arrow button, always visible, click to toggle | **Chosen** |
| B. Hover-reveal | Collapsed rail shows icons only; hovering flies out full labels, pin to persist | Rejected |
| C. Keyboard shortcut + remembered state | `Cmd/Ctrl+B` toggles; state persists in `localStorage` | Rejected |

See `wireframes/sidebar-cues.html`, updated to mark A chosen.

**Full height (pass 5).** "Can we have the sidebar elongate down to fill the screen? Put the [collapse] icon at the very bottom." The sidebar card now stretches to the full height of `.shell-body` — which itself is a `flex:1` row inside `.shell`'s `min-height:100vh` flex column, so it's exactly "the remaining viewport below the header" when content is short, and grows to match content's own height when content is taller (the page scrolls, the sidebar — `position:sticky` — tracks near the top of view the whole way down). No hardcoded "100vh minus header px" number: this falls out of leaving `.shell-body`'s `align-items` and `.sidebar`'s `align-self` at their CSS Grid default (`stretch`), which pass 4 had overridden to `start` — removing that override is the entire fix. The collapse chevron, already pinned via `margin-top: auto` inside the sidebar's own flex column, now sits at the bottom of this full-height card rather than just below the last nav item.

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
| **Sidebar** | Primary nav — now inverted, a rounded card, collapsible to an icon rail (pass 4, see Sidebar) |
| **Skeleton** | Every async fetch boundary |
| **Sonner (toast)** | Import batch complete, draft confirmed/posted, reconciliation break |
| **Progress** | Import batch progress, safe-harbor paid-vs-required |
| **Header** *(pass 4, contents corrected pass 5)* | Full-width top bar — brand lockup left, entity selector right; page title/actions moved to the content column (see Layout & shell, Header) |
| **Avatar cluster** *(pass 5, new)* | Overlapping initials-on-`--secondary` circles in the entity selector — membership at a glance, max 3 + overflow (see Header) |
| **Public hero + feature call-outs** *(pass 4, corrected)* | Home — pre-auth landing page, product statement + brand identity + CTAs |
| **Split screen login** *(pass 4)* | Login — theme-aware form pane (full field list: OAuth, email, password + reveal + forgot-password, sign-in, sign-up link, legal footer) + always-branded visual pane, stacks on phone width |

**Top bar pattern (Monarch):** page title (left) + a secondary outline action + a primary filled CTA (right) — e.g. Dashboard: "Refresh" (outline) + nothing else; Ledger: "Confirm all" (filled, primary action for that screen). **Pass 4:** this pattern now lives in the full-width Header, with the entity switcher added to its left edge.

**Empty-state pattern (ARCH §2.4 — Dashboard ships in M3 with the tax panel empty until 1.0, allocation panel empty until M4):** an empty panel keeps its real card chrome (eyebrow label, card shape, dashboard-scale padding) and states plainly that the feature isn't set up yet, in `--muted-foreground` body text — no illustration, no skeleton (a skeleton implies "loading," not "not built yet" — conflating the two is misleading). **Copy never names an internal milestone or version id** (architect's nit, 2026-09-28) — "Not set up yet," not "Available in v1.0"/"Available at M4": these panels are staging-only today, but neutral copy survives either way OQ-8 (0.x releases) resolves, without leaking internal roadmap language to a user. Example: the tax-liability card shows the eyebrow "PENDING TAX LIABILITY" and "Not set up yet" — same card shape as the live version will have, so the dashboard's layout doesn't visibly shift when the feature ships. See `styled-screens/dashboard.html` for the built example.

**Still ours to set:** reduced-motion policy; loading-state discipline (per-feature).

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

| Screen | Data shown | Milestone note |
|---|---|---|
| Dashboard | Net worth + delta; cash-flow by period; recent activity; pending tax liability + safe-harbor gap; allocation actual-vs-target | Ships M3; tax panel empty until 1.0, allocation panel empty until M4 — see Component inventory § Empty-state pattern |
| Ledger | Draft transactions; posted transactions; reversals; Cash-in-Transit exceptions; actor attribution | |
| Accounts | Balance sheet by GL account and by custodial account (toggle); NAV delta; reconciliation status | |
| Entities | Entity list; memberships; invite action | |
| Securities | Lot table; allocation actual-vs-target; book-vs-market time series | |
| Import | Linked providers; batch progress; `import_batch` new/duplicate/needs-category counts | |
| Home *(pass 4, corrected)* | **No DTO** — public landing page, static marketing content, unauthenticated, no membership/ledger data at all | Not a package concern |
| Login *(pass 4)* | Unauthenticated — email/password, OAuth provider list (Google/Apple/GitHub, PRD §8); no ledger data | `packages/auth` |

---

## Provenance & shared tooling

polycarpic's own `cairn` tracker (`scripts/cairn/`) is a separate shadcn-svelte app with its own vendored preset and its own generated theme-variant pipeline (`gen_variants.py` → `docs/DESIGN/variants.css`). **This product's palette does not inherit cairn's tokens** (rejected at pass 1) — it's a fully separate identity derived from Monarch/Origin measurements (pass 3, this revision).

**CI hazard, in progress (POLY-78):** `scripts/cairn/tests/test_board_tokens_parity.py` asserts `docs/DESIGN/tokens.css` parity with cairn's board tokens and runs in the required `cairn` CI check — this divergence fails it until POLY-78 merges. Expected, not to be worked around. `docs/DESIGN/variants.css` has been removed from this branch (it belongs to cairn's generator, not the product) — expect a trivial merge conflict against POLY-78's own removal.

---

## Accessibility

**Target: WCAG AA.** Every pair below re-run for pass 5's palette via the standard WCAG relative-luminance formula against the exact hex values in `tokens.css` (script in `temp/`, `2026-09-30-ux-designer-wcag-contrast-check-pass3.py`).

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
| `--warning-foreground` / `--warning` (fill) | 5.02:1 |

**Light mode — non-text pairs (floor 3:1):**

| Pair | Contrast | Result |
|---|---|---|
| `--ring` / `--card` | 4.79:1 | PASS |
| `--sidebar-ring` / `--sidebar` (NEW `--brand-2`) | 6.00:1 | PASS |
| `--chart-1`…`--chart-5` / `--card` | 4.11:1 → 17.73:1 | PASS all 5 |
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
| `--warning-foreground` / `--warning` (fill) | 9.67:1 |

**Dark mode — non-text pairs (floor 3:1):**

| Pair | Contrast | Result |
|---|---|---|
| `--ring` / `--card` | 14.18:1 | PASS |
| `--sidebar-ring` / `--sidebar` (NEW, derived light-mode blue ink) | 4.51:1 | PASS |
| `--brand-2` / `--background` | 7.76:1 | PASS — this dark surface is exactly what `--brand-2` is for |
| `--chart-1`…`--chart-5` / `--card` | 8.87:1 → 16.32:1 | PASS all 5 |

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
- **Resolved pass 5:** flows weren't rendering — `index.html` §flows linked to raw `flows/*.md`, which the browser serves as plain text, so the fenced `mermaid` blocks never reached the page's own loader. All five are now embedded inline under their own `<h3>`; the `.md` files stay as the diffable source. Fixing this also surfaced a real, previously-untested syntax error in the dashboard-glance flow (an unescaped quote inside a node label) — fixed in both the embedded copy and the source. All five confirmed ≤782px (the content-column width) via the architect's render.py measurement method plus a live browser check; four of five exceed the raw 720px mmdc threshold intrinsically (954/886/896/1200px) but fit the real container through the same CSS scale-down already proven for ARCH's diagrams.
