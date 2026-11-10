---
id: POLY-131
title: Layer lint follow-ups
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-82]
assignee: backend-lead
paths: [scripts/layers/**, tests/layers/**, layers.json, docs/ARCH/index.html, docs/SECURITY/index.html]
labels: [enabler]
priority: P3
pr: null
created: 2026-11-09
updated: 2026-11-09
---

Umbrella for the non-blocking findings from the architect's POLY-82 review (verdict comment on POLY-82 @ 173952f). One loop for the batch, not one issue each; add later layer-lint nits here.

## Items

- [ ] **S4 — `set_config` false positive.** The session-SET rule's argument split stops at the first `)`, so `set_config('a', coalesce(x, ''), true)` fails although its third argument is the literal `true`. Fails closed today; fix the split (balanced parentheses) and add the pass fixture.
- [ ] **S6 — comment stripping is not quote-aware.** A `--` inside an SQL string literal (`'a -- b'`) strips the rest of the line, hiding a later `SET ROLE` from the rule. Strip comments with a tokenizer that respects single-quoted strings and dollar-quoting; add the fail fixture.
- [ ] **SecEng sign-off on the HPKE library.** ARCH v1.15 names `@hpke/core` + `@hpke/dhkem-x25519` (architect's pick, POLY-82 ruling). SecEng confirms or replaces it in the M2 secrets design; SECURITY §6.3 records the decision. The lint already bans `hpke-js` and `@hpke/*` outside packages/secrets, so the ban needs no change unless the pick does.

## Comments

### @team-lead — 2026-11-09

Add to the batch: delete `spikes/poly-76/` once POLY-83 has merged. It is the throwaway migration-chain spike (25 files) kept as evidence behind the architect's POLY-76 ruling and as the runner's reference while POLY-83 builds; `process/cairn/reviews/POLY-76/ruling.md` is the durable record. Same treatment for `prototype/` when the first real screens ship (POLY-128).
