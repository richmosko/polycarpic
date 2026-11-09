---
id: POLY-76c
title: Spike ruling, ARCH 6.2
status: in-progress
milestone: POLY-M1
parent: POLY-76
blocked_by: [POLY-76b]
assignee: architect
paths: [docs/ARCH/index.html, process/cairn/reviews/POLY-76/ruling.md, process/cairn/issues/POLY-76.md, process/cairn/issues/POLY-76c.md, process/cairn/issues/POLY-83.md, process/cairn/issues/POLY-86.md, process/cairn/issues/POLY-100.md]
stage: review
estimate.cost_usd: "1.50"
estimate.gate_cycles: 1
labels: [spike, db]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

The architect reads the spike record, rules confirm or flip on the migration tool, and updates ARCH §6.2 to a final decision. A failed (a), (b), (b′), (c) or (e) flips to dbmate plus Kysely codegen; (f) goes back to the Principal and the architect and does not flip the tool.

## Acceptance criteria

- [x] `process/cairn/reviews/POLY-76/ruling.md` states confirm or flip, citing the record's evidence per item.
- [x] ARCH §6.2 no longer says "provisional"; OQ-10 and OQ-16 are closed or restated with what the spike measured.
- [x] Any consequence for POLY-83, POLY-86 or POLY-100 is listed for the lead.

## Comments

### @architect — 2026-11-08

Ruling: CONFIRM Drizzle Kit. (a) (b) (c) (e) pass; (b′) passes with a derived snake_case `fields` map; (e) passes with FORCE RLS in custom SQL, guarded by POLY-84's catalog probe; (f) measured, one question to the Principal (context-free sign-up transaction, recommend yes). Read process/cairn/reviews/POLY-76/ruling.md. ARCH v1.13: §6.2 final, OQ-10 closed, OQ-16 measured. Criteria added to POLY-83, POLY-86, POLY-100; POLY-84, POLY-87 and layers.json consequences listed for the lead (ruling §6).
