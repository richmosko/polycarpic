# POLY-57 gate-1 ruling — overflow (reference list, tests, cairn.py boundary sketch)

Architect, 2026-09-25, base `f686787`. The operative ruling is the POLY-57 issue comment; this file
holds what does not fit its budget. All grep results below are `git grep` at `f686787`.

## 1. Moves

| From `scripts/cairn/design/` | To | Change |
|---|---|---|
| `estimation.md` | `scripts/cairn/docs/estimation.md` | two corrections (§3) + the ruling path on its L462 |
| `test-boundary-ci.md` | `process/reviews/POLY-6/ruling.md` | none (blob `999baf9`) |
| `telemetry-attribution.md` | `process/reviews/POLY-10/ruling.md` | none (blob `5b7e689`) |
| `backfill-sibling-scan.md` | `process/reviews/POLY-26/ruling.md` | none (blob `b4e290c`) |
| `estimation-engine-fixes.md` | `process/reviews/POLY-48/ruling.md` | none (blob `08152c6`) |
| `sub-issue-letter-ids.md` | `process/reviews/POLY-51/ruling.md` | none (blob `62fb1aa`) |
| `variants.json`, `gen_variants.py`, `NOTICE.md`, `bootstrap.snippet.html` | `scripts/cairn/board/theme/` | `gen_variants.py` paths + header text only |
| — | `scripts/cairn/docs/README.md` | new, text in the issue comment |

