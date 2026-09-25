# Effort estimation loop — design note (POLY-3)

Kickoff decision: `docs/project_kickoff.md` § 2.12. This note is the architect's
design pass (POLY-3 AC1); the implementation follows it, and a deviation is a
revision of this file, not a comment.

**Units (revised by POLY-34).** Dollars (`cost_usd`, priced at close from
`scripts/cairn/prices.json`) for cost, and gate cycles for bloat. Raw tokens
are recorded as a secondary and never drive a ratio or a threshold.
Wall-clock is recorded, never estimated. Human minutes appear nowhere. The
POLY-34 ruling is §0; §1, §3, §4, §5, §8 and §9 are revised in place to match.

**Decomposition unit.** One sub-issue per **(agent, stage)** under a parent
feature issue (`parent: <ID>`). Usually that is one per agent; the architect
typically holds two (a `plan` sub-issue and a `review` sub-issue).

## 0. POLY-34 ruling — the cost axis (gate 1)

### 0.1 Measurement (POLY-6 calibration records, last line per id)

| id | role (model) | actual.tokens | cache_read share | cost_usd | $/MTok | token ratio |
|---|---|---|---|---|---|---|
| POLY-28 | architect (opus-5-5) | 842,889 | 90.7% | 0.8802 | 1.04 | 1.20 |
| POLY-29 | qa (sonnet-5) | 12,318,784 | 98.0% | 3.7907 | 0.31 | 17.60 |
| POLY-30 | impl-lead (sonnet-5) | 37,601,904 | 99.0% | 9.4330 | 0.25 | 31.33 |
| POLY-31 | devops (sonnet-5) | 3,026,027 | 96.7% | 1.1035 | 0.36 | 5.04 |
| POLY-32 | architect (opus-5-5) | 3,988,028 | 97.3% | 2.0704 | 0.52 | 9.97 |

Source: `process/cairn/metrics/calibration.jsonl` (main checkout) and the
POLY-6 `otel` lines in `token-usage.jsonl` (models per role as shown). The
effective price per raw token varies 4.2× across one loop (0.25–1.04 $/MTok),
so the raw sum is not a stable cost proxy. POLY-11–24 (POLY-3/16/10) carry
`actual.tokens: null` and `cost_usd: null`: they predate teammate attribution.

### 0.2 (a) Unit: `cost_usd`, not cost-weighted tokens

**Ruling: `cost_usd`**, computed at close by `token_actuals` from the price
table in the checkout that runs the close. Why, over cost-weighted tokens
(tokens × per-type rate ÷ a reference rate):

- Weighted tokens need a reference rate. Per-model input rate makes the unit
  model-relative: `cache_read/input` is 0.05 on opus-5-5, 0.10 on sonnet-5 and
  0.025 on fable-5-1 (`prices.json`). POLY-6 already mixes opus (architect)
  and sonnet (everyone else), so a per-model weighting would sum incomparable
  units within one reference class. A single global reference rate is just
  `cost_usd` divided by a constant, which adds nothing.
- `cost_usd` already exists: one seam (`token_actuals` → `_row_cost_usd`),
  already in every record since POLY-28, and already what `loop-stats`
  reports. Adding it costs no new pricing logic.
- It is the quantity the lead budgets in. POLY-34's start comment already
  records dollar guesses beside the token guesses.
- Cost: a model swap moves the dollar ratio by the price ratio (≤ 2.5×
  between the priced opus and sonnet tiers). That is a real cost change, and
  it is far smaller than the 26× spread of the token ratios above.

**Price-table change.** `actual.cost_usd` is frozen at close with the table in
force then. The calibration record gains `prices_retrieved` (the table's
`retrieved` stamp) so a repricing is visible. A re-close recomputes the cost
under the current table; that is the only correction path (never hand-edit).
There is no automatic repricing of old records.

