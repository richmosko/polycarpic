# Design System Spec

> The written companion to `tokens.css` + `screen.css`. The CSS files are the machine-readable source of truth; this doc explains the *why* and the usage rules. Owned by the `ux-designer` agent. Generate/refine with `/generate-designdoc`.

**2026-09-28, revised same day.** This file initially (rewrite #1) replaced an earlier revision that documented the cairn tracker's own board/dashboard UI, and inherited that tool's shadcn-svelte palette for the product on the reasoning that both are shadcn-svelte apps. **The Principal rejected that reasoning the same day** (`temp/design-direction-2026-09-28.md`, relayed by team-lead): matching cairn's look is explicitly not the goal, diverging from it is. This revision (#2) replaces the inherited palette/type/radius with a hand-authored identity taking inspiration from **Monarch Money** and **Origin** (originfinancial.com) instead — see **Inspiration: Monarch & Origin**, below. Everything not about color/type/radius (Component inventory, Screen data contract, Financial-semantics *structure* if not its exact hues) carries forward unchanged.

## What governs this system

This project's UI direction is **SvelteKit + shadcn-svelte** (Tailwind, headless primitives, LayerChart for charts) — PRD §8 "Technical Considerations", kickoff §2.9. shadcn-svelte's CSS-custom-property convention **is** our token architecture: `tokens.css` (per the Artifacts table in `CLAUDE.md`) is the downstream, machine-readable deliverable `frontend-lead` consumes — dropped into `apps/web`'s `app.css` per shadcn-svelte's standard Tailwind v4 `@theme inline` wiring. `screen.css` is whatever component-level overrides a given screen needs on top of shadcn-svelte's shipped component CSS — expected to be thin.

**The palette is hand-authored, not a vendored shadcn preset.** Unlike polycarpic's own `cairn` tracker tool (which vendors a specific shadcn-svelte "create" preset, see **Provenance & shared tooling**), this product's colors are picked directly for its own domain and inspiration sources, then wired through the same standard shadcn-svelte slot names so shadcn-svelte components still consume them unchanged. Plain sRGB hex, not OKLCH — this system doesn't need the multi-preset theme-variant machinery that justified OKLCH precision for cairn's tokens, so that extra complexity doesn't pay for itself here.

---

## Inspiration: Monarch Money & Origin

Per Principal direction, inspiration was taken from **Monarch Money** (monarch.com) and **Origin** (originfinancial.com) — both consumer/prosumer wealth-management dashboards in the same product category as polycarpic. **Research method and limitation, stated plainly:** this session had `WebFetch` (text-mode, strips CSS/images) but no working browser-screenshot tool, so live pixel/hex values could not be read directly off either site today. What follows draws on established, well-known public brand identity for these two specific, easily-recognizable products, not a hex-accurate teardown. **Flagging the method, not asserting precision** — the same standing caveat this doc uses elsewhere for unmeasured claims. Recommend a follow-up visual QA pass (ideally with `figma-generate-design` or a live browser session) before hi-fi lock, to confirm or correct the specifics below.

**What was taken from each, and why:**

| Element | Taken from | Why |
|---|---|---|
| Single accent hue, indigo/violet family (`--primary`) | Origin's premium, editorial brand color | Origin's identity leans on one restrained accent rather than a busy multi-color UI — reads as trustworthy for a wealth-planning tool, and gives polycarpic a hue nowhere near cairn's sky-blue or its own gain/danger colors, satisfying the divergence directive without collateral collisions |
| Growth green for gains (`--positive`) | Monarch's "money is growing" visual language | Monarch leans on green for positive net-worth/cash-flow movement — a familiar, low-risk convention for this exact product category, not a novel invention |
| One sans-serif type family throughout, hierarchy by weight not face | Both products | Neither Monarch nor Origin uses a serif/sans split for body vs. headings the way cairn's Merriweather/Space-Grotesk pairing does — a dense financial dashboard reads faster on one consistent family, varying only weight/size. Also resolves a pushback this doc's own prior revision flagged: fewer web fonts, less network cost |
| Rounder corners, softer card language | Both products | Both read as approachable/consumer-friendly rather than utilitarian — a deliberately bigger radius than cairn's 10px base |
| Card-based dashboard composition: a few large KPI stat cards up top, activity/table detail below | Both products | Standard for this product category and already how this doc's wireframes were structured before this revision — confirmed as the right shape, not changed |
| Net-worth-over-time as the dashboard's hero chart | Both products | Both treat net worth trend as the primary "how am I doing" signal — matches PRD §4.1's story directly |
| Sidebar navigation, not top tabs | Both products | Consistent with the account-switcher-plus-section-list structure this doc's wireframes already use |

**What was deliberately not copied:** neither product's exact chart library, motion design, or information density was reverse-engineered — polycarpic's own constraints (immutable ledger, membership-scoped access, GL-vs-custodial dual views) don't have a direct analog in either inspiration product, so those screens (Ledger, Accounts, Securities/Lots) are original composition, not modeled on a specific competitor screen.

---

## Foundations

### Color

Plain sRGB hex (see **What governs this system** for why, not OKLCH). Contrast figures below were computed via the standard WCAG relative-luminance formula against the actual token values in `tokens.css` — script and full pair list in **Accessibility**.

**Dashboard canvas convention: cards-on-muted, not cards-on-background.** `--background` is pure white in light mode, but the canvas is `--muted` (a soft cool gray), with `--card` (white) surfaces on top for content panels. Convention: page/canvas root = `bg-muted`, content cards/panels = `bg-card`, reserving bare `--background` for chrome meant to sit flush with card color.

#### Light (`:root`)

| Token | Value | Role |
|---|---|---|
| `--background` | `#FFFFFF` | Page background |
| `--foreground` | `#111827` | Default body text |
| `--card` | `#FFFFFF` | Card surface |
| `--popover` | `#FFFFFF` | Popover/dropdown surface |
| `--primary` | `#6D5BD0` | Primary action fill — indigo/violet (Origin-inspired) |
| `--primary-foreground` | `#FFFFFF` | Text on primary fill (5.18:1) |
| `--secondary` | `#F1F0FB` | Secondary button/surface — faint violet tint |
| `--secondary-foreground` | `#3730A3` | Text on secondary (8.80:1) |
| `--muted` | `#F4F5F7` | Muted background — cool neutral gray, not cairn's warm stone |
| `--muted-foreground` | `#5B6472` | Muted/meta text (5.48:1 on `--muted`, 5.98:1 on `--card`) |
| `--accent` | `#EDEBFB` | Hover/active surface accent |
| `--accent-foreground` | `#3730A3` | Text on accent (8.46:1) |
| `--destructive` | `#DC2626` | Destructive fill (delete, danger, tax-liability overdue — see Financial semantics) |
| `--destructive-foreground` | `#FFFFFF` | Text on destructive fill (4.83:1) |
| `--border` | `#E5E7EB` | Default hairline border |
| `--input` | `#E5E7EB` | Input border |
| `--ring` | `#6D5BD0` | Focus ring |
| `--chart-1`…`--chart-5` | `#C7BFF2` → `#332C6E` | Sequential/magnitude ramp (single-hue indigo) — time-series & single-metric charts |
| `--sidebar` | `#FAFAFB` | Sidebar background |
| `--sidebar-accent` | `#EDEBFB` | Sidebar hover/accent (active nav item) |
| `--positive` | `#15803D` | Gain / income / surplus (see Financial semantics) — 5.02:1 as fill-text or as plain text on `--card`, 4.60:1 on `--muted` |
| `--positive-foreground` | `#FFFFFF` | Text on positive fill |
| `--warning` | `#B45309` | Caution tier below destructive (see Financial semantics) — 5.02:1 as plain text on `--card` |
| `--warning-foreground` | `#FFFFFF` | Text on warning fill (5.02:1) |

#### Dark (`.dark`)

| Token | Value | Role |
|---|---|---|
| `--background` | `#0B0E14` | Page background |
| `--foreground` | `#E5E7EB` | Default body text (15.60:1) |
| `--card` | `#131722` | Card surface (14.46:1 text) |
| `--primary` | `#8B7CF0` | Primary action fill, lightened for dark bg |
| `--primary-foreground` | `#14101F` | Dark text on primary — clears 5.55:1; white text on this same fill only clears 3.37:1, so dark text is required here |
| `--muted` | `#1B2030` | Muted background |
| `--muted-foreground` | `#9CA3AF` | Muted/meta text (6.38:1) |
| `--destructive` | `#EF4444` | Destructive fill, lightened for dark bg |
| `--destructive-foreground` | `#2A0507` | Dark text — clears 4.97:1; white only clears 3.76:1 on this lighter dark-mode red |
| `--border` | `rgba(255,255,255,0.08)` | Hairline |
| `--chart-1`…`--chart-5` | `#DCD6FA` → `#4B3BA8` | Ramp re-lightened for dark mode (not identical to light — this ramp needs to read against a dark card, so it isn't a straight carry-over) |
| `--sidebar` | `#0F1320` | Sidebar background |
| `--positive` | `#4ADE80` | Dark-mode gain — 11.09:1 as plain text on `--background` |
| `--positive-foreground` | `#052E13` | Text on positive fill (8.57:1) |
| `--warning` | `#FBBF24` | Dark-mode caution — 11.57:1 as plain text on `--background` |
| `--warning-foreground` | `#451A03` | Text on warning fill (8.97:1) |

**Character read:** cool neutral grays (not cairn's warm stone), a single indigo/violet accent hue carried by `--primary` (Origin-inspired), a matching single-hue indigo chart ramp, plus two financial-semantic hues — green (`--positive`, Monarch-inspired) and amber (`--warning`) — chosen far enough from `--destructive` (red) and `--primary` (indigo) to avoid confusion under normal vision or the common CVD forms. Red/green is still the CVD risk axis (deuteranopia/protanopia), mitigated the same way as before: color is never the only signal for a delta (see **Financial semantics**).

### Typography

**One sans-serif family throughout — hierarchy is by weight, not face** (diverges from cairn's serif-body/sans-heading split; see **Inspiration**). `--font-heading` is kept as an alias onto the same family so existing component code that reaches for it doesn't need to change meaning, it's just no longer a second typeface.

| Token | Stack | Notes |
|---|---|---|
| `--font-sans` | `'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` | Used everywhere — body, buttons, inputs, table cells, headings, stat values |
| `--font-heading` | `var(--font-sans)` | Alias — headings differ by weight/size only, not typeface |
| `--font-mono` | `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace` | System stack, no web-font request — account numbers, ticker symbols, transaction IDs, tabular figures |

**One web font, not three.** cairn's system loads three Google Fonts variable families; this system loads one (Inter) and uses a system stack for mono — resolves a standing pushback item from this doc's prior revisions (unnecessary network font cost) as a side effect of the divergence, not a separate initiative.

| Token | Size | Line-height | Weight | Used for |
|---|---|---|---|---|
| `text-xs` | 12px | 16px | 400/500 (badge) | Badge/chip text, table meta, timestamps |
| `text-sm` | 14px | 20px | 400 | **Base UI size** — buttons, inputs, table cells, nav items |
| `text-base` | 16px | 24px | 400 | Prose body copy inside cards/dialogs |
| `text-lg` | 18px | 28px | 600 | Card title, dialog title |
| `text-xl` | 20px | 28px | 600 | Section heading |
| `text-2xl` | 24px | 32px | 700 | Page/dashboard title |
| `text-2xl`/`text-3xl` as **stat/display value** | 24–30px | 1.1–1.2 | 700 | Big dashboard metric numbers — money figures, net worth, pending liability |

Since body and headings now share one legible sans at every size, the earlier serif-at-small-sizes accessibility flag no longer applies — dropped, not carried forward.

### Dashboard scale

**Standard density for dashboard screens** — kept from the prior revision on its own merits (a generic 8px-adjacent spacing rhythm, not itself a cairn-identity choice) rather than re-derived; future screens inherit these rather than re-deriving spacing/type per screen.

| Element | Value |
|---|---|
| Page margins | 28px |
| Gap between cards | 24px |
| Card padding | 24px (nested cards 16px; wells 14px) |
| Display/stat values | 28px, `--font-sans` bold, line-height 1.15 |
| Card/section titles | 17–18px, 600 weight |
| Eyebrow labels | 12px, 600 weight, uppercase, letter-spacing 0.08em, `--muted-foreground` |
| Base UI text | 14–15px |
| Meta/secondary text | 13px |
| Mono (account #s, tickers) | 12–13px |
| Badges | 12px text, `3px 11px` padding, pill radius |
| Buttons | 14px text, `8px 16px` padding, `--radius-md` (10px) |
| Table rows | 13px text, `16px` cell padding |

### Radius scale

**Hand-picked, not formula-derived from a vendored preset** (this system isn't vendoring one — see **What governs this system**). Softer/larger than cairn's 10px base, matching the rounder card language both inspiration products use.

| Token | Value | Used for |
|---|---|---|
| `--radius-sm` | 8px | Small controls: badge, checkbox |
| `--radius-md` | 10px | Button, input, select |
| `--radius-lg` | 12px | Card, dialog, popover |
| `--radius-xl` | 20px | Large surfaces: sheet panel, drawer |

**Unmeasured caveat:** these weren't re-verified against a live `shadcn-svelte init` scaffold's generated `@theme inline` block this session (no vendored preset to check against, per above) — frontend-lead should sanity-check these compose cleanly with shadcn-svelte's shipped component CSS at implementation time.

### Shadows

No custom `--shadow-*` overrides — inherits shadcn-svelte's default `shadow-xs`/`shadow-sm`/`shadow-md` scale. Usage: `shadow-xs` on inputs/buttons, `shadow-sm` on cards/popovers, reserve heavier shadows for modals/sheets floating over the whole page.

### Sidebar tokens

Persistent nav sidebar as a first-class surface — `--sidebar`, `--sidebar-foreground`, `--sidebar-accent(-foreground)`, `--sidebar-border`, `--sidebar-ring`, distinct from `--card`/`--popover` so the sidebar can be tinted independently (here: barely — a near-imperceptible step from page `--background`, just enough to read as a distinct plane). Active nav item styles off `--sidebar-accent` (the vendored shadcn `ui/sidebar/` component's actual behavior).

---

## Financial semantics

A financial dashboard needs a gain/loss signal and a caution tier that a badge-variant reuse of stock shadcn tokens can't honestly express — this is the one place this design system adds real new tokens (`--positive`, `--warning`, both light/dark).

### Delta coloring (gains, losses, income vs. expense)

| Situation | Token | Notes |
|---|---|---|
| Positive delta — gain, income, surplus, net worth increase | `--positive` | Pair with a `+` sign or up-arrow, never color alone (WCAG 1.4.1; also the accessible default for the ~8% of men with red/green CVD) |
| Negative delta — loss, expense, net worth decrease | `--destructive` | Reused, not a new "negative" token — a loss and a destructive/danger action share the same "pay attention, this is a decrease" semantic weight. Pair with a `−` sign or down-arrow |
| Neutral / no change | `--muted-foreground` | |

**Do not encode gain/loss by hue alone anywhere it's the sole signal** — every delta value in the UI carries a leading sign character or directional icon alongside the color. Hard accessibility requirement, not a style preference.

### Status tiers (three, not more)

| Tier | Token | Product examples |
|---|---|---|
| Normal / on track | `--positive` or plain `--foreground` (context-dependent) | Safe-harbor gap ≤ 0; reconciliation clean; import fully matched |
| Caution | `--warning` | Safe-harbor gap open but due date >14 days out; an unmatched transfer leg inside the exceptions window but not yet overdue; a lot's book/market delta beyond a configurable threshold |
| Danger / overdue | `--destructive` | Safe-harbor payment due date passed without payment; an unmatched transfer leg past the exceptions threshold (default 3 business days, PRD §5); a reconciliation break |

Don't invent a fourth tier or a per-feature bespoke color.

### Entity, account, and category badges — variant weight and icon, not per-category hue

**Meaning is carried by label + icon + variant weight, not a dedicated hue per category** — avoids an ever-growing, CVD-fragile categorical palette as the product adds transaction categories and tax-treatment tags over time.

| Category | Variant | Icon (Lucide, indicative) | Notes |
|---|---|---|---|
| Entity type — Person | `secondary` | `User` | |
| Entity type — Trust | `secondary` | `Landmark` | |
| Entity type — Business | `secondary` | `Building2` | |
| Entity type — Household | `secondary` | `Home` | |
| Account — GL (ledger) | `outline` | `BookText` | Distinguishes GL-basis vs. custodial-basis balance sheet views (PRD §5) |
| Account — Custodial | `outline` | `Landmark` | |
| Transaction — Draft (staged) | `secondary` | `Clock` | Awaiting user confirmation |
| Transaction — Posted | `outline` | `Check` | Immutable once posted (PRD §5) |
| Transaction — Reversed | `outline` italic, reduced opacity | `RotateCcw` | A reversing entry exists — never shown as "edited" |
| Role — Owner / Manager / Viewer | `default` / `secondary` / `outline` | — | Weight decreases with privilege level |

**Open item:** a genuine 3+-hue categorical chart need (e.g. spend-by-category with 6+ categories) isn't solved by this doc yet — decide against a concrete chart spec when one arises, using a published CVD-safe base (e.g. Okabe & Ito 2008) plus a real pairwise-separation check, not invented speculatively here.

---

## Component inventory

Map to shadcn-svelte's shipped components — install via `bunx shadcn-svelte@latest add <name>`, don't hand-roll. Document every component's states (default, hover, focus, disabled, loading, error) as screens are built; this table is the starting inventory for polycarpic's six primary screens.

| shadcn-svelte component | polycarpic usage |
|---|---|
| **Card** | KPI/stat cards on the dashboard (per-entity balances, pending tax liability); containment for every screen section |
| **Table** | Ledger/transaction list, lot table, exceptions report, balance-sheet line items |
| **Badge** | Entity/account/transaction/role badges (see Financial semantics), safe-harbor status pill |
| **Tabs** | Entity switcher, GL-vs-custodial balance sheet toggle, nominal-vs-inflation-adjusted chart toggle |
| **Sheet / Dialog** | Transaction detail drawer (Sheet, edge-anchored); confirm-draft dialog; new-entity/membership dialog (Dialog, centered) |
| **Select / Combobox** | Category picker, tax-treatment tag picker, jurisdiction picker |
| **Chart** (`Chart.Container` wrapping LayerChart) | Net-worth-over-time (sequential ramp, `--chart-1..5`), asset-allocation actual-vs-target (bar), safe-harbor gap gauge (uses **Financial semantics** tiers, not the chart ramp) |
| **Sidebar** | Primary nav — entity switcher, section links |
| **Skeleton** | Every async fetch boundary — shaped like the real layout, no decorative spinners |
| **Sonner (toast)** | Import batch complete, draft confirmed/posted, reconciliation break detected |
| **Progress** | Import batch progress, safe-harbor "amount paid vs. required" bar |

shadcn ships `focus-visible:ring-ring` and `disabled:opacity-50 disabled:pointer-events-none` on every interactive primitive out of the box.

**Still ours to set, because shadcn doesn't opine:**
- **Reduced-motion policy** — wrap transitions with `@media (prefers-reduced-motion: reduce)`.
- **Loading-state discipline** — per-feature responsibility ("no decorative loading states").

---

## Screen data contract

For architect's Screen DTO work (ARCH §2.3, OQ-11). Model constraints: amounts are signed per line with Dr/Cr derived for display; drafts are separate from posted entries and posted entries are immutable; Cash-in-Transit open items get an exceptions view; access comes from membership only (no parent/child inheritance).

| Screen | Data shown |
|---|---|
| Dashboard | Net worth; cash-flow by period; recent activity (posted + draft, signed amounts); pending tax liability + safe-harbor gap; allocation actual-vs-target; scoped to the switched entity |
| Ledger | Draft transactions (editable category/tax-treatment tag); posted transactions (immutable); reversals; Cash-in-Transit exceptions aged past the configurable threshold; actor attribution per row |
| Accounts | Balance sheet by GL account and by custodial account (toggle); NAV delta vs. prior book period; reconciliation status (clean/break) per custodial account |
| Entities | Entity list (Person/Trust/Business/Household); memberships per entity (user, role); invite action |
| Securities | Lot table (book value, market value, cost basis) per custodial account; allocation actual-vs-target; book-vs-market time series |
| Import | Linked providers + connection state; batch progress; batch review (new/duplicate/needs-category counts) |

---

## Provenance & shared tooling

polycarpic's own `cairn` tracker (the board/dashboard at `localhost:8766`, under `scripts/cairn/`) is a separate shadcn-svelte app with its own vendored preset, its own reference copies, and its own generated theme-variant pipeline (`scripts/cairn/board/theme/gen_variants.py` → `docs/DESIGN/variants.css`, one of three checked-in copies by architect ruling). **This product's palette used to inherit that tool's tokens (2026-09-28, rewrite #1) — the Principal rejected that (see the note at the top of this file); it's now a fully separate, hand-authored identity.**

**CI hazard, in progress (POLY-78, devops-engineer):** `scripts/cairn/tests/test_board_tokens_parity.py` currently asserts `docs/DESIGN/tokens.css` shares key values with cairn's board tokens, and runs in the required `cairn` CI check — this design system's own divergence will fail that check until POLY-78 decouples cairn's generator/tests/reference-copies from `docs/DESIGN/` entirely. Per direction, this is expected and not to be worked around by re-adding cairn's values. `docs/DESIGN/variants.css` is cairn-tool generated infrastructure, not part of the product; devops-engineer's POLY-78 removes it from this directory (an attempt to remove it from this branch directly was blocked by the session's own sandbox as a shared-resource edit — left for POLY-78 to resolve as a trivial merge conflict, as the direction anticipated).

If a future need arises to look up cairn's own design history (its vendored preset, its accessibility derivations), that lives in `git log -- docs/DESIGN/design-system-spec.md` (pre-2026-09-28 revisions) and in cairn's own issue history (`PT-nn` citations) — not duplicated here, and no longer this product's concern.

---

## Accessibility

**Target: WCAG AA.** All contrast figures in this revision were computed from the exact hex values in `tokens.css`, via the standard WCAG relative-luminance formula (`L = 0.2126R + 0.7152G + 0.0722B` on linearized sRGB channels, contrast = `(L_light+0.05)/(L_dark+0.05)`) — a real computed check, not an eyeballed estimate. Every pair below clears its stated floor; figures are inline in the Foundations color tables above.

| Concern | Standard / approach |
|---|---|
| Color contrast | WCAG AA — 4.5:1 normal text, 3:1 large text/non-text UI — **measured**, see Foundations tables |
| Color-alone signaling | Never — every gain/loss/status signal pairs color with a sign, icon, or label (see Financial semantics) |
| Keyboard | All interactive elements reachable & operable — shadcn primitives ship this by default |
| Screen readers | Semantic markup; labelled controls; a stat card's sign/direction must be readable from text content, not inferred from color by assistive tech |
| Motion | Respect `prefers-reduced-motion` (open item, see Component inventory) |

**Open items:**
- No CVD (color-vision-deficiency) simulation run on the new palette yet — the red/green pairing (`--destructive`/`--positive`) is the standard risk axis; mitigated structurally (color is never the sole signal, see Financial semantics) but not yet simulated. Recommend a Machado/Oliveira/Fairchild-style pass before lock, same method the cairn tool's own board used.
- `--border` against `--card` is a low-contrast hairline by design (1.24:1) — decorative, not information-bearing on its own, consistent with common practice, but flagging since WCAG 1.4.11 in principle covers some UI-component boundaries.
- Reduced-motion policy not yet written.
- Radius scale not re-verified against a live shadcn-svelte scaffold (see Radius scale).

---

## Open questions

- Native iOS/macOS (kickoff §2.10) needs these tokens exported to Swift — format/tooling not yet decided; flagging as a Plan-phase follow-up, not blocking the web design system.
- Categorical (3+ hue) chart palette for transaction-category breakdowns — deferred until a concrete chart spec exists (see Financial semantics, Entity/account badges).
- A live-browser visual QA pass against Monarch/Origin (this session had no screenshot tool) would confirm or correct the specifics recorded in **Inspiration: Monarch & Origin** — recommended before hi-fi styled-screens are treated as final.
