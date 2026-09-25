# Effort estimation — `cairn close` and `cairn estimate`

Kickoff decision: `docs/project_kickoff.md` § 2.12. A change to the behaviour below is a
revision of this file.

**Units.** Dollars (`cost_usd`, priced at close from `scripts/cairn/prices.json`) drive
`ratio` and the cost-bloat rule; gate cycles drive the gate-cycle bloat rule. Raw tokens
are recorded as a secondary and never drive a ratio or a threshold. Wall-clock is
recorded, never estimated.

**Decomposition unit.** One sub-issue per **(agent, stage)** under a parent feature issue
(`parent: <ID>`). The architect usually holds two (`plan` and `review`). Top-level issues
carry no estimate.

## 1. Sub-issue fields

Flat dotted keys, all optional; an absent key is omitted from the dump.

```yaml
stage: execute                 # plan | execute | review
estimate.cost_usd: "3.00"      # the estimate that drives ratio + bloat
estimate.tokens: 400000        # optional secondary
estimate.gate_cycles: 1
actual.cost_usd: "3.7907"      # written by `cairn close`, 4 dp, never by hand
actual.tokens: 512340          # written by `cairn close`; secondary
actual.gate_cycles: 2
actual.wall_clock: 47          # integer minutes, window start -> last assignee commit
ratio: "1.26"                  # actual.cost_usd / estimate.cost_usd, 2 dp
```

`ISSUE_FIELD_ORDER` places them after `paths`, before `labels`, in the order above.

- `estimate.tokens`, `estimate.gate_cycles` and every `actual.*` except `actual.cost_usd`
  are ints. `cairn set` coerces `estimate.*` ints; a non-integer value is a CLI error.
- `estimate.cost_usd` is a decimal string. `cairn set X estimate.cost_usd=3` writes
  `"3.00"`; `=` writes null; anything not `float()`-parseable and > 0 is an error.
- `actual.cost_usd` is written by close as `f"{cost:.4f}"`.
- `ratio` = `actual.cost_usd / estimate.cost_usd` from the unrounded cost, stored as a
  2 dp string; null when either operand is null.
- `estimate.tokens` satisfies close's "at least one `estimate.*`" precondition and
  drives nothing.
- Close always writes `actual.cost_usd`, `actual.tokens`, `actual.wall_clock` and
  `ratio`, each as a value or `null`.

**`cairn check`** (errors unless stated):
- `stage` ∈ {plan, execute, review}; `stage` requires a non-null `parent`.
- Int fields ≥ 0; `estimate.tokens: 0` is an error.
- `estimate.cost_usd`, when non-null: `float()`-parseable, > 0. `actual.cost_usd`,
  when non-null: `float()`-parseable, ≥ 0.
- A non-null `ratio` is `float()`-parseable, ≥ 0, and requires both cost operands
  non-null.
- Any `actual.*` or `ratio` on an issue whose status is not `done`.
- A `done` sub-issue with a `stage` but no `actual.*` is a **warning** (closed by
  `cairn set status=done`, not `cairn close`).
- `config.yml` → `estimation.bloat_ratio`: absent or `null`, or a `float()`-parseable
  string/int > 1.0. Any other `estimation.*` key is an error.

## 2. Actuals sources

All three sources are computed over one **window** W = (from_ts, close_ts]:

