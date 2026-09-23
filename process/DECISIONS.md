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

<!--
Add new decisions ABOVE this comment, newest first.
-->
