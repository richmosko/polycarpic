# Design System Spec

> The written companion to `tokens.css` + `screen.css`. The CSS files are the machine-readable source of truth; this doc explains the *why* and the usage rules. Owned by the `ux-designer` agent. Generate/refine with `/generate-designdoc`.

**2026-09-28 rewrite.** Everything below this line replaces an earlier revision of this file that documented the *cairn tracker's own* internal board/dashboard UI (the tool at `localhost:8766`, owned by the architect), not polycarpic the product. That content is still in git history (`git log -- docs/DESIGN/design-system-spec.md`) and its provenance is unaffected — it just doesn't belong in the file whose job is to be `frontend-lead`'s implementation contract for `apps/web`. See **Provenance & shared tooling**, below, for what carries forward and why.

## What governs this system

This project's UI direction is **SvelteKit + shadcn-svelte** (Tailwind, headless primitives, LayerChart for charts) — PRD §8 "Technical Considerations", kickoff §2.9. shadcn-svelte's CSS-custom-property convention **is** our token architecture: `tokens.css` (per the Artifacts table in `CLAUDE.md`) is the downstream, machine-readable deliverable `frontend-lead` consumes — dropped into `apps/web`'s `app.css` per shadcn-svelte's standard Tailwind v4 `@theme inline` wiring (`bunx shadcn-svelte@latest init` scaffolds the plumbing; this doc doesn't re-derive it, only the values). `screen.css` is whatever component-level overrides a given screen needs on top of shadcn-svelte's shipped component CSS — expected to be thin.

**Base palette is inherited, not re-derived.** polycarpic's own tooling (the `cairn` tracker dashboard/board, `scripts/cairn/`) is itself a shadcn-svelte app, already built on an AA-audited preset (`b6XadDxmQS` — Style "Mira", Base "Stone", Theme "Sky", Chart "Yellow"). Reusing that exact preset for the product gives us a palette that's already cleared real contrast/gamut/CVD checks (see **Provenance & shared tooling**) rather than re-litigating those from zero. Everything below the Foundations section is new, polycarpic-specific work — the financial-domain semantics the tracker tool never needed.

---

## Foundations

### Color

All values are `oklch()`. Where a role has no dark-mode override listed, dark mode is presumed to reuse the light value (chart ramp) — confirmed against the extracted payload, not assumed.

**Dashboard canvas convention: cards-on-muted, not cards-on-background.** `--background` (`oklch(1 0 0)`, pure white in light mode) is a real token, but the preset's own live preview does not paint the page canvas with it — the canvas is `--muted` (`oklch(0.97 0.001 106.424)`), with `--card` (white) surfaces on top for content panels. Adopt this convention: page/canvas root = `bg-muted`, content cards/panels = `bg-card`, reserving bare `--background` for chrome meant to sit flush with card color (e.g. a toolbar blending into the content plane).

#### Light (`:root`)

| Token | Value | Role |
|---|---|---|
| `--background` | `oklch(1 0 0)` | Page background |
| `--foreground` | `oklch(0.147 0.004 49.25)` | Default body text |
| `--card` | `oklch(1 0 0)` | Card surface |
| `--card-foreground` | `oklch(0.147 0.004 49.25)` | Text on card |
| `--popover` | `oklch(1 0 0)` | Popover/dropdown surface |
| `--popover-foreground` | `oklch(0.147 0.004 49.25)` | Text on popover |
| `--primary` | `oklch(0.5 0.134 242.749)` | Primary action fill (sky blue) |
| `--primary-foreground` | `oklch(0.977 0.013 236.62)` | Text on primary fill |
| `--secondary` | `oklch(0.967 0.001 286.375)` | Secondary button/surface |
| `--secondary-foreground` | `oklch(0.21 0.006 285.885)` | Text on secondary |
| `--muted` | `oklch(0.97 0.001 106.424)` | Muted background (subtle panels) |
| `--muted-foreground` | `oklch(0.5450 0.013 58.071)` | Muted/meta text — darkened from the preset's raw `oklch(0.553 0.013 58.071)` to clear WCAG AA against `--muted` (4.58:1/4.56:1, inherited fix, see **Accessibility**) |
| `--accent` | `oklch(0.97 0.001 106.424)` | Hover/active surface accent |
| `--accent-foreground` | `oklch(0.216 0.006 56.043)` | Text on accent surface |
| `--destructive` | `oklch(0.577 0.245 27.325)` | Destructive fill (delete, danger, **tax-liability overdue** — see Financial semantics) |
| `--destructive-foreground` | `oklch(1 0 0)` | Text on destructive fill — lightened to pure white to clear AA (4.76:1/4.77:1, inherited fix) |
| `--border` | `oklch(0.923 0.003 48.717)` | Default hairline border |
| `--input` | `oklch(0.923 0.003 48.717)` | Input border |
| `--ring` | `oklch(0.709 0.01 56.259)` | Focus ring |
| `--chart-1`…`--chart-5` | `oklch(0.905 0.182 98.111)` → `oklch(0.476 0.114 61.907)` | Sequential/magnitude ramp — time-series & single-metric charts (net worth over time, allocation-vs-target bars) |
| `--sidebar` | `oklch(0.985 0.001 106.423)` | Sidebar background |
| `--sidebar-foreground` | `oklch(0.147 0.004 49.25)` | Sidebar text |
| `--sidebar-accent` | `oklch(0.97 0.001 106.424)` | Sidebar hover/accent (active nav item — see **Sidebar tokens**) |
| `--sidebar-border` | `oklch(0.923 0.003 48.717)` | Sidebar hairline |
| `--positive` | `oklch(0.52 0.15 150)` | **New.** Gain / income / surplus (see Financial semantics) |
| `--positive-foreground` | `oklch(1 0 0)` | Text on positive fill |
| `--warning` | `oklch(0.75 0.15 85)` | **New.** Caution tier below destructive (see Financial semantics) |
| `--warning-foreground` | `oklch(0.28 0.05 85)` | Text on warning fill |

#### Dark (`.dark`)

| Token | Value | Role |
|---|---|---|
| `--background` | `oklch(0.147 0.004 49.25)` | Page background |
| `--foreground` | `oklch(0.985 0.001 106.423)` | Default body text |
| `--card` | `oklch(0.216 0.006 56.043)` | Card surface |
| `--primary` | `oklch(0.443 0.11 240.79)` | Primary action fill (dimmer sky blue) |
| `--muted` | `oklch(0.268 0.007 34.298)` | Muted background |
| `--muted-foreground` | `oklch(0.709 0.01 56.259)` | Muted/meta text |
| `--destructive` | `oklch(0.704 0.191 22.216)` | Destructive fill |
| `--destructive-foreground` | `oklch(0.31 0.01 17.0)` | Split from `:root`'s value — dark's `--destructive` is unusually lighter than light's, so a shared ink can't clear both (inherited fix, see **Accessibility**) |
| `--border` | `oklch(1 0 0 / 10%)` | Hairline (translucent white) |
| `--chart-1`…`--chart-5` | same as light | Ramp not re-tuned for dark mode |
| `--sidebar` | `oklch(0.216 0.006 56.043)` | Sidebar background |
| `--positive` | `oklch(0.62 0.15 150)` | **New**, dark-mode variant |
| `--positive-foreground` | `oklch(0.15 0.02 150)` | Text on positive fill |
| `--warning` | `oklch(0.70 0.15 85)` | **New**, dark-mode variant |
| `--warning-foreground` | `oklch(0.2 0.04 85)` | Text on warning fill |

**Character read:** warm stone neutrals (hue ≈ 49–58, not cool navy-grey), a single sky-blue accent hue (≈ 237–243) carried by `--primary`, a single-hue golden chart ramp, plus two new financial-semantic hues: green (`--positive`, H≈150) and amber (`--warning`, H≈85) — chosen far enough from `--destructive` (H≈27, red-orange) and `--primary` (H≈243, blue) to avoid confusion under normal vision or the common CVD forms (deuteranopia/protanopia both preserve blue-yellow separation; red/green is the risk axis, mitigated by pairing color with an icon/sign, never color alone — see **Financial semantics**).

### Typography

| Token | Stack | Notes |
|---|---|---|
| `--font-sans` | `'Merriweather Variable', Georgia, 'Times New Roman', serif` | Base/default UI face despite the shadcn slot name — buttons, inputs, table cells, body copy |
| `--font-heading` | `'Space Grotesk Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` | Headings and card titles only (20px+) — **not** big display/stat numbers |
| `--font-mono` | `'Geist Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace` | Account numbers, ticker symbols, transaction IDs, tabular/numeric dashboard values |

**Face is by role, not size.** Big display/stat values (e.g. a dashboard net-worth figure) render `--font-sans` **bold**, not `--font-heading` — a large number is a body-role element (a stat), not a title.

| Token | Size | Line-height | Weight | Face | Used for |
|---|---|---|---|---|---|
| `text-xs` | 12px | 16px | 400/500 (badge) | `--font-sans` | Badge/chip text, table meta, timestamps |
| `text-sm` | 14px | 20px | 400 | `--font-sans` | **Base UI size** — buttons, inputs, table cells, nav items |
| `text-base` | 16px | 24px | 400 | `--font-sans` | Prose body copy inside cards/dialogs |
| `text-lg` | 18px | 28px | 600 | `--font-heading` | Card title, dialog title |
| `text-xl` | 20px | 28px | 600 | `--font-heading` | Section heading |
| `text-2xl` | 24px | 32px | 700 | `--font-heading` | Page/dashboard title |
| `text-2xl`/`text-3xl` as **stat/display value** | 24–30px | 1.1–1.2 | 700 | `--font-sans` bold | Big dashboard metric numbers — money figures, net worth, pending liability |

**Accessibility flag, inherited and still true here:** Merriweather (serif) at `text-xs` (12px badge/chip text) is harder to read than a humanist sans at that size. Given financial data leans on small dense text (transaction rows, lot tables), **avoid shipping `text-xs` monetary figures in the serif face** — bump to `text-sm`+ or route through `--font-mono` (tabular figures already want mono for digit alignment anyway).

### Dashboard scale

**Standard density for dashboard screens** — future screens inherit these rather than re-deriving spacing/type per screen.

| Element | Value |
|---|---|
| Page margins | 28px |
| Gap between cards | 24px |
| Card padding | 24px (nested cards 16px; wells 14px) |
| Display/stat values | 28px, `--font-sans` bold, line-height 1.15 |
| Card/section titles | 17–18px, `--font-heading` 600 |
| Eyebrow labels | 12px, `--font-heading` 600, uppercase, letter-spacing 0.08em, `--muted-foreground` |
| Base UI text | 14–15px |
| Meta/secondary text | 13px |
| Mono (account #s, tickers) | 12–13px |
| Badges | 12px text, `3px 11px` padding, pill radius |
| Buttons | 14px text, `8px 16px` padding, `--radius-md` (8px) |
| Table rows | 13px text, `16px` cell padding |

### Radius scale

Base `--radius: 0.625rem` (10px), shadcn-svelte's standard multiplicative derivation:

| Token | Formula | Value | Used for |
|---|---|---|---|
| `--radius-sm` | `radius * 0.6` | 6px | Small controls: badge, checkbox |
| `--radius-md` | `radius * 0.8` | 8px | Button, input, select |
| `--radius-lg` | `radius` | 10px | Card, dialog, popover |
| `--radius-xl` | `radius * 1.4` | 14px | Large surfaces: sheet panel, drawer |

### Shadows

No custom `--shadow-*` overrides — inherits shadcn-svelte's default `shadow-xs`/`shadow-sm`/`shadow-md` scale. Usage: `shadow-xs` on inputs/buttons, `shadow-sm` on cards/popovers, reserve heavier shadows for modals/sheets floating over the whole page.

### Sidebar tokens

Persistent nav sidebar as a first-class surface — `--sidebar`, `--sidebar-foreground`, `--sidebar-accent(-foreground)`, `--sidebar-border`, `--sidebar-ring`, distinct from `--card`/`--popover` so the sidebar can be tinted independently (here: barely — a near-imperceptible 1.5% lightness step from page `--background`, just enough to read as a distinct plane). Active nav item styles off `--sidebar-accent` (the vendored shadcn `ui/sidebar/` component's actual behavior — `--sidebar-primary` is declared but unused by the component itself; don't reach for it expecting it to render).

---

## Financial semantics

The base shadcn preset has no vocabulary for money: no green, no amber, no notion of "this number is good" vs. "this number needs attention." This is the one place polycarpic's design system adds real new tokens (`--positive`, `--warning`, both light/dark) rather than reusing stock shadcn tokens by variant weight alone — a financial dashboard needs a gain/loss signal that a badge-variant reuse can't honestly express.

### Delta coloring (gains, losses, income vs. expense)

| Situation | Token | Notes |
|---|---|---|
| Positive delta — gain, income, surplus, net worth increase | `--positive` | Pair with a `+` sign or up-arrow, never color alone (WCAG 1.4.1 — color is not the only visual means of conveying info; also the accessible default for the ~8% of men with red/green CVD) |
| Negative delta — loss, expense, net worth decrease | `--destructive` | Reused, not a new "negative" token — a loss and a destructive/danger action share the same "pay attention, this is a decrease" semantic weight. Pair with a `−` sign or down-arrow |
| Neutral / no change | `--muted-foreground` | |

**Do not encode gain/loss by hue alone anywhere it's the sole signal** — every delta value in the UI (dashboard KPI cards, allocation deltas, statement line items) carries a leading sign character or directional icon alongside the color. This is a hard accessibility requirement, not a style preference, given how central gain/loss reading is to this product's core use case.

### Status tiers (three, not more)

Reusing the "variant weight encodes meaning" principle (fewer hues, more legible): polycarpic has exactly three severity tiers across the product, expressed consistently everywhere a status needs one:

| Tier | Token | Product examples |
|---|---|---|
| Normal / on track | `--positive` or plain `--foreground` (context-dependent — see per-component notes below) | Safe-harbor gap ≤ 0; reconciliation clean; import fully matched |
| Caution | `--warning` | Safe-harbor gap open but due date >14 days out; an unmatched transfer leg inside the exceptions window but not yet overdue; a lot's book/market delta beyond a configurable threshold |
| Danger / overdue | `--destructive` | Safe-harbor payment due date passed without payment; an unmatched transfer leg past the exceptions threshold (default 3 business days, PRD §5); a reconciliation break |

Don't invent a fourth tier or a per-feature bespoke color — if a new situation doesn't fit one of these three, that's a signal to bring it to the team rather than reaching for a new hue.

### Entity, account, and category badges — variant weight and icon, not per-category hue

Following the same discipline the base preset's own badge system uses: **meaning is carried by label + icon + variant weight, not a dedicated hue per category.** This avoids the trap of needing an ever-growing, CVD-fragile categorical palette as the product adds transaction categories, tax-treatment tags, and entity types over time.

| Category | Variant | Icon (Lucide, indicative — confirm at implementation) | Notes |
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
| Role — Owner / Manager / Viewer | `default` / `secondary` / `outline` respectively | — | Weight decreases with privilege level, matching the visual-hierarchy convention used for status elsewhere |

**Open item:** if a later screen genuinely needs 3+ mutually-exclusive categorical series distinguished by hue alone (e.g. a stacked bar of spend by category with 6+ categories), that's a real categorical-palette need this doc doesn't solve yet — decide it against the concrete chart spec when it comes up (the Okabe-Ito CVD-safe base + OKLab ΔE ≥0.06 pairwise-separation method the cairn tool's own board used is a proven, reusable technique for that — see **Provenance & shared tooling**), not invented speculatively here.

---

## Component inventory

Map to shadcn-svelte's shipped components — install via `bunx shadcn-svelte@latest add <name>`, don't hand-roll. Document every component's states (default, hover, focus, disabled, loading, error) as screens are built; this table is the starting inventory for polycarpic's six primary screens (see **Wireframes**).

| shadcn-svelte component | polycarpic usage |
|---|---|
| **Card** | KPI/stat cards on the dashboard (per-entity balances, pending tax liability); containment for every screen section |
| **Table** | Ledger/transaction list, lot table, exceptions report, balance-sheet line items |
| **Badge** | Entity/account/transaction/role badges (see Financial semantics), safe-harbor status pill |
| **Tabs** | Entity switcher (Person/Trust/Business/Household), GL-vs-custodial balance sheet toggle, nominal-vs-inflation-adjusted chart toggle |
| **Sheet / Dialog** | Transaction detail drawer (Sheet, edge-anchored); confirm-draft dialog; new-entity/membership dialog (Dialog, centered) |
| **Select / Combobox** | Category picker, tax-treatment tag picker, jurisdiction picker |
| **Chart** (`Chart.Container` wrapping LayerChart) | Net-worth-over-time (sequential ramp, `--chart-1..5`), asset-allocation actual-vs-target (bar), safe-harbor gap gauge (uses **Financial semantics** tiers, not the chart ramp) |
| **Sidebar** | Primary nav — entity switcher, section links (Dashboard, Ledger, Accounts, Entities, Securities, Import) |
| **Skeleton** | Every async fetch boundary (dashboard KPIs, transaction list, price feed) — shaped like the real layout, no decorative spinners (working principle) |
| **Sonner (toast)** | Import batch complete, draft confirmed/posted, reconciliation break detected |
| **Progress** | Import batch progress, safe-harbor "amount paid vs. required" bar |

shadcn ships `focus-visible:ring-ring` and `disabled:opacity-50 disabled:pointer-events-none` on every interactive primitive out of the box — don't reintroduce unstyled buttons/inputs that bypass them.

**Still ours to set, because shadcn doesn't opine:**
- **Reduced-motion policy** — wrap transitions with `@media (prefers-reduced-motion: reduce)`.
- **Loading-state discipline** — `Skeleton` exists as a primitive; nothing forces every fetch boundary to use it. Per-feature responsibility, called out per working principle ("no decorative loading states").

---

## Screen data contract

For architect's Screen DTO work (ARCH §2.3, OQ-11) — the data each of the six primary screens shows, driving the per-page DTO set. Model constraints noted by architect apply throughout: amounts are signed per line with Dr/Cr derived for display; drafts are separate from posted entries and posted entries are immutable; Cash-in-Transit open items get an exceptions view; access comes from membership only (no parent/child inheritance).

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

polycarpic's own `cairn` tracker (the board/dashboard at `localhost:8766`, under `scripts/cairn/`) is a separate shadcn-svelte app with its own design history, own reference copies (`scripts/cairn/dashboard/src/app.css`, `scripts/cairn/board/tokens.css`), and its own generated theme-variant pipeline (`scripts/cairn/board/theme/gen_variants.py` → `docs/DESIGN/variants.css`, one of three checked-in copies by architect ruling — **do not hand-edit `docs/DESIGN/variants.css`, and it does not describe the product**). This doc's Foundations section inherits that tool's already-audited base palette (see **What governs this system**); everything past Foundations is new, product-specific work.

If a future need arises to look up how a specific accessibility figure or generator mechanism in the *shared* palette was derived (e.g. why `--muted-foreground` is darkened per-variant, or the two-model contrast-checking discipline), that history lives in `git log -- docs/DESIGN/design-system-spec.md` (pre-2026-09-28 revisions) and in the cairn tool's own issue history (`PT-nn` citations, kept as pointers per `process/DECISIONS.md`) — not duplicated here.

---

## Accessibility

**Target: WCAG AA.** Contrast figures for the inherited Foundations tokens were independently verified (two-model discipline — continuous-sRGB float math and 8-bit-hex-quantized math, both required to clear the floor with ε=0.05 margin) as part of the cairn tool's own design work; see **Provenance**, above, for where that record lives.

**New tokens are not yet measured — flagging the method, not asserting precision.** `--positive`/`--positive-foreground` and `--warning`/`--warning-foreground` (both modes) were chosen for hue separation from `--destructive`/`--primary` and a target of AA 4.5:1 (normal text) / 3:1 (large text, non-text UI) against `--card`/`--background`, but have **not** been run through an actual OKLCH-aware contrast checker or CVD simulation yet. **Verify before lock** — re-run the same method the cairn tool's board used (Björn Ottosson's OKLCH↔sRGB matrices, WCAG relative-luminance contrast, Machado/Oliveira/Fairchild 2009 CVD simulation for deuteranopia/protanopia) against these four new values before `frontend-lead` ships them.

| Concern | Standard / approach |
|---|---|
| Color contrast | WCAG AA — 4.5:1 normal text, 3:1 large text/non-text UI |
| Color-alone signaling | Never — every gain/loss/status signal pairs color with a sign, icon, or label (see Financial semantics) |
| Keyboard | All interactive elements reachable & operable — shadcn primitives ship this by default |
| Screen readers | Semantic markup; labelled controls; a stat card's sign/direction must be readable from text content, not inferred from color by assistive tech |
| Motion | Respect `prefers-reduced-motion` (open item, see Component inventory) |

**Open items:**
- Run the four new financial-semantic tokens through a real contrast/CVD check before `frontend-lead` builds against them.
- Merriweather at `text-xs` for monetary figures — route through `--font-mono` or bump to `text-sm`+ (see Typography).
- Reduced-motion policy not yet written.

---

## Open questions

- Does the Principal want a distinct visual identity for polycarpic vs. the shared cairn-tooling palette, or is "our own tooling and our own product look related" an acceptable, even desirable, brand choice? Currently assumed acceptable (not yet asked) — see kickoff §2.9, "design system first, built visually... then encoded". Batched to team-lead for relay.
- Native iOS/macOS (kickoff §2.10) needs these tokens exported to Swift — format/tooling not yet decided; flagging as a Plan-phase follow-up, not blocking the web design system.
- Categorical (3+ hue) chart palette for transaction-category breakdowns — deferred until a concrete chart spec exists (see Financial semantics, Entity/account badges).
