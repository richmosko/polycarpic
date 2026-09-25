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
