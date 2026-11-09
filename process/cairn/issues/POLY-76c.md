---
id: POLY-76c
title: Spike ruling, ARCH 6.2
status: todo
milestone: POLY-M1
parent: POLY-76
blocked_by: [POLY-76b]
assignee: architect
paths: [docs/ARCH/index.html, process/cairn/reviews/POLY-76/ruling.md]
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

- [ ] `process/cairn/reviews/POLY-76/ruling.md` states confirm or flip, citing the record's evidence per item.
- [ ] ARCH §6.2 no longer says "provisional"; OQ-10 and OQ-16 are closed or restated with what the spike measured.
- [ ] Any consequence for POLY-83, POLY-86 or POLY-100 is listed for the lead.
