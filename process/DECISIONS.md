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
**Decision:** `backfill_tokens.py` derives a cutoff from the data file (the start of the earliest otel `window_start`), drops every record at or after it, stamps its lines `generated` = cutoff, and refuses under the lock if otel lines appear before its cutoff. `/api/tokens` keeps summing every source per bucket. Ruling: `process/reviews/POLY-50/ruling.md` §2.
**Why:** A backfill line aggregates one `(issue, role, model)` over its bucket's whole time span, so most buckets straddle the first otel day and the reader cannot split them after the fact. The cutoff under-attributes at most the records between midnight and the first otel export on that day (≤ 945 here); it never double-counts.
**Alternatives considered:** Per-window source precedence in the reader (needs date-granular backfill lines, a schema change for no gain); a `--until` flag (a value nobody would keep in sync with the data file).
**Approved by:** richmosko (POLY-50 plan confirmed 2026-09-26)

### 2026-09-26 — Checklist ticks go through a CLI; board write-back stays deferred
**Decision:** `cairn check-item <ID> <ordinal> [--uncheck] [--text <exact>]` is the one path that flips a body `- [ ]` item: exactly one byte changes, `updated` is untouched, the write is mtime-guarded and idempotent. The board's checkboxes stay `disabled`; qa's verdict ticks criteria with the CLI and commits the file by pathspec. Ruling: `process/reviews/POLY-56/ruling.md` R2.
**Why:** Cairn has had zero body-rewriting paths since 2026-08-19, and the loop's evidence chain is commits by pathspec. A CLI tick lives inside that discipline; a board tick would need a stale-snapshot check against a teammate editing the same body in a worktree and a server-side rewrite path with no commit attached.
**Alternatives considered:** Board write-back with an anchored rewrite (text + ordinal) and a conflict check (deferred, not rejected: it can be built on top of the same `check-item` core once the board has a commit story); leaving write-back deferred entirely (qa would keep ticking by hand, which is what produced the by-hand edits this issue set out to remove).
**Approved by:** richmosko (POLY-56 plan confirmed 2026-09-26)

### 2026-09-27 — cairn.py becomes a facade over a flat `cairnlib/` package
**Decision:** cairn's implementation lives in `scripts/cairn/cairnlib/`, 21 flat modules in a leaves-first dependency order; `scripts/cairn/cairn.py` holds only re-exports and the `__main__` guard, exposing exactly the original 237 public names as the same objects. Tests patch the module where the caller looks a name up, never the facade. The board's stale-engine check fingerprints the whole package directory. Ruling: `process/reviews/POLY-58/ruling.md`.
**Why:** one 8,000-line file made every cairn loop collide in the same file and let no module test alone. Keeping `import cairn` byte-for-byte compatible means the shim, the four sibling scripts and 54 test files needed no edits; the flat package (not nested sub-packages) keeps the import graph one level deep and the extraction one commit per module with the suite green at each.
**Alternatives considered:** the earlier 13-module sketch (11 backward calls, could not be extracted in order); nested sub-packages such as `readers/` (a second level of `__init__` re-exports for no boundary gain); rewriting callers to import `cairnlib` directly (touches every test and script for no behaviour change).
**Approved by:** richmosko (POLY-58 plan confirmed 2026-09-26)

### 2026-09-27 — Cairn record writes are bytes in, bytes out
**Decision:** every cairn command that rewrites an issue file goes through `cairnlib.records.read_record` / `write_record`: the file is read and written as bytes, the frontmatter is re-emitted with the file's own line ending, and nothing after the closing fence changes unless the command's edit is there. The text-mode writer is gone. `parse_frontmatter` accepts a `---\r` fence so CRLF files parse everywhere. Ruling: `process/reviews/POLY-60/ruling.md` R1.
**Why:** `set`, `comment` and `close` silently rewrote whole CRLF files to LF on first touch, so the tracker's byte-for-byte guarantee was false for every path except POLY-56's `check-item`. One seam under one fixture test per path is cheaper to keep true than five separate promises.
**Alternatives considered:** normalise every file to LF on read and declare LF canonical (breaks the guarantee by fiat and rewrites files nobody edited); fix only `check-item`'s refusal (leaves the three rewriting paths wrong).
**Approved by:** richmosko (POLY-60 plan confirmed 2026-09-27)
