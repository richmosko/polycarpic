# Decisions

> Log of non-trivial decisions made over the life of this project. Conventions in [`WORKFLOW.md`](WORKFLOW.md) → Decision logging.
>
> This file lives **outside** `STATE.md` so it doesn't bloat the auto-loaded session context. Pull this file in explicitly when you need to recall *why* a past decision was made.
>
> **Consolidation rule (Principal, 2026-09-22):** a decision that supersedes an earlier one **replaces** the earlier entry with the condensed new guideline — do not stack reversals. Git history is the audit trail. The one-line "Supersedes" field records what was replaced.

## Format

```
### YYYY-MM-DD — <short decision title>
**Decision:** <one sentence>
**Why:** <one or two sentences>
**Alternatives considered:** <bullets>
**Approved by:** <name>
**Supersedes:** <ref to prior decision, if any>
```

---

### 2026-09-23 — PRs merge with a merge commit, never squash
**Decision:** `/merge-pr` and the GitHub UI merge every PR with a merge commit; squash and rebase merges are disabled in the repo settings.
**Why:** POLY-1 gave each teammate its own git author identity so work can be attributed by agent from the commit log. PR #3 was squashed and `main` now carries one commit authored by the Principal for the whole feature; the per-agent commits survive only on the PR. Merge commits keep every commit, and its author, on `main`, at the cost of a merge bubble and the tracker chore commits in `main`'s history.
**Alternatives considered:** Keep squash and read attribution pre-merge from the feature branch (works for cairn's close-time read, useless for any later analysis of `main`); rebase merge (linear and author-preserving, but rewrites shas so the ones quoted in issue comments stop matching `main`).
**Approved by:** richmosko

### 2026-09-23 — Finish-gate exception only for failures already red on `main`
**Decision:** `/finish-feature`'s full-suite gate may be bypassed for a PR only when every failure is already red on `main`, touches none of the PR's changed files, and is tracked in an open issue named in the PR body; the next loop takes that issue before any other feature.
**Why:** POLY-1's gate was red solely from template-scrub debris (five files, POLY-4). A gate that cannot pass for any PR is not a gate; the exception keeps the loop honest without blocking approved, verdicted work.
**Alternatives considered:** Fold the suite cleanup into the approved PR (scope creep after review); hold the PR until POLY-4 lands (blocks a verdicted feature on unrelated debris).
**Approved by:** richmosko

### 2026-09-23 — Kickoff decisions consolidated in `docs/project_kickoff.md`
**Decision:** The thirteen decision areas settled in the kickoff clarification pass (tracker = cairn with prefix `POLY`; delivery autonomy = `stop-at-merge` with per-milestone self-merge grants; per-agent git author identity; path ownership declared per task; initiatives as a PRD roadmap section; entity-owns-books tenant model; ledger in our Postgres under RLS; schema-ready multi-currency; draft→immutable imports with two-way immutability, opt-in auto-post rules, transfer matching, reconciliation; declarative reports with read-only templates; BetterAuth; Hetzner VPS primary with Vercel+Neon secondary; shadcn-svelte; pnpm monorepo with SvelteKit-hosted API; native Swift; deterministic fake provider; token + gate-cycle estimation in cairn) are recorded there, one section each, and are not duplicated here.
**Why:** One consolidated record beats thirteen ledger entries; the kickoff file is the operative source until the PRD/ARCH docs absorb it.
**Alternatives considered:** One entry per decision here.
**Approved by:** richmosko

### 2026-09-23 — Project bootstrapped from template
**Decision:** Use the `project_template` starter as the foundation for this project.
**Bootstrapped from:** `project_template` **v0.12.2**
**Why:** Provides the R→P→I→V workflow, team-agent roster, artifact conventions, and the cairn tracker out of the box. Template history (archive, metrics, reviews, template decisions, starting prompt) was scrubbed the same day; `PT-nn` citations in scripts, agent files, and `WORKFLOW.md` are kept as pointers into the template for porting future updates.
**Alternatives considered:** Bare repo + ad-hoc workflow.
**Approved by:** richmosko

### 2026-09-25 — Modular, atomic components with self-contained tests
**Decision:** Components are built as modules that each carry a test file runnable alone; prefer a new module over growing a large file, and reviews flag monolith growth. Recorded as a working principle in `CLAUDE.md`.
**Why:** Parallel feature loops on separate branches pay off only when features touch disjoint files; the second PR to merge eats the rebase, and semantic conflicts that git merges silently are caught only by tests. `scripts/cairn/cairn.py` (7,400 lines) is the standing counter-example.
**Alternatives considered:** Keep monoliths and serialize all loops; cross-branch path guards (they cannot see semantic conflicts).
**Approved by:** richmosko

<!--
Add new decisions ABOVE this comment, newest first.
-->

### 2026-09-26 — Backfill stops at the earliest otel day; the reader never arbitrates between sources
**Decision:** `backfill_tokens.py` derives a cutoff from the data file (the start of the earliest otel `window_start`), drops every record at or after it, stamps its lines `generated` = cutoff, and refuses under the lock if otel lines appear before its cutoff. `/api/tokens` keeps summing every source per bucket. Ruling: `process/cairn/reviews/POLY-50/ruling.md` §2.
**Why:** A backfill line aggregates one `(issue, role, model)` over its bucket's whole time span, so most buckets straddle the first otel day and the reader cannot split them after the fact. The cutoff under-attributes at most the records between midnight and the first otel export on that day (≤ 945 here); it never double-counts.
**Alternatives considered:** Per-window source precedence in the reader (needs date-granular backfill lines, a schema change for no gain); a `--until` flag (a value nobody would keep in sync with the data file).
**Approved by:** richmosko (POLY-50 plan confirmed 2026-09-26)

### 2026-09-26 — Checklist ticks go through a CLI; board write-back stays deferred
**Decision:** `cairn check-item <ID> <ordinal> [--uncheck] [--text <exact>]` is the one path that flips a body `- [ ]` item: exactly one byte changes, `updated` is untouched, the write is mtime-guarded and idempotent. The board's checkboxes stay `disabled`; qa's verdict ticks criteria with the CLI and commits the file by pathspec. Ruling: `process/cairn/reviews/POLY-56/ruling.md` R2.
**Why:** Cairn has had zero body-rewriting paths since 2026-08-19, and the loop's evidence chain is commits by pathspec. A CLI tick lives inside that discipline; a board tick would need a stale-snapshot check against a teammate editing the same body in a worktree and a server-side rewrite path with no commit attached.
**Alternatives considered:** Board write-back with an anchored rewrite (text + ordinal) and a conflict check (deferred, not rejected: it can be built on top of the same `check-item` core once the board has a commit story); leaving write-back deferred entirely (qa would keep ticking by hand, which is what produced the by-hand edits this issue set out to remove).
**Approved by:** richmosko (POLY-56 plan confirmed 2026-09-26)

### 2026-09-27 — cairn.py becomes a facade over a flat `cairnlib/` package
**Decision:** cairn's implementation lives in `scripts/cairn/cairnlib/`, 21 flat modules in a leaves-first dependency order; `scripts/cairn/cairn.py` holds only re-exports and the `__main__` guard, exposing exactly the original 237 public names as the same objects. Tests patch the module where the caller looks a name up, never the facade. The board's stale-engine check fingerprints the whole package directory. Ruling: `process/cairn/reviews/POLY-58/ruling.md`.
**Why:** one 8,000-line file made every cairn loop collide in the same file and let no module test alone. Keeping `import cairn` byte-for-byte compatible means the shim, the four sibling scripts and 54 test files needed no edits; the flat package (not nested sub-packages) keeps the import graph one level deep and the extraction one commit per module with the suite green at each.
**Alternatives considered:** the earlier 13-module sketch (11 backward calls, could not be extracted in order); nested sub-packages such as `readers/` (a second level of `__init__` re-exports for no boundary gain); rewriting callers to import `cairnlib` directly (touches every test and script for no behaviour change).
**Approved by:** richmosko (POLY-58 plan confirmed 2026-09-26)

### 2026-09-27 — Cairn record writes are bytes in, bytes out
**Decision:** every cairn command that rewrites an issue file goes through `cairnlib.records.read_record` / `write_record`: the file is read and written as bytes, the frontmatter is re-emitted with the file's own line ending, and nothing after the closing fence changes unless the command's edit is there. The text-mode writer is gone. `parse_frontmatter` accepts a `---\r` fence so CRLF files parse everywhere. Ruling: `process/cairn/reviews/POLY-60/ruling.md` R1.
**Why:** `set`, `comment` and `close` silently rewrote whole CRLF files to LF on first touch, so the tracker's byte-for-byte guarantee was false for every path except POLY-56's `check-item`. One seam under one fixture test per path is cheaper to keep true than five separate promises.
**Alternatives considered:** normalise every file to LF on read and declare LF canonical (breaks the guarantee by fiat and rewrites files nobody edited); fix only `check-item`'s refusal (leaves the three rewriting paths wrong).
**Approved by:** richmosko (POLY-60 plan confirmed 2026-09-27)

### 2026-09-27 — POLY-A split into tooling and research; Plan renamed POLY-C
**Decision:** the definition milestone `POLY-A` (Bootstrap & Research) is split: `POLY-A` becomes Bootstrap & Tooling and closes with the template scrub, the kickoff § 2.1 / § 2.12 workflow items, and the cairn/telemetry follow-up umbrellas through POLY-60; a new `POLY-B` (Research) carries the PRD half of the old definition and is now in progress; the Plan milestone that held the `POLY-B` id is renamed `POLY-C`. The three done issues that had no milestone (POLY-7, 8, 9) are attached to `POLY-A` so the archive sweeps them. `POLY-A` is archived with its issues.
**Why:** every one of the 60 issues under `POLY-A` was tooling work; the Research phase proper (PRD interview, user stories) has not started. Closing the tooling work as its own milestone gives the board a clean lane for research issues and lets `cairn archive` clear the 60-issue backlog, which it refuses while the milestone is open. `WORKFLOW.md` → Definition milestones already anticipates subdividing `A` when it turns out heavy.
**Alternatives considered:** close `POLY-A` as-is and start Research under `POLY-B` (Plan) — misnames the phase and leaves the definition of done half-met; keep `POLY-A` open through the PRD — the 60 tooling issues stay in the default view for the whole Research phase.
**Approved by:** richmosko (2026-09-27, items 2–4 of the session plan)

### 2026-09-27 — Audience is self-hostable by others, never hosted; baseline security engineering is a hard requirement
**Decision:** polycarpic is built so a competent stranger can run their own copy for their own household; a hosted multi-user offering is a standing non-goal, not a v1 deferral. No compliance program (GLBA, PCI DSS, SOC 2) is required for this build. The security engineering SecEng identified as baseline is nonetheless a hard NFR: aggregator tokens encrypted at rest, never logged or returned, revoked at the provider; RLS keyed on the membership join and proven safe under connection pooling, with policies on every table including staging, drafts and lots; an owner/manager/viewer permission matrix with tests; trigger-enforced append-only posted entries with reversal-only corrections; an actor column on journal entries and drafts; documented volume encryption and encrypted, tested backups with a stated RPO/RTO; superuser bypass documented as an accepted risk with the owner as approver.
**Why:** obligations follow the customer relationship, not the software. Self-hosting for others adds a packaging and documentation tax but no regulator; hosting would add a written security program, breach-notification deadlines, third-party pen tests and legal documents, which is proof and paperwork rather than code. The Principal wants the code half regardless, because the threats that exist today (a household viewer login, the owner's own ad hoc SQL) are the same ones the stricter engineering addresses.
**Alternatives considered:** household-only indefinitely (skips the packaging tax; forecloses nothing technically, but the Principal wants the recipe publishable); hosted offering kept open (would make GLBA-grade isolation, KMS and audit logging Plan-phase constraints now).
**Approved by:** richmosko (PRD v1 interview, 2026-09-27)

### 2026-09-27 — Transfers post through Cash in Transit when legs differ in date; the date window is import matching, not posting
**Decision:** a journal entry has exactly one posting date. A transfer whose raw legs share a date posts as one multi-leg entry; legs on different dates post as two entries through the seeded Cash in Transit clearing account (out-date: debit CIT, credit source; in-date: debit destination, credit CIT). The configurable date window belongs to the import layer, which uses it to recognise two raw rows as one transfer and link both to it. Unmatched legs post to CIT as open items; items older than a configurable threshold (default three business days) surface on an exceptions report. The Goals metric "CIT clears within a target window" is replaced by "CIT is fully explained at every check, zero aged exceptions".
**Why:** kickoff § 2.6 said the two legs are "paired within a date window into one multi-leg entry", which conflates matching with posting and would put two dates on one entry. Settlement time is the bank's, not a product goal; explainability of the clearing account is.
**Alternatives considered:** keep the kickoff wording and revisit in Plan (leaves a known accounting error in the requirement the architect designs from).
**Approved by:** richmosko (PRD v1 interview, 2026-09-27)

### 2026-09-27 — Quarterly estimated tax uses the annualized-installment method as a running accrual; payments are prepaid-tax assets; filing treatment follows entity tax classification
**Decision:** the estimate is the annualized-installment method run continuously. Any day of the year, per entity and jurisdiction, the app annualizes income to date by tax treatment through the applicable rates and shows three figures: the **pending liability** (100 % of annualized tax to date minus the prepaid-tax balance), the **two safe-harbor values** (prior-year basis: last year's filed tax × 100/110 % × the cumulative fraction due at the next due date; current-year basis: 90 % × annualized tax × the same fraction) with the required payment being the lesser, and the **gap** between required and pending liability. At each jurisdiction's period cutoff the period's annualized figure is frozen and stored, fixing the upcoming installment while the accrual continues on the next period; the frozen figures are exported at filing for Schedule AI / Form 2210 and the state equivalent. Due dates, period cutoffs, annualization multipliers and cumulative percentages are a **per-jurisdiction, per-filing-year lookup table** held as data (federal 25/50/75/100 over 3-2-3-4-month periods; California 30/70/70/100); rate tables likewise, storage decided by the architect in Plan. Prior-year tax is a once-a-year manual input per entity and jurisdiction. Each estimated payment is a transfer into a prepaid-tax asset account per jurisdiction (custodian IRS or state); filing is the settling entry, and whether that entry is an expense or a distribution follows a per-entity tax-classification attribute (individual, grantor trust, non-grantor trust, pass-through, C-corp). The Goals metric is: quarterly transfers into the prepaid accounts match the app's required figure, and filing shows no underpayment penalty. The CPA confirms trust and pass-through treatment for the actual entities (PRD open question).
**Why:** the drafted metric compared the app to a manual calculation, which measures nothing since filing stays in tax software. A single safe-harbor figure is skewed by a prior-year windfall; showing prior-year and current-year bases side by side with the full pending liability lets the Principal choose the payment and see what it leaves for April. The Principal already accrues continuously and pays the accrued figure at each due date, which is the annualized method; an earlier draft of this entry mislabelled that as a "projection" and listed the annualized method as a non-goal — corrected here before merge. Period tables as data keep a new tax year a row, not a release.
**Alternatives considered:** the IRS regular method (level installments judged against the year's final tax — penalises lumpy income); a single hard-coded safe-harbor method (catastrophic after a windfall year); treating estimated payments as expense on payment (misstates the balance sheet until filing); jurisdiction tables in code (a release per tax year).
**Approved by:** richmosko (PRD v1 interview rounds 1–2, 2026-09-27)

### 2026-09-27 — Development milestones are M-ordinals until designated to cut a release; timeline is self-paced; backlog seeded unmilestoned
**Decision:** development milestones under `POLY-V1` are named `POLY-M1`, `POLY-M2`, … while Plan defines their scope; a milestone is renamed to its version (`POLY-0.x`, `POLY-1.0`) only when designated to cut a release, preserving the tracker's milestone ↔ tag 1:1 rule. No milestone carries a target date; estimates come from the tracker's observed baseline after the first development milestone. The PRD's twelve story-grain issues are created now as `backlog` with no milestone; the architect files them into M-milestones and sets order in Plan.
**Why:** sequencing is not guaranteed during Plan, and an ordinal carries no promise a version name would. Dates now would be guesses with nothing behind them. Seeding early keeps the product's scope visible on the board through Plan; backlog status keeps the drive loop off them.
**Alternatives considered:** version-named milestones from the start (cleaner, less sequencing freedom); decoupling tags from milestone names entirely (a tracker spec change); holding the issue list in `temp/` until milestones exist (an empty board during Plan).
**Approved by:** richmosko (PRD v1 interview, 2026-09-27)

### 2026-09-27 — Research gate approved: PRD v1; Plan opens with UX and architecture in parallel, prototype as a live mocked dev server
**Decision:** the Research milestone `POLY-B` is closed and archived. PRD v1 (`docs/PRD/index.html`, header flipped to Approved) is the Plan-phase input: nine user stories, thirteen story-grain backlog issues, four interview rulings in this ledger. Plan (`POLY-C`) opens with two tracks in parallel rather than the kickoff's strict sequence: the ux-designer builds the design system and wireframes with the Principal via `/generate-designdoc`, while the architect starts the layer model and the GL build-vs-adopt research via `/generate-archdoc`; seceng and devops-engineer join once ARCH v1 exists. High-fidelity design is validated on the throwaway prototype at `prototype/` — a real SvelteKit dev server serving mocked pages with fake data (kickoff § 2.9), not static mockups — built from the wireframes once they exist. The lead runs every design interview itself, since teammates lack the question tool.
**Why:** the milestone's definition of done (PRD v1 approved, stories enumerated, backlog seeded) is met on `main` at PR #38. The kickoff orders design before ARCH because the API shape depends on the screens, not because the architect's research does; running both saves a phase-length wait. The Principal wants to judge look-and-feel on running pages, which the prototype was already scoped to provide.
**Alternatives considered:** holding Research open for the UX flows (the workflow template's "late Research" slot) — delays the gate for work the Plan milestone already owns; static wireframes only for high fidelity — the Principal asked for a running server.
**Approved by:** richmosko (2026-09-27, "Gate approved")

### 2026-09-28 — Cairn's theme assets and tests are localized to `scripts/cairn/`; cairn never writes under `docs/`
**Decision:** the inherited PT-69 shape, in which cairn's theme generator writes `docs/DESIGN/variants.css` and cairn's CI-run tests pin `docs/DESIGN/tokens.css` to the board's tokens, is reversed for this repo. Cairn's own design reference moves under `scripts/cairn/`, no cairn test reads any file under `docs/`, and the product design system in `docs/DESIGN/` is free to diverge from the tracker's look. Tracked as POLY-78 (devops-engineer), which must merge before the design-system branch can pass CI.
**Why:** `docs/DESIGN/` is the product's design directory and the Principal wants polycarpic's design to take its cues from Monarch Money and Origin, not from cairn. As inherited, any product palette change would fail the required `cairn` status check, so the coupling is a merge blocker, not a cosmetic one.
**Alternatives considered:** keep cairn's palette as the product base to satisfy the parity test (locks the product to tooling aesthetics); exempt `docs/` from CI's change filter (leaves the generator writing into the product tree).
**Approved by:** richmosko (2026-09-28, "ensure Cairn does not write or update anything in the docs directory")

### 2026-09-28 — seceng runs on opus
**Decision:** `.claude/agents/seceng.md` is retuned from the template default (`sonnet`, `effort: high`) to `opus`, `effort: high`. The sonnet instance spawned at Plan start was retired and respawned on opus before it produced deliverables.
**Why:** the security design for this project (RLS under connection pooling, credential encryption, purge path, threat model over a ledger) is novel system design in the same class as the architect's work, not pattern-matching.
**Alternatives considered:** sonnet with `effort: high` (the template's rationale; rejected by the Principal for this project).
**Approved by:** richmosko (2026-09-28)

### 2026-09-28 — Rulings live in the tracker record; `process/reviews/` is retired; a hand-off is never committed
**Decision:** durable rulings that exceed an issue comment's budget live at `process/cairn/reviews/<ID>/ruling.md`, inside the tracker's own parent directory, where CI's tracker-record exclusion already applies. The template-inherited `process/reviews/<ID>/` location is retired and its nineteen files moved with history. Hand-off files (drafts for the lead, decision candidates, review logs not meant for the record) are never committed: they live in `temp/`, which for a worktree-bound teammate means `temp/` inside its own worktree, pointed to by absolute path. `cairn guard-push` enforces it by refusing new files under `process/` outside the tracker record and the named process docs. Tracked as POLY-80. The same self-containment applies to cairn's own design assets (POLY-78).
**Why:** three principles from the Principal: cairn's records are self-contained under one parent; no unnecessary CI triggers; nothing that is a hand-off reaches GitHub. The inherited layout violated all three at once: a free-floating `process/` directory that the CI filter treats as test-relevant, with a hook and ten briefs telling agents to commit overflow there.
**Alternatives considered:** keep `process/reviews/` and exempt it from CI (leaves the hand-off path open and the records split across two parents); issue comments only with the line cap removed (rulings with tables and code would bloat issue files past the 24 KB board limit).
**Approved by:** richmosko (2026-09-28, "we should go with your rec on rulings")
