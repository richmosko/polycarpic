# Effort estimation loop — design note (POLY-3)

Kickoff decision: `docs/project_kickoff.md` § 2.12. This note is the architect's
design pass (POLY-3 AC1); the implementation follows it, and a deviation is a
revision of this file, not a comment.

**Units.** Tokens (cost) and gate cycles (bloat). Wall-clock is recorded, never
estimated. Human minutes appear nowhere.

**Decomposition unit.** One sub-issue per **(agent, stage)** under a parent
feature issue (`parent: <ID>`). Usually that is one per agent; the architect
typically holds two (a `plan` sub-issue and a `review` sub-issue).

## 1. Sub-issue fields

### YAML shape: flat dotted keys, not nested maps

The parser (`parse_yaml_subset`) does accept a one-level block mapping
(`estimate:` then indented `tokens: …`). Flow mappings (`{tokens: 1}`) are a
hard `YamlError`. But the writer side has no dict support at all: `_dump_value`
would emit `str(dict)`, `cmd_set`'s `key=value` has no path syntax, and
`apply_patch` merges top-level keys only. Nested maps would mean three new
surfaces (dumper, setter path syntax, patch merge), each needing round-trip
tests. Flat keys need none of them.

*Reconciling the implementation-lead's finding that "the parser supports one
level of nesting, so these can be real nested maps":* the premise is true, but
it covers the read side only. Every close writes the file back through
`dump_frontmatter`, and that function cannot emit a dict. Nested maps are
therefore not free. If the lead prefers them anyway, the cost is: a block-map
branch in `dump_frontmatter` (top level only), a `key.sub=value` path in
`cmd_set`/`apply_patch`, and round-trip tests. The rest of this note works
unchanged under either shape.

**Decision:** logically `estimate: {tokens, gate_cycles}`; physically flat
dotted keys. `estimate.tokens` is a plain key to this parser (`_MAPPING_LINE_RE`
accepts dots) and to any real YAML parser, so no reader disagrees about it.

```yaml
stage: execute                 # plan | execute | review
estimate.tokens: 400000
estimate.gate_cycles: 1
actual.tokens: 512340          # written by `cairn close`, never by hand
actual.gate_cycles: 2
actual.wall_clock: 47          # integer minutes, from_ts -> last assignee commit
ratio: "1.28"                  # actual.tokens / estimate.tokens, 2 dp
```

**Numbers.** The parser reads only integers (`^-?\d+$`). It has no float type,
and adding one would turn `target_tag: 1.0` into a float everywhere. So:

- `estimate.*` and `actual.*` are non-negative ints.
- `ratio` is a decimal **string**. The dumper quotes it (numeric-looking), and
  readers call `float()`.
- `_coerce_cli_value` coerces `estimate.*` to `int`, so that
  `cairn set POLY-9 estimate.tokens=400000` writes `400000` and not
  `"400000"`. A non-integer value is a CLI error.

`ratio` is the token ratio only. The gate-cycle comparison is a plain integer
comparison (§5) and needs no stored ratio.

### Field order

`ISSUE_FIELD_ORDER` gains, after `paths` and before `labels`: `stage`,
`estimate.tokens`, `estimate.gate_cycles`, `actual.tokens`,
`actual.gate_cycles`, `actual.wall_clock`, `ratio`. This keeps the ownership
and effort block together, ahead of the classification fields. All the new keys
are **optional**. An absent key is omitted from the dump, as `paths` already is,
so every existing issue round-trips byte-identical.

### `cairn check` validation (errors)

- `stage` ∈ {plan, execute, review} when present.
- `stage` present requires `parent` non-null. (Top-level issues carry no stage;
  a stage belongs to a sub-issue.)
- `estimate.*` / `actual.*`: int ≥ 0 when present. `estimate.tokens: 0` is an
  error, because it would make the ratio undefined.
- `ratio`: `float()`-parseable and ≥ 0. It is present **iff** both
  `actual.tokens` and `estimate.tokens` are non-null.
- Any `actual.*` or `ratio` on a sub-issue whose status is not `done` is an
  error. Actuals are close-time output only.
- A sub-issue with `status: done` and a `stage` but no `actual.*` is a
  **warning**, not an error. It was closed by `cairn set status=done` rather
  than `cairn close`.
- `config.yml` → `estimation.bloat_ratio`: absent or `null` is fine. When
  present it must be a `float()`-parseable string/int > 1.0. Any other
  `estimation.*` key is an error (a typo guard, same posture as `board.*`).

## 2. Actuals sources

All three sources are computed over one **window** W = (from_ts, close_ts]:

