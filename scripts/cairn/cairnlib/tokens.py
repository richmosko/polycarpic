"""cairnlib.tokens — Token usage / cost dashboard block (PT-79): GET
/api/tokens, aggregated to issue x role, memoized on the metrics file's
own (mtime_ns, size).

A SEPARATE endpoint from /api/dashboard, /api/roster, and /api/flow
(PT-56/PT-61's own precedent: a different cost profile and refresh cadence
do not belong bolted onto an existing payload). Reads
process/cairn/metrics/token-usage.jsonl (PT-77/PT-78's shared schema) and
scripts/cairn/prices.json (architect's ruling § 1) -- the engine's own
dated price table, deliberately living BESIDE the engine and never under
process/cairn/: the rates are identical for every project that ever uses
cairn (engine data, not this project's state), so `git subtree
split --prefix=scripts/cairn` must carry it with the engine, and a
spun-off cairn must never drag a project's usage history along with it.

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 13).
"""

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from cairnlib.constants import CAIRN_DIR
from cairnlib.store import _repo_root_for
from cairnlib.attribution import milestone_rank_map, milestone_windows
from cairnlib.flow import build_flow_payload

__all__ = [
    "PRICES_PATH",
    "TOKEN_USAGE_REL",
    "_TOKENS_CACHE",
    "_TOKENS_CACHE_MAX",
    "_TOKEN_COUNTERS",
    "_read_token_usage_lines",
    "_row_cost_usd",
    "_token_bucket_kind",
    "_tokens_cache_key",
    "build_tokens_payload",
    "build_tokens_payload_cached",
    "load_prices",
]

PRICES_PATH = CAIRN_DIR / "prices.json"
TOKEN_USAGE_REL = Path("metrics") / "token-usage.jsonl"
_TOKEN_COUNTERS = ("input", "cache_write", "cache_read", "output")

# Bounded in-process memo, per data_dir: {str(data_dir): ((mtime_ns, size), payload)}.
# Same "cheap freshness probe, insertion-order eviction" shape as
# _FLOW_CACHE above -- the metrics file changes rarely (a one-time
# backfill re-run, or a receiver flush at most every ~30 minutes per
# PT-78's own ruling), so a full re-parse of every line on every request
# is waste.
_TOKENS_CACHE: Dict[str, Tuple[Tuple[int, int], Dict[str, Any]]] = {}
_TOKENS_CACHE_MAX = 8