**Unpriced model (null cost).** Unchanged posture: any unpriced line in W makes
`cost_usd` null, never partial and never 0. Close then writes
`actual.cost_usd: null` and `ratio: null`, skips the cost-bloat rule, and prints
`close: warning: unpriced model(s) [<m>, …] in window -- actual.cost_usd: null`.
`token_actuals` gains a `unpriced_models` key (sorted list, `[]` when none) so
the warning can name them. `actual.tokens` is still written.

### 0.3 (b) Fields, order, check

New keys: `estimate.cost_usd` and `actual.cost_usd`, both decimal strings (the
YAML subset is int-only). The `ISSUE_FIELD_ORDER` block becomes:
`stage, estimate.cost_usd, estimate.tokens, estimate.gate_cycles,
actual.cost_usd, actual.tokens, actual.gate_cycles, actual.wall_clock, ratio`.

- `estimate.cost_usd`: the lead's dollar estimate. `_coerce_cli_value` gains an
  `ESTIMATION_DECIMAL_FIELDS = ("estimate.cost_usd",)` branch: `""` → `None`;
  a `float()`-parseable value > 0 → the string `f"{x:.2f}"` (so
  `cairn set X estimate.cost_usd=3` writes `"3.00"`); anything else is a
  `CairnError`.
- `actual.cost_usd`: written by close as `f"{cost:.4f}"`. It uses 4 dp, not
  2 dp, so a priced, non-empty window never renders as `"0.00"`. The record
  keeps the 6 dp float.
- `ratio` is redefined as `actual.cost_usd / estimate.cost_usd`, computed from
  the unrounded cost, and stored as a 2 dp string. It is null when either
  operand is null.
- `estimate.tokens` stays as an **optional secondary**. It is still validated
  (int > 0 when present), still carried into the record, and still satisfies
  close's "at least one `estimate.*`" precondition. It drives nothing.
  `actual.tokens` stays as written today.
- **Close always writes all four computed keys:** `actual.cost_usd`,
  `actual.tokens`, `actual.wall_clock`, and `ratio`, each as a value or
  `null`. Today a `None` is skipped, which would leave a stale token `ratio`
  on a re-close (POLY-28–32 carry one). Check already treats `null` as absent.

`cairn check` (errors):
- `estimate.cost_usd`, when non-null: a string or int, `float()`-parseable,
  > 0.
- `actual.cost_usd`, when non-null: `float()`-parseable, ≥ 0. It joins the
  non-`done` restriction list.
- A non-null `ratio` requires both `actual.cost_usd` and `estimate.cost_usd`
  to be non-null. This replaces the token-operand rule, so a token-only
  `ratio` is now an error. On this branch that is POLY-28–32 until AC5
  re-closes them, so AC5 lands in the same PR.

### 0.4 (c) `cairn estimate`

Header row:
`id  closed  est.$  act.$  ratio  est.gc  act.gc  wall  act.tok  bloat`.
Values print as stored; `null` prints as `null`. Schema-1 rows print `ratio`
as `-`, because their stored ratio is a token ratio and is not comparable.
- Median line:
  `median actual: cost $X.XX · gate_cycles N · wall Nm · tokens N`. The cost
  median is over rows with non-null `actual.cost_usd` only, the same way null
  tokens are excluded today. The token median is kept as a secondary.
- Suggestion (first non-empty tier):
  `suggested: estimate.cost_usd=X.XX estimate.gate_cycles=N   (tier A median)`.
  With no non-null cost in the tier:
  `suggested: estimate.gate_cycles=N   (tier A median; no non-null cost actuals)`.
- `--json`: unchanged (it emits the raw rows).
- Expected after AC5 (from 0.1): POLY-35 plan/architect → tier A cost median
  $0.88 (POLY-11/17/21 are null and excluded). POLY-38 review → $2.07.

### 0.5 (d) Bloat on the new axis

