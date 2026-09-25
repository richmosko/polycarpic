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

## Comments

### @team-lead — 2026-09-25

Feature started. Branch: `feature/poly-57-cairn-docs-cleanup`.
