# POLY-26 gate-1 ruling — backfill scans worktree-sibling transcript dirs; one shared resolver

Architect, 2026-09-25. Scope: `scripts/cairn/backfill_tokens.py`, `scripts/cairn/otel_receiver.py` (resolver removal only),
their tests, and one sentence of `process/TRACKER.md`. Parent ruling: `telemetry-attribution.md` §c (POLY-10).
Nothing here touches `.claude/settings.json`, the hooks, or `process/cairn/metrics/`.

## Measurements

| # | What | Command / predicate | Result |
|---|---|---|---|
| M1 | Transcript files, main slug dir | `Path(~/.claude/projects/<slug>).rglob("*.jsonl")` | 8 (6 top-level, 2 nested) |
| M2 | Worktree-sibling dirs + files | dirs matching `<slug>--claude-worktrees-*`; `rglob("*.jsonl")` per dir | 25 dirs, 30 files, all top-level, 0 empty dirs |
| M3 | Near-neighbour dirs | dirs matching `<slug>*` that are neither the main dir nor anchored siblings | 0 on this machine (the anchor is tested by fixture, not by luck) |
| M4 | File-name collisions main ↔ sibling | same `<id>.jsonl` name in both | 0 |
| M5 | `gitBranch` on sibling `assistant` records | counter over all 30 sibling files | 4204 records; **307 (7.3 %)** on a `feature/poly-N-*` branch, **3897 on `worktree-<name>`** (+4 `HEAD`) |
| M6 | Who reads `token-usage.jsonl` | read `cairn.build_tokens_payload`, `cairn.token_actuals` | `/api/tokens` sums **every** source per (issue, role); `token_actuals` counts **only `source == "otel"`** |
| M7 | Live data file (main checkout metrics worktree) | parse all lines | 112 lines, all `otel`, window 2026-09-24..25; 26 `subagent-unattributed` (POLY-3 ×7, POLY-10 ×9, POLY-16 ×8, main ×2), all dated 2026-09-24 |
| M8 | Existing tests touching the private resolver | grep `_transcript_path_for`/`_worktree_transcript_suffix` in `tests/` | 0 references outside a docstring; POLY-10 tests 7/8 go through `resolve_role` / `_transcript_is_stale` |

## (1) Resolver: moves into `backfill_tokens.py`, receiver imports it

- Move `_WORKTREE_TRANSCRIPT_SUFFIX_CACHE`, `_worktree_transcript_suffix()` and `_transcript_path_for()` verbatim into
  `backfill_tokens.py` (after `_transcript_dir_slug`), plus one new helper both consumers share:
  `_worktree_sibling_dirs(transcripts_dir) -> List[Path]` — `sorted(d for d in transcripts_dir.parent.glob(
  glob.escape(transcripts_dir.name) + _worktree_transcript_suffix() + "-*") if d.is_dir())`, `[]` if the parent is
  not a dir. `_transcript_path_for` keeps its direct-hit-first order and iterates `_worktree_sibling_dirs`.
- `glob.escape` is new: a slug is a path with `/_.` replaced, so `[`/`*`/`?` in a repo path would today become glob syntax.
- **Receiver**: delete its three definitions; its three call sites call `backfill_tokens._transcript_path_for(...)`.
  No alias left behind — one implementation, checkable by `not hasattr(otel_receiver, "_transcript_path_for")`.
- PT-87 invariants unchanged for the receiver: exact-name `<id>.jsonl` lookup only, anchored `<slug>--claude-worktrees-`
  prefix, header window `_ROLE_SCAN_LIMIT`, path derived per lookup and never stored or logged, a miss uncached.

## (2) `scan_transcripts` walks main + siblings

- Roots = `[transcript_dir] + _worktree_sibling_dirs(transcript_dir)`; `files = sorted(set(p for r in roots for p in
  r.rglob("*.jsonl")))`. The anchor is the same helper as (1), so a `<slug>-old--claude-worktrees-x` or `<slug>-old/`
  neighbour is never a root. `seen_keys` stays run-global, so a record duplicated across roots counts once.
- Signature and return tuple unchanged. No opt-out flag: a test's `tmp/<name>/` has no `<name>--claude-worktrees-*` siblings.
- `main` output: line 1 keeps its exact form, `scanned {len(files)} transcript file(s) under {transcript_dir}` (N = all
  roots). New line 2, always printed: `  of which {k} under {m} worktree sibling dir(s) {transcript_dir.name}--claude-worktrees-*`
  (k = files not under `transcript_dir`, m = `len(_worktree_sibling_dirs(...))`). Counts + the pattern only; no sibling dir
  name or file path is printed.
