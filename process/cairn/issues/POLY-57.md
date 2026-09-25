---
id: POLY-57
title: Cairn docs: living docs only, rulings as audit records
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, docs]
priority: P2
pr: null
created: 2026-09-25
updated: 2026-09-25
---

`scripts/cairn/design/` mixes three things: one living design note (`estimation.md`), five loop-scoped gate-1 rulings (POLY-6, POLY-10, POLY-26, POLY-48, POLY-51), and vendored board theme data from the template (`variants.json`, `gen_variants.py`, `NOTICE.md`, `bootstrap.snippet.html`). The rulings landed there by precedent, not by rule: WORKFLOW.md says a ruling is an issue comment within the 40-line budget, with overflow in `process/reviews/<ID>/`.

**User decisions (2026-09-25):**
- Cairn's docs stay inside `scripts/cairn/` (they travel with a spin-off) but the directory is `docs/`, not `design/`.
- Rulings are audit records. They are read for audit only, so they are never folded into living docs as prose. Where a living doc states a behaviour a ruling changed, that one statement is corrected in place; nothing else is added.
- `process/TRACKER.md`, `scripts/cairn/docs/estimation.md`, `process/WORKFLOW.md`, and `.claude/agents/*.md` are read every loop. Only what is strictly necessary goes in: no agent prose, no history, no rationale.

**Known stale statement:** `estimation.md`'s `--at` token-ceiling text predates the POLY-47 rule (first otel flush after the commit within 1800 s; see the POLY-48 ruling Addendum 1). Check the other four rulings for a second one before assuming there is none.

## Acceptance criteria

- [ ] `scripts/cairn/design/` is gone; `scripts/cairn/docs/` holds `estimation.md` and a README of at most ten lines saying what belongs there (living docs only)
- [ ] Vendored theme data moves under the board directory that consumes it; `gen_variants.py` and every reference still resolve
- [ ] The five ruling files move to `process/reviews/<ID>/ruling.md` unchanged; every path reference in TRACKER.md, WORKFLOW.md, and issue files points at the new location
- [ ] Living docs corrected in place only where a ruling changed a stated behaviour, one sentence each; diff of TRACKER.md and estimation.md reviewed line by line against that rule
- [ ] WORKFLOW.md and the architect agent file gain one line each: a ruling is an issue comment within budget, or `process/reviews/<ID>/ruling.md`; never a file under `scripts/cairn/docs/`
- [ ] Tests, `cairn check`, and the docs links all pass after the moves
- [ ] `scripts/cairn/docs/estimation.md` is pruned to current behaviour (user decision 2026-09-25, in this loop): history, rationale, loop narratives, and superseded rules go; every statement that remains is true now, and no behaviour statement is lost

## Comments

### @team-lead — 2026-09-25

Feature started. Branch: `feature/poly-57-cairn-docs-cleanup`.

### @architect — 2026-09-25

**Gate-1 ruling (POLY-57a), base `f686787`.** Reference list, tests, and thresholds: `process/reviews/POLY-57/ruling.md`.

1. **Split.** Living: `estimation.md` → `scripts/cairn/docs/`. Rulings, moved unchanged (`git mv`, blob shas pinned in ruling.md §1): test-boundary-ci → `process/reviews/POLY-6/ruling.md`, telemetry-attribution → POLY-10, backfill-sibling-scan → POLY-26, estimation-engine-fixes → POLY-48, sub-issue-letter-ids → POLY-51. Theme data (`variants.json`, `gen_variants.py`, `NOTICE.md`, `bootstrap.snippet.html`) → `scripts/cairn/board/theme/`; `gen_variants.py` resolves `cairn_dir = SCRIPT_DIR.parents[1]`, and its three emitted headers are regenerated. `dist/index.html` L14–16 is edited by hand alongside `dashboard/index.html` (no `node_modules`, measured). Done means the ruling.md §2 `git grep` predicate returns nothing.
2. **Stale statements.** POLY-6, POLY-10, POLY-26, POLY-51: none (measured: their TRACKER text already landed). POLY-48: two.
   - `estimation.md` §2 Tokens: `from_ts < generated <= close_ts` → `from_ts < generated <= to_ts   (to_ts = close_ts; with --at, the first otel flush within 1800 s after it)`.
   - `TRACKER.md` L419: "An issue's `paths:` list declares" → "An issue's `paths:`, unioned with the `paths:` of every other issue sharing its `parent` and `assignee`, declares" (the rest of the sentence is unchanged).
3. **One line each.** Both `process/WORKFLOW.md` (after the "Rulings live in the file" bullet, L242) and `.claude/agents/architect.md` (after the "Comment budget" bullet in → Rulings) get this line:
   ```
   - **A ruling is an issue comment within budget, or `process/reviews/<ID>/ruling.md`**; never a file under `scripts/cairn/docs/`.
   ```
4. **`scripts/cairn/docs/README.md`**, verbatim:
   ```
   # cairn docs

   Living docs only: text that states how cairn behaves now.
   When a statement stops being true, correct it in place.

   Not here:
   - Gate rulings: an issue comment, or `process/reviews/<ID>/ruling.md`.
   - History, rationale, agent prose: the issue file and the git log.
   - Vendored theme data: `../board/theme/`.
   ```
5. **cairn.py split.** Sketch in ruling.md §6; filed as POLY-58 (todo, POLY-A). Not in this loop.

**Tests (qa, red first):** `scripts/cairn/tests/test_docs_layout.py` (cairn side) plus one `tests/workflow/` check (ruling blobs, grep predicate). Retarget the two theme tests to `board/theme/`. Details are in ruling.md §4.
**Guards:** suite + `tests/workflow` green; `cairn check` clean; dist fresh; the generator leaves the tree clean; the TRACKER/estimation diff contains only path edits plus the two sentences.

### @architect — 2026-09-25

**Addendum 1 (POLY-57a) — two facts, no change to the ruling.**
- The `--at` ceiling bullet (`estimation.md` L461) was already corrected at `f7faaae`. The one remaining POLY-48 statement is the §2 Tokens formula line (`<= close_ts`), which ruling item 2 corrects.
- Generator path math: under `board/theme/`, `SCRIPT_DIR.parents[1]` resolves to `scripts/cairn` (ruling item 1). Two functional test paths break on the move and are qa's to fix: `test_theme_variants_generator.py` L51 (`DESIGN_DIR`) and `test_theme_bootstrap_and_dropdown.py` L76.

### @team-lead — 2026-09-25

AC amended in place (user decision 2026-09-25): `estimation.md` is pruned to current behaviour in this loop, not filed as a follow-up. Sequence: after POLY-57c's green, the architect prunes in a new execute sub-issue (POLY-57e, paths `scripts/cairn/docs/estimation.md`); the lead reads the diff against the "strictly necessary" rule; qa's verdict runs on the final sha.