- `from_ts` = max(**parent flip**, **sibling floor**).
  - The parent flip is the author time of the oldest commit in `<base>..<ref>`,
    i.e. `/start-feature`'s "feature started" commit, which is the same default
    `loop-stats` uses for `since`.
  - The sibling floor is the latest calibration `window.to` of a closed
    sub-issue with the same `parent` and the same `assignee`. It is absent when
    there is none.
  - The sub-issue file's own creation time is **not** used. Sub-issues are
    often written after the work has started (as POLY-11 was), and the
    assignee/role filters already keep other agents' commits and tokens out of
    W.
  - There is no `--since` override: a hand-set window would let a calibration
    record be fudged.
- `close_ts` is the wall time at which `cairn close` runs.
- Known limit: two same-(parent, assignee) sub-issues that are open at the
  same time split their work at the first close. The protocol opens a review
  sub-issue only after the plan closes.

### Tokens — OTel receiver, `process/cairn/metrics/token-usage.jsonl`

What is recorded today: one line per (issue, role, model) per flush, carrying
`generated` (flush time, ISO-8601 UTC seconds), date-only
`window_start`/`window_end`, and four counters.

- `issue` comes from the **main checkout's branch at flush time**
  (`_bucket_for_branch`). `cairn.issue` is used only when that branch is
  `main`.
- `role` comes from `agent.name` if present. Otherwise it comes from the
  session's transcript header (`agentSetting`/`agentName`), which is what
  happens in practice today.
- Flushes happen every 30 min, or earlier when the attributed issue changes.

**What attribution this supports.** (parent issue, agent role, flush-time
window). It does **not** support sub-issue attribution directly: while the lead
checkout sits on `feature/poly-3-*`, every teammate's tokens land on `POLY-3`
with its role. Sub-issue tokens are therefore:

```
actual.tokens(S) = Σ (input + cache_write + cache_read + output)
    over lines with source == "otel", issue == S.parent, role == S.assignee,
                    from_ts < generated <= close_ts
```

`cairn close` first signals the receiver (`otel_receiver.py --flush-now`) and
waits up to 5 s for the new `generated` stamp. That flush sets the boundary
between two same-(parent, role) sub-issues, such as the architect's plan and
review. Known limits, stated rather than papered over:

- The first line in W may carry up to one flush interval of pre-W tokens.
- If the lead checkout leaves the feature branch mid-loop, tokens go to a
  `milestone:` bucket and are lost to the sub-issue.
- A `subagent-unattributed` role matches no assignee.
- `otel_receiver.compact()` coalesces lines per (issue, role, model), which
  destroys the windows. Compaction must never cover an issue with an open
  sub-issue. It is not run automatically today; the implementer adds a guard
  or a docstring warning.
- **No evidence is null, never 0.** In both of these cases `close` warns
  (naming the case), writes `actual.tokens: null`, and writes no `ratio`:
  - the token file is missing;
  - the file exists but **no line** matches (parent, role, W).

  The calibration record also carries `"ratio": null`. A zero ratio would
  poison every reference-class median. `cairn estimate` excludes null
  token actuals from the token median, and gate-cycle medians still use
  those rows. A real 0 is only ever the sum of ≥1 matching line.

`tokens` sums all four counters, the same total the dashboard shows.
`cache_read` dominates the sum, and that is intended: context re-reads are the
bloat this loop exists to see. The calibration record keeps the per-counter
breakdown and `cost_usd` (via `prices.json`), so cost can be reweighted later
without a rerun.

### Gate cycles — per-agent commit log (POLY-1 identities)

Commits carry `author.name == <agent-name> == assignee`. The input is the
linear first-parent history `git log --first-parent --reverse <base>..<ref>`
filtered to W. The defaults are `base = main` and `ref = HEAD`, the same
defaults `loop-stats` uses.

**Definition.** One gate cycle is one maximal run of the assignee's commits in
that history, where a run is broken **only** by a commit whose author is
neither the assignee nor the assignee of a same-stage sibling (same `parent`,
same `stage`).

This yields one red→green pass for `execute`: qa's red commit and the builder's
green commit are same-stage, so they form one cycle. A reviewer's
changes-requested commit breaks the run, so the builder's fix is cycle 2. It
yields one review round for `review` (each verdict separated by the builders'
commits) and one ruling revision for `plan`. The lead's issue-file commits
(questions, gate records) also break runs, which is correct: they are round
boundaries.

Zero commits by the assignee in W gives `actual.gate_cycles: 0` **and a
warning line on stderr**, which is mandatory and pinned by a test. Zero cycles
means one of two things: the work happened outside W, or it was committed under
another identity. It is still recorded, because the gate-cycle bloat rule
cannot fire on it.