`estimation.bloat_ratio` is a threshold on the **cost** ratio, and the
`bloat_reasons` entry is `"cost"` (it replaces `"tokens"`). Validation is
unchanged (> 1.0; absent or null is fine). When it is unset: no cost rule, and
the skip line is printed with "token" replaced by "cost":
`close: bloat: cost threshold unset (estimation.bloat_ratio) — skipped`.
`bloat: null` semantics are unchanged. A null `ratio` (no `estimate.cost_usd`,
or an unpriced model) skips the cost rule. The gate-cycle rule is untouched.

### 0.6 (e) AC5 — re-closing POLY-28–32

**Ruling: leave `estimate.cost_usd` absent, so `ratio` is null.** A cost
derived as token estimate × blended rate is not an estimate anyone made.
Using the observed rate is circular: it reproduces the token ratio. Using
any other stated rate injects an invented number into the first cost
reference class. `cairn estimate` seeds from **actuals** (medians), so
POLY-28–32 serve as a reference class without a ratio.

Mechanics: each re-close runs `--at` its recorded `window.at`, with
`--base 97037a6 --ref a508b32^2`. 97037a6 is the merge-base of PR #12's
parents (measured), and every `at` below is on `a508b32^2`'s first-parent
history (measured).

The order matters, because POLY-32's floor reads POLY-28's new line:
1. POLY-28 `--at 4601a09`
2. POLY-29, POLY-30, POLY-31 `--at c93342d`
3. POLY-32 `--at 75cc704`

Expected: identical windows and gate cycles. `actual.cost_usd` = 0.8802 /
3.7907 / 9.4330 / 1.1035 / 2.0704, provided `prices.json` is unchanged
(`retrieved` 2026-09-24). `ratio: null`. `bloat` stays on POLY-29/32
(gate_cycles only).

### 0.7 POLY-39 — CI change pattern

**Verified: no test reads the real tracker tree.** Method:
1. `grep -rnE "cairn/(issues|milestones|majors|archive)"` over
   `scripts/cairn/tests` and `tests/workflow`. Every hit is a docstring
   citation, a temp-tree fixture (`test_gate_head`, `test_flow_throughput`,
   `test_dashboard_flow`, `test_milestone_overhead` build their own
   `repo_root`), or a string literal (`test_skill_id_literals`).
2. Each `REPO_ROOT` use checked. The real-tree reads are `process/STATE.md`,
   `WORKFLOW.md`, `TRACKER.md`, `.claude/**`, `ci.yml`, the dashboard sources,
   and `metrics/` (not in git). None of them is under
   `issues|milestones|majors|archive`.
3. CI never runs `cairn check` on the real tree: `ci.yml` runs
   `run_tests.py` and the JS suite only. Tracker lint lives in the
   `guard-commit` pre-commit hook.

**Pattern (devops-engineer).** Leave `PATTERN` unchanged and filter
excluded paths out first. ERE has no lookahead. The exclusion must stay
fail-closed:

```bash
EXCLUDE='^process/cairn/(issues|milestones|majors|archive)/'
rc=0; RELEVANT="$(grep -vE "$EXCLUDE" <<<"$CHANGED")" || rc=$?
if [ "$rc" -gt 1 ]; then exit "$rc"; fi   # 1 = every line excluded; >1 = grep error
if grep -qE "$PATTERN" <<<"$RELEVANT"; then run=true; else run=false; fi
```

`process/*.md` and `process/cairn/config.yml` still match `process/`. The only
tracked paths under `process/cairn/` are `config.yml`, `issues/`, `majors/`
and `milestones/`; `archive/` is excluded ahead of its first use.

