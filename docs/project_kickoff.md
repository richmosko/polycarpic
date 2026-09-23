# Polycopic — Project Kickoff

_Consolidated from [`project_manifesto.md`](project_manifesto.md) (the Principal's original brief, frozen as written) and the clarification pass of 2026-09-22/23. This file is the operative kickoff record: where it and the manifesto disagree, this file wins. It is a living document until the PRD absorbs the roadmap and the ARCH doc absorbs the architecture decisions; after that it is frozen as history._

---

## 1. Vision

A personal budgeting and wealth-management application that grows into a **virtual Single Family Office**. Not built in one shot: a high-level roadmap of initiatives (feature clusters mapped to major releases) is written first, then the PRD, then the rest of the Research → Plan → Implement → Validate cycle.

**Look and feel targets:** [Origin](https://useorigin.com/) and [Monarch](https://www.monarch.com/). Starting layout: [shadcn-svelte dashboard-01](https://www.shadcn-svelte.com/view/dashboard-01).

**Heart of the app:** a dashboard with views of the financial health of each entity (Person, Trust, Business, Household), plus views and annotation interfaces for transactions, journal entries, and accounts.

### Functional scope

**Budgeting**
- Expenses (distributions) per time period, nominally months
- Categorized expenses with cash flows per period
- Categorized revenue cash flows tagged by tax treatment
- Quarterly estimated-tax calculation
- Tax-consequence expenses distinguished from owner draws / distributions

**Financial planning**
- Asset allocation view with target adjustments
- Balance sheets by GL account and by custodial account
- Lot-based tracking of marketable securities: GL book valuation with depreciation / amortization / return of capital, plus daily market valuation for equity and NAV tracking and charting
- Custodial NAV view (balance sheet by physical holding account) and its delta from prior book periods

**Future (explicitly out of the first initiatives)**
- Stock research and valuation engine for screening
- Monte-Carlo portfolio survivability and efficient-frontier modelling
- Capitalization table per entity
- Business-type features (literal inventory management, etc.)
- Consolidated household dashboard (schema support ships early; the view is a later milestone)
- Multi-currency process (rate feed, period-end revaluation, FX reports)
- User-authored report scripting
- Period locking of closed books
- MCP server exposing a user's data to their own assistant

---

## 2. Decisions from the clarification pass

Each item below was proposed by the team-lead and confirmed by the Principal. Rationale is kept to one line; the manifesto carries the motivation.

### 2.1 Workflow mechanics

| Topic | Decision |
|---|---|
| Tracker | **cairn** (file-based, in-repo). Linear is not used. |
| Issue prefix | **POLY** |
| Delivery autonomy | **`stop-at-merge`** is the project default: a `/drive` loop builds one feature to an open, mergeable PR and stops; the Principal reviews and runs `/merge-pr`. The Principal may grant `self-merge-within-milestone` for a named milestone (`/drive self-merge`), in which case the loop merges each feature itself and stops at the milestone boundary. Phase transitions are always human decisions. |
| Agent isolation | Every teammate works in its own git worktree pinned to the feature branch tip, pulls `--rebase` before each step, commits by pathspec, pushes fast-forward to the shared `feature/<id>-<slug>` branch, and reports a sha. The lead stays in the main checkout. Many agents on one branch is the normal shape. |
| Git author identity | **Distinct per agent.** Each teammate sets `user.name`/`user.email` per worktree (requires `extensions.worktreeConfig=true` in the repo; added to the shared worktree-protocol block in every `.claude/agents/*.md`). Pushes use the Principal's credentials; PRs are opened by the Principal's GitHub account; the model's `Co-Authored-By` trailer stays. Accepted costs: blank avatars on GitHub, unsigned commits. |
| One writer per file | **Path ownership declared in the task record.** Each cairn sub-issue lists the paths its agent may touch; a push-time check compares the agent's commits against the declared paths and fails loudly on a stray file. Worktree isolation already guarantees one writer per checkout; this closes the gap for concurrent writers on one branch. |

### 2.2 Template scrub (first milestone)

The repo is a straight copy of `project_template` **v0.12.2** and carries the template's own history. Scrub:

1. Delete `process/cairn/archive/` (120 template issues, 16 milestones), `process/cairn/metrics/*` (template telemetry), `process/reviews/`, `process/TEMPLATE_DECISIONS.md`, `docs/starting-prompt.md`.
2. Run `/setup-tracker`: prefix `POLY`, replace the template's founding major with this project's, set `stop-at-merge`.
3. Record template version **v0.12.2** in `process/STATE.md` → Releases and in `process/DECISIONS.md` → "Bootstrapped from", so future template updates can be diffed against a known base. (The manifesto's "STATUS.md" means `process/STATE.md`.)
4. **Keep** the `PT-nn` citations in `scripts/cairn/`, `.claude/agents/*.md`, and `process/WORKFLOW.md` — they are pointers into the template repo, not stale state, and they help when porting template updates.
5. Fill the CLAUDE.md project description and repo URL.

### 2.3 Pre-Discovery and initiatives

- Initiatives (feature clusters → major releases) live as a **high-level roadmap section in the initial PRD**, committed before the PRD is fleshed out. The PRD is a living document; the roadmap evolves in place.
- A cairn **major** (`POLY-V1`, `POLY-V2`, …) is created only when an initiative is approved for Research.
- One set of living docs (PRD / ARCH / SECURITY / DESIGN / INFRA), written with the first initiative in focus and extended per major — not a fresh document set per initiative.

### 2.4 Entity and tenant model

**Model 2 — entity owns books, users hold roles.**

- The first-class tenant is an **entity** with a **type** and an optional **parent** entity. Each entity has its own chart of accounts and ledger.
- **Users are separate from entities.** A **membership** table links `(user, entity, role)`; roles are at least owner, manager, viewer.
- **Row-level security keys on the membership join**, never on a bare `user_id`.
- **Access is a grant; structure is a hierarchy; the hierarchy grants nothing.** A parent (e.g. Household) is a reporting lens over the child entities the viewer already holds grants on. Spouses each own their Person entity and grant the other viewer rights; the Household roll-up shows each spouse the union of what they can see.
- A Household is also a **real entity** with its own ledger when jointly titled accounts exist (joint checking, joint brokerage).
- **Entity types are open-ended** with `Person`, `Trust`, `Business`, `Household` pre-seeded as system types (`owner = null`). User-defined types carry an owner and are visible to the creator **plus anyone holding a membership on an entity of that type** (a viewer must be able to read the type name to render the entity). Recorded as a SECURITY item.
- **First initiative:** parent link + membership model in the schema. **Deferred:** the consolidated household dashboard and cross-entity reporting queries.
- Household roll-ups are reporting sums, not legal consolidation; no intercompany eliminations until a business entity is consolidated into a personal balance sheet (future).

### 2.5 General ledger

- **The ledger lives in our PostgreSQL under our RLS.** External ledger services (Formance, TigerBeetle), plain-text engines (Beancount, hledger), and full ERPs (ERPNext, Odoo) are out. The Plan-phase research step is scoped to: home-grown schema (borrowing from `mosko-fintech` where useful) vs. a library that manages tables inside our own Postgres.
- Chart of accounts: modern numbering, hierarchical (category → account → sub-account), each account tagged nominal debit/credit and with a currency; custodial-account columns denote physical holding accounts.
- Journal entries: multi-leg, `Σ debits == Σ credits` enforced in the **base currency**. Typical entries (depreciation, amortization, distribution) supported.
- **Sub-ledgers:** securities (lots, quantities, book value, daily EOD market value) in the first initiative. Non-marketable assets (real estate, vehicles, private stakes, crypto, collectibles: book value + occasional appraisal, no lots) deferred. Cap table deferred (future; per-entity, only for types that issue units).
- **Multi-currency: schema-ready, process deferred.** Every journal line carries `currency`, `native_amount`, `base_amount`, `fx_rate`; every account carries a currency; the balance rule runs on `base_amount`. All USD with rate 1 in practice. The rate feed, period-end revaluation job (monetary accounts only; Unrealized FX Gain/Loss, reversed next period), Realized FX Gain/Loss on settlement, and native/base side-by-side reports are a future milestone scheduled only if foreign currency is held again.

### 2.6 Transaction import layer

- Lowest non-infrastructure layer. **Provider-agnostic adapter interface**; Plaid, SimpleFIN, direct broker APIs (Schwab, IBKR) and the fake source all implement it.
- Raw transactions are logged and **hashed for de-dup**.
- **Draft → confirmed → immutable.** Imported transactions land as drafts (mutable staging). Confirmation posts a journal entry.
- **Two-way immutability on post:** the journal entry links to the raw row; the raw row gets `status = posted` and the entry id; a database trigger rejects `UPDATE`/`DELETE` on either side.
- **Rules propose, user opts in to auto-post.** Rules always propose category and entry; each rule has a user-set opt-in flag to auto-post on match; everything else waits in draft.
- **Corrections are reversing entries**, never edits. A "fix the category" click is a reversal plus a new entry under the hood; the audit trail shows both. Period locking deferred; posting-date check designed so it can be added.
- **Transfer matching** (first initiative): the two raw legs of an inter-account transfer are paired within a date window into one multi-leg entry. Legs that age out unmatched post against a seeded **Cash in Transit** clearing account, which should read zero once both sides land.
- **Reconciliation** (first initiative): GL balance per custodial account vs. the custodian's reported balance.
- **Provider order:** fake → SimpleFIN → Plaid → direct broker APIs.

### 2.7 Reports and statements

- **Option A — declarative report definitions.** A report is data: rows select accounts by number range, tag, or type; subtotal and ratio lines use a small formula grammar; the column axis is periods or entities. Stored per user in the database (RLS-covered), rendered through shared table + LayerChart components.
- **Seeded reports are read-only system templates** (Balance Sheet, Income Statement, Statement of Cash Flows, custodial NAV, NAV delta) that users clone and edit, so upgrades replace templates without touching customizations.
- User-authored scripting deferred until declarative definitions fail on a named report.

### 2.8 Auth and hosting

| Topic | Decision |
|---|---|
| Database | PostgreSQL, latest version. |
| Auth | **BetterAuth** — users and sessions in our Postgres; OAuth 2.0; bearer tokens for native clients; MFA available; email flows via **Resend** (existing constraint). Clerk rejected: external identity store, leased free tier. |
| OAuth providers (day one) | **Google, Apple, GitHub.** Apple registered early because iOS requires it once any third-party login exists. |
| Primary hosting | **Hetzner VPS, Docker Compose** (Postgres + SvelteKit node adapter + worker + reverse proxy). Owns the box, which the DR / patching / novice-deploy runbook requirements assume. |
| Secondary hosting | **Vercel + Neon**, kept working and **verified by CI** on the adapter switch, so a friend can stand up a free instance. |
| Dual-target rules | Only the SvelteKit adapter changes between targets; no Vercel-specific APIs anywhere; background jobs (import polling, EOD prices, period-end) are idempotent, short, triggerable units — a worker container on the VPS, scheduled functions on Vercel. |
| RLS mechanism | App connects as a limited Postgres role and sets the user context per transaction (ARCH detail). |

### 2.9 Frontend and design system

- **SvelteKit** with **shadcn-svelte** (owned component source, Tailwind, headless primitives; its charts are built on **LayerChart**). Flowbite Svelte rejected (dependency, fixed look, ApexCharts).
- **Design system first**, built visually with the Artifact design tool, then encoded into `docs/DESIGN/` tokens and spec via `/generate-designdoc`. Both the prototype and the real app import those tokens.
- **Throwaway UX prototype** at `prototype/` — its own SvelteKit app with its own `package.json`, fake/static data, never importable by the real app. **Deleted** once the real app's first screens ship; the DESIGN doc keeps screenshots of the agreed screens as the durable record.

### 2.10 Repository layout and native clients

- **pnpm workspace monorepo:** `apps/web` (SvelteKit), later `apps/ios` (Swift); `packages/` with one package per layer (ledger, import, reports, auth, ui, …). Each package has its own tests and version. **Affected-only CI** (Turborepo or equivalent): only packages a change touched run their tests; docs-only changes trigger no test job.
- **API routes inside SvelteKit** (`/api/v1`) as thin wrappers over the shared packages. Web UI calls packages server-side; native clients call the routes. Boundary enforced by lint: no SvelteKit imports inside `packages/`, no database access outside the service layer.
- **OpenAPI** generated from route input/output schemas, committed, CI fails if stale; the iOS client is generated from it.
- **Native Swift / SwiftUI** is the direction for iOS and macOS (not a wrapped web view). Design tokens must export to Swift.
- Spin-off into a separate repo only when a package is reused elsewhere (`/spin-off-component`); never for size alone.

### 2.11 Fake import source

- **Deterministic seeded generator**, not a runtime LLM agent: seed + date range → identical output; runs in CI in milliseconds. An agent authors the **persona profile fixtures** once (accounts, recurring payees with schedules and jitter, salary cadence, category spend distributions, one-offs).
- Built as a **provider adapter** behind the real import interface, registered as `fake`, so every import-layer test runs against it exactly as against a real provider. Switching a dev instance to SimpleFIN is a config change.
- **Three personas:** (1) single person — checking, savings, credit card, brokerage; (2) couple — two Person entities plus a Household with a joint account (exercises transfer matching and the roll-up schema); (3) an entity with a brokerage that buys, sells, receives dividends and return of capital (exercises the securities sub-ledger and lots).
- **Fake EOD price feed** behind the price-provider interface: plausible random walk per ticker.

### 2.12 Effort estimation methodology

- **Units:** tokens (cost) and **gate cycles** (bloat; one red→green pass or one review round). Wall-clock recorded but secondary. Human minutes never appear.
- **Decomposition:** each issue → cairn sub-issues, one per agent, each tagged with stage (plan / execute / review), owned paths, dependencies on other sub-issues, and an estimate of expected tokens and gate cycles. Written by the lead, reviewed by the architect **before implementation**.
- **Closing the loop:** at issue close a cairn command pulls actuals from the OTel token telemetry and the per-agent commit log, writes the actual/estimate ratio onto the sub-issue, and appends a calibration record. Closed sub-issues become **reference classes** for estimating new ones.
- **Bloat signal:** gate cycles over estimate, or token ratio over a threshold, flags the sub-issue; flagged items feed the post-milestone cleanup sweep. **Threshold is set after the first milestone's baseline.**
- Built into cairn. Neither *Claude Code Time Estimator* (human-minute units; its calibration loop is borrowed) nor *OpenSpec* (duplicates cairn + docs; its "tasks before code" idea is borrowed) is adopted.
- Its own workflow milestone, before the first product milestone.

### 2.13 Remaining open questions — resolved

| Question | Resolution |
|---|---|
| Playwright for regressions? | **Playwright tests** (headless, CI) for a small end-to-end smoke suite: login, import a batch, confirm a draft, view a statement. **Playwright MCP / agent-driven browsing** for the QA engineer's exploratory and visual checks only — not regression. |
| When to write component technical design docs? | At the start of each package's first milestone, as the architect's first gate in the Implement loop; a short interface-focused design file stored beside the package; revised only when its interface changes. ARCH stays at layers + API shape. |
| OpenAPI / Swagger? | Yes — see 2.10. |
| DB migration methodology? | Migrations are files committed with the code, **never hand-run**. CI applies them to a fresh Postgres on every run. VPS: one-off migrate step before the app container starts. Vercel: build step against Neon. **Tool chosen in Plan; Drizzle is the leading candidate** (TypeScript schema, plain-SQL migrations, RLS policies in schema); the architect checks the `mosko-fintech` incumbent first. |
| Deploy latest release vs. main? | **Staging** auto-deploys every merge to `main`; **production** deploys only tagged releases cut by `/merge-pr`. |
| Dual VPS / managed deployment? | Yes — see 2.8. |
| Agent git separation? | See 2.1. |
| Secure MCP server over a user's data? | Feasible and cheap once the API exists: a thin client of the same HTTP API authenticated with the user's own bearer token, so it inherits RLS and never holds a database connection. Remote MCP with OAuth. **Future initiative**; noted in ARCH as one more API consumer alongside iOS. |

---

## 3. Working principles carried from the manifesto

- **Modular, layered, narrow interfaces.** Layers depend only downward (goal, not dogma); interfaces are the contracts between components; define layers before details.
- **Top-down scaffolding.** Skeletons, placeholder pages, interface stubs first; frontend mock-ups before the backend is designed in earnest.
- **SOLID and YAGNI.** Single responsibility per class; no structure for unstated future use.
- **Security and auditability are first-class.** RLS mandatory.
- **Professional code.** A senior engineer reading it should think "professional".
- **Cheap stack.** No pile of subscriptions.
- **Light CI.** Component-local tests on every change; the full battery only at integration milestones; docs-only changes run no tests; peer review (security, architecture) happens by direct agent message **before** CI; the CI suite is pared for obsolescence and redundancy at every milestone close.
- **Context hygiene.** Never append decision logs. Consolidate and remove superseded guidance; state the condensed new rule. Cleanup sweep after every milestone.
- **Fake data only in dev and test.** Plaid is real, expensive, and not online from day one.

---

## 4. Sequencing

1. **Template scrub** (2.2) and workflow milestone: per-agent git identity, path ownership check, estimation loop in cairn (2.1, 2.12).
2. **Pre-Discovery → initial PRD** with the initiative roadmap section (2.3), then the PRD interview proper.
3. **Design system** with the Artifact design tool → `docs/DESIGN/` (2.9), then the **throwaway prototype** at `prototype/`: landing, nav, click flows, chart layouts, color schema.
4. **ARCH doc:** layers (imported and built), responsibilities, API interfaces; only then milestones and issues, including integration milestones between layers. GL build-vs-adopt research and migration-tool choice happen here.
5. **SECURITY doc:** threat model, RLS protocols, token/secret storage, infrastructure access.
6. **INFRA doc:** network topology (VPS, firewall, DNS, third parties incl. Resend), resource allocation (compute, compose, buckets), IAM / keys / TLS / compliance boundaries, environments and CI/CD (component-localized, docs-ignoring, fast; migration deployment mechanism), update and patch schedule, disaster recovery (backups, monitoring, RPO/RTO), and a deployment runbook a novice can follow.
7. **Implement → Validate loops**, `stop-at-merge` by default; per milestone the Principal chooses one-by-one or self-merge. PRD / ARCH / SECURITY / INFRA are living artifacts.