Known limit: a review round carried only by `SendMessage` is invisible. The
protocol already requires rulings in the file ("messages carry pointers, not
rulings"), so the definition and the protocol agree.

### Wall clock

`actual.wall_clock = round((last_ts − from_ts) / 60)`, in integer minutes.
`last_ts` is the author time of the assignee's last commit in W, not
`close_ts`. That way a sub-issue closed long after its work finished (POLY-11
closes only once `cairn close` exists) does not count the idle gap. It is
`null` when the assignee has no commits in W.
It is secondary: it is recorded and printed by `estimate`, and never compared
against a bound.

## 3. Calibration record

**File:** `process/cairn/metrics/calibration.jsonl`, on the orphan `metrics`
branch beside `token-usage.jsonl`. That branch uses the same nested-worktree
mount and the same `*.jsonl merge=union` attribute, and is never merged into
`main`. It is written under the metrics dir's `.lock` (the `backfill_tokens`
lock helpers). Writes are append-only, one line per `cairn close`, with keys in
this order:

```json
{"schema": 1, "closed": "2026-09-23T18:04:11Z", "id": "POLY-9", "parent": "POLY-3",
 "stage": "execute", "assignee": "backend-lead", "labels": ["cairn", "workflow"],
 "milestone": "POLY-A",
 "estimate": {"tokens": 400000, "gate_cycles": 1},
 "actual": {"tokens": 512340, "gate_cycles": 2, "wall_clock": 47,
            "input": 1200, "cache_write": 60000, "cache_read": 450000, "output": 1140,
            "cost_usd": 0.91},
 "ratio": 1.28, "bloat": true, "bloat_reasons": ["gate_cycles"],
 "window": {"from": "2026-09-23T17:17:02Z", "to": "2026-09-23T18:04:11Z"},
 "base": "main", "ref_sha": "abc1234"}
```

- JSON carries real floats. Only the YAML side has the int-only constraint.
- `bloat` is `null` when the threshold is unset *and* gate cycles are within
  estimate. That is "not evaluated", distinct from `false`.
- Re-closing the same id appends a second line. Readers take the **last line
  per id**, which is also how corrections happen: re-run `cairn close`, never
  hand-edit.

## 4. `cairn estimate <ID>` — reference-class query

The input is the target sub-issue's `stage`, `assignee`, and `labels`. Both
`stage` and `parent` are required; if either is missing the command exits 1
with a message. The query runs over the calibration records (last line per id,
excluding `<ID>` itself), in tiers:

1. **Tier A:** same `stage` and same `assignee`.
2. **Tier B:** same `stage`, different assignee, with at least one shared
   label. These are ranked by label-overlap count (desc), then `closed` (desc).

Within a tier, rows are sorted by `closed` descending, capped at `--limit`
(default 5 per tier). Output is a plain table per tier:

```
reference classes for POLY-12 (execute / backend-lead / [cairn, workflow])
tier A — same stage + assignee (3)
  id       closed      est.tok  act.tok  ratio  est.gc  act.gc  wall  bloat
  POLY-9   2026-09-23  400000   512340   1.28   1       2       47m   yes
  ...
  median actual: tokens 480000 · gate_cycles 2 · wall 41m
tier B — same stage, shared labels (1)
  ...
suggested: estimate.tokens=480000 estimate.gate_cycles=2   (tier A median)
```

The suggestion is the median of the first non-empty tier. It is printed, never
written; the lead applies it with `cairn set`. No reference classes gives
`no closed reference classes yet — hand-estimate` and exit 0. `--json` emits
the same data structured. `cairn estimate` never reads the token log or git:
calibration records are the only input, so it is fast and deterministic.

## 5. Bloat flag

This is evaluated inside `cairn close`, after the actuals:

- Gate cycles: `actual.gate_cycles > estimate.gate_cycles` sets the flag. This
  rule is **always** evaluated, since it needs no threshold.
- Tokens: `ratio > estimation.bloat_ratio` sets the flag, but **only when**
  `config.yml` sets `estimation.bloat_ratio`. That key ships **unset** (absent).
  While it is unset the token rule is skipped, and `close` prints
  `bloat: token threshold unset (estimation.bloat_ratio) — skipped`, so the
  skip is visible rather than silent.

A flagged sub-issue gets the label `bloat` added (idempotently) to `labels`,
and `bloat_reasons` is recorded in the calibration line. The post-milestone
cleanup sweep finds them by label (`grep -l 'labels:.*bloat'
process/cairn/issues/`; `cairn ls` has no label filter and this issue does not
add one). POLY-A's baseline sets the
threshold; until then, only gate-cycle overruns flag.