Use `git mv`. Ruling files are byte-identical after the move; their internal cross-references
(e.g. POLY-26's "Parent ruling: `telemetry-attribution.md`") stay stale on purpose: audit records are frozen.

**Theme location.** `board/theme/`, not `board/` flat: `board/vendor/NOTICE.md` already exists, and a
subdirectory keeps the generator out of the board's own asset list. Trade-off: `_send_static` serves
any file under `BOARD_DIR`, so `board/theme/gen_variants.py` becomes fetchable from the local board.
Accepted: localhost only, repo contents are public in the checkout anyway.

`gen_variants.py`: `cairn_dir = SCRIPT_DIR.parents[1]` (theme → board → cairn), `repo_root =
cairn_dir.parents[1]`; the three emitted CSS headers name `scripts/cairn/board/theme/…`. Regenerate
with no arguments; commit the three `variants.css` in the same commit as the generator.

**Dashboard dist.** `dashboard/index.html` comment L14–16 is copied verbatim into `dist/index.html`
L14–16. No `node_modules` in the main checkout (measured: `ls` fails), so mirror the same three-line
edit into `dist/index.html` by hand in the same commit as the source edit, which keeps
`check_dist_freshness.py` (ancestry) fresh. That a rebuild yields no other dist diff is `(unmeasured)`:
Vite is expected to strip the CSS comments in `src/variants.css` / `src/app.css`.

## 2. References that must follow

**Functional (tests go red until they resolve).**
- `board/theme/gen_variants.py` L48–49, L512–513, header strings L289–338.
- `scripts/cairn/tests/test_theme_variants_generator.py` L51–54 (`DESIGN_DIR`);
  `test_theme_bootstrap_and_dropdown.py` L76.
- Generated: `scripts/cairn/board/variants.css`, `scripts/cairn/dashboard/src/variants.css`, `docs/DESIGN/variants.css`.

**Living docs.** `process/TRACKER.md` L102 (POLY-10 ruling path), L244 (`estimation.md`);
`process/WORKFLOW.md` L647 (link text and target); `scripts/cairn/tests/INTERFACE.md` L115;
`scripts/cairn/docs/estimation.md` L462; `scripts/cairn/board/theme/NOTICE.md` (2 self-refs);
`docs/DESIGN/design-system-spec.md` L423, L581.

**Code / config comments.** `.github/workflows/ci.yml` L3; `scripts/cairn/run_tests.py` L95;
`scripts/cairn/backfill_tokens.py` L125; `scripts/cairn/cairn.py` L299, L5410, L6788, L6982, L7148, L7296
(bare `estimation-engine-fixes.md` → `process/reviews/POLY-48/ruling.md`); `scripts/cairn/board/board.html`
L12–14, L74; `board.css` L1141; `board.js` L534, L538; `board/tokens.css` L53; `docs/DESIGN/tokens.css` L60;
`scripts/cairn/dashboard/index.html` L14–16 (+ `dist/index.html` L14–16); `dashboard/src/app.css` L7, L50;
`dashboard/src/lib/theme-settings.svelte.ts` L28.

**Test docstrings (qa).** `test_backfill_tokens.py` L1081; `test_estimation.py` L3, L33, L591, L782, L1383,
L1416, L1452; `test_guard_push.py` L348; `test_migrate_retired.py` L2;
`test_otel_receiver_watchdog_attribution.py` L5; `test_run_tests.py` L759; `test_server.py` L415;
`test_sub_issue_id_lint.py` L3; `test_sub_issue_ids.py` L3; `tests/workflow/test_cairn_test_boundary.py` L2, L185, L264.

**Issue files (builder).** POLY-3, 6, 10, 11, 14, 16, 17, 20, 21, 24, 25, 26, 28, 32, 34, 35, 38, 41, 44,
45, 46, 48, 48a, 48d, 51, 52, 55, 57. Path text inside old comments is rewritten; no comment header is
added, so `cairn guard-commit` (keyed on added `### @author` headers) does not trip. Rewrite bare
filenames too (`telemetry-attribution.md` §c → `process/reviews/POLY-10/ruling.md` §c).

Predicate for "done": `git grep -n -e 'cairn/design' -e 'test-boundary-ci' -e 'telemetry-attribution'
-e 'backfill-sibling-scan' -e 'sub-issue-letter-ids' -e 'estimation-engine-fixes' -- ':!process/reviews'
':!process/cairn/issues/POLY-57*'` returns nothing. Tests build these needles at runtime (no literal), so
they do not match themselves.

## 3. Stale statements (corrected in place, one sentence each)

| Ruling | Stale sentence | Replacement |
|---|---|---|
| POLY-6 | none | — |
| POLY-10 | none (H1/H3 corrections already landed, TRACKER L86/L88) | — |
| POLY-26 | none ("does not yet share this fix" already removed) | — |
| POLY-51 | none (TRACKER L465 landed with POLY-54) | — |
| POLY-48 §1(b) + Addendum 1 | `estimation.md` §2 Tokens formula line `from_ts < generated <= close_ts` (the token ceiling is not `close_ts` under `--at`) | `from_ts < generated <= to_ts   (to_ts = close_ts; with --at, the first otel flush within 1800 s after it)` |
| POLY-48 §1(c) | `TRACKER.md` L419 "An issue's `paths:` list declares the repo-relative globs its assignee's commits may touch;" | "An issue's `paths:`, unioned with the `paths:` of every other issue sharing its `parent` and `assignee`, declares the repo-relative globs its assignee's commits may touch;" (rest of the sentence unchanged) |

POLY-48 §1(a) and §1(d) added behaviour that no living sentence contradicts; nothing is added for them.

## 4. Tests qa writes red first

One new cairn-side file, `scripts/cairn/tests/test_docs_layout.py` (spins off with cairn):
`design/` absent; `docs/` holds exactly `README.md` + `estimation.md`; README ≤ 10 lines; the four theme
files exist under `board/theme/`; no file under `scripts/cairn/` (`dist/` included) contains `cairn/design`. Mutation: restore any moved file → red.

One repo-side check in `tests/workflow/` (the POLY-6 boundary: repo layout is workflow): each
`process/reviews/<ID>/ruling.md` exists with the blob sha in §1 (`git hash-object`); the §2 predicate
returns nothing. Mutation: edit one byte of a ruling → red.

Retarget `test_theme_variants_generator.py` / `test_theme_bootstrap_and_dropdown.py` to `board/theme/`
(they go red until the move). Update test docstrings in §2 in the same commit. No other test changes.

## 5. Guard thresholds for the verdict

- Full cairn suite and `tests/workflow` green; `cairn check` clean; `check_dist_freshness.py` fresh.
- `python3 scripts/cairn/board/theme/gen_variants.py` leaves `git status` clean after the commit.
- `git diff f686787 -- process/TRACKER.md scripts/cairn/docs/estimation.md` (rename-aware) shows only the
  §2 path edits and the two §3 sentences. `WORKFLOW.md` and `architect.md` gain exactly one line each
  beyond §2 path edits.

## 6. `cairn.py` boundary sketch (filed as POLY-58; design only)

Measured: 7,400 lines, 167 top-level defs/classes; 54 test files `import cairn`; 3 of them patch or
assign `cairn.<attr>`; `backfill_tokens.py`, `otel_receiver.py`, `loop_stats.py` import `cairn`.

Seam: a package `scripts/cairn/cairnlib/`; `cairn.py` stays the CLI entry and a re-export facade, so
`import cairn` keeps working for the 51 non-patching tests and the three sibling scripts. The 3 patching
tests retarget to the owning module (a patch on the facade does not reach module internals).

| Order | Module | Lines now | Responsibility | Tests that retarget |
|---|---|---|---|---|
| 1 | `errors.py`, `constants.py` | 57–320 | exceptions, regexes, vocabularies | none |
| 2 | `yamlsub.py` | 321–502 | strict-subset YAML parser | `test_yaml_parser` |
| 3 | `records.py` | 503–807 | fences, comment split, byte-preserving write-back | `test_frontmatter_rewrite`, `test_issue_parsing`, `test_record_mutation` |
| 4 | `config.py` | 808–1072 | `config.yml` load and defaults | `test_board_columns_config`, `test_load_config_raises`, `test_id_shape_prefix` |
| 5 | `store.py` | 1073–1411 | directory scan, record lookup, id allocation | `test_id_allocation`, `test_sub_issue_ids`, `test_id_sort`, `test_git_mv_or_rename` |
| 6 | `lint.py` | 1412–2011 | `cairn check` | `test_check_lint`, `test_sub_issue_id_lint`, `test_ga_milestone_lint`, `test_lint_*`, `test_paths_field` |
| 7 | `snapshot.py` | 2012–2281 | snapshot + board API payloads | `test_snapshot`, `test_show_archived` |
| 8 | `readers/` (`attribution`, `flow`, `roster`, `tokens`) | 2282–3816 | dashboard readers | `test_flow_*`, `test_dashboard_roster*`, `test_tokens_endpoint`, `test_milestone_overhead` |
| 9 | `estimation.py` | 3817–4384 + 6910–end | actuals readers, `close`, `estimate` | `test_estimation`, `test_pt43_never_zero_zero` |
| 10 | `multiroot.py` | 4385–4681 | read-only aggregation | `test_multi_root` |
| 11 | `watch.py` | 4682–4913 | SSE watcher, engine staleness | `test_watcher`, `test_engine_staleness` |
| 12 | `server.py` | 4914–5619 | HTTP lens | `test_server`, `test_root_redirect`, `test_serve_in_thread`, `test_concurrent_board_load` |
| 13 | `archive.py`, `guards.py`, `cli.py` | 5620–6909 | archiving; budgets, guard-push, guard-commit; argparse | `test_cli`, `test_archive_records`, `test_set_records`, `test_guard_push`, `test_comment_guard`, `test_check_budgets`, `test_gate_head` |

Order is leaves-first: each step imports only earlier steps, so every extraction is one commit with
the suite green. Test filenames do not move. The table's test mapping is `(unmeasured)` beyond the
name match; the POLY-58 ruling re-measures it.