def load_prices(prices_path: Path = PRICES_PATH) -> Dict[str, Any]:
    """Parses `scripts/cairn/prices.json`. Never raises -- a missing or
    malformed price table degrades every model to "unpriced"
    (`cost_usd: null` everywhere `build_tokens_payload` would otherwise
    compute a number), the same never-500 posture that function takes
    for a missing metrics file: a pricing problem must not break the
    dashboard, only its dollar view.
    """
    empty = {"source": None, "retrieved": None, "currency": "USD", "unit": "per_mtok", "models": {}}
    try:
        parsed = json.loads(Path(prices_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return empty
    if not isinstance(parsed, dict) or not isinstance(parsed.get("models"), dict):
        return empty
    return parsed


def _row_cost_usd(row: Dict[str, Any], rate: Dict[str, Any]) -> float:
    """USD cost of one `token-usage.jsonl` line's counters against one
    model's `rate` dict ($/MTok). Architect's ruling § 1: rates are
    always explicit per-model numbers, never a multiplier derived from
    `input` -- Claude Fable 5.1's measured cache-read rate is 0.025x
    input, not the published docs' 0.1x multiplier, so a derived formula
    would silently overcharge it 4x.

    `cache_write_5m`/`cache_write_1h`, when BOTH keys are present on the
    row (PT-77 backfill lines always carry them), are priced
    INDIVIDUALLY at their own rates -- test § 8 item 3's own regression:
    pricing the whole `cache_write` total at the 5m rate understates the
    real corpus by 9%. When the split is absent (every PT-78 otel-sourced
    line, which does not carry it per that ruling's own schema), the
    row's plain `cache_write` total is priced at the 1h rate --
    documented assumption, not a ruled requirement: PT-77's own
    measurement found this repo's backfilled cache writes are 100% 1h,
    so an unsplit total is closer to reality priced at the 1h rate than
    at the 5m rate the regression test above warns against.
    """
    mtok = 1_000_000.0
    cost = (
        (row.get("input") or 0) / mtok * rate["input"]
        + (row.get("cache_read") or 0) / mtok * rate["cache_read"]
        + (row.get("output") or 0) / mtok * rate["output"]
    )
    if "cache_write_5m" in row or "cache_write_1h" in row:
        cost += (row.get("cache_write_5m") or 0) / mtok * rate["cache_write_5m"]
        cost += (row.get("cache_write_1h") or 0) / mtok * rate["cache_write_1h"]
    else:
        cost += (row.get("cache_write") or 0) / mtok * rate["cache_write_1h"]
    return cost


def _read_token_usage_lines(path: Path) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """Parses `token-usage.jsonl` -- a malformed individual line is
    skipped (degrades this endpoint's totals by one contribution), never
    raised: this file is written by two independent processes
    (backfill_tokens.py, otel_receiver.py) under their own fail-loudly
    contracts at WRITE time; a READER here failing the whole dashboard
    over one bad line would be a second, needless failure mode for data
    that was already validated once.

    Returns `(lines, warning)` -- `warning` names the file path and the
    1-indexed line number of the FIRST malformed line skipped (team-lead's
    explicit instruction: a skip must be visible, not just tolerated).
    `None` when every line parsed cleanly.
    """
    lines: List[Dict[str, Any]] = []
    warning: Optional[str] = None
    path = Path(path)
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        raw = raw.strip()
        if not raw:
            continue
        try:
            record = json.loads(raw)
        except json.JSONDecodeError:
            if warning is None:
                warning = f"skipped malformed line {lineno} in {path}"
            continue
        if isinstance(record, dict):
            lines.append(record)
        elif warning is None:
            warning = f"skipped malformed line {lineno} in {path}"
    return lines, warning


def _token_bucket_kind(issue: str) -> str:
    """PT-84 §7: the `kind` discriminator server-computes from the raw
    `issue` string ONCE, here -- the chart must never string-sniff the
    `milestone:` prefix itself (§7's own stated reason: a prefix
    convention parsed on the client is exactly the coupling that breaks
    the next time the storage form changes)."""
    if issue == "main":
        return "main"
    if issue.startswith("milestone:"):
        return "milestone"
    return "issue"


def build_tokens_payload(data_dir: Path, prices: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """`GET /api/tokens`'s payload (PT-79, architect's ruling § 2).
    Aggregated to issue x role -- model detail is folded into `cost_usd`
    server-side and never crosses the wire, keeping the price table on
    one side of the API boundary (AC2 needs the four counters, AC4 needs
    the role split, nothing on the page needs a per-model breakdown).

    `cost_usd` is `null` -- never `0` -- for any (issue, role) bucket
    that includes so much as one unpriced model's contribution: a
    missing rate must look like missing information, not free work. An
    issue's own `total.cost_usd` is null whenever any of its roles' cost
    is null, for the same reason -- summing past a null would silently
    understate the total instead of surfacing the gap.

    A missing or unreadable metrics file is `warning: "no token data"`,
    `issues: []`, HTTP 200 -- the ONE place the tracker's usual "missing
    means error" rule does not apply: `token-usage.jsonl` is optional
    data, unlike `config.yml`, which defines the tracker itself. Never
    raises.
    """
    data_dir = Path(data_dir)
    prices = load_prices() if prices is None else prices
    models = prices.get("models") or {}
    usage_path = data_dir / TOKEN_USAGE_REL

    if not usage_path.is_file():
        return {
            "issues": [],
            "window_start": None,
            "window_end": None,
            "generated": None,
            "sources": [],
            "prices": {"retrieved": prices.get("retrieved"), "source": prices.get("source"), "unpriced_models": []},
            "warning": "no token data",
            "milestone_caption": None,
        }

    rows, read_warning = _read_token_usage_lines(usage_path)

    # (issue, role) -> {counter: total, "_cost": float, "_unpriced": bool}
    buckets: Dict[Tuple[str, str], Dict[str, Any]] = {}
    sources: Set[str] = set()
    unpriced_models: Set[str] = set()
    window_start: Optional[str] = None
    window_end: Optional[str] = None
    generated: Optional[str] = None

    for row in rows:
        issue = row.get("issue")
        role = row.get("role")
        model = row.get("model")
        if not issue or not role:
            continue  # malformed row -- degrade this one contribution, not the endpoint

        if row.get("source"):
            sources.add(row["source"])
        ws, we, gen = row.get("window_start"), row.get("window_end"), row.get("generated")
        if ws and (window_start is None or ws < window_start):
            window_start = ws
        if we and (window_end is None or we > window_end):
            window_end = we
        if gen and (generated is None or gen > generated):
            generated = gen

        acc = buckets.setdefault((issue, role), {c: 0 for c in _TOKEN_COUNTERS})
        for c in _TOKEN_COUNTERS:
            acc[c] += row.get(c, 0) or 0

        rate = models.get(model)
        if rate is None:
            if model:
                unpriced_models.add(model)
            acc["_unpriced"] = True
        else:
            acc["_cost"] = acc.get("_cost", 0.0) + _row_cost_usd(row, rate)

    # Per-issue raw (unrounded) cost is tracked SEPARATELY from each
    # role's own rounded, displayed cost_usd -- summing already-rounded
    # cents across N roles compounds rounding error (observed: a penny
    # off the architect's own hand-computed example). The total is the
    # sum of RAW per-role costs, rounded once, never a re-sum of already
    # -rounded role values.
    per_issue: Dict[str, List[Dict[str, Any]]] = {}
    raw_issue_cost: Dict[str, float] = {}
    issue_any_unpriced: Dict[str, bool] = {}
    for (issue, role), acc in buckets.items():
        unpriced = bool(acc.get("_unpriced"))
        role_entry = {c: acc[c] for c in _TOKEN_COUNTERS}
        role_entry["role"] = role
        role_entry["cost_usd"] = None if unpriced else round(acc.get("_cost", 0.0), 2)
        per_issue.setdefault(issue, []).append(role_entry)
        issue_any_unpriced[issue] = issue_any_unpriced.get(issue, False) or unpriced
        if not unpriced:
            raw_issue_cost[issue] = raw_issue_cost.get(issue, 0.0) + acc.get("_cost", 0.0)

    # PT-102 (amended ruling, ccd4f48/bd45b78): the chronological chart's
    # sort key -- REUSE the throughput chart's own status->done detection
    # via the MEMOIZED `build_flow_payload` wrapper, never
    # `_compute_flow_payload` directly (a wrapper-bypass costs a full git
    # walk on every poll and produces byte-identical output, so nothing
    # else here would catch it). `build_flow_payload` never raises --
    # git-unavailable degrades to its own warning shape with an empty
    # `closed_at` map, which this payload's "never raises" contract
    # inherits for free.
    closed_at_by_issue = build_flow_payload(data_dir).get("closed_at") or {}

    issues_out: List[Dict[str, Any]] = []
    for issue, role_entries in per_issue.items():
        # Role order: no order ruled for the payload -- sorted by name
        # for a deterministic response (this codebase's standing
        # convention for anything serialised to disk or over the wire;
        # PT-77 §1, PT-61's series order).
        role_entries.sort(key=lambda r: r["role"])
        total = {c: sum(r[c] for r in role_entries) for c in _TOKEN_COUNTERS}
        total["cost_usd"] = None if issue_any_unpriced[issue] else round(raw_issue_cost.get(issue, 0.0), 2)
        issues_out.append({
            "issue": issue,
            "kind": _token_bucket_kind(issue),
            "total": total,
            "roles": role_entries,
            "closed_at": closed_at_by_issue.get(issue),
        })

    # PT-84 §7: `milestone_windows` (this module) built ONCE per payload
    # build, never per bucket -- same "once, not per record" discipline
    # as the receiver's flush-time table. `_repo_root_for` (already used
    # by `build_roster_payload` above) derives the true git worktree root
    # from `data_dir`; `milestone_windows` itself needs that ROOT, never
    # `data_dir`, because its own git pathspecs are computed relative to
    # it (see that function's docstring). Caught broadly, not just
    # `MilestoneWindowError`: this payload's own contract is "never
    # raises" (a missing/corrupt metrics file already degrades rather
    # than 500s), and a milestone-ordering failure is strictly less
    # essential than the token totals themselves -- degrades to an empty
    # rank map, which `milestone_rank_map` itself already defines as
    # "every milestone bucket falls back to rank 0" (stable-sort/
    # insertion order among milestones, not creation-time order, but
    # still deterministic and never a 500).
    try:
        milestone_windows_table = milestone_windows(_repo_root_for(data_dir))
    except Exception:
        milestone_windows_table = []
    rank_map = milestone_rank_map(milestone_windows_table)

    # Issue order: numeric ascending, then milestone buckets by their own
    # CREATION timestamp (never string compare -- `PT-0.10` sorts before
    # `PT-0.5` lexicographically), then `main` last -- PT-77's own
    # `_sort_key` convention for the underlying data file (§6), mirrored
    # here for the aggregated payload for the same determinism reason,
    # and because the ruling's §4 renders `main` "last, visually muted"
    # and §6 ranks milestone buckets between issues and `main`.
    def _issue_sort_key(entry: Dict[str, Any]) -> Tuple[int, int]:
        iid = entry["issue"]
        if entry["kind"] == "milestone":
            milestone_id = iid[len("milestone:"):]
            return (1, rank_map.get(milestone_id, 0))
        m = re.match(r"^[A-Za-z]+-(\d+)$", iid)
        if iid == "main" or not m:
            return (2, 0)
        return (0, int(m.group(1)))

    issues_out.sort(key=_issue_sort_key)

    # Architect's review of 3aa09e8 (4f7fafc): a missing/malformed
    # prices.json must surface as a top-level warning too, not just via
    # `unpriced_models` -- team-lead's call to honour the addendum
    # literally rather than amend it. Keyed on an EMPTY `models` dict,
    # not on `source` being falsy: `load_prices`'s own missing-file
    # fallback has both empty, but a price table that is technically
    # present yet defines rates for zero models (a caller-injected
    # prices= in a test, or a real file trimmed to nothing) is exactly
    # as unusable and must warn the same way. Combined with a
    # malformed-line warning, not overwritten by it -- both are real,
    # independent facts about this response.
    warnings = [w for w in (read_warning, None if models else "no price table found") if w]
    combined_warning = "; ".join(warnings) if warnings else None

    # §7: "caption explains what they are in one clause" -- present only
    # when the payload actually carries a milestone bucket (nothing to
    # explain otherwise), same "field appears only when relevant"
    # convention as `warning`/`unpriced_models`. One clause, no period-
    # separated second sentence, so a client can drop it inline without
    # sounding like two unrelated statements.
    milestone_caption = (
        "Milestone bars are main-branch work — filing, releases, between-loop "
        "planning — attributed to whichever milestone was active at the time, "
        "not to any single issue."
        if any(entry["kind"] == "milestone" for entry in issues_out)
        else None
    )

    return {
        "issues": issues_out,
        "window_start": window_start,
        "window_end": window_end,
        "generated": generated,
        "sources": sorted(sources),
        "prices": {
            "retrieved": prices.get("retrieved"),
            "source": prices.get("source"),
            "unpriced_models": sorted(unpriced_models),
        },
        "warning": combined_warning,
        "milestone_caption": milestone_caption,
    }


def _tokens_cache_key(usage_path: Path) -> Optional[Tuple[int, int]]:
    try:
        st = usage_path.stat()
    except OSError:
        return None
    return (st.st_mtime_ns, st.st_size)


def build_tokens_payload_cached(data_dir: Path) -> Dict[str, Any]:
    """Memoized wrapper (PT-79 ruling § 2): keyed on the metrics file's
    own `(mtime_ns, size)`, same bounded-dict/insertion-order-eviction
    shape as `_FLOW_CACHE`. A `None` cache key (file absent or
    unreadable) always recomputes -- the "no token data" warning payload
    is cheap enough that memoizing it buys nothing, and would need its
    own invalidation story once the file is later created.
    """
    data_dir = Path(data_dir)
    usage_path = data_dir / TOKEN_USAGE_REL
    cache_key = _tokens_cache_key(usage_path)
    dir_key = str(data_dir)
    if cache_key is not None:
        cached = _TOKENS_CACHE.get(dir_key)
        if cached is not None and cached[0] == cache_key:
            return cached[1]

    payload = build_tokens_payload(data_dir)

    if cache_key is not None:
        if dir_key not in _TOKENS_CACHE and len(_TOKENS_CACHE) >= _TOKENS_CACHE_MAX:
            _TOKENS_CACHE.pop(next(iter(_TOKENS_CACHE)))
        _TOKENS_CACHE[dir_key] = (cache_key, payload)
    return payload