- `from_ts` = max(**parent flip**, **sibling floor**).
  - The parent flip is the author time of the oldest commit in `<base>..<ref>`
    (`/start-feature`'s "feature started" commit).
  - The sibling floor is the latest calibration `window.to` (last line per id) of a
    closed sub-issue with the same `parent`, the same `assignee`, a **different id**, and
    a stage **no later** than this one's (plan < execute < review). Absent when there is
    none.
  - The sub-issue file's own creation time is not used. There is no `--since` override.
- `close_ts` is the wall time at which `cairn close` runs, unless `--at <sha>` is given.

### Stage windows

The lead closes each sub-issue immediately after the gate commit that ends its stage,
and commits the issue file by pathspec: **plan** when the design gate clears and after
each addendum; **review** after each verdict; **execute** (qa and builder) at the
approving verdict.

**`--at <sha>`.** `close_ts` becomes the author time of `<sha>` and `ref` becomes
`<sha>`. `<sha>` must be on `ref`'s first-parent history, after the parent flip;
otherwise `close` exits 1. The calibration record carries
`"window": {"from", "to", "at": "<sha>" | null}`.

| stage | from_ts | close_ts |
|---|---|---|
| plan | parent flip | design-gate or latest addendum commit |
| execute | max(flip, floor from an earlier-stage same-assignee sibling) | approving verdict |
| review | max(flip, plan sub-issue's `window.to`) | the verdict just issued |

- **Two review rounds.** One review sub-issue, closed after each verdict; the second
  close has the same floor, so W covers both rounds. The last line per id wins.
- **Same-stage siblings** (qa + builder) count only their own commits and do not floor
  each other.
- **Two sub-issues with the same (parent, assignee, stage)** are outside the protocol;
  they split at the first close.

**Re-close.** `close` on a `done` sub-issue rewrites `actual.*` and `ratio`, adds or
removes the `bloat` label to match, leaves `status: done`, and appends a line. The same
`--at` twice is idempotent in `actual.*` and `window`.

### Tokens — OTel receiver, `process/cairn/metrics/token-usage.jsonl`

One line per (issue, role, model) per flush, carrying `generated` (flush time, ISO-8601
UTC seconds), date-only `window_start`/`window_end`, and four counters.

- `issue` is the **main checkout's branch at flush time** (`_bucket_for_branch`);
  `cairn.issue` is used only when that branch is `main`.
- `role` is `agent.name` if present, else the session's transcript header
  (`agentSetting`/`agentName`).
- Flushes happen every 30 min (1800 s), or earlier when the attributed issue changes.

Attribution is (parent issue, agent role, flush time), so:

```
actual.tokens(S) = Σ (input + cache_write + cache_read + output)
    over lines with source == "otel", issue == S.parent, role == S.assignee,
                    from_ts < generated <= to_ts
    (to_ts = close_ts; with --at, the first otel flush within 1800 s after it)
```

`cairn close` first signals the receiver (`otel_receiver.py --flush-now`) and waits up to
5 s for the new `generated` stamp. Known limits:

- The first line in W may carry up to one flush interval of pre-W tokens.
- With `--at`, if no otel flush falls within 1800 s after the commit, `to_ts = close_ts`
  and close warns `no flush within 1800 s after --at <sha>; …`. The admitted flush may
  carry up to one interval of post-gate same-role tokens; because `window.to` records
  it, a same-assignee commit inside (commit, flush] counts in neither stage.
- If the lead checkout leaves the feature branch mid-loop, tokens go to a `milestone:`
  bucket and are lost to the sub-issue.
- A `subagent-unattributed` role matches no assignee.
- `otel_receiver.compact()` coalesces lines per (issue, role, model) and destroys the
  windows; it must never cover an issue with an open sub-issue. It is not run
  automatically.
- **No evidence is null, never 0.** When the token file is missing, or no line matches
  (parent, role, W), `close` warns naming the case, writes `actual.tokens: null`, and the
  record carries `"ratio": null`. `cairn estimate` excludes null token actuals from the
  token median.

`tokens` sums all four counters. The calibration record keeps the per-counter breakdown.

### Gate cycles — per-agent commit log

Commits carry `author.name == <agent-name> == assignee`. The input is the first-parent
history of `<ref>` (default `HEAD`), filtered to W; `base` (default `main`) bounds W
through the parent flip. If `from_ts` resolves to none, `close` exits 1.

**Definition.** One gate cycle is one maximal run of the assignee's commits in that
history, broken **only** by a commit whose author is neither the assignee nor the
assignee of a same-stage sibling (same `parent`, same `stage`). The lead's issue-file
commits break runs.

Zero assignee commits in W gives `actual.gate_cycles: 0` **and a warning on stderr**.
A review round carried only by `SendMessage` is invisible.

### Wall clock

`actual.wall_clock = round((last_ts − from_ts) / 60)` in integer minutes, where `last_ts`
is the author time of the assignee's last commit in W. `null` when the assignee has no
commits in W. Recorded and printed, never compared against a bound.

### Cost

`actual.cost_usd` is priced with the `prices.json` in the checkout that runs the close
and is frozen there. A re-close recomputes it under the current table; that is the only
correction path. Any unpriced model in W makes the cost null, never partial and never 0:
close writes `actual.cost_usd: null` and `ratio: null`, skips the cost-bloat rule, still
writes `actual.tokens`, and prints
`close: warning: unpriced model(s) [<m>, …] in window -- actual.cost_usd: null`.
`token_actuals` returns the names in `unpriced_models` (sorted, `[]` when none).

## 3. Calibration record

**File:** `process/cairn/metrics/calibration.jsonl`, on the orphan `metrics` branch
beside `token-usage.jsonl`, written under the metrics dir's `.lock`. Append-only, one
line per `cairn close`, keys in this order:

```json
{"schema": 2, "closed": "2026-09-23T18:04:11Z", "id": "POLY-9", "parent": "POLY-3",
 "stage": "execute", "assignee": "backend-lead", "labels": ["cairn", "workflow"],
 "milestone": "POLY-A",
 "estimate": {"cost_usd": 3.0, "tokens": 400000, "gate_cycles": 1},
 "actual": {"tokens": 512340, "gate_cycles": 2, "wall_clock": 47,
            "input": 1200, "cache_write": 60000, "cache_read": 450000, "output": 1140,
            "cost_usd": 3.790712},
 "ratio": 1.26, "ratio_tokens": 1.28, "prices_retrieved": "2026-09-24",
 "bloat": true, "bloat_reasons": ["gate_cycles"],
 "window": {"from": "2026-09-23T17:17:02Z", "to": "2026-09-23T18:04:11Z", "at": null},
 "base": "main", "ref_sha": "abc1234"}
```

- `ratio` is the cost ratio (null if either operand is null). `ratio_tokens` is kept and
  read by nothing. `prices_retrieved` is the price table's `retrieved` stamp, or null.
- In a schema-1 line `ratio` is a token ratio; readers branch on `schema` and never
  compare the two. The file is not migrated.
- `bloat` is `null` when the cost threshold is unset *and* gate cycles are within
  estimate ("not evaluated", distinct from `false`).
- Readers take the **last line per id**. Corrections are a re-run of `cairn close`,
  never a hand edit.

## 4. `cairn estimate <ID>` — reference-class query

Requires the target's `stage` and `parent` (otherwise exit 1). Runs over calibration
records (last line per id, excluding `<ID>`), in tiers:

1. **Tier A:** same `stage` and same `assignee`.
2. **Tier B:** same `stage`, different assignee, at least one shared label; ranked by
   label-overlap count (desc), then `closed` (desc).

Within a tier, rows sort by `closed` descending, capped at `--limit` (default 5).

```
reference classes for POLY-12 (execute / backend-lead / [cairn, workflow])
tier A — same stage + assignee (3)
  id       closed      est.$  act.$   ratio  est.gc  act.gc  wall  act.tok   bloat
  POLY-9   2026-09-23  3.0    3.7907  1.26   1       2       47    512340    yes
  ...
  median actual: cost $3.79 · gate_cycles 2 · wall 41m · tokens 480000
suggested: estimate.cost_usd=3.79 estimate.gate_cycles=2   (tier A median)
```

- Values print as stored; `null` prints as `null`; a schema-1 row prints `ratio` as `-`.
- The cost median is over rows with non-null `actual.cost_usd` (schema-1 rows included).
  With none in the tier, the suggestion is
  `suggested: estimate.gate_cycles=N   (tier A median; no non-null cost actuals)`.
- The suggestion is the median of the first non-empty tier; it is printed, never written.
- No reference classes: `no closed reference classes yet — hand-estimate`, exit 0.
- `--json` emits the raw rows. `estimate` reads only calibration records, never the
  token log or git.

## 5. Bloat flag

Evaluated inside `cairn close`, after the actuals:

- **Gate cycles:** `actual.gate_cycles > estimate.gate_cycles` flags, reason
  `"gate_cycles"`. Always evaluated.
- **Cost:** `ratio > estimation.bloat_ratio` flags, reason `"cost"`, only when the key is
  set and `ratio` is non-null. The key ships unset; while unset, close prints
  `close: bloat: cost threshold unset (estimation.bloat_ratio) — skipped`.

A flagged sub-issue gets the `bloat` label (idempotently), and `bloat_reasons` is
recorded in the calibration line.

## 6. Shared actuals reader

Both live in `cairn.py`, are pure over their inputs, and never print. `cairn close` and
`loop_stats.scorecard` both read through them, so they cannot disagree about what an
issue cost.

```python
def token_actuals(data_dir, issue_id, role=None, since=None, until=None,
                  prices=None) -> dict
    # -> {"tokens", "input", "cache_write", "cache_read", "output",
    #     "cost_usd", "unpriced_models", "lines"}   (tokens None + lines 0 when the file is absent)
def gate_cycle_actuals(repo_root, base, ref, assignee, same_stage_authors,
                       since=None, until=None) -> dict
    # -> {"gate_cycles", "commits"}
```

## 7. CLI surface

- `cairn close <ID> [--base main] [--ref HEAD] [--at <sha>] [--no-flush] [--dry-run]`
  requires `stage` + `parent` + `assignee` and at least one `estimate.*` field
  (otherwise exit 1, naming the missing key). It then:
  1. flushes the receiver;
  2. computes W and the actuals;
  3. writes `actual.*` and `ratio`, sets `status: done`, and adds `bloat` if flagged,
     through one `apply_patch`;
  4. appends the calibration record;
  5. prints a one-screen summary.

  `--dry-run` prints without writing either file. `close` does not commit: the caller
  commits the issue file by pathspec, and the metrics branch is committed the usual way
  (WORKFLOW → Metrics branch).
- `cairn estimate <ID> [--limit N] [--json]` (§4).
