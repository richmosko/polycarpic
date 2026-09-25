---
id: POLY-58
title: Split cairn.py into modules
status: todo
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, refactor]
priority: P3
pr: null
created: 2026-09-25
updated: 2026-09-25
---

`scripts/cairn/cairn.py` is 7,400 lines and 167 top-level definitions in one file; parallel loops touching cairn collide in it, and no module tests alone. The architect's boundary sketch (13 modules under a `scripts/cairn/cairnlib/` package, leaves-first extraction order, test mapping) is in `process/reviews/POLY-57/ruling.md` §6. `cairn.py` stays the CLI entry and a re-export facade, so `import cairn` keeps working for tests and for `backfill_tokens.py`, `otel_receiver.py`, `loop_stats.py`.

## Acceptance criteria

- [ ] A gate-1 ruling re-measures the §6 sketch (line ranges, cross-module calls, which tests patch `cairn.<attr>`) and fixes the module list
- [ ] Each module is extracted in its own commit, in the ruled order, with the suite green at every commit
- [ ] `cairn.py` is the CLI entry plus re-exports only; `import cairn` behaviour is unchanged for every caller
- [ ] Tests that patch `cairn.<attr>` patch the owning module instead; test filenames do not change
- [ ] Full suite time does not grow