**Limit (measured by reading the step; document it, don't fight it).**
`CHANGED` is the cumulative PR diff (`base.sha..HEAD`), not the per-push
delta. On a PR that touches code, every push, tracker-only tips included,
still runs the full suite. The exclusion only saves runs on PRs whose
*entire* diff is tracker data. The PR #12 runs the POLY-39 comment cites fall
in the first case, so this loop's pushes will **not** stop running. Strict
mode compounds this: a main advance forces a branch update, which is a new
head and a new run. Diffing against `github.event.before` instead is
**rejected** because it fails open. If the previous run was cancelled
(`cancel-in-progress`) or red, a tracker-only push would turn the required
check green on a broken tree. Closing that hole needs a check-runs API query
on `before`; that is out of scope and an open question for the lead.

### 0.8 Addendum 1 — skip anchored to the last successful run (accepted)

The rule: skip only when the tree being checked differs from a tree that
already went green **in tracker paths only**. This extends the §0.7 step;
if the anchor check doesn't skip, the step falls through to §0.7 unchanged.

- **Anchor lookup.** List this workflow's successful PR runs on this branch:
  `gh api "repos/$REPO/actions/workflows/ci.yml/runs?event=pull_request&status=success&branch=$HEAD_REF&per_page=1" --jq '.workflow_runs[0].head_sha // empty'`.
  An empty result means no anchor, so fall through to §0.7.
  The job's `permissions` add `actions: read`, and the step gets
  `GH_TOKEN: ${{ github.token }}`.
- **Pick the anchor.** Use only the newest result, A. Don't walk back to
  older runs: an older anchor is an ancestor of A, so it can't contain a
  base that A lacks. If any of these three checks fails, fall through to
  §0.7:
  1. `git cat-file -e A` succeeds.
  2. `git merge-base --is-ancestor A "$PR_HEAD"` holds, where
     PR_HEAD = `pull_request.head.sha`.
  3. `git merge-base --is-ancestor "$BASE_SHA" A` holds. A contains the
     current base, so the tree A's run tested (refs/pull/N/merge) equals
     A's own tree, and a move on `main` can never ride along on a skip.
- **Skip test.** Set run=false only if every line of
  `git diff --name-only A "$PR_HEAD"` matches EXCLUDE (an empty diff counts
  as a match). A green run on A is either a real run of the suite or a sound
  skip, so by induction the invariant holds.
- **Fail closed.** If `gh` fails, the output isn't JSON, or any git command
  exits non-zero other than an ancestry "no" (exit 1), take no skip and fall
  through to §0.7. The anchor path may only ever *add* a false. There is
  exactly one `run=false` write in it, and no `|| true` anywhere. A
  `workflow_dispatch` event bypasses the anchor path, as it does today.
- **Measured effect (unmeasured until the first push after this lands).**
  Each tracker-only push after a green code tip should skip the suite. The
  job still starts, running only checkout and the API call.
- **qa shape test.** The anchor lookup asks for `status=success` and
  `event=pull_request`. The workflow grants `actions: read`. Both ancestry
  checks appear. `run=false` appears exactly twice in the step (§0.7 plus the
  anchor). The step has no `|| true`.

POLY-35 re-closes after this addendum. POLY-39's scope grows to cover this
step.

## 1. Sub-issue fields

> POLY-34: the cost fields and the redefined `ratio` are in §0.3, which
> supersedes the token-ratio text below where the two conflict. The YAML-shape
> and number-encoding reasoning below still holds.

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
estimate.cost_usd: "3.00"      # POLY-34: the estimate that drives ratio + bloat
estimate.tokens: 400000        # optional secondary (POLY-34)
estimate.gate_cycles: 1
actual.cost_usd: "3.7907"      # written by `cairn close`, 4 dp, never by hand
actual.tokens: 512340          # written by `cairn close`; secondary
actual.gate_cycles: 2
actual.wall_clock: 47          # integer minutes, window start -> last assignee commit
ratio: "1.26"                  # POLY-34: actual.cost_usd / estimate.cost_usd, 2 dp
```

**Numbers.** The parser reads only integers (`^-?\d+$`). It has no float type,
and adding one would turn `target_tag: 1.0` into a float everywhere. So:

- `estimate.*` and `actual.*` are non-negative ints.
- `ratio` is a decimal **string**. The dumper quotes it (numeric-looking), and
  readers call `float()`.
- `_coerce_cli_value` coerces `estimate.*` to `int`, so that
  `cairn set POLY-9 estimate.tokens=400000` writes `400000` and not
  `"400000"`. A non-integer value is a CLI error.

`ratio` is the cost ratio only (POLY-34; it was the token ratio before).
The gate-cycle comparison is a plain integer comparison (§5) and needs no
stored ratio. The cost fields are decimal strings, the same encoding as
`ratio`; see §0.3.

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
  - The sibling floor is the latest calibration `window.to` (last line per
    id) of a closed sub-issue with the same `parent`, the same `assignee`, a
    **different id**, and a stage **no later** than this one's
    (plan < execute < review). It is absent when there is none. Excluding
    self makes a re-close re-measure from the same floor; excluding later
    stages keeps a plan re-close from flooring at its own review's close
    (POLY-16).
  - The sub-issue file's own creation time is **not** used. Sub-issues are
    often written after the work has started (as POLY-11 was), and the
    assignee/role filters already keep other agents' commits and tokens out of
    W.
  - There is no `--since` override: a hand-set window would let a calibration
    record be fudged.
- `close_ts` is the wall time at which `cairn close` runs, unless `--at <sha>`
  is given (below).

### Stage windows (POLY-16 ruling)

**Finding.** The floor above is only real if each stage is closed when it
ends. POLY-3 closed all four sub-issues at finish-feature, so the architect's
plan sub-issue (POLY-11) absorbed every architect commit (gate_cycles=4) and
the review sub-issue (POLY-14) got 0. Measured on POLY-3's first-parent log
(`git log --first-parent 1389297^1..1389297^2`, author per commit), the
architect's runs are: {6979191, 82c0677, de28e82} ruling · {85c5fd6, b6caa8a}
addendum 1 · {c195c37, c9ae61a} verdict · {de60cde} re-verdict.

**Why the log alone cannot split them.** Addendum 1 and the first verdict
both follow a green build, both touch the design note, and both are followed
by a qa red. Author order does not decide the stage of a multi-stage author's
run, and commit subjects are not a contract. So a boundary derived purely from
the log (e.g. "plan ends at the first execute commit") would put addendum 1
in review and give POLY-11 = 1. The stage boundary is a **gate event**, and
only the lead knows when it happened.

**Ruling: both.** (a) is the rule; (b) is the mechanism that makes (a)
exact and lets a late close be corrected.

- **(a) Close at stage end (WORKFLOW → Estimation).** The lead runs every
  close, immediately after the gate commit that ends the stage, and commits
  the issue file by pathspec:
  - **plan**: when the design gate clears, and again after each addendum;
  - **review**: after each verdict (changes-requested and approve);
  - **execute** (qa and builder): at the approving verdict.
- **(b) `--at <sha>` sets the ceiling.** `close_ts` becomes the author time of
  `<sha>`, and `ref` becomes `<sha>`. `<sha>` must be on `ref`'s first-parent
  history, after the parent flip; otherwise `close` exits 1. The calibration
  record carries `"window": {"from", "to", "at": "<sha>" | null}`. This does
  not reopen the fudge that §2 forbids for `--since`: the ceiling can only
  land on a real, recorded commit. It is how a close run late (as in POLY-3)
  is measured as if it had run at the gate.

**Per-stage window**, all W = (from_ts, close_ts]:

| stage | from_ts | close_ts |
|---|---|---|
| plan | parent flip (no earlier-stage sibling exists) | design-gate or latest addendum commit |
| execute | max(flip, floor from an earlier-stage same-assignee sibling) | approving verdict |
| review | max(flip, plan sub-issue's `window.to`) | the verdict just issued |

- **Two review rounds.** One review sub-issue, closed after each verdict. The
  second close has the same floor (self is excluded), so W grows to cover both
  rounds and gives 2. The last line per id wins.
- **Same-stage siblings** (qa + builder, both execute) are unchanged. Each
  counts only its own commits, and the other's commits do not break its run.
  They do not floor each other either: different assignees.
- **Two sub-issues with the same (parent, assignee, stage)** are outside the
  protocol (one per agent, stage). Known limit: they split at the first close.

**Re-close.** `close` on a `done` sub-issue is allowed. It rewrites
`actual.*` and `ratio`, adds or **removes** the `bloat` label to match the new
evaluation, leaves `status: done`, and appends a line. Re-closing at the same
`--at` is idempotent in `actual.*` and `window`.

**POLY-3 re-close (AC4), expected:** POLY-11 `--at b6caa8a` gives W =
(532a5f2, b6caa8a] and 2 cycles. POLY-14 `--at de60cde` gives W = (b6caa8a,
de60cde] and 2 cycles (c9ae61a and de60cde are split by 040a43b). Order:
POLY-11 first, because POLY-14's floor reads its new line.
(Measured from the commit log above; token numbers are unmeasured until the
re-close runs.)

**Tests (qa, `test_estimation.py`):**
1. The back-to-back pair: one assignee, plan and review, both closed at the
   end with `--at` at their gate commits; each gets its own commits.
2. The same pair closed with no `--at` reproduces the POLY-3 collapse. This
   pins that the default is still `now`.
3. Same-stage siblings: the qa and builder commits interleave. Each gets 1
   cycle, and neither floors the other.
4. Two review rounds: close after verdict 1 gives 1; close after verdict 2
   gives 2; the last line per id holds 2.
5. Re-close idempotence: the same `--at` twice gives identical `actual.*` and
   `window`, two lines, and `status` stays `done`. A re-close that no longer
   overruns removes `bloat`.
6. Plan re-close after review is closed: the floor ignores the later-stage
   sibling.
7. `--at` off first-parent history, or at/before the parent flip, exits 1.

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
first-parent history of `<ref>`, filtered to W. The defaults are `base = main`
and `ref = HEAD`, the same defaults `loop-stats` uses.

`base` bounds W through the parent flip, not through a `<base>..<ref>` range
exclusion. The review of the green build (bbbc8f7) accepted this as a
deviation: it gives the same result once W is bounded. That makes a bounded W
mandatory. If `from_ts` resolves to none (`base..ref` is empty and there is no
sibling floor), `close` exits 1; it does not count the assignee's whole-repo
history.

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

- **Schema 2 (POLY-34).** `ratio` is the cost ratio (null if either cost
  operand is null). `ratio_tokens` keeps the old token ratio for continuity
  only; nothing reads it. `estimate.cost_usd` is a float or null.
  `prices_retrieved` is the price table's `retrieved` stamp, or null. In a
  schema-1 line, `ratio` is a token ratio. Readers branch on `schema` and never
  compare a schema-1 `ratio` with a schema-2 one. The file is not migrated;
  a re-close appends a schema-2 line, which wins by last-line-per-id.

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
(default 5 per tier). Output is a plain table per tier (POLY-34 columns,
§0.4):

```
reference classes for POLY-12 (execute / backend-lead / [cairn, workflow])
tier A — same stage + assignee (3)
  id       closed      est.$  act.$   ratio  est.gc  act.gc  wall  act.tok   bloat
  POLY-9   2026-09-23  3.0    3.7907  1.26   1       2       47    512340    yes
  ...
  median actual: cost $3.79 · gate_cycles 2 · wall 41m · tokens 480000
tier B — same stage, shared labels (1)
  ...
suggested: estimate.cost_usd=3.79 estimate.gate_cycles=2   (tier A median)
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
- Cost (POLY-34, §0.5): `ratio > estimation.bloat_ratio` sets the flag with
  reason `"cost"`, where `ratio` is now the cost ratio. It fires **only when**
  `config.yml` sets `estimation.bloat_ratio` and `ratio` is non-null. That key
  ships **unset** (absent). While it is unset the cost rule is skipped, and
  `close` prints
  `bloat: cost threshold unset (estimation.bloat_ratio) — skipped`, so the
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

- `cairn close <ID> [--base main] [--ref HEAD] [--at <sha>] [--no-flush] [--dry-run]`
  (`--at`: §2 → Stage windows). It
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

**POLY-34 (implementer):** in TRACKER.md, add rows for `estimate.cost_usd`
(decimal string > 0 \| absent) and `actual.cost_usd` (decimal string ≥ 0 \|
absent, close-written, 4 dp, null on an unpriced model). Mark
`estimate.tokens` as an optional secondary. Redefine the `ratio` row as
`actual.cost_usd / estimate.cost_usd`. Change the Effort-estimation
paragraph's "token ratio" to "cost ratio".

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

### 9.1 POLY-34 tests (qa) — POLY-39 shape test first

0. **POLY-39**, in `tests/workflow/test_cairn_test_boundary.py`
   (`CiWorkflowShapeTests`). Extract the `EXCLUDE` and `PATTERN` literals
   from the `changes` step block, then apply them in Python `re` (grep -v
   first, then grep):
   - tracker-only paths `process/cairn/{issues,milestones,majors,archive}/X.md`
     give run=false;
   - `process/STATE.md`, `process/cairn/config.yml` and
     `scripts/cairn/cairn.py` each give true;
   - tracker + code mixed gives true;
   - `docs/PRD/index.html` gives false.

   Also assert the step never swallows grep's exit status with a bare
   `|| true`. The existing `RULED_PATHS` test stays green.
1. **Check.** `estimate.cost_usd` of `"0"`, `"0.00"` or `"abc"` is an error;
   int `3` is accepted. `actual.cost_usd` on a non-done issue is an error. A
   non-null `ratio` with `estimate.tokens` + `actual.tokens` but no cost
   operands is an error. `ratio: null` is accepted.
2. **Set.** `estimate.cost_usd=3` writes `"3.00"`; `=abc` exits 1; `=` writes
   null.
3. **Round-trip.** An issue carrying all nine keys dumps byte-identical, in
   §0.3 order.
4. **Close, priced.** `actual.cost_usd` == `f"{token_actuals cost:.4f}"`;
   `ratio` == cost/est at 2 dp. The record has `schema: 2`, `ratio`,
   `ratio_tokens`, `prices_retrieved` and `estimate.cost_usd`.
5. **Close, unpriced model in W.** `actual.cost_usd: null`, `ratio: null`,
   `actual.tokens` an int. The warning names the model, and `"cost"` is not
   in `bloat_reasons` even when `bloat_ratio` is set.
   `token_actuals(...)["unpriced_models"]` lists the model.
6. **Close with `estimate.tokens` only.** `ratio: null`, and the record's
   `ratio_tokens` is non-null.
7. **Re-close clears a stale token ratio.** Given a done file with
   `ratio: "1.20"` and no `estimate.cost_usd`, after close the file has
   `ratio: null` and `cairn check` passes.
8. **Bloat.** Rewrite the two existing tests that pin `"tokens"` in
   `bloat_reasons` (test_estimation.py ~l.524/542) to `"cost"`. With
   `bloat_ratio: 1.5`, a cost ratio of 1.6 flags `"cost"`. When unset, the
   `cost threshold unset` line prints and the gate rule still flags.
9. **Estimate.** Schema-1 and null-cost rows are excluded from the cost
   median. The suggestion line is
   `estimate.cost_usd=X.XX estimate.gate_cycles=N`. A tier with all-null
   costs gives the gate-only suggestion ending `no non-null cost actuals`.
   The header string is pinned, and a schema-1 row prints ratio `-`.
