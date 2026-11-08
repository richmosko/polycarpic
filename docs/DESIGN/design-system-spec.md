# Design System Spec

> The written companion to `tokens.css` + `screen.css`. The CSS files are the machine-readable source of truth; this doc explains the *why* and the usage rules. Owned by the `ux-designer` agent. Generate/refine with `/generate-designdoc`.

## What governs this system

This project's UI direction is **SvelteKit + shadcn-svelte** (Tailwind, headless primitives, LayerChart for charts) — PRD §8, kickoff §2.9. `tokens.css` is the downstream, machine-readable deliverable `frontend-lead` consumes into `apps/web`'s `app.css`. `screen.css` is component-level overrides on top of shadcn-svelte's shipped component CSS.

**The palette is hand-authored from measured references, not a vendored shadcn preset** (unlike cairn's own tokens — see **Provenance & shared tooling**) and not OKLCH (plain sRGB hex; this system doesn't need cairn's multi-preset theme-variant precision).

---

## Inspiration: Monarch & Origin

Monarch Money and Origin (`useorigin.com`) are inspiration, not templates. What this system took from each:

**From Monarch** (app screens, not its marketing site)
- Warm off-white canvas, pure-white cards, near-black ink; light is the primary mode.
- Net worth as a single-line area chart with a soft gradient fill.
- Account list grouped by type, with group deltas, sparklines and relative freshness.
- Segmented stacked bar plus legend for allocation.

**From Origin**
- Near-black dark mode with subtle white-overlay surfaces.
- Uppercase, letterspaced mono (`--font-mono`) for section and eyebrow labels.
- A calm blue for the secondary/informational role, and measured semantic hues for positive, negative and warning (darkened only as far as WCAG AA needs; see Accessibility).

**Shared**
- Card radius 12px, button/input radius 8px.
- One grotesque sans for the whole app, no display serif (both products reserve the serif for marketing headlines).

**Not taken:** the pill CTA (marketing-only), the display serif, and Origin's dark-first default. Screens with no direct analogue (Transactions review, General Ledger vs. Custodial Accounts, entity/membership) are original compositions.

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
| `--cat-1`…`--cat-7`, `--cat-other` | `#2CFF05` · `#05A9FF` · `#E2B003` · `#FF49D8` · `#06E5F7` · `#C67EFF` · `#FF67A4` · `#A8A39D` | Categorical (identity) palette, slots 1–2 are `--brand`/`--brand-2`, each with a dark `-foreground` label ink — § Categorical palette |
| `--cat-edge` | `rgba(29,31,32,0.35)` | The 1px edge on a categorical mark, `--foreground` at 35% — § Categorical palette |
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
| `--cat-1`…`--cat-7`, `--cat-other` | same values as light | Unthemed, like `--brand`; only the `-foreground` label ink changes, to `#070808` — § Categorical palette |
| `--cat-edge` | `rgba(242,242,243,0.25)` | `--foreground` at 25% — § Categorical palette |
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

#### Categorical palette

The `--chart` ramp encodes **how much**. Treemaps, Pack, Sankey and grouped or stacked bars need colour that says **which thing**, and a one-hue ramp cannot do that (its steps sit ~1.2:1 apart). `--cat-1`…`--cat-7` plus `--cat-other` are the identity palette. Method: the dataviz skill's colour formula (four colour jobs, six checks), computed with its `validate_palette.js`, never by eye.

**Hues: the brand colours, and five more at their brightness and intensity.** A Principal ruling sets this. Slots 1 and 2 are `--brand` and `--brand-2` themselves, literal and unthemed, and the other five match them: the brand pair measures OKLCH L 0.87 / 0.71, C 0.29 / 0.17, and every slot sits inside L 0.71–0.87. Chroma is the most sRGB allows at each hue's lightness, which is C 0.14–0.26: at their steps gold and cyan stop just short of the sky blue's 0.17. Fill values are the same in both modes. The hues skip the status arcs (red ~29°, orange ~48°, gain green ~150–162°). Seven hues, not eight: an eighth can pass the adjacent checks at the end of the order, but the only in-band candidates at least 15 ΔE from every slot in normal vision are pale pinks, off the brand's intensity and 2.1 ΔE from an existing slot under colour-blindness, so an eighth would be a near-repeat of a colour already in the set.

| Slot | Hue (OKLCH) | Fill, both modes | L / C | Contrast on `--background` / `--card` (light) | Label ink (light) | Label ink (dark) |
|---|---|---|---|---|---|---|
| `--cat-1` | neon green 142° | `#2CFF05` (= `--brand`) | 0.87 / 0.29 | 1.29 / 1.36:1 | `#1D1F20` 12.15:1 | `#070808` 14.72:1 |
| `--cat-2` | sky 243° | `#05A9FF` (= `--brand-2`) | 0.71 / 0.17 | 2.44 / 2.58:1 | `#1D1F20` 6.40:1 | `#070808` 7.76:1 |
| `--cat-3` | gold 88° | `#E2B003` | 0.78 / 0.16 | 1.90 / 2.01:1 | `#1D1F20` 8.23:1 | `#070808` 9.97:1 |
| `--cat-4` | magenta 338° | `#FF49D8` | 0.71 / 0.26 | 2.75 / 2.92:1 | `#1D1F20` 5.67:1 | `#070808` 6.87:1 |
| `--cat-5` | cyan 205° | `#06E5F7` | 0.84 / 0.14 | 1.46 / 1.55:1 | `#1D1F20` 10.68:1 | `#070808` 12.95:1 |
| `--cat-6` | violet 308° | `#C67EFF` | 0.72 / 0.19 | 2.53 / 2.68:1 | `#1D1F20` 6.17:1 | `#070808` 7.48:1 |
| `--cat-7` | rose 358° | `#FF67A4` | 0.72 / 0.19 | 2.56 / 2.72:1 | `#1D1F20` 6.09:1 | `#070808` 7.38:1 |
| `--cat-other` | neutral | `#A8A39D` | 0.72 / 0.01 | 2.36 / 2.50:1 | `#1D1F20` 6.61:1 | `#070808` 8.01:1 |

**Order.** All 120 orders of the five non-brand hues were enumerated, with the brand pair fixed at 1–2; the order here ties for the best worst case over adjacent pairs across seven slots and all pairs across slots 1–5. In so narrow a brightness band lightness cannot do the separating alone, so step and position do. Violet stays out of slots 1–5 because it collapses onto the sky blue under colour-blindness. Gold is stepped below its brightest because at L 0.85 (`#FFC400`) it is 1.6 ΔE from the neon under colour-blindness; at L 0.78 it clears the target.

**Validator results** (`validate_palette.js`, run against `--card` and `--background` in each mode). ΔE is OKLab distance ×100; CVD is the worse of protanopia and deuteranopia (Machado 2009, severity 1.0), target ≥ 8, floor ≥ 6 with labels; normal vision must clear 15. Separation does not depend on the surface, so one figure holds for both modes.

| Run | Result |
|---|---|
| Adjacent pairs, slots 1–7 (bars, stacks, Sankey bands) | **PASS**: CVD ΔE 12.0 (magenta↔cyan), normal 16.3 (violet↔rose) |
| All pairs, slots 1–5 (treemap, Pack: any two can touch) | **PASS**: CVD ΔE 8.3 (neon↔gold), normal 17.1 (sky↔cyan) |
| All pairs, slots 1–7 | **FAIL**: CVD ΔE 2.6 (sky↔violet), normal 10.2 (magenta↔rose). Six and seven series are for adjacent-pair forms, or direct labels on every mark |
| Chroma floor | **PASS**: all ≥ 0.10 |
| Contrast vs surface (≥ 3:1) | **WARN, light; waived.** 1.29–2.92:1 on `--background`/`--card`. Dark: PASS, ≥ 6.62:1 |
| Lightness band | **FAIL, both modes; waived.** Light band 0.43–0.77: neon, gold 0.78, cyan out. Dark band 0.48–0.67: all seven out |

**The waiver, and what pays for it.** By Principal ruling the light-mode 3:1 surface rule and the lightness band do not apply to categorical fills: the brand colours are the palette, and darkening them is exactly what the ruling rejected. Distinctness is not waived; the separation runs above still gate. Every categorical mark pays three ways, in every mode:

1. **A visible label or legend.** Colour is never alone; a chart that cannot label a mark shows it in its table view.
2. **An edge.** A 1px `--cat-edge` hairline on the fill, and a 2px surface gap between touching fills. `--cat-edge` is the page ink at partial alpha, so it reads as a darker step of whatever it sits on: `--foreground` at 35% in light mode, where an inset edge clears about 2:1 against the brightest fills and more against the page (neon 2.09:1 / 2.68:1, cyan 2.04 / 2.98, gold 1.94 / 3.69), and an outset edge is 2.14:1 on `--background`, 2.15:1 on `--card`. In dark mode it is `--foreground` at 25%, because the fills already clear the surface and the edge only has to show: outset 2.08:1 on `--card` and 2.00:1 on `--background`, a soft ring with no halo; inset it barely registers on the brightest fills (neon 1.00:1, cyan 1.04, gold 1.15) and needs to do no more. `--border` is not the edge: at 1.06:1 on the neon it disappears.
3. **Dark label ink on the fill.** Every `--cat-N-foreground` is dark: `#1D1F20` in light mode (tightest 5.67:1, magenta) and `#070808` in dark (tightest 6.87:1, magenta), AA throughout. Text is never set in a slot colour on a light surface.

**Status hues stay reserved.** No slot is red, orange or gain green, and a categorical fill never carries gain/loss: when a series means good or bad it wears `--positive`/`--destructive`, never a slot (one chart never mixes both). Status colours are text on signed figures with a `+`/arrow, and a slot is a labelled fill, so the nearest pairs are held apart by job as well as by distance: `--cat-3` gold↔dark `--warning` 10.1, `--cat-7` rose↔dark `--destructive` 10.7, `--cat-5` cyan↔dark `--positive` 11.1, `--cat-1`↔dark `--positive` 16.7.

**Fixed assignments: colour follows the entity, never its rank.** Filtering a series out never repaints the survivors.

| Set | Slot 1 | Slot 2 | Slot 3 | Slot 4 | Slot 5 |
|---|---|---|---|---|---|
| Accounting elements (GL treemap, Sankey, bars) | Assets | Liabilities | Equity | Income | Expense |
| Entity types (Entities Pack) | Person | Trust | Business | Household | Holding |
| Asset classes (Allocation map and bars) | Cash and cash equivalents | Fixed income securities | Marketable securities | Alternative investment assets | — |

The accounting elements and the entity types reuse slots 1–5; the two sets never appear on the same chart. An asset-class sub-category takes its parent's slot. Anything else (transaction categories in bars, Sankey flows) takes slots in order of first appearance, persisted per entity so a category keeps its colour across sessions; from the eighth series on, the tail folds into one "Other" in `--cat-other`.

**Usage rules (from the skill).**
- **A legend is always present for two or more series**; direct-label selectively (the tile or band that matters, the extremes), and let the table view carry every value. A label renders inside a fill only when it fits with padding, otherwise it moves outside the mark or to the tooltip; colour is never the only channel.
- **Separate touching fills with a 2px surface gap**, and edge each mark with the 1px `--cat-edge` hairline (§ the waiver above).
- **Large blocks stay quiet:** a treemap is the exception the label inks were built for; Pack circles and wide areas take the slot as a 3px stroke on a `--card`/`--muted` fill, not a solid fill.
- **Texture fallback:** one "Lines" fill at 45° (and its 135° mirror), inked tone-on-tone in a darker step of the slot's own hue. Opt-in only: the accessibility setting, print, or `forced-colors`. Never decorative, never on by default.
- **One series is one colour.** The bars of a single series all take one colour (`--chart-3`) and are never coloured by value; slots are for two or more identities.

### Secondary accent — job definition

A second brand hue needs an explicit job or it fights the first one for meaning. `--brand-2` / the blue `--secondary` family is used for:
- **Secondary buttons and surfaces** — anywhere `--secondary`/`--accent` applies.
- **Info-weight badges and callouts** — a step above `--muted-foreground` neutral, a step below `--warning`'s caution — e.g. "new feature," "beta," informational tooltips. Not a Financial-semantics status tier (those stay `--positive`/`--warning`/`--destructive`, see Financial semantics) — this is for product-chrome informational messaging, a different axis.
- **Selected / non-primary-active states** — e.g. a selected row in a list that isn't *the* primary action of the screen, distinct from `--primary`'s "main CTA" meaning.
- **Chart series 1** in genuine two-series comparison charts (nominal vs. inflation-adjusted, actual vs. target): `--chart-3`, mid-ramp blue. Series 2 takes the green identity: literal `--brand` on dark surfaces, `--primary` (`#148100`) on light surfaces. One representative green accent per mode is enough for a 2-series case; no second ramp is needed.

**Not used for:** anything `--primary` already owns (main CTAs, the brand's "default interactive" meaning) or anything a Financial-semantics tier already owns (gain/loss/caution/danger) — the point of giving it a job is so it doesn't become a second, redundant way to say what green or the semantic tiers already say.

### Typography

**Space Grotesk throughout the app**, following the shadcn template's grotesque-sans direction. One family for body and headings; `--font-heading` is an alias, so hierarchy is by weight and size, not face. Space Grotesk supports `tnum`, so `font-variant-numeric: tabular-nums` works on any figure; money columns still use `--font-mono`.

| Token | Stack | Notes |
|---|---|---|
| `--font-sans` | `'Space Grotesk Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` | Everywhere — body, buttons, inputs, table cells, headings, stat values |
| `--font-heading` | `var(--font-sans)` | Alias — no second family |
| `--font-mono` | `'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace` | Origin's own measured choice — uppercase letterspaced section/eyebrow labels, account numbers, ticker symbols, tabular figures |

**Two web fonts (Space Grotesk + Roboto Mono).** Roboto Mono is a real added cost over a system-mono stack — justified because its uppercase-letterspaced treatment is an adopted signature (Origin's section headers), not decoration. frontend-lead should subset it to uppercase Latin + digits if the eyebrow-label usage is the dominant one, to keep the request small.

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
| Brand app bar, plain pages (Get started, Admin) | 24px, left of the wordmark | Literal `--brand` on the bar (`#070907`) | 14.72:1 |
| Brand app bar, Home | Full, 32px, left of the "Polycarpic" wordmark | Literal `--brand` on the bar (`#070907`) | 14.72:1 |
| Login form pane (`.auth-logo`) | 24px, left of the wordmark, top-left | `--primary` | 4.75:1 light, 14.72:1 dark |

`.brand-mark` is the SVG's own class; the brand app bar's lockup container is `.brand-bar-lockup`.

### Layout & shell

The shell is shadcn's **sidebar-07** block (https://ui.shadcn.com/view/new-york-v4/sidebar-07).

1. **The sidebar fills the vertical *screen*, not the vertical *page*, and is a floating card with a gutter on every side.** `position: fixed; top/left/bottom: var(--shell-gutter)` (16px), `border-radius` on all four corners. Composition, top to bottom: brand row → nav (eight items) → avatar trigger (opens the user-menu popover to its right — see § Sidebar).
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

- **Breadcrumbs are the only place a page's title renders** — screens do not repeat it as an on-page heading. Most screens have a single crumb; the account register is the multi-crumb example ("General Ledger **>** Bank Y checking").
- **AI/agent, search, notifications, and a settings gear are not in this row.** They are not deleted as product surfaces — ARCH §2.4 keeps Search and Notifications as real screens/overlays and Settings as a real screen — only their *entry point in the top row* is absent. **Where they go instead is proposed, not decided:**
  - **Settings, Notifications** — proposed as items under the avatar popover (see § Sidebar). Marked "proposed" in the styled screens (`.proposed-tag`).
  - **Search** — proposed via a keyboard shortcut, plus a "Search…" entry in the "more" menu where relevant. No specific key combination chosen yet. Whatever surface ships, a Journal ID is a search key (§ General Ledger: tree & register).
  - **AI/agent** — no entry point proposed; no icon or disabled placeholder exists anywhere.
- **The "more" menu is contextual per page view** — its contents are that page's global actions, not a fixed list. Defined per screen:

| Screen | "More" menu contents |
|---|---|
| Dashboard | Refresh |
| Transactions | Sync Transactions, New entry |
| General Ledger (tree + register) | Export |
| Custodial Accounts | Sync, New provider item |
| Allocation | *(none specified yet — target editing opens from the gear on the Actual vs. target card)* |
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
2. **Nav** (`.sidebar-nav`) — eight flat items (see § Sidebar information architecture). Settings is not a sidebar item; its entry point is a proposed avatar-popover item.
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

**Eight flat sidebar items, no nesting, plus one proposed avatar-popover entry (Settings).** The icon-rail collapse works because every item is flat.

| # | Nav item | Absorbs | What it is |
|---|---|---|---|
| 1 | **Dashboard** | — | Cross-cutting summary — net worth, cash flow, tax, allocation snapshot. |
| 2 | **Transactions** | transactions and import status | The time-ordered transaction feed: one `Tabs` row in urgency order — Exceptions, Pending, Posted — one stage visible at a time, each tab carrying a **count badge** so every stage's load stays visible while another is open. It opens on Pending, the bank-feed review/match inbox (see § Transactions workflow); a non-zero Exceptions count does not take the default, its badge turns `destructive-soft` instead. An **account filter** at the right end of the tab row scopes all three at once, badges included; the sidebar lands on **All Transactions** (every custodial account), and the popover lists the custodial accounts as Custodial Accounts names them. Every row carries a muted **source line** under the payee — `landmark` icon + `<account> · <institution> via <provider>`, or `pen-line` icon + "Manual entry" — omitted where it only repeats the filter; with one account selected, Posted shows only the rows whose own leg posts to it. Row Date is the transaction date, never the time an entry was logged. Posted is transaction-scoped: every posted transaction is a row and carries its entry's Journal ID; an entry built from several transactions appears as several rows with one ID; the GL Journal entries card is the entry-grained view (§ Transactions workflow). Posted rows lead with the **Journal ID** (§ General Ledger: tree & register), which opens the **journal entry popover**. Import stats/status and the Sync Transactions / New entry actions live here; there is no separate "Import" item. Not the chart of accounts; see General Ledger for that. |
| 3 | **General Ledger** | the GL side of accounts | One `Tabs` row at the top of the content shows one section at a time: **Chart of accounts**, **Balance sheet map**, **Journal entries**. It opens to the chart-of-accounts **tree** (category → nature class → custodian sub-account, balances, a custodial marker naming the physical account behind a sub-account). Clicking an account opens that account's **register** — a separate page, breadcrumbed back to the tree — showing every line that hit it, in date order, with a running balance; each line expands to its full journal entry, and its Journal ID links to the GL card. The **Journal entries** tab lists every posted entry header for the entity by date, with page size, date range and sort. The register is account-scoped and running-balance-shaped; Transactions is transaction-scoped and time-ordered — genuinely different questions, not two views of one screen. |
| 4 | **Custodial Accounts** | the physical side of accounts, and securities | The physical-account view — one card per account, grouped by Institution or Account type, each showing **market value (EOD prices), book value (GL cost basis) and cash balance side by side, left to right, with Unrealized**, plus reconciliation status against the GL; a totals card sums the three figures across accounts. Each account that holds securities has a **lots sub-card**: a pull-down per security showing its lots and short/long/total current gain or loss, summed per security and per account. New custodial accounts and provider links are created via a New provider item dialog on this screen (aggregator, manual, or file-import source type; a discovered-account mapping step; token refresh; unlink, with the ≤24h revocation-lag note on the Vercel target). Link health (expired token, lost access, stale) shows as a badge on the card and a banner on Transactions. Sync here pulls positions and balances. |
| 5 | **Allocation** | allocation vs. target | A dedicated actual-vs-target page. |
| 6 | **Tax** | the tax liability view | Per entity and jurisdiction: pending liability, the safe-harbor gap and its status tier, next due date, the custodial prepaid-tax account, the year's installment timeline, and the "Post your payment" action (never "Pay"). The Dashboard's Pending tax liability card links here (§ Allocation, Reports & Settings → Tax; flow 5.4). |
| 7 | **Reports** | — | Balance Sheet, Income Statement, Cash Flow — the Dashboard's empty-state pattern (§ Component inventory) until POLY-M5 ships statements. |
| 8 | **Entities** | — | Entity list, memberships, invite, and create — every entity beyond the user's own Person entity is created here (§ Entities & membership). |
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
| Normal / on track | `--positive` or plain `--foreground` | Safe-harbor gap < 0 (prepaid ahead of the requirement); reconciliation clean; import fully matched |
| Caution | `--warning` | Safe-harbor gap ≥ 0, due date more than 14 days out (gap = 0 is exactly at the safe-harbor line, nothing in hand beyond it, so never on track); an unmatched transfer leg aged inside the Cash-in-Transit exceptions window; a manual entry and an imported transaction that match; a stale/expired provider link that still has cached data to show |
| Danger / overdue | `--destructive` | Safe-harbor gap ≥ 0 with the due date within 14 days or passed; exceptions-threshold breach; reconciliation break |

### Entity, account, and category badges — label + icon, not per-category hue

Meaning by label/icon/variant weight, not a dedicated hue per category.

| Category | Variant | Icon (Lucide, indicative) |
|---|---|---|
| Entity type — Person / Trust / Business (base); Household / Holding (parent) | `secondary` | `User` / `Landmark` / `Building2` / `Home` / `Layers` |
| Account — GL / Custodial | `outline` | `BookText` / `Landmark` |
| Tab count | `secondary`; **`destructive-soft`** on Exceptions when non-zero | none |
| Transaction — Draft / Posted / Reversed / **Corrected** | `secondary` / `outline` / `outline` italic / **`outline` + `brand-2`-tinted dot** | `Clock` / `Check` / `RotateCcw` / `Pencil` |
| Role — Owner / Manager / Viewer | `default` / `secondary` / `outline` | — |

Badges stay monochrome. Charts that need a hue per identity use the categorical palette (§ Foundations → Categorical palette).

### Correcting a posted entry — "Correct entry," not "edit" or "reverse"

The user-facing action and the underlying mechanism are two different claims. "The UI never offers an edit affordance on a posted row, only reverse" describes the *mechanism* correctly, but it is not what the user should be told to click.

- **Import is the immutable baseline.** An imported bank transaction is never altered after import, and the user never corrects an import row directly.
- **Nothing reaches the GL without a confirmation step.** Between import and posting, a draft is fully editable — category, tax-treatment tag, counterparty, amount allocation — as flow 5.3 describes. This is where a user fixes a mistake *before* it is load-bearing.
- **After posting, the user-facing action is "Correct entry," not "edit."** Clicking it does not mutate the posted row — under the hood it posts a full reversal of the original entry plus a new corrected entry (reversal-only, PRD §5) — but the user is never shown "reverse" as a verb for this, and never asked to construct the reversing entry themselves.
- **A corrected row carries a badge** (see table above) distinguishing it from a plain Posted or a standalone Reversed (e.g. a reversal with no replacement) row.
- **Click-through reveals the mechanism.** Opening a corrected entry's detail view shows the full underlying pair — the original entry's lines rendered shaded/struck-through, the reversal lines, and the new corrected entry, each block labelled with its Journal ID — so the double-entry trail stays fully auditable (Overview principle: "every number earns trust") without the top-level row ever using the word "reverse" as the primary affordance.
- **Auto-posted rows get the identical treatment.** A row posted by a recurring rule rather than a manual confirm shows the same `Posted` badge plus a small `posted by rule — <rule name>` attribution line underneath it, and offers the exact same **Correct entry** action as any other posted row. There is no separate "edit" affordance for a rule-posted row, and no different correction mechanism — actor attribution (user / auto-post rule / system job, PRD §5) changes who gets credited, never how a mistake gets fixed.

See flow 5.3 (§ User Flows) for the decision diagram and `styled-screens/transactions.html` for the built row action, badge, and click-through state.

---

## Transactions workflow

The product specification for the Plaid bank-feed → journal-entry pipeline (starting point: the Principal's sidebar interview). Governs the **Pending** tab on Transactions — see § Sidebar information architecture for where this sits in the nav, and flow 5.3 for the full decision diagram.

**Layout:** a high-density table/list of unposted raw rows. Clicking a row expands it vertically (Accordion/Expansion pattern) — the matching workspace opens inline, no navigation away from the feed.

**The two-line preview (every expanded row starts here):**
- **Line 1, the locked leg.** Always the custodial cash side, debit on inflows, credit on outflows, named by the row's own custodial account. Locked because it represents verified bank reality; never editable, here or in Split/Group.
- **Line 2, the suggested offset leg.** Always the opposite side from Line 1. The system scans historical rules and the Plaid category to pre-fill an educated guess (e.g. Accounts Receivable, Software Expense, Custodial Clearing). Shown as an inline search dropdown the user can override in place — never a blank field. The control shows the chosen account as a full path, and the dropdown lists paths (§ General Ledger: tree & register, Account path).

**Flow A — Split (one raw row → one multi-leg entry).** For a transaction that represents multiple contexts (e.g. a $1,200 payout that nets a $20 platform fee). The expanded row morphs into a multi-column grid; the user adds unlimited offsetting rows. A live validation loop disables "Approve & Post" until the split rows' total exactly matches the raw transaction's absolute total — never a partial or over/under split.

**Flow B — Group (many raw rows → one entry).** For compressing many micro-transactions into one summary entry (prevents GL bloat). The user checkbox-selects rows in the primary table; a floating bulk-action bar appears; "Group & Summarize" opens the **same journal-entry modal** used everywhere else, pre-filled with one aggregated primary line and the user's chosen balancing distributions. **This is one of the system's two many-to-one draft→entry relationships;** the other is a same-date matched transfer, whose two legs post into one entry. Every other posting path (manual entry, simple match, Split) is one draft (or one manual action) to one entry.

**The journal-entry modal, one component reused everywhere.** Header (date, memo) + legs (side, account, amount) — a near-full-screen `Dialog`, not a drawer, because entering legs needs most of the screen. Each leg's account control shows a full path and lists paths, as on Pending and in the Split grid. The same modal serves manual **"+ New entry"**, **"Correct entry"** (§ Correcting a posted entry, above), **Split**, and **Group & Summarize** — only the pre-fill differs per entry point.

**Posting gate:** a transaction cannot leave Pending unless **all** of the following hold —
1. Σ debits = Σ credits (balanced).
2. The accounting equation holds, per entity (Assets = Liabilities + Equity).
3. The entry date matches the bank date — or, for a date mismatch, the Cash-in-Transit clearing rule applies.
4. The posted draft links to exactly one journal entry. Several drafts may share that entry: a group, or a same-date matched transfer.
5. Every securities line has its lot write and a security with an asset class. A trade in an unmapped security therefore stays in Pending.

Any gate failure keeps the item in Pending — there is no partial post and no silent failure. **"Approve & Post"** collapses the expanded panel with a fade-out and removes the item from the unposted inbox once the gate passes.

**Posted is transaction-scoped: every posted transaction is a row and carries its entry's Journal ID; an entry built from several transactions appears as several rows with one ID; the GL Journal entries card is the entry-grained view.** Each row mirrors Pending's: the bank transaction as imported, its payee, source line and signed amount, under the Journal ID. A group and a same-date matched transfer each show one row per transaction with one ID; the rows sit together, because an entry has one date and same-date rows order by Journal ID. A status-column line names the shape (`grouped — 1 entry`, `matched transfer — 1 entry`). A split stays one row, with Category reading `Split` over its categories. A transfer whose legs land on different dates is two entries through Cash in Transit, so its rows carry two IDs. **Correct entry** on any row of a multi-row entry corrects that one entry, and every row of it then carries the corrected entry's ID and the `Corrected` badge. A reversal is part of the correction its Corrected row rolls up, and an opening balance is a system entry, so each is a Journal entries row and not a Posted row. The Posted badge counts rows; the Journal entries card counts entries, and the two numbers differ by design. The filter trigger right-aligns its popover at the row's end.

**Manual entries are Posted rows.** On All Transactions, an entry from the New entry modal is one row with its own Journal ID, however many legs it has, and its Amount is the entry's sum of debits, unsigned, because it has no bank sign. With one account selected it is one row for the leg on that account, signed like a bank row: a debit to a cash account reads +. It cannot exist outside a compliant journal entry, so it takes the same rules as every other row, Correct entry included. Its source line reads "Manual entry" with `pen-line` in place of `<account> · <institution> via <provider>`.

**Account filter on Posted: leg-level, one rule for every row.** With one account selected, Posted shows only the rows whose own leg posts a debit or credit to that account; All Transactions shows everything. An imported row's own leg is its transaction's cash leg, so a transfer shows only that account's row and its counterpart row does not appear, whether the transfer is one entry or two. A manual entry with a leg on the selected account shows as one row for that leg. A manual entry with no custodial leg, such as an accrual, shows only on All Transactions. The source line is omitted where it would repeat the trigger; a Manual entry line stays.

**Row Date is the transaction date.** Date on Posted and on the Journal entries card is the date the user entered on the entry, never the time it was logged. The New entry modal's Date field is that date, so a backdated entry sorts by it on both lists, while its Journal ID still orders by posting. The audit trail (actor, logged-at) lives in the Journal ID popover and the GL entry view, not in the list.

**Potential-duplicate warning.** While a manual entry is open in the New entry modal, each custodial leg is compared with imported transactions that are Pending or Posted. A candidate has the same custodial account, the same amount and direction, and a date within the entity's Duplicate detection window of the entry's Date, either side (Settings, default ±1 day). A candidate shows a caution-tier warning (`--warning`, `triangle-alert`) above the actions naming it: "Looks like Sep 12 · Stripe Payout +$1,500.00 on Primary Checking, Pending". The nearest date is named, and a Pending candidate wins a tie. The check reruns as Date, legs or amounts change, and the warning clears when nothing matches.

- **Match to that transaction instead** is the default action. It discards the manual entry and opens the Pending row's review panel, pre-filled with the modal's offset leg. For a Posted candidate the action reads **Open that entry** and opens its Journal ID popover, as there is no review panel left to fill.
- **Post anyway** takes the Post button's place, so Enter cannot slip past the warning. It posts the entry, and the row carries a muted `outline` `possible duplicate` badge under its status until the user dismisses it from the popover or matches the import. The badge is a review note on the row, not a ledger state: the entry posts like any other.

Only New entry and imports check, because Correct entry, Split and Group start from a real transaction.

**Mirror on Pending.** The same rule and window run on Pending: an imported transaction that matches a posted manual entry, whichever arrived first, shows a caution line on its row: "Looks like manual entry JE-000215 · Sep 11 · +$1,500.00". The line shows collapsed or expanded, and the Journal ID opens that entry's popover. The nearest date is named, and an entry already linked to an import is no longer a candidate. The review panel adds **Match to that entry** as its default action, and Approve & Post steps down to an outline button beside it so Enter cannot slip past it. 

**Match to that entry** links the import to the existing entry and posts nothing: the row leaves Pending, the entry stays as it is, and the Posted count holds. The entry's row gains a `matched import` status line and loses any `possible duplicate` badge, and its popover lists the import. Approve & Post past the caution keeps both. Dismiss possible duplicate on the entry clears the caution on the row it names.

**Journal entry popover.** Clicking a Journal ID on Posted opens a `Popover` anchored to the ID, not a navigation, so an entry can be read without leaving the list. Header line: Journal ID with copy (always visible here), transaction date, actor, "logged <timestamp>", status badge. Body: every leg, in `.trail-row` markup with its side and its account's full path, then the correction trail if any: the original and its reversal, since the entry's own legs are already above. Footer: **Open in General Ledger**, to `general-ledger.html#je-…`, plus **Dismiss possible duplicate** on a row that carries that badge. It is non-modal: an outside click or Esc dismisses it and focus returns to the ID. A long trail scrolls inside the popover and the footer stays visible. The popover is where Posted shows the actor and the logged time, as the list has neither. **View correction** on a Corrected row is a separate control: it expands the trail in place. The account register keeps its ID as a link (see Journal ID links).

**Cross-entity transfers.** A transfer between two entities the user manages posts one entry per entity, and the draft carries one choice, shown as two option cards (`RadioGroup`) above a preview with one block per entity. **Contribution / distribution** is preselected. **Due-to / due-from** is the alternative. Each card says in plain language what it does to both balance sheets, and the due-to / due-from card says repayment is expected:

- *Contribution / distribution:* "The money has moved for good, and nobody owes anybody. <Sender> records a distribution: its cash and its equity each fall by <amount>. <Receiver> records a contribution: its cash and its equity each rise by <amount>."
- *Due-to / due-from:* "This is a loan, and repayment is expected. <Sender> swaps <amount> of cash for money it is owed, so its total assets and equity stay the same. <Receiver> gains <amount> of cash and owes the same amount, so its equity stays the same. Both balances stay open until it is repaid."

The preview's legs follow the choice, and each entity's cash leg stays locked. Pairing and posting need Manager on both entities; without it the row offers no Approve & Post and says which entity needs a Manager. A later change of mind is a Correct entry. Transfers inside one entity are unchanged and carry no choice.

**Trade drafts.** A brokerage draft splits by nature before posting: one locked cash leg, then one line per security under its nature account (`Assets › Marketable securities › Schwab brokerage`), each with a note naming the security, quantity and lot action. The line's class comes from the security's mapping, so it is not editable on the row; changing it means changing the mapping. A trade in a security with **no mapping** stays in Pending with a caution line ("ARKK has no asset class yet, so this trade cannot post."), Approve & Post disabled, and an inline **Map security** form (Asset class: the four fixed classes; Sub-category). Mapping is per security, so it clears every waiting trade in that security at once and removes it from Allocation's unmapped gap. Allocation's gap row and the known-delta badge on Custodial Accounts both link to this row.

**"show N" selector:** each of the three tabs (Exceptions, Pending, Posted) has its own limit selector — a user with a large Posted history isn't forced to render all of it; Posted is paged, Exceptions/Pending show their full (usually small) count by default.

**Permissions:** New entry, Sync, Split, Group, Approve & Post, Match to that entry, Map security, the transfer treatment choice, Dismiss possible duplicate, and the rule auto-post opt-in are Manager/Owner actions — a Viewer sees none of these affordances anywhere on this screen (SECURITY §4.2.1 matrix, ARCH §2.4 permissions table).

---

## General Ledger: tree & register

General Ledger is three sections behind one `Tabs` row at the top of the content, one visible at a time: **Chart of accounts** (the default), **Balance sheet map** and **Journal entries**. Each section keeps its card header. The URL hash carries the tab, so Back from a register returns to the tab it left, and a `#je-…` link selects Journal entries.

The Chart of accounts tab is the **chart-of-accounts tree** in a titled card — category → account → sub-account, each row showing its balance. Under Assets the accounts are the four nature classes, the same four that head Allocation: Cash and cash equivalents, Fixed income securities, Marketable securities, Alternative investment assets. Each class has a sub-account per custodian, named for it: institution + account type ("Schwab brokerage", "Bank Y checking"), with the number mask added when one institution holds two of a type ("Schwab brokerage ··4821"); when the second appears, the first takes its mask too, so neither name is ambiguous. A sub-account belongs to one custodial account; a custodial account has one sub-account per class it holds, so a brokerage appears under Cash, Fixed income and Marketable, and its book value on Custodial Accounts is the sum of those rows. Prepaid tax sits beside the classes, with one sub-account per filing year, because it has no nature class. So does **Real estate**, one account per property with no custodian, no lots and no reconciliation, carried at the value the user books: it counts in net worth and the balance sheet, never in Allocation. Clicking an account opens that account's **register** as its own page, breadcrumbed back to the tree.

- **The custodial marker.** A sub-account that belongs to a custodial account carries a small custodial badge (`landmark` icon + the custodial account's name, as Custodial Accounts names it). The sub-account's own name already gives institution and type, so the badge does the other job: it ties the row to its card, and the same badge under several classes shows one account spanning them. It is a cross-reference only, not a second data source; the figure shown is always the GL's own balance. Class rows carry no badge. Not every account has one (Owner's Equity, Cash in Transit never do).
- **The register is account-scoped and running-balance-shaped:** every line that hit this one account, in date order, with a running balance. Each line's chevron expands to its full journal entry in the same `.correction-trail` block as the Journal entries card (every leg, not just the one that hit this account, plus the correction trail where one exists), and its Journal ID links to the GL card. The register has no Actor column, so the block's labels name the actor. The same "every number earns trust" principle as the Dashboard.
- **Distinct from Transactions, deliberately.** Transactions (§ Transactions workflow, above) is transaction-scoped: every posted transaction is a row and carries its entry's Journal ID; an entry built from several transactions appears as several rows with one ID; the GL Journal entries card is the entry-grained view. The register is the opposite cut: one account, every entry that ever touched it. Neither view replaces the other.
- **Journal entries card.** Posted entry headers, not lines, listed by date, newest first; same-date entries order by Journal ID. This is the audit view, so it lists every header: a correction's original, reversal and corrected entry are three rows here, where Transactions' Posted tab rolls them into one Corrected row. Columns: Journal ID, Date, Description, Actor (a user, a rule with its name, or System), Status (Posted, Corrected, Reversed; § Correcting a posted entry), Amount. Amount is the entry's sum of debits, unsigned, because an entry has no single direction. Controls sit in one row at the card top: **date range** (default This month, by ruling: it matches the month-to-date figures in the tree), **sort** (date, amount or Journal ID, each both ways) and the normal **show N** limit; a paged footer closes the card. The title's count reads "<in range> of <all> entries". A chevron opens an entry's legs in the same `.correction-trail` block as the Posted tab, a Corrected row showing its whole chain. Reversal rows name each other by Journal ID. **Correct entry** sits in the opened block of a live Posted entry; an entry already reversed, and the reversal itself, offer none. Viewers see no Correct entry.
- **Journal ID.** The exact reference for a posted entry: a short per-entity display number, `JE-000214`, assigned at posting: gapless, serialized per entity, never reused (the mechanism is ARCH's). A reversal and a corrected entry each take their own number. It is distinct from the entry's UUID key, which is never shown, and the data model has to add it (ARCH keys every row by UUID). It leads every view of posted work (Journal entries card, Transactions' Posted tab, account register), in the mono face, with a Lucide `copy` control on row hover or keyboard focus, always visible on touch; a corrected row carries the corrected entry's ID. It also labels each block of an opened entry, and the journal-entry modal shows it read-only: a new entry reads "Journal ID assigned at posting", Correct entry shows the ID being corrected, and the "entry posted" toast names the new number. The ID orders by posting; Date is the entry date, so a backdated entry sorts differently on the two.
- **Account path.** A leg always names its account by full path, root to leaf: "Assets › Marketable securities › Schwab brokerage", "Expenses › Office Expense". The path comes from the chart of accounts, so it has as many segments as the account's depth. This holds wherever a journal entry's legs are listed: the Journal entries card, Transactions' Posted expansion and correction trail, the journal entry popover, the account register expansion, the Pending preview, the Split grid and the journal-entry modal. Two accounts with the same leaf name stay distinct, and the leg shows where it sits on the balance sheet. Ancestors and separators are `--muted-foreground`, the separator is the breadcrumb's `chevron-right`, and the leaf keeps the row's ink so it reads first; on a struck or locked row the leaf follows that row. An account control shows the chosen account as a path and its list holds postable accounts only, as paths. In plain text, such as a `title` or a native `<option>`, the separator is `›` (U+203A). The tree and the treemap show the leaf alone, because their position already gives the path.
- **Leg side.** A leg's debit or credit is not part of its path: "DR" or "CR" sits in its own fixed column before the path (`.leg-side`: 2.5ch, mono, uppercase, `--muted-foreground`), 8px from it, so every path in a block starts at the same x and the side can be scanned down the column. The column is the same wherever legs are listed, as above, and a struck or locked row applies its treatment to it too. The Pending preview labels a leg "Line 1 · CR" with the same tag. The tag is an `<abbr>` titled "Debit" or "Credit", so hover and assistive tech get the full word. Where the side is editable, in the journal-entry modal, the same tag is a narrow native `<select>` holding DR and CR.
- **Account path at narrow widths.** Below 320px of row width the middle segments collapse to "…", keeping root and leaf: "Assets › … › Schwab brokerage". A two-segment path has nothing to collapse. The full path stays in the tooltip and the accessible name.
- **Journal ID links.** On the account register the ID is a link to that entry's row on the Journal entries card (`general-ledger.html#je-000212`). On Transactions' Posted tab the ID opens the journal entry popover instead, and its Open in General Ledger footer goes to the same row (§ Transactions workflow): Posted reads an entry in place, while the register is already inside the ledger. Arriving selects the Journal entries tab, highlights the row and opens its legs, and the card widens its date range if the entry falls outside it. The card itself shows the ID as text, since the row is the destination. The ID is also searchable: an exact `JE-000212` in search resolves within the active entity to the same row. No search surface is drawn yet (§ Header), so this states the intent for whichever surface ships.
- **Reversed entries stay listed, muted.** The Journal entries card lists Reversed originals and their reversals by default, with no filter to reveal them, because it is the audit view. Both rows render in `--muted-foreground`, badge included, and the Reversed original's description is struck through; a row's secondary line is not struck, so "reversed by" stays readable. The Journal ID keeps full ink on both rows: it is the reference. The corrected entry that replaces them is live and renders normally.

See `styled-screens/general-ledger.html` and `styled-screens/account-register.html`.

### Treemap prototype — balance sheet map

A nested treemap of the chart of accounts, prototyped on the Balance sheet map tab of `styled-screens/general-ledger.html` (static layout from one squarified pass; the build would use LayerChart's `Treemap`). Nesting is category → nature class → custodian sub-account, area is |balance|, and every tile links to its register. A class with one custodian draws as one tile labelled with the class, since the leaf alone would repeat across classes; its accessible name carries the full path.

**What the prototype settles:**
- **Balance sheet only, two equal halves.** Assets on the left; Liabilities + Equity on the right. The accounting equation makes the halves equal in area, so the map shows the equation itself: a reader sees at once that the halves balance. Income and Expenses are period flows, not balances; on one area scale with balances they are invisible (month-to-date $2,400 against $362,745) and they would break the equal halves. They are not on this map. An income-statement counterpart (Income | Expenses + net income, also equal halves) belongs with Reports if it is wanted.
- **Colour by element, from the categorical slots.** Assets `--cat-1`, Liabilities `--cat-2`, Equity `--cat-3` (the accounting-element assignment, § Categorical palette), each label in its slot's dark `-foreground` ink: 12.15 / 6.40 / 8.23:1 in light mode, 14.72 / 7.76 / 9.97:1 in dark. Tiles keep a 1px `--cat-edge` hairline and a 2px `--card` gap (§ Categorical palette → the waiver). The slots are distinct hues, validated all-pairs, so colour separates the elements; the halves and their captions still carry the meaning, and colour is never alone.
- **Credit-balance accounts are fine.** Liabilities and Equity carry credit-normal balances; |balance| gives them positive area on their own side.
- **Labels are fixed-size HTML, clipped by container query:** the value hides under 96×38px, the name under 64×22px; an unlabelled tile names itself on hover, focus and to assistive tech (full path in its accessible name). Text inside a scaled SVG `viewBox` shrinks with the card and is unreadable at 960px, so labels must not scale with the layout.

**What does not work, or needs a rule before build:**
- **Tiny accounts vanish.** On the reference entity, Liabilities are 2.2% of a half and draw as a thin strip; Prepaid Tax is 0.9%. A household ledger is dominated by a home and a brokerage, so the accounts used daily (checking, cards) are the smallest tiles: the map says least about what the user touches most. The card lists every tile below a size floor in a "too small to draw" note with links; a minimum tile size is rejected because it misstates proportions.
- **Contra and wrong-side balances.** A contra account (accumulated depreciation) or a balance on the wrong side of its element (an overdrawn checking account, a card in credit) would add area where it subtracts. Rule: net it into its parent for area, and list it in the note with its sign.
- **Zero balances** have no area and are omitted; the tree stays the complete list.
- **Negative equity** (liabilities above assets) breaks the equal halves: the right half is Liabilities alone and the left is smaller. Proposed: a hatched "deficit" tile in the Assets half, sized to |equity|, so the halves still balance. Not prototyped.
- **Resize.** The prototype positions tiles by percentage of one 900×240 layout, so tiles stretch at 960px; the real component re-lays out on resize. Below ~600px wide the map is unreadable: hide the card under the `md` breakpoint.
- **Accessibility.** A treemap is not navigable as a structure by a screen reader. Tiles are links with full-path names, but the tree remains the accessible primary view; the map is a supplement, never a replacement.
- **LayerChart specifics are unverified:** its tiling method, padding options (for group outlines) and label slot were not checked against the docs page, which renders client-side. Confirm before build.

**Second instance.** Allocation's current-allocation map (§ Allocation, Reports & Settings) reuses this pattern with a class header strip added, because its sub-tiles share their class's fill.

**Recommendation: go, scoped.** Ship the balance-sheet map (Assets | Liabilities + Equity, equal halves, categorical fills, size-floor note) as the Balance sheet map tab on desktop widths; it earns its place by making the accounting equation visible. No-go on a single five-element map of the whole chart of accounts: flows and balances do not share an area scale.

---

## Custodial Accounts: lots & provider setup

"Sub-card in the Custodial view... pull downs of each security to show lots. And for the Allocation vs target to be a dedicated page." Lots live here; allocation vs. target is its own screen (§ Allocation, Reports & Settings).

**Three figures on every account, side by side.** Each custodial-account card shows, in one row, left to right in this order — market value, book value, cash, then the derived Unrealized = market − book. Cash sits last so the row reads as "market and book include cash": the two totals first, the cash already inside them after.

| Figure | What it is | Source |
|---|---|---|
| **Market value · EOD** | Cash plus every lot at the latest end-of-day price | Cash sub-account + lots × daily EOD price feed |
| **Book value · GL** | Cost basis of everything in the account, cash included: the sum of its ledger sub-accounts, one per nature class | General Ledger |
| **Cash** | The account's cash sub-account: a brokerage's sweep cash and money-market funds, which carry no lots; the whole balance of a bank account | The GL's cash sub-account balance; when the custodian reports a different figure, the card's details show it |
| **Unrealized** | Unrealized gain or loss, signed and coloured per § Delta coloring | Derived |

A cash-only account shows the same row with the three figures equal and a `$0.00` delta: the row keeps one shape on every card, so accounts scan as a column. A **totals card** above the account cards sums the same four figures across every custodial asset account for the entity, with the price date ("prices as of <date> close"). Unrealized on an account equals its lots sub-card's total unrealized gain; the two figures must agree.

**Group by Institution or Account type.** A `Tabs` toggle sits under the totals card and above the groups, labelled "Group by": **Institution** (the default) · **Account type**. Institution is the default because a provider link belongs to an institution: its sync, token and re-auth reach every account there, so a broken link reads as one group. Account type is the accountant's cut, seeded Checking, Savings, Brokerage, Crypto wallet, Credit card. The choice persists per user, like other view toggles. Institutions sort by market value, largest first; account types keep that fixed order, and a type with no accounts draws no group. A **group header** is a label on the page background, not a card: name, account count, then summed market value, book value and cash, in the card's order. The cards under it are unchanged, and the totals card does not change with the grouping.

**A credit card is a liability.** Its card keeps the row's shape: market value and book value both show what is owed, as a negative in plain ink (`−$1,204.00`, not a loss, so no `--destructive`); cash and Unrealized show a dash, because neither applies. In a group header the negative nets into market and book value, and cash stays the cash of the group's asset accounts. The totals card sums asset accounts only, which is the figure Allocation reads, and a line under it states what is owed on credit cards and the net.

**Per-account card:** a chevron and the account and institution names on the left; two badges on the right, in a fixed order; the three-figure row below. The first badge is link health, the second reconciliation against the GL (clean / stale / break, per the status tiers — the danger tier surfaces on the Dashboard too, per flow 5.5). Link health comes first because a reconciliation is only as current as the link behind it. A card rests collapsed to its header and figures, so status reads at a glance and costs one row. The chevron (the `.alloc-disclosure` idiom, a `Collapsible`) opens the card's **details**: first reconciliation, the custodian's figure against the GL in words and the link to any staged drafts; then, on an account that holds securities, the lots sub-card with its pull-down per security. Each card opens on its own. Allocation's holdings popover links here and arrives with the cards of the accounts it lists open. Allocation's totals read these same figures: market and book across asset accounts. A difference explained exactly by the account's staged drafts is a **known unposted delta**, not a break: the header carries a muted `Known delta` badge (clock icon, `--muted` fill, no status hue) naming the draft count and amount and linking to those drafts in Pending on Transactions, and the details show the custodian's figure and the same link.

**The lots sub-card (only on accounts that hold securities):**
- One row per security, collapsed by default — a pull-down (chevron) reveals its individual lots.
- Each lot shows market value, book value (the same left-to-right order as the account row), and its own short-term or long-term unrealized gain/loss.
- The security's own row shows its summed book/market/gain across all its lots.
- The account's lots sub-card totals short, long, and total unrealized gain/loss across every security; the total equals the card's Unrealized figure. There is no separate book-vs-market chart.

**The New provider item dialog:**
- **Source type**, chosen first: aggregator (Plaid/SimpleFIN/fake), a manual account (no live link), or an imported file (CSV/OFX).
- **Discovered-account mapping** (aggregator path only): a provider item can surface several accounts at once (e.g. a bank's checking + savings); each discovered account maps to an existing or new custodial account — a provider item is a first-class record that owns its discovered accounts (ARCH §3 data-model note), not folded directly into one custodial account.
- **Token refresh** and **unlink** live in the same dialog. Unlink states the revocation lag explicitly on the Vercel deployment target: access may persist up to 24h after unlinking.
- **Sync** (on Custodial Accounts, with a Sync Transactions counterpart on Transactions) pulls **both** balances and positions here — not transactions-only, which is what Sync means on Transactions.
- **Import file** is the manual/file-source counterpart to Sync — same place, different action, for an account with no live aggregator link.

**Link health** (expired token, lost access, stale) is a badge on the custodial-account card here, and a banner at the top of Transactions — one state, shown in both places a user would reasonably look for it.

**Permissions:** New provider item, token refresh, unlink, and Sync/Import file are Manager/Owner actions — a Viewer sees none of them (same posture as Transactions' posting actions, ARCH §2.4 permissions table).

See `styled-screens/custodial-accounts.html`: two cards are open, Primary Checking for reconciliation and Brokerage for its lots sub-card with one security pulled down, and the provider-item dialog is shown open below the cards as the reference.

---

## Allocation, Reports & Settings

**Allocation.** A dedicated page in two cards: the current allocation as a treemap, then actual vs. target. Both aggregate by asset class across every custodial account for the entity — not a new data source, a different aggregation. The four classes are the ledger's nature classes, so the top level has two readings and each ties to its own total: market (lots by the security's class, plus cash) ties to Custodial Accounts' market value, and book (the nature accounts) ties to its book value and the General Ledger tree. The page shows the market reading. No nominal/inflation-adjusted toggle: allocation is a contemporaneous snapshot of today's holdings, so a CPI-U restatement adds no information (the toggle, PRD §4.10, lives on time-series views). The hierarchy has three levels: tier, class, sub-category. Tiers and the four classes are fixed, because the ledger is organised by them; the target editor offers no way to add or remove a class. Sub-categories are a per-security mapping outside the ledger, seeded with defaults and editable: add, rename and remove live in the editor, under each open class (Current: Cash and cash equivalents → Cash, Money market. Non-Current: Fixed income securities → Treasuries, Corporate, Municipal; Marketable securities → US Large cap, US Mid/Small cap, Intl Developed, Intl Emerging; Alternative investment assets → Digital Assets). Geography stays in the sub-category name, so the hierarchy keeps one chevron depth. **Money market** under Cash reads the provider's reported position for each custodial account, the rest of that account's cash balance is Cash, and the two always sum to the ledger cash; a reported figure above the cash balance shows as a reconciliation gap, never as negative cash, and a manual or file custodial account, which reports no positions, shows all its cash as Cash. Real estate and the other accounts with no nature class are outside Allocation altogether: no tile, no class, no target. A tier is a label with its share, never a colour. Every asset class has its sub-categories behind a chevron pull-down (the lots sub-card's disclosure pattern). The Actual vs. target card's class rows expand the same way, each sub-row with its own actual / target and drift badge. The target editor is two-level: class targets must total 100%, and each class's sub-targets (whole-portfolio percent) must sum to that class's target, shown per class as a positive soft "Sub-targets sum to N%" badge or a neutral outline "N pt unassigned"; Save stays disabled until both levels reconcile. Each tile, class or sub-category opens the holdings behind it in place. Flow 5.6.

- **Current allocation map.** The top card, so the shape of today's holdings reads before any comparison: the second instance of the treemap pattern (§ General Ledger → Treemap prototype), with the same tile, label, gap and hairline rules. Nesting is tier → asset class → sub-category; area is share of market value, and the card states the total, which is Custodial Accounts' market-value total. The tiers are two columns sized to their share and 8px apart, each captioned above the map in plain text with its percent, as the balance sheet map captions its halves; here the widths follow the data rather than being equal. Each class is one rectangle in its fixed slot, 1–4 (§ Categorical palette), and a sub-category takes its parent's slot, so a class reads as one block with hairline divisions. Because a class's sub-tiles share a fill, a **class header strip** (`.tm-head`) names it: class, percent and, where it fits, dollars. The strip sits inside the class rectangle, so class areas are exact and sub-tiles compare within their class; the percent labels compare across classes. Every labelled tile shows name and percent, and dollars where they fit. A strip too narrow for its name takes two lines. A class with one sub-category draws as a single tile, the strip alone. A tile too narrow for its name, and the sub-category of a single-tile class, is listed in the note under the map with its link, percent and dollars.
- **Unmapped holdings are a visible gap.** A position the custodian reports whose security has no class mapping is in no class and in no lot, so it would otherwise vanish. It is never excluded silently: a gap row closes the Actual vs. target card (name, what was reported, dollars, a `warning-soft` "Map N securities" badge) and the note under the map names it. The figure sits outside the page total until mapped, and the row links to the staged trade in Pending, which holds the mapping action (§ Transactions workflow). With nothing unmapped the row and the note's sentence are gone.
- **Identity and detail.** A legend names the four classes, and every class is also named on its strip, so colour is never alone. The mock's hover layer is the native `title`; the build's tooltip shows full path (Non-Current › Fixed income securities › Municipal), percent, dollars, target and drift. The Actual vs. target card is the map's table view, with the tiers as group headers: every percent and target is there, and it is the accessible primary view, the map a supplement. Under the `md` breakpoint the map card hides, as the balance sheet map does.
- **Holdings popover.** A class spans accounts, so no single Custodial card can show it, and the drill stays on the page: each tile, class name and sub-category name is a button that opens a read-only shadcn `Popover` anchored to it, the target editor's 520px surface. Non-modal; Esc or a click outside closes it, with no guard because nothing can be lost. Below the `md` breakpoint it opens as a full-width `Dialog`. **Header:** name, tier path, actual percent and dollars, target, drift badge. **Body:** the holdings behind that figure, grouped by custodial account, largest first, with the account's share of the figure. Each account group is the Custodial card's `.lots` block, so a security row and its lots pull-down are the same component: ticker, quantity, market, book, unrealized. A cash sub-category lists one cash balance per account, and Digital Assets the wallet; a row with no lots has no chevron. **Footer:** the aggregate market, book and unrealized, which equal the figure it opened from, and one link, Open Custodial Accounts, which arrives with the cards of the accounts listed open. Viewers can open it. The styled screen renders it open for Cash as a reference below the cards, with a sample holding that has lots beneath it.
- **Target editor popover.** A `settings` (gear) icon button at the top right of the Actual vs. target card (`aria-label="Edit target allocation"`, `aria-haspopup="dialog"`) opens the editor in a shadcn `Popover` anchored to it, right edges aligned. Non-modal, so the bars stay readable while targets change; it holds about eight inputs, so it takes the `.je-popover` surface at 520px with a scrolling body, tier headers over its classes, and the Save rule, Total, Cancel and Save target stay in the footer. Cancel or Esc closes it and discards the edits; a click outside closes it only when nothing has been edited, so a stray click cannot lose them. Focus moves to the first input on open and returns to the gear on close. Below the `md` breakpoint it opens as a full-width `Dialog`. Viewers get no gear. The styled screen renders it open, as a reference below the card.

**Reports.** A nav item **from day one**: "its own sidebar item from day one... built in POLY-M5 (Statements); until then it shows the Dashboard's empty-state pattern." Three statements — Balance Sheet, Income Statement, Cash Flow — behind the same `Tabs` pattern used elsewhere. Before M5, every tab uses the empty-state convention (real card chrome, "Not set up yet," no milestone/version naming) rather than being hidden or disabled — the nav item itself is never gated on the feature shipping. **Between closes** the Balance Sheet and NAV add one computed line, "Estimated tax since last close", with an `outline` `Estimate` badge, above Net assets, and "Last closed through <date>" sits under the statement. The line covers every unfiled year, is not a ledger balance, and stays out of the trial balance. Both arrive with tax, so statements before that render without them. Assets list the four nature classes, then Real estate and Prepaid tax beside them. A parent's consolidated Balance Sheet carries the roll-up's lines: the four classes, **Other assets** (the no-class accounts, at book), liabilities and net worth.

**Settings.** Batch-import scheduling ("all the option selections for batch scheduled imports") plus general app preferences. Two scopes that must not be conflated: **per-entity** (import schedule, CIT exceptions threshold, duplicate-detection window, which also governs manual-entry duplicate warnings, and the reporting-period close cadence, monthly by default or quarterly, shown only on a taxpayer entity — a Household's schedule doesn't touch a Person entity; and **Export this entity** for owners, with its fingerprint receipt) and **per-user** (theme, default entity on login, reduced motion; **Sign-in and second step**; **Delete your account**). The last three are specified in § Access & account safety. Viewers can view this page, but the Manager/Owner-only settings (schedule, import options, close cadence) are read-only for them — same posture as every other write action in this system (ARCH §2.4 permissions table).

See `styled-screens/allocation.html`, `styled-screens/reports.html`, `styled-screens/settings.html`.

**Tax.** Its own sidebar item, after Allocation; also reached from the Dashboard's Pending tax liability card. One view per entity, with a tab per jurisdiction the entity files in (data-driven, never only Federal) and a tax-year selector. Top card: the status tier badge and a one-line reason, then the two figures side by side, each with its own arithmetic underneath, so they are never read as one sum: **Pending liability** = annualized tax to date − custodial prepaid balance; **Safe-harbor gap** = required payments to date (the lesser safe-harbor basis, cumulative to the latest installment) − the same balance. The tier follows the gap (§ Status tiers). The one action is **Post your payment**, which leads to the imported bank transaction on Transactions — the app never moves money. Below it, for a taxpayer entity, the **Reporting-period close** card; then the year's installments on a track (paid / short / due, label + icon, never colour alone) and the custodial prepaid-tax account card with its GL balance and a link to its register. See `styled-screens/tax.html`.

- **Reporting-period close.** One card per jurisdiction tab. It always shows "Last closed through <date>". At period end a job raises a close-due notification and the card takes a `warning-soft` `Close due` badge; nothing posts until the user confirms. The card shows the arithmetic (annualized tax to date at period end, − accrued through the last close, = true-up), the entry's two legs, and **Confirm <jurisdiction> close through <date>**. The amount is before prepaid, because prepaid stays a separate asset. A fall in the estimate reverses the legs. One entry per jurisdiction, so each tab closes on its own. A skipped period needs no catch-up, and a back-dated import lands in the next close's true-up. A wrong close is fixed by closing that period again, never by Correct entry, so the posted entry offers none. Year end is simply the last close; filing is a separate step. Who closes: an individual, a non-grantor trust, a C-corp or a parent set to Joint filers. A pass-through or grantor entity shows one line in place of the card, "Income here is allocated to its owners, who accrue the tax."
- **Income allocated to you.** A Person holding units in pass-through entities gets a card listing each entity, its classification, the Person's units of the total, and the income allocated year to date by the cap table on each entry's date (a change mid-year splits the year), which is already inside annualized tax to date. It shows totals only and links to no register, because the Person's owner may hold no membership on the entity.

---

## Entities & membership

**Every user owns a default base entity from account creation.** Creating an account also creates a **Person** entity named after the user (`<Name> (Person)`, e.g. "Mosko (Person)"), with the user as its owner. It is the base unit for the user's personal custodial accounts. There is therefore no signed-in state without an entity: sign-in always lands on a dashboard.

- **Landing entity on sign-in:** the last-viewed entity, else the user's own Person entity. An invited user's first sign-in lands on the entity they were invited to.
- **Any entity may hold accounts.** A base entity (Person, Trust, Business) has no children; a parent may also own accounts directly, so a joint checking account lives in the Household. Further entities are created from Entities.
- **Parent entities roll up whole entities.** A parent (Household; Holding for a holding structure) includes whole entities, base or parent to any depth, never individual accounts, and shows consolidated figures: its own accounts plus everything beneath it, each entity counted once however many paths reach it. An entity may belong to more than one parent (a Business in a Household and in a Holding).
- **Agreeing to a parent accepts its later placement.** Placing a parent inside another parent asks no one beneath it for approval. Every owner beneath is notified: "<entity> is now included under <parent>, because <inner parent> was placed inside it.", then the consent text (§ Access & account safety → Consent text). The notification routes to that entity's Included under list.
- **Adding to a parent.** An owner of both ends reaches it from **Add to a parent** (`layers`) at the foot of an entity's Included under list. It opens a confirmation, "Include <entity> in <parent>?", whose body is the consent text, then one line: a later parent above sees the same totals and the owner is told; the link can be removed from Included under. Buttons: Cancel, **Include in <parent>**.
- **A new member on a parent above.** When an invite to a parent is sent, any role, every owner of every entity beneath it gets one notice per person: "<person> was invited to <parent> as a <role>. <parent> includes your entities <entity>, through <path>, …", the consent text, and **See included under**. A later role raise sends none.
- **Included under.** Every entity card lists the parents above it, read-only and by name only: a direct link carries a `Direct` badge and, for an owner of the entity, **Remove**; an indirect one names its path ("through The Moskos"), because a Person's owner leaves a Holding by leaving the Household inside it. The parent's owner can remove the same link; removal is immediate and needs no confirmation from the other side.
- **Tax classification.** A settable field on every entity's card. Base entities: Individual; Trust, non-grantor or grantor; Business, pass-through or C-corp. Parents: **Joint filers** (the parent accrues its own payable at close) or **Pass-through to members**, the default for a new Household or Holding. A taxpayer entity has a reporting-period close (§ Allocation, Reports & Settings → Tax).
- **Members and cap table.** Every entity card carries one list of its members and holders, two columns: **Access** (Owner / Manager / Viewer, or None) and **Units**, each with its percent of the total. Membership says who may do what; the cap table says who owns how much, and neither derives from the other: a 0-unit Manager keeps the books, and a holder may have no access at all. Order: owner-access members, then other members, then holders with no access, then **Outside owners** (the total less every holder, computed and never typed: real owners the app doesn't track, whose share allocates to no one), then the **total units**. A holder is a Person, Trust or Business, never a parent. A Person holder with no access is offered **Invite as viewer**, in the row and in the save that adds it; an entity holder gets no offer, because membership belongs to people. A Person's own table is implicit, itself at all units, and its card says so with nothing to edit.
- **Founder and pending rows.** The entity's founding owner carries an outline `Founder` badge beside Owner, and the founder alone sees "Founding owner: you" with **Transfer founder** on the card. On a multi-owner entity a requested invite is a members-list row (email, role, outline `Pending approval` badge with `clock`, "Invite requested by <name> · awaiting <names> · expires <date>"), shown to owners only; a member whose raise waits for a second step shows the new role and an outline `Waiting for second step` badge. The section heading carries the count ("2 pending"). § Access & account safety.
- **Former holder.** A purged holder's row reads "Former holder (purged <date>)", italic, with Access None and its units marked "counted in Outside owners"; Outside owners includes them from the purge date and its sub-line says so. Nothing of the purged entity is shown. Owners may type a label, shown as "Your label: <text>" with **Edit label**; the label is a cap-table edit, so on a multi-owner entity it goes through approval. A former holder can never be added again, and the editor offers no units input for it.
- **Editing the cap table.** Owners only; every member reads it, and an owner of a holder sees that holder's row and the total, never the other rows. **Edit cap table** turns the units and the total into inputs, adds **Add holder** (the members' own Persons first, then the editor's other Persons, Trusts and Businesses; anyone else is invited as a member first or stays in Outside owners) and an **Effective from** date. On a multi-owner entity the save becomes a request: **Save change** reads **Request change**, and the proposed split shows as a dashed `.cap-pending` line under the table (split, effective date, who it waits on, expiry, **Withdraw** for the requester) until it applies; while it is open, **Edit cap table** is omitted. Save adds a dated change and never rewrites an earlier date, so income keeps the split in force on its own date; each holder added or changed is notified. **History** lists the changes newest first: the date in force, the split and total, and who recorded it. A correction is a new change at the same date. The creation form shows the table preset to 100 units, all held by the creator's Person from the creation date, for a Trust, Business, Household or Holding.
- **Cap-table refusals.** A failed check saves nothing and leaves the editor open with the entries as typed, the message under the field (destructive-ink text, `aria-describedby`, the input `aria-invalid`): "Can't save: units exceed the total on <date>." · "Can't save: this would make an entity its own holder." · "Can't save: ownership chains deeper than one entity aren't supported yet." No message names an entity the editor cannot see.
- **Access is explicit membership only** (owner / manager / viewer), never inherited through a roll-up in either direction — flow 5.7.

**Gross and economic (POLY-1.1).** Every parent view (Dashboard, Reports and Entities with a parent selected) carries a **Gross / Economic** toggle in the Tabs idiom, Gross by default. Gross is the roll-up as it stands. Economic multiplies every figure by the viewer's weight in its entity: their own Person at 100%, another Person at 0%, any other entity at their units' share plus their share through an entity that holds it; Dashboard and Reports then close on **economic net worth**. It weights exactly the entities the gross view shows for that parent, each once, and adds none, so it reveals nothing the gross view does not. An entity weighing 0% stays listed, at zero, never hidden. On Entities, which shows no money, Economic adds the viewer's weight to each circle.

**The drill-through boundary.** A parent's viewer sees the parent's consolidated figures, and every figure stays clickable. A parent's own accounts open their registers as usual. Drilling into a figure that comes from an included entity the user holds no membership on opens a **boundary panel** in place of that entity's register: the entity's name and type badge, the text "Included from <entity>. You don't have access to that entity's ledger.", and a way back. No number is greyed or made unclickable, and nothing is shown from beyond the boundary beyond the figure the parent already showed.

**The entity switcher** (header entity selector) is always present: every user holds at least their own Person entity. It lists every entity the user holds membership on, base and parent, with each parent's included entities nested beneath it to any depth; an entity in two parents is listed under both. An included entity the user has no membership on is listed with a lock, and selecting it opens the boundary panel.

**Roll-up map (Entities).** A card above the membership list draws every entity the user holds membership on as a **Pack** (LayerChart `Pack`, d3.pack, for frontend-lead): parents as `--muted` circles, nested to any depth, each holding its entities: base entities as `--card` circles, a nested parent as a `--muted` circle inside it; each circle's 3px stroke is its entity type's categorical slot (Person `--cat-1`, Trust `--cat-2`, Business `--cat-3`, Household `--cat-4`, Holding `--cat-5`), edged by a 1px `--cat-edge` hairline, with the type icon and label beside it, so colour is never alone; an entity in no parent sits at top level. A parent holding accounts itself shows "N own accounts" under its name. An entity in several parents is drawn once in each, with an "also in <parent>" chip, across levels; there is no overlap geometry. Each circle shows the type icon and label, name and role badge, and switches to that entity on click; the current entity carries a `--ring` outside a 3px `--card` gap, so it never merges with a green Person stroke. **Circles are equal in size per level:** the map shows structure, not wealth. Sizing by balance would shrink small entities past legibility and would leak magnitude across the access boundary. The membership list below stays the accessible fallback, each card with an Includes line and an Included under list. Dashboard roll-ups may likewise list an included entity under each parent it belongs to.

See `styled-screens/entities.html`.

---

## Access & account safety

The moments where the app asks for more than a click: the second step, consent to a parent, co-owner approval, the founder, account deletion and export. Every confirmation here is the `.je-modal` dialog surface (title, one-line subtitle, body, Cancel left of the action); every status is an outline badge with a label, so colour never carries it alone. Flows 5.11–5.13.

### Second step

- **Who.** Required for anyone holding owner or manager on any entity, except the owner role on a user's own Person while it has no other member; offered to viewers. The first action that needs it stops at **Set up a second step first**, below. Methods: an authenticator app (TOTP) or a passkey, plus ten single-use backup codes. Signing in with Google, Apple or GitHub exempts no one.
- **The first method is anchored on the account email.** Setting up a user's first method, anywhere but Sign up, takes the password and then a code sent to the account's email, because a stolen password alone must not be able to choose the factor. Sign up asks no second code: the invite code reached the visitor at that address, so the account's email is already proven. Once a method exists, adding or removing one uses Confirm it's you with the existing method.
- **Set up.** On Sign up for an owner or manager invitee (§ Public screens → Get started and Sign up); on a role raise, the new role waits until the step is set up and the member keeps viewer access meanwhile; at the first action that needs it (the interstitial below); and from Settings.
- **"Set up a second step first".** A user with no second step whose only role is owner of their own unshared Person signs in and views freely, shared entities included. The first real action opens this `.je-modal` interstitial in place of the action's own next step: **Create entity** for a Trust, Business, Household or Holding; the first **Invite member** on their own Person; and any step-up action (export, purge, granting access, linking a bank). Deleting the account takes its own path (§ Account deletion). Title "Set up a second step first"; the subtitle names the action and why ("Creating Family Trust makes you its owner. Owners confirm sign-ins with a second step, so a stolen password alone can't reach the books."). The body runs in three steps under the same title and subtitle, each headed "Step N of 3 · …" in `card-sub`:
  1. **Your password**, footer Cancel, **Continue**. A user without one is sent to Google, Apple or GitHub to sign in again.
  2. **Check your email.** "We sent a code to <masked email>. This confirms it's really you before your first second step is set up." A 6-digit `code-input` ("Code from the email"), then "The code works once and expires shortly. Didn't get it? Check spam, or resend the code." with **resend the code** as a link; a new code replaces the last one. A wrong or expired code sets `aria-invalid` on the field with the `cap-error` line "That code is wrong or has expired. Check the latest email, or resend the code." Footer Cancel, **Continue**. The code's lifetime and attempt limits are SECURITY's; the copy states no number.
  3. **Choose your second step:** the Sign-up enrolment block unchanged (the two radio `.fork-card`s, the QR code with the key typed out, the 6-digit check). Footer Cancel, **Turn on and continue**.
   Ten backup codes follow, shown once, then the action continues with what was entered before it. A step-up action meets Confirm it's you next, with the method just set up: the interstitial comes before that check and never replaces it. Cancel abandons the action with nothing set up and nothing changed. Accepting a raise reaches the same block from the Role raise waiting notice. Flow 5.11.
- **Settings → Sign-in and second step** (per user, `#second-step`): the status (`positive-soft` `On` badge with `shield-check`; with none set up, an outline `Off` badge and **Set up second step**, which opens the same three steps (password, emailed code, method) titled "Set up a second step", with nothing to continue; `settings.html#second-step-off`), each method with its added date and **Remove**, **Add passkey**, backup codes left with **Make new codes**, and **Change password** ("Changing it signs you out everywhere else."). While the user holds owner or manager on any entity other than their own unshared Person, the last method has no Remove and the help line says the step is required.
- **Step-up: "Confirm it's you".** For a user with a second step, before export, purge, granting access or changing a role, linking or unlinking a bank, answering, forcing or confirming a co-owner request, transferring the founder role, removing a second-step method and deleting the account, unless the user was checked in the last 5 minutes. Subtitle names the action ("Exporting Mosko (Person) needs a fresh check. You won't be asked again for 5 minutes."). Body: password, then the 6-digit code; **Use a passkey instead** and **Use a backup code** beneath. A user without a password (Google, Apple or GitHub only) is sent to that provider to sign in again, then asked for the code. Cancel abandons the action with nothing changed. Focus starts in the first field; Esc is Cancel.

### Consent text

One fixed block, `.consent-text` (muted panel with a `--ring` left rule), used verbatim wherever an entity joins a parent's audience: the Add to a parent confirmation, the placement notice and the new-member-above notice. `<parent>` is the only variable.

> Members of <parent>, and of any parent above it, see class and category totals for this entity for any period.
> For a small entity, that effectively reveals individual amounts and their dates.
> Nothing else is shown: no payee, memo, account or counterparty.

The wording is a security requirement (SECURITY C-25): no screen paraphrases or shortens it, and a change to it needs a security review. Parent views keep any date range selectable; no date picker snaps to whole months or quarters.

### Notifications

Each is a `.notice` row: icon, a bold first sentence that says what happened, detail, a meta line (kind · date), and at most two actions on the right. They open from the avatar popover's Notifications entry. Copy, with the styled screen's names:

| Notice | To | Text | Actions |
|---|---|---|---|
| Placement | every owner beneath | "**Mosko (Person) is now included under Mosko Holdings**, because The Moskos was placed inside it." + consent text | See included under |
| New member on a parent above | every owner of every entity beneath, once per person | "**Alex Rivera was invited to Mosko Holdings as a viewer.** Mosko Holdings includes your entities Mosko (Person), through The Moskos, and Mosko Consulting LLC." + consent text | See included under |
| Approval request | every other owner | "**Sam Mosko asks to invite jo@example.com to The Moskos as a manager.** The invite is sent once every other owner approves." Meta: "requested Nov 7 · expires Nov 21 unless every owner approves" | Approve · Decline |
| Reminder, day 7 | owners who have not answered | "**Reminder: 7 days left** to answer Sam Mosko's request to …" / "A request nobody answers expires as declined on Nov 21." | Approve · Decline |
| Outcome | every owner | "Your request to … was approved and applied." · "… was declined by Sam Mosko." · "… expired on Nov 21 without every approval." | — (founder: Force removal, below) |
| Requester confirm | the requester | "**Every remaining owner has approved** your request to … One approver stopped being an owner before it applied, so it waits for you to confirm." | Confirm and send · Withdraw |
| Forced | every owner, the target included | "Mosko forced Sam Mosko's removal from The Moskos after Sam Mosko declined." | — |
| Founder transferred | every owner | "Mosko transferred the founder role for The Moskos to Sam Mosko." | — |
| Former holder | each owner of each entity whose cap table named it | "**A holder on Mosko Holdings' cap table was purged.** It now reads "Former holder (purged Oct 2, 2026)", and its 15 units count as outside owners from that date. You may add a label of your own." | Open cap table |
| Role raise waiting | the member raised | "**You are now a manager of The Moskos.** Set up a second sign-in step to start; until then you keep viewer access." | Set up second step |
| Raise cancelled, a second owner joined | the sole owner who raised it directly; a raise approved by the owners is kept | "**A second owner joined Mosko Consulting LLC, so the raise you made alone for Lee Mosko was cancelled.** Raise it again and the owners will approve it." | See members |
| Raise cancelled by an owner | the owner who raised it, when another owner cancels | "**Mosko cancelled your raise of Lee Mosko to manager of The Moskos.** Lee Mosko keeps viewer access." | — |

Approve, Decline, Force removal and Confirm each pass through Confirm it's you. Pending requests, an invitee's email included, are shown to owners only.

Two emails go to the account's address, outside Notifications:

| Email | When | Subject | Body line |
|---|---|---|---|
| Code | a first method is being set up without one, or an account with no second step is being deleted | "Your polycarpic code: 482913" | "Enter this code to confirm it's you. It works once and expires shortly. If you didn't ask for it, someone may have your password: change it now." |
| First second step set up | the first method is turned on | "A second sign-in step is now on" | "An authenticator app was set up as your second step on Nov 8, 2026. If this wasn't you, contact the person who runs this instance." |

The method named is the one set up (authenticator app or passkey). Neither email carries a link that signs anyone in.

### Co-owner approval

- **What waits, on an entity with more than one owner:** inviting a member or raising a role; removing or demoting a co-owner; any cap-table edit, a former holder's label included. Removing a viewer or manager, and lowering or giving up one's own role, act at once. A sole owner acts alone, including adding the first co-owner.
- **Badges.** `Pending approval` (outline, `clock`) on a pending members-list row and on the cap-table pending line; the card heading counts them ("2 pending"). `Founder` (outline, small) beside the founder's Owner badge. `Waiting for second step` (outline, small) beside a raised role not yet in force.
- **Cancel raise.** In a held raise's members row, for every owner, on any entity: a lowering, so it needs no approval. Confirmation: "Cancel Lee Mosko's raise to manager?", subtitle "Lee Mosko keeps viewer access.", body "The raise has waited for Lee Mosko's second step since Nov 7. Cancelling needs no approval. Sam Mosko, who raised it, is notified. You confirm with your second step." Footer: **Keep the raise** (the Cancel position), **Cancel raise**. Raising again starts a new raise, with approval on a multi-owner entity. A held raise does not expire.
- **Invite dialog.** Email and Role. On a multi-owner entity the subtitle reads "<entity> has two owners, so the invite is sent after <names> approve." (or "approves" for one), the button reads **Request invite**, and the body states the window: "Every other owner has 14 days to answer, with a reminder at day 7; a request nobody answers expires as declined." It also says owners and managers set up a second step when they join, and that owners of every entity a parent includes are told when the invite is sent. On a sole-owner entity: no subtitle, **Send invite**.
- **Expiry wording.** A pending row and line always carry "expires <date>"; the reminder says "7 days left"; an expiry reads "expired on <date> without every approval". The requester may ask again; after an expiry, once per 7 days.
- **Force removal.** Offered to the founder alone, on the notice of a declined or expired request to remove or demote a co-owner (**Force removal** or **Force demotion**). Confirmation: "Force Sam Mosko's removal from The Moskos?", subtitle "Sam Mosko declined this request on Nov 9.", body "As the founding owner you can apply it anyway. Sam Mosko loses owner access at once. Sam Mosko and every other owner are notified, and the change is recorded in the audit log. You confirm with your second step." Action `destructive`.
- **Transfer founder.** On the entity card, for the founder alone: "Founding owner: you" with the help line "Breaks a deadlock over removing or demoting a co-owner; no other extra power." and **Transfer founder**. Confirmation: "Transfer the founder role for <entity>", a select of the current owners, "You stay an owner. Every owner is notified." Stepping down is this action; a founder cannot give up owner without it.

### Account deletion

Settings → Delete your account → **Delete account…** opens one dialog of choices, in three steps, and applies nothing until **Delete my account** (`destructive`, unavailable until every entity has a choice, then the check again if the last one is more than 5 minutes old). Flow 5.13.

- **The check first, by path.** A user with a second step meets Confirm it's you with it. A user with none gives the password, then a code sent to the account's email (the "Check your email" step of Set up a second step first, under the title "Confirm it's you", "Step 2 of 2"; `settings.html#delete-no-second-step`), and sets up no method: a departing user gains nothing from a factor used once. Such a user owns nothing but their own unshared Person, so step 1 is empty, step 2 holds that Person with Purge only (it has no other member), and step 3 lists any entity they view.

1. **Name a successor founder** for each entity the user founded that has other owners: a select among those owners.
2. **Entities only you own:** Transfer to a member (who becomes owner and founder) or Purge, after an export; a purge choice shows `Export ready` and the fingerprint line once its export exists. Transfer opens a select of the entity's members, each with their role; a member without a second step is listed disabled as "<name> · needs a second step", because the new owner must hold owner in force. With no member eligible, **Transfer to a member…** is disabled and the help line reads "No member here has a second step, so purge is the only choice. A member who sets one up appears here when you reopen this dialog."
3. **Entities you leave:** named, with "they are notified that you left".

### Export receipt

Export this entity (Settings, per entity, owners) runs after Confirm it's you and leaves a `.receipt`: a `positive-soft` `Exported` badge, the time, who, and the file name; then **Ledger fingerprint**, in mono, as the last Journal ID and a shortened hash ("JE-000214 · 9f3a1c2e…26d17b04"), the full hash in the title and behind **Copy** (`aria-label="Copy the full ledger fingerprint"`); then one line: "The fingerprint covers every posted entry up to the last one named. Keep the file somewhere other than this box: a later check against it shows whether any entry was changed." An entity with no posted entries has no chain head: the fingerprint line reads "Ledger fingerprint: none, no entries are posted yet", with no Copy, and the closing line reads "The file holds the entity's accounts and settings. The first export after an entry is posted carries a fingerprint." The same fingerprint line, either form, appears on each purge choice in account deletion.

See `styled-screens/entities.html`, `styled-screens/settings.html`, `styled-screens/login.html`, `styled-screens/sign-up.html`.

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
| **Accordion** | The Pending tab's row expansion (two-leg preview) |
| **Tabs** | Entity switcher, nominal-vs-inflation-adjusted toggle on time-series views (Dashboard net-worth chart, Reports; never Allocation), Totals/Percent toggle (Monarch pattern), the Gross / Economic toggle on parent views (POLY-1.1), Reports' statement switcher, Tax's jurisdictions, General Ledger's three sections, Custodial Accounts' group-by toggle, Transactions' three stages with count badges (`.tab` + `badge-sm`: `secondary`, `destructive-soft` on Exceptions when non-zero). General Ledger and Custodial Accounts are two nav items, never a tab pair |
| **Sheet / Dialog** | Transaction detail drawer; new-entity/membership dialog; provider-item dialog (Custodial Accounts) |
| **Dialog, near-full-screen** | The journal-entry modal (header + legs) — manual "+ New entry", "Correct entry", Split, and Group & Summarize all reuse this one modal |
| **Select / Combobox** | Category, tax-treatment tag, jurisdiction pickers; the suggested-offset-leg inline search dropdown (Pending inbox); per-card "show N" limit selector; Journal entries sort selector |
| **Popover + Range Calendar** | Journal entries date range: presets plus one month grid, opened from a select-like trigger |
| **Sidebar** | Primary nav, eight flat items (Settings proposed under the avatar popover) — inverted, a floating card (gutter on every side), collapsible to an icon rail, brand row on top (mark + wordmark + collapse control) + avatar-popover trigger on bottom (opens to the right) — see Sidebar information architecture |
| **Button** | Variants: `default` (primary green fill: the one main action per view), `secondary`, `outline`, `ghost`, `destructive`, and `dark` (a solid `--foreground` fill with `--background` ink: near-black in light mode, near-white in dark). **Rule: never an outline button standing alone on `--background`.** Its `--border` edge is only 1.22:1 on the light page (~1.17:1 dark), so it all but disappears. Outline is for a secondary action set beside a filled one, or inside a card or bar that gives it a surface. A standalone secondary action uses `dark` instead (15.61:1 light / 17.92:1 dark against the page): the OAuth buttons on Login and Sign up, "Continue with Google", "Continue with Apple" and "Continue with GitHub", each with the provider's own glyph. Hierarchy then comes from colour and position, not weight: the dark button is the heavier mass, so the primary stays the only green fill and sits last, after the divider |
| **Skeleton** | Every async fetch boundary |
| **Switch** | Settings' on/off preferences (auto-post matched recurring transactions, reduced motion), `.switch[role=switch]` |
| **Brand app bar** | Every page without the app shell (Home, Get started, Admin): fixed near-black bar, lockup left, the page's trailing items right, a fade below — see Public screens § Brand app bar |
| **Sonner (toast)** | Import batch complete, entry posted, reconciliation break |
| **Progress** | Import batch progress, safe-harbor paid-vs-required |
| **Top row** | Starts right of the sidebar, not full-width, not sticky/bordered, same background token as the content below it: breadcrumb (left); entity selector + separator + "more" menu (right) — see Layout & shell, Header |
| **Separator** | The top row's vertical divider before the "more" menu |
| **Popover / DropdownMenu** | Avatar popover at the sidebar's bottom — profile, **Settings (proposed)**, **Notifications (proposed)**, preferences, theme, keyboard shortcuts, Log out last (see Sidebar); the same primitive backs the top row's "more" menu and, without the menu items, the Transactions **journal entry popover** on Posted (header, legs, correction trail, Open in General Ledger) |
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
| Breadcrumb separator; account path separator | `chevron-right` | |
| Dashboard nav | `layout-dashboard` | |
| Transactions nav | `arrow-left-right` | |
| General Ledger nav | `book-text` | |
| Custodial Accounts nav | `landmark` | |
| Allocation nav | `pie-chart` | |
| Allocation: edit target | `settings` | Gear on the Actual vs. target card; opens the target editor popover |
| Tax nav | `receipt` | `landmark` is taken by Custodial Accounts |
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
| Link-health warning banner; potential-duplicate warning | `triangle-alert` | |
| Search *(proposed entry point, not in the top row)* | `search` | Reserved for the keyboard-shortcut / "more"-menu entry point, § Header |
| GL tree group disclosure; lots security pull-down; Journal entries row | `chevron-down` (open) / `chevron-right` (closed) | Same pair for every disclosure row |
| Journal ID: copy / copied | `copy` / `check` | `check` for 1.2s after the click |
| Manual entry source line (Transactions Posted) | `pen-line` | Stands where `landmark` names a bank source |
| Journal entries date range trigger | `calendar` | |
| Custodial cross-reference badge (GL tree, register) | `landmark` | Same glyph as the Custodial Accounts nav item |
| GL account badge (register) | `book-text` | Same glyph as the General Ledger nav item |
| Provider dialog: Refresh token | `key` | |
| Provider dialog: Unlink | `link-2-off` | `--destructive` text |
| Entities: Invite member | `user-plus` | |
| Entities: Create entity | `plus` | |
| Entities: Edit cap table | `pencil` | |
| Entities: cap table History | `history` | |
| Entities: Add holder | `plus` | |
| Entities: Invite as viewer | `user-plus` | |
| Entities: Add to a parent | `layers` | |
| Entities: Transfer founder | `arrow-right-left` | |
| Pending approval badge | `clock` | Outline badge; the label carries the meaning |
| Notifications: placement, new member above, former holder / approval request / reminder / declined / applied / role raise | `bell` / `user-plus` / `clock` / `x` / `check` / `shield-check` | |
| Settings: Export / Copy fingerprint | `download` / `copy` | |
| Settings: second step on / Authenticator app / Passkey | `shield-check` / `smartphone` / `key-round` | |
| Settings: Delete account | `trash-2` | |
| Login `#local` note | `info` | |
| Entity type badges: Person / Household / Trust / Business | `user` / `house` / `landmark` / `building-2` | Per § Entity, account, and category badges |
| Admin: operator-session badge | `terminal` | |
| Login: reveal password | `eye` (`eye-off` when revealed) | |
| Get started: "I have an invite" card | `mail` | |
| Get started: "I'm setting up my own instance" card; walkthrough Requirements | `server` | |
| Walkthrough: Deploy / First operator sign-in / Invite members | `terminal` / `log-in` / `user-plus` | |
| Get started: Create your account / Start the walkthrough | `arrow-right` / `arrow-down` | Trailing icon inside the button |
| Sign up: valid-invite badge | `circle-check` | |
| Login / Sign up: Continue with Google | **not Lucide**: the Google "G" mark, four-colour | Google's own brand glyph on the dark button, as its sign-in branding asks |
| Login / Sign up: Continue with Apple | **not Lucide**: the Apple logo, monochrome `currentColor` | Apple's own mark; on the `dark` button it takes the button ink (white on black in light mode), as Apple's sign-in guidelines ask |
| Login / Sign up: Continue with GitHub | **not Lucide**: the GitHub mark (Invertocat), monochrome `currentColor` | GitHub's own mark, in the button ink |
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
| Pending row expansion | **Accordion** (nested item), **Select** (suggested-offset inline search) | The two-leg preview itself is custom content inside an Accordion item |
| Split grid | `custom` | A dynamic multi-row form grid with live-sum validation; no shadcn block matches |
| Bulk action bar | `custom` | A "floating selection toolbar" pattern (seen in many apps) but not a shadcn-svelte component |
| Journal-entry modal | **Dialog**, sized near-full-screen | Direct reuse — a non-default Dialog size, not a different primitive |
| Transaction/account-register/journal-entries tables | **Table** | Direct reuse |
| Journal entries date range | **Popover** + **Range Calendar** | The shadcn date-range-picker pattern; the preset list is `.popover-item`s beside the calendar |
| Journal entry popover (Transactions Posted) | **Popover** + **Badge** + plain `.trail-row` markup | The entry read in place from its Journal ID; non-modal, so the list stays usable |
| Leg side | `custom` (`.leg-side`) | Plain tag, not a **Badge**: an outline chip on every leg adds noise to a dense list, and the column already separates it from the path |
| Account path | `custom` (`.acct-path`) | Inline text, not a **Breadcrumb**: a leg's path is a label, not navigation. A Combobox trigger renders the same markup; a native `<select>` cannot style it |
| Potential-duplicate warning (New entry modal, Pending row) | Caution-tier inline block + **Button**s | Names the matched transaction above the modal's actions, or the matched manual entry on a Pending row; the row badge is `outline` in muted ink |
| Chart-of-accounts tree | `custom` | No shadcn tree component; built from nested disclosure rows (could adopt a community tree primitive later if one matures) |
| Lots sub-card pull-down | **Collapsible** | Direct reuse — a simpler primitive than Accordion for a single expand/collapse row |
| Custodial card details | **Collapsible** | Each card opens independently, so not an Accordion |
| Cross-entity treatment choice | **Radio Group** (`.treatment`) | Two bordered option cards, each with a label and a plain-language body; the selected card takes `--ring` |
| Map security form (trade draft) | **Select** + **Button** | Inline on the Pending row |
| Settings on/off preferences | **Switch** | Direct reuse |
| Settings theme picker (Light / Dark / Auto) | **Toggle Group** (single) | Rendered with the `.tabs` look; semantically a radio group, not tabs |
| Brand app bar (Home, Get started, Admin) | `custom`, with **Button** / **Badge** / **Avatar** for the trailing items | One component for every shell-less page: a fixed bar with a lockup, trailing items and a fade; too small and too brand-specific to be a block. No sidebar because no entity exists (setup), none applies (operator), or the visitor is not signed in (Home) |
| Register / any wide table | **Table** (its own overflow-x wrapper) | `.table-wrap` mirrors shadcn Table's built-in scroll container, so a wide table scrolls inside its card at 960px instead of spilling |
| Allocation actual-vs-target track | `custom` on **Progress** | A Progress track plus a target marker; shadcn Progress has no marker |
| Allocation current-allocation map | **LayerChart** `Treemap` | The balance sheet map's component with a class header strip; tiling and label options unverified, as there |
| Allocation holdings popover | **Popover** + **Collapsible** + **Badge** | Read-only; reuses the lots sub-card. `Dialog` below `md` |
| Allocation target editor | **Popover** + **Input** + **Badge** + **Button** | A form anchored to the gear; non-modal, so the bars stay readable. `Dialog` below `md` |
| Provider-item dialog | **Dialog**, **Tabs** (source-type picker), **Select** (account mapping) | Composed from three existing primitives, no custom chrome |
| Tabs (nominal/real toggle on time-series views, Totals/Percent, Reports statements, Tax jurisdictions, General Ledger sections, Transactions stages) | **Tabs** | Direct reuse |
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
| Transactions | `transactions.html` | sidebar | "more" menu, tabs with count badges, expanded Pending row, cross-entity transfer draft, unmapped and mapped trade drafts, split grid, bulk bar, journal-entry modal |
| General Ledger | `general-ledger.html` | sidebar | three tabs, expanded Journal entries row, date range popover |
| Account register | `account-register.html` | sidebar (multi-crumb) | expanded register line |
| Custodial Accounts | `custodial-accounts.html` | sidebar | group-by toggle (Institution on, Account type headers as a reference), card details (Primary Checking and Brokerage open, the rest collapsed), lots sub-card (AAPL pulled down), provider-item dialog |
| Allocation | `allocation.html` | sidebar | holdings popover and target editor popover (open, as references below the cards) |
| Tax | `tax.html` | sidebar | Federal tab, danger tier (Q3 installment $200 short), close-due card, income allocated from pass-through entities |
| Reports | `reports.html` | sidebar | dimmed statement previews, with the estimated-tax line on the Balance Sheet (review only, not shipped) |
| Entities | `entities.html` | sidebar | nested roll-up map, Included under lists, tax classification, members and cap table (read, editing, history, creation preset, refusals), a two-owner entity (Founder, Pending approval, Waiting for second step with Cancel raise, pending cap-table change, Transfer founder), a former holder, notifications (placement, new member above, approval request, day-7 reminder, declined with Force removal, requester confirm, former holder, role raise, raise cancelled twice), confirmations (add to a parent, invite on a multi-owner entity, force removal, transfer founder, cancel raise), Set up a second step first on Create entity (password, emailed code, its error state, method) |
| Settings | `settings.html` | sidebar, no nav item active | avatar popover with Settings current; export receipt with ledger fingerprint; Sign-in and second step; Delete account; step-up prompt, export receipt with no posted entries, account-deletion choices with the transfer select, Sign-in and second step with none set up, and the emailed-code check before deleting with no second step (references) |
| Home | `home.html` | none (public) | — |
| Login | `login.html` | none (split screen) | states `#second-step`, `#local` |
| Get started | `get-started.html` | brand app bar | — |
| Sign up | `sign-up.html` | none (split screen) | invite code pre-filled and validated; state `#second-step` |
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

The one top bar of every page without the app shell: Home, Get started, Admin. Markup: `<body class="has-brand-bar">` with `<header class="brand-bar">` first in the DOM.

- **The bar:** fixed, near-black `#070907` (the brand's dark surface, the same in both themes), 72px tall (64px below 760px).
  - Left: the lockup (`.brand-bar-lockup`), a link, in the literal `--brand` (14.72:1).
  - Right: the page's trailing items, re-inked for the black bar — Home's Get started + Sign in, Get started's Sign in, Admin's operator-session status badge.
- **The fade:** hangs under the bar and moves with it, so the page scrolls under the black and emerges through the gradient. Neon and near-white text only ever sit on the bar's solid black.
  - Over Home's illustration: deep (88px, black → transparent), so the image rises out of the black.
  - Over a plain page background (`.brand-bar--plain`): short (28px, starting at 28% black). A deep black fade on the light page reads as a dirty smear; the short one reads as the bar's shadow.
  - Dark mode: the page is already near-black, so the plain fade is close to invisible and a 1px hairline marks the bar's edge.
- **Clearance:** the body pads by the bar's height, so nothing renders under the bar at rest; `scroll-padding-top` keeps anchors and focus scrolling clear of it.
- **Keyboard order:** the bar is first in the DOM, so Tab goes lockup, trailing items, then the page.
- **Background:** the page paints `--background` edge to edge (the global body canvas is `--muted`, which differs in dark mode).

See `styled-screens/home.html`, `styled-screens/get-started.html`, `styled-screens/admin.html`.

### Get started and Sign up

There is no public sign-up: every instance is self-hosted, and accounts on it come by invitation from an entity owner. Home's "Get started" therefore leads to a fork, and Login's account line offers the same two branches. See flow 5.1.

- **Get started** (`get-started.html`, brand app bar with Sign in on the right): one page, not a modal. On top are two cards:
  - "I have an invite", which leads to Sign up (primary button);
  - "I'm setting up my own instance", which scrolls to the walkthrough (`dark` button).

  The walkthrough sits directly below as four numbered steps: requirements, deploy, first operator sign-in, invite members. It is an outline that grows as the deployment docs are written.
- **Sign up** (`sign-up.html`, Login's split layout with its own visual pane, the sunrise; see **Visual-pane image sources**), invite-gated:
  - Fields, in order: the invite code, then the account (the three `dark` OAuth buttons, or email + password).
  - From an invite link, the code arrives pre-filled and validated, with a line naming who invited the visitor and to which entity. An invalid or used code shows an inline error under the field.
  - "Create account" creates the user's own Person entity (§ Entities & membership) and lands on the dashboard of the invited entity.
  - Footer: "Already have an account? Sign in", then "No invite? Set up your own instance".
  - **Second step, `sign-up.html#second-step`.** After Create account, an invitee joining as owner or manager sets one up before landing: "Set up a second step", one line naming the entity and role and why, two radio `.fork-card`s (Authenticator app · Passkey), then for the app a QR code with the key typed out and a 6-digit check, **Turn on second step**, and ten backup codes shown once. No emailed code is asked: the invite code reached the visitor at the account's address, so the email is already proven. A viewer invitee sees the same step with **Skip for now**, which defers it to the first action that needs it (§ Access & account safety → Second step).
- **Login's account line:** "Have an invite? **Create your account**" leads to Sign up; "No invite? **Set up your own instance**" leads to Get started.

### Login — split screen login page

Two references: `useorigin.com`'s own login (dark, brand pane + form card — behind a splash loader under automation, no direct capture) and a split-screen login example the Principal supplied (form pane left with a labeled email/password pair, a "Forgot password?" link and a reveal-eye icon, OAuth button, divider, primary button, sign-up link, legal footer at the very bottom; a full-bleed moody photo right, inset with rounded corners and a margin rather than flush to the viewport edge).

**Form pane content, in order:** mark + wordmark (top-left), "Welcome back" heading + one-line subtext, three OAuth buttons stacked 8px apart (Google, Apple, GitHub), a divider ("or"), email field (labeled), password field (labeled, with a "Forgot password?" link and a show/hide reveal icon), primary "Sign in" button, the two-way account line ("Have an invite? Create your account" / "No invite? Set up your own instance"), and a legal footer ("By signing in you agree to...") at the bottom.

**OAuth buttons:** "Continue with Google", "Continue with Apple" and "Continue with GitHub", the three providers v1 offers, each a full-width `dark` button with the provider's own glyph, stacked in that order 8px apart. They are `dark`, not outline; see the Button row in § Component inventory for why. Sign up shows the same three.

**States, by URL hash in the mock** (`login.html#…`; in the build these are server-rendered states of one route):
- **`#second-step`, a new device.** After the password or an OAuth provider: "Second step", "This device is new to your account. Enter the code from your authenticator app.", a 6-digit `.code-input` (`inputmode="numeric"`, `autocomplete="one-time-code"`), **Continue**, then **Use a passkey instead** and **Use a backup code**, and "Lost every method? The person who runs this instance can reset your second step." A known device skips this state.
- **`#local`, a home box on a `.local` name.** The OAuth row and the "or" divider are not rendered (no Google, Apple or GitHub), and an `.auth-note` with `info` takes their place: "Google, Apple and GitHub sign-in are not available on this home box, because it runs on a local network name (polycarpic.local). Sign in with your email, password and second step." Sign up drops its OAuth buttons and shows the same note, and its caption reads "Then create your account with email" (`sign-up.html#local`). A home box on a real domain shows the buttons as usual.

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
| Transactions — three tabs with count badges (Exceptions, Pending, Posted), each with a "show N" limit | Aged CIT exceptions + link-health banners; the Pending review/match inbox (locked custodial leg + suggested offset leg); posted, paged rows with Journal IDs, correction badges and the journal entry popover, manual entries included; import stats/status | `ExceptionList`, `PendingInbox`, `ImportStatus` → posting + import; `PostedJournal` → ledger | M2 (CIT exceptions in M3) |
| Journal-entry modal (header + legs) — split, group, manual "+ New entry", "Correct entry" | Entry draft in, posting-gate result out | `EntryDraft` in, `GateResult` out → posting | M2 |
| General Ledger — chart-of-accounts tree | Category → account → sub-account, balances, custodial marker | `ChartTree` → ledger | M2 |
| General Ledger — account register page | Lines on one account, date order, running balance, Journal ID, each line's full entry (every leg, correction trail, actor), link to entry | `AccountRegister` → ledger | M2 |
| General Ledger — Journal entries tab | Posted entry headers by date: Journal ID, description, actor, status, sum of debits, legs; date range, sort, paging | `JournalEntries` → ledger | M2 |
| Custodial Accounts | Balance, reconciliation status, link-health badge; lots sub-card per security (lots, short/long/total unrealized gain, per lot and summed) | `CustodialAccountList` → posting + import; `LotsCard` → securities | M3 (lots card at M4) |
| Provider-item dialog (New provider item on Custodial Accounts) | Source type (aggregator / broker API / file / manual); discovered accounts mapped to custodial accounts; token refresh; unlink + revocation-lag note | `ProviderItem` → import | M2 (fake + file); real aggregators at 1.0 |
| Sync (Transactions, Custodial Accounts) / "Import file" | Job status; on Custodial Accounts also pulls balances and positions | `SyncRequest` → import | M2 |
| Allocation | Current-allocation treemap; actual vs. target; holdings popover; target editor popover | `AllocationVsTarget`, target editor → portfolio; holdings by class: contract open, ARCH | M4 |
| Reports | Balance Sheet, Income Statement, Cash Flow; NAV and NAV delta | `ReportTable` → reports | M5; empty state until then |
| Entities | Entity list; memberships; invite action; cap table beside the membership list (units, total, outside owners, effective-dated history) | `EntityList`, `MembershipList`, invite command, `CapTable`, `HolderCandidates`, `CapTableChange` → tenancy | M1 |
| Gross / Economic toggle (Dashboard, Reports, Entities on a parent) | The roll-up's figures, or the same rows weighted by the viewer's stake, with economic net worth | `RollupTotals`, `EconomicRollup` → reports | POLY-1.1 |
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
- `--border`/`--card` is a low-contrast hairline by design (1.29:1) — decorative, consistent with common practice.
- `--warning` and `--chart-1` fall under 3:1 only on an `--accent` hover fill (2.87:1 / 2.92:1) — no chart inside a hover; a bare warning icon on a hovered row keeps its label.
- Reduced-motion policy not yet written.
- Radius-xl (sheets) not measured against either reference — extrapolated.

---

## Open questions

- Native iOS/macOS token export format (kickoff §2.10) — not yet decided, non-blocking for web.
- Compare `styled-screens/dashboard.html` against Monarch Money's Accounts screen (https://www.monarchmoney.com) component-by-component once frontend-lead builds the real screen.