## 6. Shared actuals reader (AC6 seam)

Both functions live in `cairn.py`. They are pure over their inputs (paths, ids,
timestamps) and never print.

```python
def token_actuals(data_dir, issue_id, role=None, since=None, until=None,
                  prices=None) -> dict
    # -> {"tokens", "input", "cache_write", "cache_read", "output",
    #     "cost_usd", "lines"}   (tokens None + lines 0 when the file is absent)
def gate_cycle_actuals(repo_root, base, ref, assignee, same_stage_authors,
                       since=None, until=None) -> dict
    # -> {"gate_cycles", "commits"}
```

- `token_actuals` is built on the existing `_read_token_usage_lines` and
  `_row_cost_usd`. It does not add a second parser.
- `build_tokens_payload` is **not** the seam, contrary to the
  implementation-lead's suggestion. It sums every line for an issue with no
  time filter, so it cannot separate two same-(parent, role) sub-issues, such
  as the architect's plan and review. It also returns a dashboard-shaped
  payload (sorted issues and role entries with rounding). `loop-stats`
  currently reads cost from it, and AC6 moves that read onto `token_actuals`.
  `build_tokens_payload` may itself be refactored onto `token_actuals`
  (`since`/`until` = None), but that is optional.
- `cairn close` calls both with W.
- `loop_stats.scorecard` replaces its `build_tokens_payload(...)` issue-row
  loop with `token_actuals(data_dir, issue_id)["cost_usd"]`, and adds per-agent
  `tokens` from `token_actuals(..., role=<role>)` into `per_agent`.
- Optionally, `gate_cycle_actuals` can feed a per-agent `gate_cycles` row.
- There is one reader, so `loop-stats` and `close` cannot disagree about what
  an issue cost.

## 7. CLI surface

- `cairn close <ID> [--base main] [--ref HEAD] [--no-flush] [--dry-run]`. It
  requires `stage` + `parent` + `assignee` and at least one `estimate.*` field
  (otherwise it exits 1 and names the missing key). It then:
  1. flushes the receiver;
  2. computes W and the actuals;
  3. writes `actual.*` and `ratio`, sets `status: done`, and adds `bloat` if
     flagged, all through one `apply_patch`;
  4. appends the calibration record;
  5. prints a one-screen summary.

  `--dry-run` prints without writing either file. `close` does **not** commit.
  The caller commits the issue file by pathspec; the metrics branch is
  committed the usual way (WORKFLOW → Metrics branch).
- `cairn estimate <ID> [--limit N] [--json]` (§4).

## 8. TRACKER.md rescission

`process/TRACKER.md` → Frontmatter schema says: "Deliberately absent, so they
don't get re-proposed: `estimate` (the workflow never reads one) …". **That
clause is rescinded for sub-issues by POLY-3:** the workflow now reads
`estimate.*` at close (ratio, bloat) and at `cairn estimate` (reference
classes), per kickoff § 2.12.

The implementer deletes `estimate` from that sentence, keeps `branch` and
`major`, and adds the seven fields above to the schema table as optional,
sub-issue-only rows. Top-level issues still carry no estimate: the feature-level
guess stays a lead comment, as on POLY-3 itself.

## 9. Tests (AC7) — minimum set, in `scripts/cairn/tests/test_estimation.py`

- **Check.** Stage enum, `stage` without `parent`, non-int estimate,
  `estimate.tokens: 0`, `actual.*` on a non-done issue, a `ratio` without both
  operands, an unknown `estimation.*` key.
- **Round-trip.** An issue carrying all seven keys dumps byte-identical.
  `cairn set estimate.tokens=5` writes an int.
- **Close.** Uses a fixture token log and a temp git repo with three authors,
  and asserts:
  - the actuals;
  - gate cycles = 2 when a different-stage commit splits the assignee's run;
  - gate cycles = 1 when only a same-stage commit intervenes;
  - the `ratio` string;
  - `status: done`;
  - that exactly one calibration line was appended.
- **Unset threshold.** With no `estimation.bloat_ratio`, a ratio of 5.0 does
  not flag; gate overrun still flags; the skip line prints. With
  `bloat_ratio: 1.5`, a ratio of 1.6 flags.
- **Estimate.** Covers tier A before tier B, last-line-per-id dedup,
  self-exclusion, the empty-reference message, and the median suggestion.
- **Missing token log.** Gives `actual.tokens` null and `ratio` absent, and
  close still succeeds with a warning.
- **loop-stats.** `scorecard` cost equals `token_actuals` cost on the same
  fixture.
