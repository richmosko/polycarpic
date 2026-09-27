# POLY-58 gate-1 ruling: split `cairn.py` into `cairnlib/`

Architect, 2026-09-26, base `55fd4b2`. Supersedes the POLY-57 §6 sketch. All line numbers are
`scripts/cairn/cairn.py` at `55fd4b2`. Measurement script: `process/reviews/POLY-58/graph.py`
(AST: maps each top-level statement to its ruled module by line range, reports cross-module
name loads); its `owner` output is committed as `owners.txt` (237 names → module).

## 1. Measurements

| # | Command | Result |
|---|---|---|
| M1 | `wc -l scripts/cairn/cairn.py` | 7,998 lines (not 7,711) |
| M2 | `graph.py cairn.py owner \| wc -l` | 237 top-level bound names (defs, classes, assignments) |
| M3 | `graph.py` with the §6 sketch ranges | 11 back-edge pairs: lint→snapshot, lint→guards, lint→estimate, attribution→roster, attribution→payloads, flow→roster, payloads→cli, server→cli, cli→guards, archive→guards, archive→estimate. The sketch's order is not acyclic. |
| M4 | `graph.py cairn.py edges` with §2 | `back-edges: 0` |
| M5 | lead's grep (`patch("cairn.` / `patch.object(cairn` / `cairn.X =`) over `tests/` | 3 files, 4 lines: `test_dashboard.py:422`, `test_server.py:431,436`, `test_tokens_endpoint.py:705`. A broader grep (`setattr(cairn`, `patch('cairn.`, `monkeypatch`) adds no others. |
| M6 | `grep -n "CAIRN_PY.read_text\|getsource(cairn"` | `test_archived_milestone_paths.py:143,162` (regex over `cairn.py` text for `def check_repo(`); `test_id_allocation.py:101` (counts `O_CREAT \| O_EXCL` in `inspect.getsource(cairn)`) |
| M7 | `grep -n "ENGINE_FILES\|with_engine_copy"` | 4 tests copy the engine into a fake root and run it: `test_otel_receiver_hardening.py:103`, `_self_stop.py:110`, `_watchdog_attribution.py:78`, `test_milestone_overhead.py:300` |
| M8 | `grep -n "__file__" cairn.py` | 5 anchors: L258 `BOARD_DIR`, L264 `DASHBOARD_DIR`, L3651 `PRICES_PATH`, L5126 `make_server(source_path=Path(__file__))`, L7329 `receiver_script` |
| M9 | `grep -n "^\s*global " cairn.py` | none: no module state is rebound, so a facade re-export never goes stale |
| M10 | `git grep -l "import cairn"` outside tests | `backfill_tokens.py`, `otel_receiver.py`, `loop_stats.py`; the 9 `cairn.<attr>` names they use are all in `owners.txt` (no stdlib attrs). 56 test files import `cairn`. |
| M11 | `grep -n "^    import" cairn.py` | 3 lazy sibling imports: `backfill_tokens` L7497, `otel_receiver` L7677, `loop_stats` L7948 |
| M12 | `compile()` of `cairn.py`, 7 runs, median | 44.2 ms. A script run as `python3 cairn.py` is never pyc-cached, so every CLI subprocess in the suite pays this; after the split only the small facade does (expected speed-up `(unmeasured)`) |
| M13 | pyflakes-lite (§6 check e) run on `cairn.py` | unresolved loads: `__file__` only, so the check has no false positives on the current source |

## 2. Modules and order (leaves first)

Package `scripts/cairn/cairnlib/`, flat (not the sketch's `readers/` subpackage: nesting buys nothing
at this size). `__init__.py` holds a docstring only; it re-exports nothing. Step = one commit.

| Step | Module | From (L @ 55fd4b2) | Anchor name |
|---|---|---|---|
| 0 | — (engine seam, §4; no move) | L4817–4855, L5047–5082 | — |
| 1 | `constants` | 57–270, + `_STAGE_ORDER` L7281 | `DEFAULT_PORT` |
| 2 | `errors` | 271–335 | `CairnError` |
| 3 | `yamlsub` | 336–527 | `parse_yaml_subset` |
| 4 | `records` | 528–913 | `parse_frontmatter` |
| 5 | `config` | 914–1178, + `resolve_data_dir` L5827–5846 | `load_config` |
| 6 | `store` | 1179–1531, + `_ID_SORT_RE`/`_id_sort_key` L2136–2162, `_repo_root_for` L3570–3594, `_RECORD_FIELD_ORDER`/`_record_schema_for_path` L5997–6017 | `allocate_and_create_issue` |
| 7 | `guards` | 6790–7273 | `check_budgets` |
| 8 | `lint` | 1532–2131, + `_rotate_cycle_to_canonical`/`_detect_blocked_by_cycles` L2163–2229 | `check_repo` |
| 9 | `snapshot` | 2230–2401 | `build_snapshot_markdown` |
| 10 | `roster` | 3539–3635 minus `_repo_root_for` | `_read_agent_identities` |
| 11 | `attribution` | 2402–2894 | `milestone_windows` |
| 12 | `flow` | 2967–3538 | `build_flow_payload` |
| 13 | `tokens` | 3636–4004 | `build_tokens_payload` |
| 14 | `actuals` | 4005–4181 | `token_actuals` |
| 15 | `payloads` | 4182–4588, + `build_dashboard_payload` L2895–2966 | `build_board_payload` |
| 16 | `multiroot` | 4589–4885 | `resolve_roots` |
| 17 | `watch` | 4886–5116 | `DataDirWatcher` |
| 18 | `server` | 5117–5822 | `make_server` |
| 19 | `archive` | 6343–6501, + `_git_mv_or_rename` L6297–6342, `cmd_archive` L6502–6578 | `archive_milestone` |
| 20 | `estimate` | 7274–7986 minus L7281 | `cmd_close` |
| 21 | `cli` | 5823–6296 and 6579–6789 (minus the relocations above), + `main` L7987 | `build_arg_parser` |

Domain modules keep their own `cmd_*` handlers (`guards`: gate/guard-commit/guard-push; `archive`;
`estimate`: close/estimate/loop-stats); `cli` holds the generic commands, `build_arg_parser`, `main`.
`owners.txt` is the derived per-name list; where it and this table disagree, the table's ranges win.

## 3. Facade contract

- **Moves are verbatim.** Function bodies are byte-identical to `55fd4b2` except the §4 seam and the
  `__file__` anchors below. Intra-package imports are explicit `from cairnlib.<mod> import <names>` at
  module top, only from earlier steps; no `import *` inside `cairnlib`. Each module imports the stdlib
  modules it uses. The three lazy sibling imports (M11) stay function-local.
- **Every module defines `__all__`** listing every top-level name it owns, private names included
  (tests use 10 private names through `cairn.`; `import *` honours `__all__` over the underscore rule).
- **`cairn.py` after step 21** contains only: shebang, the module docstring (plus one paragraph naming
  `cairnlib/`), `import sys`, one `from cairnlib.<mod> import *` line per module in step order,
  `__all__` as the concatenation of the modules' `__all__`, and `if __name__ == "__main__": sys.exit(main())`.
  No `def`, no `class`, no other assignment. Mid-branch, `cairn.py` keeps the not-yet-moved code and
  gains one `import *` line per extracted module, placed above the remaining code.
- **Callers are untouched:** `scripts/cairn/cairn` (the shim), `backfill_tokens.py`, `otel_receiver.py`,
  `loop_stats.py`, `run_tests.py` get no edit. They work because `python3 <dir>/cairn.py` and every
  sibling put `scripts/cairn/` on `sys.path[0]`, and the tests insert `CAIRN_DIR`.
- **`__file__` anchors:** `constants` defines `CAIRN_DIR = Path(__file__).resolve().parent.parent` and
  `CAIRNLIB_DIR = CAIRN_DIR / "cairnlib"`; `BOARD_DIR`, `DASHBOARD_DIR`, `PRICES_PATH`, and the
  receiver script path derive from `CAIRN_DIR`. No other module reads `__file__`.
- `scripts/cairn/tests/INTERFACE.md` gains one paragraph (step 21): names live in `cairnlib.<mod>`,
  `cairn` re-exports them all, and patch targets follow §5.

## 4. Engine-staleness seam (step 0)

Pre-split, `make_server` fingerprints `cairn.py`, which holds all server code. Post-split that file
holds none, so the PT-49 staleness banner would never fire. Step 0, before any move:
`engine_fingerprint`, `engine_is_stale`, and `compute_multi_etag`'s `source_path` stat accept a file
(unchanged behaviour) or a directory: `mtime_ns` = max and `size` = sum over the directory's `*.py`
files, `sha` = sha256 over the sorted `(name, NUL, bytes)` of the same files, first 12 hex. From
step 1, `make_server`'s default `source_path` is `CAIRNLIB_DIR`. `test_engine_staleness.py` keeps
passing a file; qa's new test passes a directory.

## 5. Tests that must change (content only; no file renamed)

Patching takes effect where the **caller looks the name up**. With `from`-imports that is the
caller's module, not the defining one. For the three patching tests:

| Test | Patched name | Callers (module) | New target |
|---|---|---|---|
| `test_dashboard.py:422` | `read_git_tags` | `build_*_payload` (payloads), `read_git_state` (attribution) | one `wraps=` spy patched into **both** `cairnlib.payloads` and `cairnlib.attribution` |
| `test_server.py:431,436` | `allocate_and_create_issue` | `make_server` (server) | `cairnlib.server` |
| `test_tokens_endpoint.py:705` | `_compute_flow_payload` | `build_flow_payload` (flow) | `cairnlib.flow` |

Also retarget: M6 (`test_archived_milestone_paths.py` reads `cairnlib/lint.py`;
`test_id_allocation.py` inspects `cairnlib.store`, still exactly one site); M7 (a new
`helpers.copy_engine(dst, names)` copies the named files plus `cairnlib/`, `__pycache__` excluded;
the 4 tests call it). Each retarget lands in the extraction commit that breaks it.

## 6. qa's red test: `scripts/cairn/tests/test_cairnlib_layout.py`

The step order and anchor names in §2 are the only layout it pins.
- (a) **One method per module**, `test_<step>_<module>_owns_its_names`: `cairnlib.<module>` imports,
  has `__all__`, contains its §2 anchor, and for every name in its `__all__`:
  `getattr(cairn, n) is getattr(mod, n)`, and for functions/classes `obj.__module__ == "cairnlib.<module>"`.
  Red at `55fd4b2` (no package); each goes green in its step's commit.
- (b) **Partition:** no name appears in two modules' `__all__`.
- (c) **Layering:** every `cairnlib` import inside `cairnlib/<m>.py` names an earlier step.
- (d) **Facade-only** (red until step 21): `cairn.py`'s AST has no `FunctionDef`/`ClassDef` and no
  assignment other than `__all__`; `set(cairn.__all__)` equals the union of the modules' `__all__`.
- (e) **No unresolved globals:** per module, every `Name` load is bound somewhere in the module
  (assignment, arg, def, import, except/with target), a builtin, or a module dunder (M13).
- (f) **Engine dir mode:** a throwaway directory of two `.py` files; editing one's bytes makes
  `engine_is_stale` true; touching mtime with identical bytes does not. Red until step 0.
(b), (c), (e) iterate over modules that exist, so they are vacuously green at the base.

## 7. Gates

- **Per commit (builder).** Before each step-k commit: `python3 scripts/cairn/run_tests.py -p <f> …`
  where the files are `test_cairnlib_layout.py` plus every test file that names (`grep -lw`) any
  name moved in step k or step k−1; `python3 scripts/cairn/cairn.py check` exits 0;
  `cd scripts/cairn && python3 -c "import cairn, backfill_tokens, otel_receiver, loop_stats"` exits 0.
  Green except layout methods (a)/(d) of later steps. Full suite only at build-green.
- **Timing.** Command `python3 scripts/cairn/run_tests.py` (default workers, as CI runs it), same
  machine, one warm-up run discarded, then 5 runs; statistic = median of `/usr/bin/time -p` real.
  qa records **before** at `55fd4b2` in `process/reviews/POLY-58/timing.md` in the red commit, with
  the spread `(max−min)/median`. The architect measures **after** at verdict the same way.
  Threshold: after-median ≤ before-median × (1 + max(0.05, spread)). The 5 % floor is `(unmeasured)`.

## 8. Review checklist (verdict), one named mutation per test

| Check | Mutation that must turn it red |
|---|---|
| 6(a) per module | define one owned name in `cairn.py` instead of importing it |
| 6(b) partition | copy one `def` into a second module's `__all__` |
| 6(c) layering | add `from cairnlib.cli import main` to `constants.py` |
| 6(d) facade-only | add `def _x(): pass` to `cairn.py` |
| 6(e) unresolved | delete one `from cairnlib.store import …` name used in `lint.py` |
| 6(f) dir mode | fall back to `Path(source_path).stat()` for directories |
| §5 patch retargets (3) | revert each target to `cairn` (spy count 0 / 503 path not hit) |
| §5 `copy_engine` | drop the `cairnlib/` copy (fake-engine subprocess `ImportError`) |
| §5 source-coupled (2) | point them back at `cairn.py` |

Matrix: all 237 names in `owners.txt` resolve from their owning module and from `cairn` to the same
object (verdict runs this once against `owners.txt`; the test does not pin the name list).
Plus: `git diff 55fd4b2 -- scripts/cairn/{backfill_tokens,otel_receiver,loop_stats,run_tests}.py scripts/cairn/cairn` is empty.
