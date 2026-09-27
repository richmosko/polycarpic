---
id: POLY-58
title: Split cairn.py into modules
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, refactor]
priority: P3
pr: null
created: 2026-09-25
updated: 2026-09-26
---

`scripts/cairn/cairn.py` is 7,400 lines and 167 top-level definitions in one file; parallel loops touching cairn collide in it, and no module tests alone. The architect's boundary sketch (13 modules under a `scripts/cairn/cairnlib/` package, leaves-first extraction order, test mapping) is in `process/reviews/POLY-57/ruling.md` §6. `cairn.py` stays the CLI entry and a re-export facade, so `import cairn` keeps working for tests and for `backfill_tokens.py`, `otel_receiver.py`, `loop_stats.py`.

## Acceptance criteria

- [ ] A gate-1 ruling re-measures the §6 sketch (line ranges, cross-module calls, which tests patch `cairn.<attr>`) and fixes the module list
- [ ] The engine-staleness seam (ruling §4) lands first; then each of the 21 modules is extracted in its own commit, verbatim, in the ruled order, with the per-commit gate (ruling §7) green at every commit and the full suite green at build-green
- [ ] `cairn.py` is the facade only (ruling §3): no `def`/`class`; `import cairn` exposes all 237 names in `owners.txt`, each the same object as in its owning module; the shim, `backfill_tokens.py`, `otel_receiver.py`, `loop_stats.py`, `run_tests.py` are unchanged
- [ ] Tests that patch a `cairn` attribute patch the module where the caller looks the name up (ruling §5); test filenames do not change; the one new test file is `test_cairnlib_layout.py`
- [ ] Editing any `cairnlib` module makes the running board report a stale engine
- [ ] Full suite median time after ≤ before × (1 + max(0.05, spread)), measured per ruling §7

## Comments

### @team-lead — 2026-09-26

Feature started. Branch: `feature/poly-58-cairn-split`.

### @architect — 2026-09-26

**Gate 1 — ruling.** Full text: `process/reviews/POLY-58/ruling.md`; measurement script `graph.py`
and the derived name→module list `owners.txt` beside it. Every claim there cites its command (M1–M13)
or is tagged `(unmeasured)`. Acceptance criteria amended in place.

- **Re-measure.** `cairn.py` is 7,998 lines, 237 top-level names. The §6 sketch order has 11
  back-edge pairs (M3); the ruled order has 0 (M4).
- **Modules (§2).** Flat `scripts/cairn/cairnlib/`, 21 modules, one commit each, preceded by a
  step-0 engine-staleness seam: constants, errors, yamlsub, records, config, store, guards, lint,
  snapshot, roster, attribution, flow, tokens, actuals, payloads, multiroot, watch, server, archive,
  estimate, cli. Nine blocks relocate out of their section to break the cycles (§2 "+" entries).
- **Facade (§3).** Verbatim moves, explicit `from cairnlib.<m> import …` from earlier steps only,
  `__all__` per module (private names included); `cairn.py` ends as docstring + `import *` lines +
  `__all__` + `__main__` guard. Shim and the four sibling scripts get no edit. `__file__` anchors
  derive from `constants.CAIRN_DIR`.
- **Engine seam (§4).** Fingerprinting accepts a directory; `make_server` defaults to `cairnlib/`,
  otherwise the stale-engine banner would stop covering server code.
- **Tests that change (§5).** 3 patching tests retarget to the caller's module (`read_git_tags` into
  both `payloads` and `attribution`); 2 source-reading tests; 4 fake-engine copies go through a new
  `helpers.copy_engine`. Each lands in the extraction commit that breaks it.
- **qa red test (§6).** `test_cairnlib_layout.py`: one ownership method per module (anchor names
  pinned, nothing else), partition, layering, facade-only, no-unresolved-globals, engine dir mode.
- **Gates (§7).** Per commit: layout test + test files naming a name moved in step k or k−1 + two
  smoke commands. Timing: 1 warm-up + 5 runs, median, before at `55fd4b2` by qa in the red commit,
  after by architect at verdict; threshold × (1 + max(0.05, spread)).
- **Review checklist (§8).** One named mutation per check; matrix = all 237 names resolve from owner
  and facade to the same object.