- The default dir is derived from `_repo_root()`: the backfill must be run from the **main checkout**. From a worktree the
  default resolves to that worktree's own sibling dir and the default out-file to a path with no metrics worktree. Stated
  here, not fixed here (the script is a manual one-off).

## (3) Scope: this loop ships code + a `--dry-run`, and writes nothing to `token-usage.jsonl`

- **No write this loop.** A backfill write today spans 2026-09-23..now and fully overlaps the 112 `otel` lines (M7).
  `/api/tokens` sums both sources (M6), so every (issue, role) with otel data would double-count on the dashboard.
  `token_actuals` ignores backfill lines (M6), so `cairn close` would gain nothing from a write anyway.
- **"Re-run the backfill on this repo" = `backfill_tokens.py --dry-run` from the main checkout, after the build is green.**
  Acceptance: line 2 reports m = the live sibling-dir count and k > 0, and the top-buckets list shows roster roles
  (architect / qa-engineer / implementation-lead / …), not `subagent-unattributed`, for sibling files. The lead records the
  two summary lines + the role set on POLY-26 (counts only).
- **Pre-POLY-10 `otel` lines are left as-is**, no repair and no follow-up. TRACKER's standing rule (§ "General rule,
  established twice now") applies: otel attribution is prospective-only; `session.id` was discarded at flush, so the 26 lines
  cannot be re-derived, and replacing them with backfill lines is exactly the double-count above.
- **Issue attribution is out of scope, and it is the bigger gap (M5).** 93 % of teammate records carry `worktree-<name>`, which
  `_bucket_for_branch` maps to `main` → `milestone:<id>`. After this loop, backfilled teammate lines carry the right **role** but
  mostly the milestone bucket, not the issue. Follow-up filed (F1). A second follow-up (F2) guards the write path so a future
  run cannot double-count against existing otel lines. Both are prerequisites for any real backfill *write* on this repo.
- `process/TRACKER.md` line "`backfill_tokens.py`'s own (separate) transcript scan does not yet share this fix — follow-up filed:
  POLY-26." is rewritten by implementation-lead to say it does, and to name F1 as the remaining issue-attribution gap.

## (4) Tests qa writes red first

New class `BackfillWorktreeSiblingScanTests` in `test_backfill_tokens.py`. Fixture under `tmp/projects/`: main dir `<slug>/`
(lead transcript, no header fields, `feature/POLY-7-x`); sibling `<slug>--claude-worktrees-arch/<id>.jsonl` (`agent-setting`
`architect`, `feature/POLY-7-x`, so issue attribution is not in play) and its nested `<sibling>/<id>/subagents/agent-1.jsonl`
(same header, a distinct `requestId`); decoys `<slug>-old--claude-worktrees-x/<id2>.jsonl` and
`<slug>-old/<id3>.jsonl` (both `qa-engineer`). Scrubbed header + usage records only, no message content.

1. `test_sibling_transcript_is_scanned_and_attributed` — buckets hold `(POLY-7, architect, m)` and `(POLY-7, team-lead, m)`.
2. `test_near_neighbour_dirs_are_never_scanned` — no `qa-engineer` bucket; neither decoy path in `files`.
3. `test_nested_subagent_transcript_under_a_sibling_is_scanned` — `<sibling>/<session>/subagents/agent-1.jsonl` is in `files`.
4. `test_record_duplicated_across_roots_counts_once` — same `requestId` in main and sibling → `stats["duplicates"] == 1`.
5. `test_cli_reports_sibling_counts` — `main([... "--dry-run"])` stdout has `scanned 3 transcript file(s) under <main>` and
   `  of which 2 under 1 worktree sibling dir(s) <slug>--claude-worktrees-*` (the decoys add nothing).
6. `test_resolver_lives_in_backfill_only` — `backfill_tokens._transcript_path_for`: direct hit, sibling hit, decoy → `None`;
   `not hasattr(otel_receiver, "_transcript_path_for")`.
7. `test_glob_metacharacters_in_the_slug_are_literal` — main dir `p[1]` with sibling `p[1]--claude-worktrees-x` is found.

**Must keep passing unchanged:** every test in `test_backfill_tokens.py` (43) and `test_otel_receiver_watchdog_attribution.py`
(incl. `RoleResolvesFromWorktreeSiblingTranscriptTests`, `TranscriptIsStaleFindsWorktreeSiblingTranscriptTests`), and
`test_otel_receiver.py`, `test_otel_receiver_hardening.py`, `test_otel_receiver_self_stop.py` (they import `backfill_tokens`).

## Guard thresholds for the verdict

Receiver behaviour is byte-identical (same lookup order, same anchor); no test outside the new class changes; no path in stdout
beyond `transcript_dir`; `token-usage.jsonl` untouched by this loop.
