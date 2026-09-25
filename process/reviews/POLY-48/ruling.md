# POLY-48 — estimation-engine fixes (gate-1 ruling)

Architect, 2026-09-25. Base: `8248461`. Sub-issues: POLY-48a (plan, architect),
POLY-48b (execute: red tests + POLY-40 + POLY-8, qa-engineer), POLY-48c
(execute: `cairn.py` + TRACKER.md, implementation-lead), POLY-48d (review,
architect).

## 0. Measurements (read at `8248461`)

- `token_actuals` (cairn.py L3779): one unpriced line → `cost_usd: None`,
  `unpriced_models` named; `cmd_close` L7101 already prints the model names.
  TRACKER.md L126 already states the null posture for `/api/tokens`; the
  calibration median (L7314) already drops a null cost.
- `cmd_close` (L6986): `close_ts = at_ts` when `--at`; forced flush runs
  before the ceiling is read (L7081) unless `--no-flush`/`--dry-run`.
  `window.to` = `close_ts`; `_sibling_floor` (L6890) reads `window.to`.
- POLY-47 evidence (issue file): ceiling commit 19:16:20Z, carrying flush
  19:17:15Z → **55 s**; receiver `DEFAULT_FLUSH_INTERVAL_SECONDS = 1800`
  (otel_receiver.py L192).
- `cmd_guard_push` (L6732) reads frontmatter + `git log base..HEAD`; the
  calibration file lives in the `metrics` worktree mount, which **a teammate
  worktree does not have** (`process/cairn/metrics/` absent here).
- `_create_issue` (L5378): `BadParentError` → `bad_parent`; every other
  `CairnError` → `legacy_archive`. The a–z exhaustion raises (L1258, L1295)
  plain `CairnError`, so it is mislabelled `legacy_archive`.

## 1. Rulings

**(a) POLY-15 AC2 — keep null.** An unpriced model yields
`actual.cost_usd: null` and no `ratio`, plus the existing named warning.
A partial total, once written to frontmatter and `calibration.jsonl`, is a
number indistinguishable from a full one; the stderr warning does not persist
with it, and a partial cost would enter the estimate median. Null is already
excluded from medians, and the repair is cheap (add the row, re-close
`--at`). TRACKER.md telemetry section: extend L126's sentence to `cairn close`
/ `actual.cost_usd` / calibration. Tests pin: null + model named in
`token_actuals.unpriced_models` and in `close`'s stderr.

**(b) POLY-47 — the ceiling admits the first flush after the commit.** With
`--at <sha>`: `at_ts` = commit author time (unchanged); the **token** ceiling
`to_ts` = the smallest `generated` > `at_ts` over **all** lines in
`token-usage.jsonl` (any issue/role — a flush is a global event), provided
`to_ts - at_ts <= 1800 s` (the receiver's default interval; import the
constant). Otherwise `to_ts = at_ts` and `close` warns
`no flush within 1800 s after --at <sha>; tokens after <last flush> unattributed`.
- `window.to` records `to_ts`; `window.at` still the sha. The next
  same-assignee stage floors at `to_ts`, so the admitted flush is never
  counted twice.
- Commits and wall-clock stay bounded by `at_ts` / `ref = sha` (unchanged).
- Tip case needs no special rule: the forced flush runs first, so it *is*
  the first flush after the commit. Rejected: force-flush-at-tip only (does
  not repair late closes, the reason `--at` exists); flush-then-commit
  procedure (unenforceable, leaves POLY-41-shaped history wrong).
- Stated limit (estimation.md §2 Tokens, new bullet): the admitted flush may
  carry up to one interval of post-gate same-role tokens — the mirror of
  the existing "first line in W" limit.

**(c) guard-push same-assignee scope — union sibling paths.** Allowed globs =
the issue's own `paths:` ∪ `paths:` of every other issue with the same
non-null `parent` and the same `assignee` (any stage, any status). Rejected:
time-scoping to the sibling's close — its `window.to` lives in the metrics
mount, which guard-push cannot read from a teammate worktree. A sibling's
malformed `paths:` exits 2 naming the sibling. Top-level issues (no parent)
are unchanged.

**(d) `close` from a worktree — refuse, exit 2, write nothing.** When
`git rev-parse --git-dir` ≠ `--git-common-dir` (linked worktree), before any
flush or read: `close: <ID>: run from the main checkout (<common-dir parent>)
-- a worktree has no metrics mount; nothing written`. Applies to `--dry-run`
too. No issue-file write, no calibration append.

**Confirmed as filed (one sentence each).**
- POLY-33: key the warning on `actual.gate_cycles is None`; null-token
  closed fixture must not warn.
- POLY-40: as filed — derive from `cairn.ISSUE_FIELD_ORDER`, keep one pinned
  canonical-order assertion.
- POLY-8: the test skips (node `{ skip }` with a NOTE naming the missing
  dir) when `scripts/cairn/dashboard/node_modules` is absent — same posture
  as the svelte-check step; finish-feature SKILL.md says so. No install in
  the gate (network in a gate is a new failure mode).
- `bad_parent`: exhaustion (both raise sites) raises `BadParentError`; the
  legacy guard raises a new `LegacyArchiveError(CairnError)`; `_create_issue`
  maps legacy → 400 `legacy_archive`, bad parent → 400 `bad_parent`, any
  other `CairnError` → 409 `allocation_failed`. HTTP test per code.
- Shared helper: one `_claim_issue_file(issues_dir, ids, fields, today)`
  taking an iterator of candidate ids; numeric and letter paths both call it.

### Addendum 1 (review of `d1f2e08`) — §1(b) counts otel flushes only

§1(b)'s "over **all** lines" was wrong: a `transcript-backfill` line's
`generated` is the backfill run time, not a flush. Measured
(`_token_ceiling` @ d1f2e08, backfill line at +10 s, otel flush at +55 s):
the ceiling came back as +10 s, which drops the real flush, and no warning
was printed. Corrected rule: the candidate set is lines with
`source == "otel"` (any issue or role). Test: that fixture must yield the
+55 s flush. The known limit is now stated in `estimation.md` §2 Tokens.

## 2. Tests (qa, red first — POLY-48b)

1. Unpriced: one priced + one unpriced line → `cost_usd None`, model named
   (token_actuals and close stderr).
2. POLY-47: flush line 1 s after the `--at` commit → included, `window.to`
   = that stamp; next-stage sibling floors there and excludes it; a line
   1801 s after → excluded + warning.
3. guard-push: two sibling sub-issues, one assignee, disjoint paths; commits
   to both → pass for either id; a third file → exit 1; different-assignee
   sibling's paths are not admitted.
4. close in a `git worktree add` checkout → exit 2, file byte-identical,
   no calibration line.
5. POLY-33 fixture; HTTP codes (exhaustion → `bad_parent`, legacy →
   `legacy_archive`); POLY-40 derivation; POLY-8 skip.

Must pass unchanged: `test_estimation.py`, `test_id_allocation.py`,
`test_guard_push.py` (existing cases), `test_check_lint.py`.
Guard thresholds (unmeasured): ≤ 120 changed non-comment lines in
`cairn.py`; net negative lines in `allocate_and_create_issue` +
`_allocate_sub_issue`.
