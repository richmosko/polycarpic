#!/usr/bin/env python3
"""otel_receiver.py — PT-78: the ongoing local OTLP receiver for Claude
Code's own token/cost telemetry, appended to the same committed data file
PT-77's one-time backfill writes.

Design pinned by the architect's gating ruling (process/cairn/issues/PT-78.md,
"@architect — 2026-09-03") and the addendum that names the concrete
implementation surface (module seams, CLI flags, the settings.json block,
the hook line, the 12-key allow-list verbatim) — those comments are the
tie-breaker for "why does it do X"; this docstring is the map from ruling
section to code.

What it is: a separate, long-lived local HTTP server (NOT inside `cairn
serve` — the board dies on `/exit` and telemetry that only records while
someone has the board open would silently under-report). Started
idempotently by the `SessionStart` hook via `--ensure-running` (pidfile +
a listen probe; a second start is a no-op, never an error). Accepts
OTLP-over-`http/json` POST /v1/metrics, decodes `claude_code.token.usage`,
counts it correctly under either DELTA or CUMULATIVE aggregation
temporality (group by (series, startTimeUnixNano), max within a group,
sum across groups, kept in memory only — a receiver restart starts
fresh, on purpose), attributes each contribution to an issue (branch
first, `cairn.issue` only as a fallback when the branch is `main`) and a
role (`agent.name` normalised through PT-77's own roster-anchored
function, else a `query_source`-keyed table with a LOUD
`subagent-unattributed` guard rather than a silent `team-lead` fold —
NOTE: role attribution is flagged for an architect amendment replacing
this table with a session.id -> transcript lookup; this module keeps the
table-based rule until that amendment sha lands, since no test currently
pins a different behaviour), and appends token-count-only lines to
`process/cairn/metrics/token-usage.jsonl` under PT-77's own file lock —
`source: "otel"`, twelve keys, an allow-list not a deny-list, so a future
Claude Code export version that adds a new identifying attribute is
dropped by default rather than persisted until someone notices.

Never persists: `session.id` (held in memory only, as the series key),
`user.email`/`user.id`/`user.account_id`/`user.account_uuid`/
`organization.id`/`terminal.type`/`effort`, or `claude_code.cost.usage`
(dollars are recomputed from tokens later, by PT-79, from the same dated
price table for both sources). No prompts, no message bodies, no tool
output ever reach this process at all: `OTEL_LOGS_EXPORTER=none` and
`OTEL_LOG_RAW_API_BODIES` unset are enforced by the `.claude/settings.json`
env block this ticket ships (documented in process/TRACKER.md, absent
from the file until `/setup-tracker` opts a project in), not by this
script — the logs stream is where that content would ride; this receiver
only ever speaks metrics.

Module seams (addendum: "tests must not need a socket" — every counting/
privacy/attribution assertion goes through these three, pure, functions;
the HTTP server is a thin shell over them):

    parse_export(payload: dict) -> List[dict]
        OTLP-JSON -> flat datapoint records. Applies the 5-key attribute
        allow-list (agent.name, model, query_source, cairn.issue, type)
        immediately; `session.id` is carried separately, INSIDE each
        record's `series_key`, and never appears as its own field.
        Raises ReceiverError on a structurally invalid top level (no
        `resourceMetrics` list) -- malformed inner shapes are skipped,
        not fatal.
    fold(datapoints: List[dict], state: ReceiverState) -> ReceiverState
        The (series, startTimeUnixNano) grouping. Mutates and returns
        `state`.
    flush(state, out_path, issue, generated) -> List[dict]
        Computes each series' delta since its last-flushed baseline,
        buckets by (issue, role, model), and appends the resulting
        `source: "otel"` lines under `process/cairn/metrics/.lock`.
        Returns the lines written (empty list, no write at all, if
        nothing had accrued). Raises ReceiverError on the non-overlap
        invariant (an otel line predating the latest transcript-backfill
        `generated`) or a malformed existing data file -- nothing
        partial is ever written.

CLI:
    python3 scripts/cairn/otel_receiver.py [--port N] [--out-file PATH]
        [--flush-interval SECONDS] [--pidfile PATH]
        [--ingest PATH|-] [--once]
        [--ensure-running [--session-id ID --session-pid PID]]
        [--session-ended ID] [--grace-period-seconds N]
        [--status] [--flush-now] [--stop]

    No flag (bare invocation)  -- runs the long-lived HTTP server in the
        foreground: binds --port, writes --pidfile, flushes on SIGUSR1
        (--flush-now's target), flushes and exits cleanly on SIGTERM/
        SIGINT (--stop's target), and otherwise at most every
        --flush-interval seconds or when the attributed issue changes.
    --ingest PATH|-  -- read one OTLP-JSON payload from a file (or stdin
        with `-`), fold it, flush, exit. Binds no port -- the main test
        seam.
    --once  -- bind --port, accept exactly one POST /v1/metrics, flush,
        exit. The one integration test that touches a socket.
    --ensure-running  -- start a detached long-lived instance if the
        pidfile is stale/absent and nothing is listening; exit 0 either
        way, never an error (what the SessionStart hook calls). PT-81
        (H1-H3): declines quietly (returns False, spawns nothing) when
        `CLAUDE_CODE_ENABLE_TELEMETRY` isn't truthy in its own
        environment, or when `otel_port` disagrees with the port in its
        own inherited `OTEL_EXPORTER_OTLP_ENDPOINT` (naming both);
        distinguishes "another process already holds the port" from "we
        spawned a child but it never came up" (naming the port and
        `otel_port` either way) rather than reporting success either way.
        The hook still exits 0 regardless -- a SessionStart hook must
        never fail a session over telemetry -- but now lets stderr
        through instead of swallowing it, so these messages are visible.
        PT-86: paired with `--session-id ID --session-pid PID` (both, or
        neither -- a bare call, what every pre-PT-86 caller still does,
        registers nothing), registers ID as a live session (see "Session
        lifecycle" below) once the receiver is confirmed up, new spawn or
        already-running alike.
    --session-ended ID  -- PT-86, the SessionEnd hook's target: deregister
        ID, reap any OTHER recorded session whose pid has since died (the
        crash backstop), and ping the daemon to re-evaluate whether it
        should start its grace-shutdown countdown. No daemon running ->
        no-op, exit 0 -- same discipline as --ensure-running, since a
        SessionEnd hook must not fail session teardown either, and (per
        Claude Code's own hook contract) cannot block it regardless: this
        call never waits on the grace period itself, only the daemon does.
    --grace-period-seconds N  -- (bare/serve invocation; default 10)
        threaded through `--ensure-running`'s spawn args when it starts a
        FRESH daemon. See "Session lifecycle" below.
    --status  -- print whether a receiver is running, its port, and its
        --out-file, then exit 0 if running / 1 if not (a caller-facing
        health check, not what the hook itself calls). PT-86: also prints
        `sessions: N` and one `session <id>: alive|dead` line per
        RECORDED id (sorted, freshly probed, never mutating -- only
        --session-ended and a flush actually reap a dead entry).
    --flush-now / --stop  -- signal a running instance (SIGUSR1 / SIGTERM)
        via its pidfile.

Session lifecycle (PT-86, process/cairn/issues/PT-86.md, architect's
    addendum): the receiver stops itself when the LAST session on the
    repo ends, only after the exporter's final flush has had a grace
    window to land -- see `_sessions_dir`'s own docstring for the
    on-disk shape (one small file per session, no cross-process lock
    needed) and `serve`'s watchdog block for the state machine. In
    short: `--ensure-running`/`--session-ended` mutate the session-file
    directory directly (fast, synchronous, since a SessionEnd hook
    cannot block session teardown -- neither call ever waits on the
    grace period itself); `--session-ended` additionally sends SIGUSR2
    as a latency-only nudge (never load-bearing for correctness) so the
    daemon's watchdog thread re-evaluates and reaps dead siblings
    (addendum §3, "on every end event") sooner than its own
    WATCHDOG_TICK_SECONDS poll would. The watchdog arms a
    `--grace-period-seconds` deadline the first time it observes an
    empty registry that was previously non-empty, clears it on any tick
    that finds the registry non-empty again, and once the deadline has
    passed with the registry still empty (one more fresh probe first),
    runs the addendum §B two-flag `.closing` point-of-no-return protocol
    -- a session racing to register in that exact window still cancels
    the shutdown -- then closes the socket, does the final flush,
    compare-and-deletes the pidfile, and exits.

    --out-file and the config-derived prefix/port are resolved from the
    REPO ROOT (this script's own on-disk location), never from
    `Path.cwd()` -- PT-77's blocking defect and PT-80 exist because of
    exactly that mistake, and `cairn.load_config` now raises rather than
    silently defaulting, so this module leans on it. The repo's CURRENT
    BRANCH is a different query, deliberately NOT anchored the same way:
    OTel carries no branch attribute at all, so the receiver asks git
    *right now*, wherever the process happens to be running -- `git
    rev-parse --abbrev-ref HEAD` with no `-C`, inheriting the caller's
    own cwd (the SessionStart hook's cwd is the repo root at session
    start; a test can point cwd at a throwaway repo to control the
    branch signal without needing a --branch flag this design has no use
    for otherwise).
"""
from __future__ import annotations

import argparse
import datetime
import gzip
import http.server
import json
import os
import select
import signal
import socket
import socketserver
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Dict, FrozenSet, List, Optional, Set, Tuple
from urllib.parse import urlparse

import cairn
import backfill_tokens
import worktree_root

SOURCE_NAME = "otel"
DEFAULT_OTEL_PORT = 4318
DEFAULT_FLUSH_INTERVAL_SECONDS = 30 * 60  # ruling §7: "at most every 30 minutes"
PIDFILE_REL = Path("process") / "cairn" / "metrics" / ".receiver.pid"
LOGFILE_REL = Path("process") / "cairn" / "metrics" / "otel_receiver.log"

# PT-86: the last-session-ends-the-daemon-stops-itself lifecycle. Design
# per process/cairn/issues/PT-86.md's architect addendum ("@architect --
# 2026-09-04", the second comment, which withdraws and replaces the
# first ruling's HTTP `/control/session` endpoint in favor of a file-per-
# session registry) -- see `_sessions_dir` and `serve`'s watchdog block.
SESSIONS_DIRNAME = ".sessions"
CLOSING_MARKER_NAME = ".closing"
# Architect review (ef000d5), Delta 6: written by `serve` at startup,
# inside `_sessions_dir` (zero new .gitignore surface -- the directory
# is already covered end-to-end, and the existing dotfile filter in
# `live_session_ids` already skips it the same way it skips
# CLOSING_MARKER_NAME). Its PRESENCE is the only thing that matters --
# `_nudge_daemon` only sends SIGUSR2 when it's there, so a receiver
# started before this change (no SIGUSR2 handler at all -- an unhandled
# SIGUSR2 terminates a Python process outright) is never signalled.
NUDGE_CAPABLE_MARKER_NAME = ".nudge-capable"
# Written once at daemon startup, inside `_sessions_dir`, same pattern as
# NUDGE_CAPABLE_MARKER_NAME. POLY-49 ruling §4 withdrew the two-signal
# (pid + transcript-staleness) reap predicate this marker used to feed
# `--status`'s now-removed `dead`/`dead-pending` distinction; kept as a
# marker daemons still write (harmless, and other tooling may read it to
# find the daemon's own resolved transcripts dir), even though `--status`
# no longer reads it back for liveness labelling.
TRANSCRIPTS_DIR_MARKER_NAME = ".transcripts-dir"
DEFAULT_GRACE_PERIOD_SECONDS = 10.0  # addendum §D: default 10s
WATCHDOG_TICK_SECONDS = 0.2  # addendum §4: "ticks <= 0.25 s"
# POLY-49 ruling §4: "Liveness = pid, every tick" -- `_tick` now reaps
# unconditionally, every WATCHDOG_TICK_SECONDS beat, with the pid-only
# predicate, so a dead entry no longer needs a THIRD, slower, time-based
# backstop trigger the way the old nudge-gated reap did. `--periodic-
# reap-seconds` (and this default) stay accepted on the CLI for
# back-compat with any caller/spawn-argv still passing them, but have no
# effect any more.
DEFAULT_PERIODIC_REAP_SECONDS = 5 * 60
# POLY-10 gate-1 ruling (a).3: an absent `.sessions/` dir is *unknown*,
# never *empty* -- the watchdog holds (no lifecycle change) for as long as
# the dir is gone, then recreates it once it has been absent at least this
# long, rather than holding forever on a dir some OTHER process (not
# `ensure_metrics_worktree.py`'s bounded swap) deleted outright. Overridable
# via `--registry-absent-recreate-seconds` / a `serve()` test kwarg, same
# shape as `--grace-period-seconds`/`--periodic-reap-seconds`.
REGISTRY_ABSENT_RECREATE_SECONDS = 60.0
# POLY-10 (b): the watchdog's own liveness marker, throttled to one write
# per second, skipped silently while `.sessions/` is absent (nothing to
# write it into). `--status` reads its mtime (not its content -- the
# content is an ISO timestamp for a human to read, but freshness is judged
# by the file's own age, which is what a swap/rename/utime can actually
# simulate in a test without racing the watchdog's own write cadence).
WATCHDOG_HEARTBEAT_MARKER_NAME = ".watchdog-heartbeat"
WATCHDOG_HEARTBEAT_WRITE_INTERVAL_SECONDS = 1.0
WATCHDOG_HEARTBEAT_ALIVE_SECONDS = 5.0  # ruling (b): "alive iff heartbeat age <= 5s"
# POLY-10 (b): written by `_do_flush` on every flush, including a no-op or
# refused one (proves the flush path itself ran) -- content is
# "<iso> <lines>", read back and reformatted by `--status`.
LAST_FLUSH_MARKER_NAME = ".last-flush"
# Addendum: the allow-list, verbatim -- every OTLP attribute NOT one of
# these five is dropped before it reaches memory beyond the series key.
_ATTR_ALLOW_LIST = ("agent.name", "model", "query_source", "cairn.issue", "type")

# Addendum: exact mapping, measured -- these four `type` values only.
_TYPE_TO_COUNTER = {
    "input": "input",
    "cacheCreation": "cache_write",
    "cacheRead": "cache_read",
    "output": "output",
}

_METRIC_NAME = "claude_code.token.usage"

# Addendum: the 12-key allow-list, verbatim order -- implemented as a
# literal tuple the writer iterates, NOT "the incoming dict minus a
# deny-list" (that phrasing is the addendum's own instruction).
_OUTPUT_KEY_ORDER = (
    "source", "generated", "window_start", "window_end",
    "issue", "role", "model", "input", "cache_write", "cache_read", "output", "records",
)


class ReceiverError(Exception):
    """Raised on a malformed existing data file or a structurally
    invalid OTLP payload -- same fail-loudly contract as
    backfill_tokens.BackfillError. Deliberately a distinct class: a
    receiver failure and a backfill failure are different callers'
    problems. NOT raised for the non-overlap case any more (PT-89):
    a group predating or straddling the backfill's `generated` stamp is
    dropped and logged, never refused as a whole-batch error -- see
    `flush`'s own docstring."""


# --------------------------------------------------------------------------
# OTLP/JSON decoding -- structure measured against a real local capture,
# 2026-09-03/04: resourceMetrics[].scopeMetrics[].metrics[].sum.dataPoints[].
# --------------------------------------------------------------------------

def decode_otlp_json(body: bytes, content_encoding: Optional[str]) -> Dict[str, Any]:
    """Handles `Content-Encoding: gzip` even though the measured exporter
    didn't use it -- protocol-legal, one branch. Raises ReceiverError on
    anything that isn't valid JSON after decompression."""
    if content_encoding and "gzip" in content_encoding.lower():
        try:
            body = gzip.decompress(body)
        except OSError as e:
            raise ReceiverError(f"malformed gzip OTLP body: {e}")
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise ReceiverError(f"malformed OTLP JSON body: {e}")


def _flatten_attrs(attr_list: Any) -> Dict[str, str]:
    """OTLP/JSON's `[{"key": k, "value": {"stringValue": v}}, ...]` shape
    -> a plain `{k: v}` dict restricted to `_ATTR_ALLOW_LIST` -- the
    earliest possible point to drop everything else, per the ruling's
    allow-list-not-deny-list instruction."""
    out: Dict[str, str] = {}
    if not isinstance(attr_list, list):
        return out
    for entry in attr_list:
        if not isinstance(entry, dict):
            continue
        key = entry.get("key")
        if key not in _ATTR_ALLOW_LIST:
            continue
        value = entry.get("value")
        if not isinstance(value, dict):
            continue
        for vkey in ("stringValue", "intValue", "doubleValue", "boolValue"):
            if vkey in value:
                out[key] = str(value[vkey])
                break
    return out


def _session_id(attr_list: Any) -> Optional[str]:
    """Read directly from the RAW attribute list -- deliberately never
    routed through `_flatten_attrs` (`session.id` is not in
    `_ATTR_ALLOW_LIST`), so it can never accidentally end up in a
    persisted field. Used only as part of an in-memory series key."""
    if not isinstance(attr_list, list):
        return None
    for entry in attr_list:
        if isinstance(entry, dict) and entry.get("key") == "session.id":
            v = entry.get("value") or {}
            return v.get("stringValue")
    return None


def _point_value(dp: Dict[str, Any]) -> Optional[float]:
    """OTLP/JSON int64 fields are transported as a JSON STRING (`asInt`)
    to avoid precision loss; `asDouble` is a plain JSON number. Both are
    observed in real captures, so both are handled. `None` (not a raise)
    when neither is present -- an inner malformed datapoint is skipped by
    the caller, not fatal to the whole payload."""
    if "asInt" in dp:
        try:
            return float(dp["asInt"])
        except (TypeError, ValueError):
            return None
    if "asDouble" in dp:
        try:
            return float(dp["asDouble"])
        except (TypeError, ValueError):
            return None
    return None


def _point_time_ns(dp: Dict[str, Any]) -> Optional[int]:
    raw = dp.get("timeUnixNano") or dp.get("startTimeUnixNano")
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _ns_to_date(ns: int) -> str:
    return datetime.datetime.fromtimestamp(ns / 1e9, tz=datetime.timezone.utc).date().isoformat()


def _ns_to_iso(ns: int) -> str:
    return datetime.datetime.fromtimestamp(ns / 1e9, tz=datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _iso_to_ns(iso: str) -> Optional[int]:
    """PT-89 §3: converts a `generated`-shaped whole-second UTC `Z`
    timestamp to nanoseconds since epoch, at the START of that second --
    `generated` never carries a fractional part (`_now_iso`'s own
    format), so there is nothing to truncate; this is the inverse of
    `_ns_to_iso`. Integer arithmetic throughout (seconds, then * 1e9) to
    avoid float rounding drift a naive `timestamp() * 1e9` could
    introduce. `None` on anything that doesn't parse -- the caller's
    signal that no stamp is available, degrading to "no guard active"
    exactly like a missing/absent `_latest_backfill_generated`."""
    try:
        dt = datetime.datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
    except (TypeError, ValueError):
        return None
    return int(dt.timestamp()) * 1_000_000_000


# --------------------------------------------------------------------------
# parse_export / fold -- the two pure, socket-free seams.
# --------------------------------------------------------------------------

SeriesKey = FrozenSet[Tuple[str, str]]


def parse_export(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """OTLP-JSON -> a flat list of datapoint records. Raises ReceiverError
    when the TOP-LEVEL shape isn't recognisable as an OTLP export at all
    (no `resourceMetrics` list) -- a payload that superficially looks
    like OTLP but has an inner malformed metric/dataPoint is tolerated by
    skipping just that item, not by failing the whole payload; the two
    are different failure classes (a caller sending the wrong THING
    entirely vs. one bad point in an otherwise-good export).
    """
    if not isinstance(payload, dict) or not isinstance(payload.get("resourceMetrics"), list):
        raise ReceiverError("malformed OTLP payload: missing or non-list 'resourceMetrics'")

    datapoints: List[Dict[str, Any]] = []
    for rm in payload["resourceMetrics"]:
        if not isinstance(rm, dict):
            continue
        # Amendment A (25d7a42): one dict per datapoint = resource
        # attributes overlaid by that datapoint's own attributes,
        # DATAPOINT WINNING on conflict -- measured today Claude Code
        # copies every resource attribute down onto each datapoint
        # (cairn.issue included), so this is a no-op in practice, not a
        # real conflict resolution. It matters for a silent-degradation
        # path: if a future export ever stops duplicating `cairn.issue`
        # onto datapoints, reading resource-level attributes here is what
        # keeps the `main`-branch fallback from silently losing its hint.
        # `_flatten_attrs` already applies `_ATTR_ALLOW_LIST`, so merging
        # resource attrs in can never widen what gets persisted --
        # resource-only host.arch/os.*/service.* are dropped at the same
        # gate identity attributes already are.
        resource_attrs = _flatten_attrs((rm.get("resource") or {}).get("attributes"))
        for sm in rm.get("scopeMetrics") or []:
            if not isinstance(sm, dict):
                continue
            for metric in sm.get("metrics") or []:
                if not isinstance(metric, dict) or metric.get("name") != _METRIC_NAME:
                    continue
                for dp in ((metric.get("sum") or {}).get("dataPoints")) or []:
                    if not isinstance(dp, dict):
                        continue
                    record = _parse_datapoint(dp, resource_attrs)
                    if record is not None:
                        datapoints.append(record)
    return datapoints


def _parse_datapoint(dp: Dict[str, Any], resource_attrs: Optional[Dict[str, str]] = None) -> Optional[Dict[str, Any]]:
    attrs = {**(resource_attrs or {}), **_flatten_attrs(dp.get("attributes"))}
    counter_type = attrs.get("type")
    if counter_type not in _TYPE_TO_COUNTER:
        return None  # not one of the four measured values -- not our metric shape

    try:
        start_ns = int(dp.get("startTimeUnixNano"))
    except (TypeError, ValueError):
        return None  # can't group without it -- drop the point rather than guess

    value = _point_value(dp)
    if value is None:
        return None

    session_id = _session_id(dp.get("attributes"))
    series_key: SeriesKey = frozenset(attrs.items()) | ({("session.id", session_id)} if session_id else set())
    point_ns = _point_time_ns(dp)

    return {
        "series_key": series_key,
        "start_time_ns": start_ns,
        "time_ns": point_ns if point_ns is not None else start_ns,
        "value": value,
        "counter": _TYPE_TO_COUNTER[counter_type],
        "model": attrs.get("model") or "unknown",
        "role_raw": attrs.get("agent.name"),
        "session_id": session_id,
        "cairn_issue": attrs.get("cairn.issue"),
    }


class ReceiverState:
    """The in-memory accumulator. Everything here is lost on process
    restart -- deliberately ("baseline on first sight"): the alternative
    (persisting per-session baselines) would mean persisting
    `session.id`, which the privacy ruling forbids outright."""

    def __init__(self) -> None:
        # (series_key, start_time_ns) -> max value ever seen for that
        # EXACT group -- idempotent against a retried/duplicated
        # delivery, correct under delta (each window is its own group,
        # max-then-sum reduces to plain sum) and under cumulative (every
        # point of a series shares one start time, the max is the final
        # running total, counted once).
        self.group_max: Dict[Tuple[SeriesKey, int], float] = {}
        # series_key -> the attribution inputs for that series (captured
        # once, at first sight -- they don't change mid-series).
        self.series_meta: Dict[SeriesKey, Dict[str, Optional[str]]] = {}
        # (series_key, start_time_ns) -> the total already CONTRIBUTED to
        # some prior flush, keyed PER GROUP (PT-89, architect's ruling
        # 5208f32) -- the SAME key `group_max` uses, not per series. The
        # next flush's contribution for a given group is (that group's
        # current total) - (this baseline), never the full total again.
        # Keyed per-group rather than per-series specifically so a
        # dropped/straddling group's baseline can advance WITHOUT writing
        # its delta (the backfill already counted that value) while a
        # DIFFERENT group of the same series keeps flushing normally --
        # advancing the baseline is what prevents that dropped value from
        # being resurrected once the group's later, clean data arrives.
        self.flushed_baseline: Dict[Tuple[SeriesKey, int], float] = {}
        # (series_key, start_time_ns) -> (min_time_ns, max_time_ns) for
        # datapoints folded SINCE THE LAST FLUSH (PT-89) -- reset to
        # empty at the end of every flush, exactly like pending_min_ns/
        # pending_max_ns below, so a group's classification against the
        # backfill's stamp always reflects only its most recent window,
        # never its whole lifetime (architect's correction, 5208f32:
        # lifetime-persistent bounds would make one collision permanently
        # exclude a long-running cumulative series from every future
        # flush, which is not the bounded loss PT-89 promises).
        self.group_time_bounds: Dict[Tuple[SeriesKey, int], Tuple[int, int]] = {}
        # Earliest/latest datapoint timeUnixNano seen since the LAST
        # flush (reset after each flush) -- used only as the "did
        # anything accrue at all" cheap check in flush(); window_start/
        # window_end and the non-overlap classification key on
        # group_time_bounds instead (PT-89), not on these two directly.
        self.pending_min_ns: Optional[int] = None
        self.pending_max_ns: Optional[int] = None
        self.last_issue_bucket: Optional[str] = None
        self.last_flush_monotonic: float = time.monotonic()
        self.lock = threading.RLock()
        # session_id -> resolved role (amendment B). Cached for the
        # receiver's LIFETIME once resolved -- but a "no transcript file
        # at all" result is never cached (see `_resolve_role_from_session`):
        # a session's transcript appears on its first turn, so a miss
        # must retry on the next datapoint, not pin an early false guard.
        self.role_cache: Dict[str, str] = {}
        # POLY-49 ruling §1.2: the foreign-session filter -- since the
        # exporter's endpoint is now user-global (M7: >= 2.1.282 only
        # reads OTEL_* from the user's own settings.json), EVERY project
        # on the machine with telemetry on posts to the SAME :4318, a
        # PT-79-class contamination risk. `known_sessions` is a POSITIVE-
        # ONLY cache (a session confirmed to have a transcript in THIS
        # repo, for the receiver's lifetime) -- a miss is never cached
        # (same reasoning as `role_cache`: a session's transcript appears
        # on its first turn, so a too-early miss must retry on the next
        # datapoint, not pin a false "foreign" verdict forever).
        self.known_sessions: Set[str] = set()
        # Datapoints/sessions dropped by the filter SINCE THE LAST FLUSH
        # (reset there, alongside pending_min_ns/max_ns) -- counts only,
        # reported as one stderr line per flush that dropped anything;
        # never persisted, never named by session id.
        self.foreign_dropped_datapoints: int = 0
        self.foreign_dropped_sessions: Set[str] = set()


def fold(datapoints: List[Dict[str, Any]], state: ReceiverState) -> ReceiverState:
    """The (series, startTimeUnixNano) grouping. Thread-safe (the HTTP
    server is threaded -- concurrent teammates export concurrently, the
    normal case for this project's team-agents workflow, not an edge
    case) -- takes `state.lock` itself so both the HTTP handler and a
    test calling this directly get the same guarantee."""
    with state.lock:
        for dp in datapoints:
            group_key = (dp["series_key"], dp["start_time_ns"])
            state.group_max[group_key] = max(dp["value"], state.group_max.get(group_key, float("-inf")))
            state.series_meta.setdefault(dp["series_key"], {
                "role_raw": dp["role_raw"],
                "session_id": dp["session_id"],
                "model": dp["model"],
                "counter": dp["counter"],
                "cairn_issue": dp["cairn_issue"],
            })
            t = dp["time_ns"]
            state.pending_min_ns = t if state.pending_min_ns is None else min(state.pending_min_ns, t)
            state.pending_max_ns = t if state.pending_max_ns is None else max(state.pending_max_ns, t)
            # PT-89: per-group bounds, same loop, same key as group_max.
            bounds = state.group_time_bounds.get(group_key)
            state.group_time_bounds[group_key] = (t, t) if bounds is None else (min(bounds[0], t), max(bounds[1], t))
    return state


# --------------------------------------------------------------------------
# Attribution -- issue (branch-first) and role.
# --------------------------------------------------------------------------

def _current_branch(repo_root: Path) -> Optional[str]:
    """`git -C <repo_root> rev-parse --abbrev-ref HEAD` -- same `-C`
    contract as cairn.py's read_git_state/read_git_tags and
    check_dist_freshness.py's _run_git, never raises. `repo_root` is
    `--repo-root` when given, else this script's own on-disk location
    (`backfill_tokens._repo_root()`) -- CWD-independent by default (the
    PT-77/PT-80 defect class), with `--repo-root` as the explicit,
    test-only override for pointing at a throwaway checkout on a
    controlled branch.
    """
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_root), "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
    except (FileNotFoundError, OSError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def resolve_issue(
    branch: Optional[str], prefix: str, cairn_issue_hint: Optional[str],
    milestone_windows_table: Optional[List[Tuple[str, str]]] = None, at_ts: Optional[str] = None,
) -> str:
    """Branch first (PT-77's exact regex/bucketing function, imported not
    reimplemented), `cairn.issue` only when the branch yields `main`,
    otherwise `main`. One resolution per flush -- every datapoint accrued
    since the last flush is attributed to whatever the checkout is AT
    FLUSH TIME, since git branch carries no per-datapoint signal at all.

    PT-84: when the branch resolves to `main` and there is no
    `cairn_issue_hint` either, the LAST fallback is the milestone active
    at `at_ts` (defaulting to now, i.e. flush time -- the same "AT FLUSH
    TIME" granularity every other resolution here already uses) rather
    than the bare `main` bucket. `milestone_windows_table` is the
    caller's own already-built `cairn.milestone_windows(...)` result
    (§5: built ONCE per flush, by the caller, and reused here AND for
    that same flush's line-sort -- not rebuilt a second time inside this
    function). `None`/empty skips the milestone check entirely, matching
    "no cairn tracker" degrading to `main` everywhere else in this
    module.
    """
    issue_re = backfill_tokens._issue_regex(prefix)
    from_branch = backfill_tokens._bucket_for_branch(branch, prefix, issue_re)
    if from_branch != "main":
        return from_branch
    if cairn_issue_hint:
        return cairn_issue_hint
    if milestone_windows_table:
        milestone_id = cairn.milestone_for_timestamp(at_ts or _now_iso(), milestone_windows_table)
        if milestone_id:
            return f"milestone:{milestone_id}"
    return "main"


# POLY-26 gate-1 ruling §1: `_worktree_transcript_suffix`/`_transcript_
# path_for` (and their cache) moved into `backfill_tokens.py`, the module
# that also owns `_transcript_dir_slug` and now `_worktree_sibling_dirs` --
# one implementation, imported here, never copied. See `backfill_tokens.
# _transcript_path_for` for the lookup contract.


def _resolve_role_from_session(
    session_id: Optional[str], transcripts_dir: Path, roster: Set[str], cache: Dict[str, str]
) -> str:
    """Amendment B (25d7a42): `agent.name` is confirmed absent on
    teammate-shaped processes, so role resolves per `session.id`, once,
    at first sight -- NOT from any OTel attribute. Reads the transcript
    `_transcript_path_for` resolves (POLY-10: the main slug dir OR a
    worktree-sibling dir -- same file `backfill_tokens.py` would scan) via
    the shared `backfill_tokens._scan_header_fields` + `resolve_role_
    from_header` (PT-87, imported not copied -- same reasoning as
    `_normalize_role` before it). File exists with neither field found ->
    `team-lead`. No transcript found anywhere -> `subagent-unattributed`,
    a loud guard: it means no transcript for this session (retention
    pruned it, or it belongs to another project's dir), not "role unknown,
    assume lead".

    PT-87: `agentSetting` (the roster-anchored `subagent_type`, wins
    verbatim when present) is read alongside `agentName` from the SAME
    scan window -- the two fields never share a record (architect's
    ruling §4 amendment: `agentSetting` lives only on `type: "agent-
    setting"` records, `agentName` never does), so the scan cannot
    early-return on `agentName` alone or it would miss a later
    `agentSetting`. Reads exactly those two fields from at most
    `backfill_tokens._ROLE_SCAN_LIMIT` records -- no message content, no
    prompts, no tool output ever reach this function's return value; the
    path is derived per lookup, never stored.
    """
    if not session_id:
        return "subagent-unattributed"
    if session_id in cache:
        return cache[session_id]

    transcript_path = backfill_tokens._transcript_path_for(session_id, transcripts_dir)
    if transcript_path is None:
        return "subagent-unattributed"  # NOT cached -- retry on the next datapoint

    try:
        agent_setting, agent_name = backfill_tokens._scan_header_fields(transcript_path)
    except OSError:
        return "subagent-unattributed"  # vanished mid-read -- NOT cached either

    role = backfill_tokens.resolve_role_from_header(agent_setting, agent_name, roster)
    cache[session_id] = role  # a definitive resolution -- cached for the receiver's lifetime
    return role


def resolve_role(
    role_raw: Optional[str], session_id: Optional[str], transcripts_dir: Path, roster: Set[str], cache: Dict[str, str]
) -> str:
    """`agent.name` on the datapoint itself, when present, wins outright
    (amendment B's own labelled reversal path: "if a future Claude Code
    emits agent.name for teammate processes, prefer the attribute and
    demote this to the fallback" -- one condition). No current fixture
    or real capture sets it, so every real call today falls through to
    the session.id -> transcript lookup.
    """
    if role_raw:
        return backfill_tokens._normalize_role(role_raw, roster)
    return _resolve_role_from_session(session_id, transcripts_dir, roster, cache)


def _issue_hint_from_datapoints(datapoints_or_meta) -> Optional[str]:
    for item in datapoints_or_meta:
        hint = item.get("cairn_issue") if isinstance(item, dict) else None
        if hint:
            return hint
    return None


# --------------------------------------------------------------------------
# flush -- append under PT-77's lock, non-overlap invariant.
# --------------------------------------------------------------------------

def _latest_backfill_generated(out_path: Path) -> Optional[str]:
    """The `generated` of the newest `source: "transcript-backfill"` line
    in the data file, or None if there isn't one yet."""
    if not out_path.exists():
        return None
    latest: Optional[str] = None
    for line in backfill_tokens._read_existing_lines(out_path):
        if line.get("source") == "transcript-backfill":
            gen = line.get("generated")
            if gen and (latest is None or gen > latest):
                latest = gen
    return latest


def flush(
    state: ReceiverState,
    out_path: Path,
    issue: str,
    generated: str,
    roster: Optional[Set[str]] = None,
    transcripts_dir: Optional[Path] = None,
    milestone_windows_table: Optional[List[Tuple[str, str]]] = None,
) -> List[Dict[str, Any]]:
    """Computes each series' delta since its last-flushed baseline,
    buckets by (issue, role, model), and appends the resulting `source:
    "otel"` lines under `process/cairn/metrics/.lock`. Returns the lines
    written (empty list -- and no write at all -- if nothing had accrued
    since the last flush, or if everything that accrued was dropped as
    predating/straddling the backfill's stamp). Never raises for a
    predating/straddling group (PT-89, architect's ruling 0fd8774 +
    5208f32) -- see the per-group classification below; a malformed
    existing data file can still raise via `_latest_backfill_generated`'s
    own reader.

    `issue`/`generated` are resolved by the CALLER (branch/`cairn.issue`
    attribution needs `git`/cwd; this function stays a pure data
    transform otherwise, per the addendum's module-seam split). `roster`/
    `transcripts_dir` default to the real project's values (computed from
    this file's own on-disk location) when omitted -- the CLI always
    passes its own resolved values explicitly instead of relying on this
    fallback, so `--repo-root`/`--transcripts-dir` overrides take effect.
    """
    if roster is None:
        roster = backfill_tokens._roster_names(backfill_tokens._repo_root())
    if transcripts_dir is None:
        repo_root = backfill_tokens._repo_root()
        transcripts_dir = Path.home() / ".claude" / "projects" / backfill_tokens._transcript_dir_slug(repo_root)
    if milestone_windows_table is None:
        milestone_windows_table = cairn.milestone_windows(backfill_tokens._repo_root())

    with state.lock:
        # POLY-49 ruling §1.2: report the foreign-session filter's drops
        # SINCE THE LAST FLUSH, independent of whether anything else
        # accrued (a flush cycle can consist ENTIRELY of foreign-dropped
        # datapoints, e.g. every real session's exports landing on this
        # same user-global port belong to some other project) -- placed
        # before the `pending_min_ns is None` no-op check below so that
        # case still gets reported. Counts only, reset every flush.
        if state.foreign_dropped_datapoints:
            print(
                f"otel_receiver: dropped {state.foreign_dropped_datapoints} datapoint(s) from "
                f"{len(state.foreign_dropped_sessions)} session(s) with no transcript in this repo",
                file=sys.stderr,
            )
            state.foreign_dropped_datapoints = 0
            state.foreign_dropped_sessions = set()

        if state.pending_min_ns is None:
            return []  # nothing accrued since the last flush -- a no-op, not an error

        # PT-89 §5: read once per flush, pass the stamp down -- this
        # walks the whole data file, so per-group or per-datapoint reads
        # would make flush O(groups x file).
        latest_backfill_generated = _latest_backfill_generated(out_path)
        stamp_ns = _iso_to_ns(latest_backfill_generated) if latest_backfill_generated else None

        # PT-89: classify each (series, start_ns) GROUP against the
        # stamp using ITS OWN recent (since-last-flush) time bounds --
        # never the batch-wide earliest datapoint (today's bug: one old
        # datapoint refused everything), never startTimeUnixNano (the
        # architect's §1: that's the metric stream's start, not a
        # datapoint's time, and would drop a long-running cumulative
        # series' entire future). §3's boundary: `time_ns < stamp_ns`
        # predates; a point AT the stamp's own second is kept -- PT-84's
        # own half-open `[start, next)` convention, reused rather than
        # inventing a second boundary rule in this codebase.
        #
        # Baseline is keyed PER GROUP (architect's correction, 5208f32),
        # not per series: a dropped/straddling group's baseline still
        # advances to its current total WITHOUT writing a delta for it --
        # those tokens were already counted by the backfill, so from the
        # receiver's side they count as "handled". Advancing the baseline
        # anyway is what prevents that value from being resurrected once
        # the SAME group's later, clean-of-the-stamp window arrives (the
        # group's own bounds reset every flush, so it recovers naturally).
        kept_deltas: Dict[SeriesKey, float] = {}
        kept_count = 0
        dropped_count = 0
        straddling_count = 0
        kept_min_ns: Optional[int] = None
        kept_max_ns: Optional[int] = None

        for group_key, total in state.group_max.items():
            series_key, _start_ns = group_key
            baseline = state.flushed_baseline.get(group_key, 0.0)
            delta = total - baseline
            if delta <= 0:
                continue  # no new growth for this exact group since it was last accounted for

            bounds = state.group_time_bounds.get(group_key)
            dropped = False
            straddling = False
            if stamp_ns is not None and bounds is not None:
                lo, hi = bounds
                if hi < stamp_ns:
                    dropped = True
                elif lo < stamp_ns:
                    straddling = True
                # else lo >= stamp_ns: entirely after the stamp -- keep.

            if dropped or straddling:
                dropped_count += 1 if dropped else 0
                straddling_count += 1 if straddling else 0
            else:
                kept_deltas[series_key] = kept_deltas.get(series_key, 0.0) + delta
                kept_count += 1
                if bounds is not None:
                    lo, hi = bounds
                    kept_min_ns = lo if kept_min_ns is None else min(kept_min_ns, lo)
                    kept_max_ns = hi if kept_max_ns is None else max(kept_max_ns, hi)

            # Baseline advances for EVERY processed group, kept or not --
            # see the docstring note above on why this is the fix, not a
            # side effect.
            state.flushed_baseline[group_key] = total

        # PT-89 §6: one line per flush, never per datapoint -- only when
        # there is something to report, naming the stamp and all three
        # counts so an operator can tell a routine flush from a lossy one
        # at a glance.
        if dropped_count or straddling_count:
            # Architect's review of c7b0068 (9c7915c): dropped and
            # straddling groups are NOT the same loss and must not share
            # one explanation. A dropped group's tokens were already
            # counted by the backfill -- nothing is actually lost. A
            # straddling group's PRE-stamp portion was also already
            # counted, but its POST-stamp portion was never seen by the
            # backfill and is discarded here anyway, because the group's
            # value is one aggregate that can't be split (§2) -- that
            # portion is real, deliberate data loss, not double-counting
            # avoidance, and the log line is this loss's only visibility.
            explanations = []
            if dropped_count:
                explanations.append("dropped groups' tokens were already counted by the backfill")
            if straddling_count:
                explanations.append(
                    "straddling groups' pre-stamp portion was already counted by the backfill, but "
                    "their post-stamp portion is discarded too -- the group's aggregate value can't "
                    "be split, so that portion is genuinely lost, not merely deduplicated"
                )
            print(
                f"otel_receiver: flush vs backfill stamp {latest_backfill_generated} -- "
                f"kept {kept_count}, dropped {dropped_count}, straddling {straddling_count} group(s) "
                f"({'; '.join(explanations)})",
                file=sys.stderr,
            )

        buckets: Dict[Tuple[str, str, str], Dict[str, float]] = {}
        for series_key, delta in kept_deltas.items():
            meta = state.series_meta[series_key]
            role = resolve_role(meta.get("role_raw"), meta.get("session_id"), transcripts_dir, roster, state.role_cache)
            model = meta.get("model") or "unknown"
            counter = meta["counter"]
            acc = buckets.setdefault(
                (issue, role, model),
                {"input": 0.0, "cache_write": 0.0, "cache_read": 0.0, "output": 0.0, "records": 0},
            )
            acc[counter] += delta
            acc["records"] += 1

        new_lines = []
        if buckets:
            # PT-89 §4: window bounds come from the KEPT groups' own
            # cycle bounds, never the pre-filter pending_min_ns/max_ns --
            # the batch-wide minimum can sit inside a group that was just
            # dropped, which would make the line claim a window earlier
            # than anything it actually contains.
            window_start = _ns_to_date(kept_min_ns)
            window_end = _ns_to_date(kept_max_ns)
            for (b_issue, b_role, b_model), acc in buckets.items():
                line = {
                    "source": SOURCE_NAME,
                    "generated": generated,
                    "window_start": window_start,
                    "window_end": window_end,
                    "issue": b_issue,
                    "role": b_role,
                    "model": b_model,
                    "input": int(round(acc["input"])),
                    "cache_write": int(round(acc["cache_write"])),
                    "cache_read": int(round(acc["cache_read"])),
                    "output": int(round(acc["output"])),
                    "records": int(acc["records"]),
                }
                new_lines.append({k: line[k] for k in _OUTPUT_KEY_ORDER})
            milestone_rank_map = cairn.milestone_rank_map(milestone_windows_table)
            new_lines.sort(key=lambda line: backfill_tokens._sort_key(line, milestone_rank_map))
            _append_lines(out_path, new_lines, milestone_rank_map)

        # PT-89 §4: unconditional reset on every path -- this, not the
        # classification above, is the actual fix. Today's bug is that a
        # refused flush left pending_min_ns/pending_max_ns (and, now,
        # group_time_bounds) untouched, so the next flush recomputed the
        # exact same stale bounds and was refused identically forever.
        state.pending_min_ns = None
        state.pending_max_ns = None
        state.group_time_bounds = {}
        state.last_issue_bucket = issue
        state.last_flush_monotonic = time.monotonic()
        return new_lines


def _append_lines(out_path: Path, new_lines: List[Dict[str, Any]], milestone_rank_map: Optional[Dict[str, int]] = None) -> None:
    """Append-only -- reads every existing line (validated the same way
    backfill_tokens does), keeps ALL of them (never drops a
    `transcript-backfill` line, and never drops a PRIOR `otel` line
    either -- that would be the regenerating-rewrite behaviour `compact`
    below reserves, not the default write path), appends the fresh
    lines, and writes back under the shared lock. `backfill_tokens.
    merge_and_write` is not reused here: that function's contract is
    "drop every line whose source matches mine, then append" -- correct
    for a REGENERATING source (PT-77 re-running from scratch), but it
    would silently delete this receiver's own previously-flushed otel
    lines on every flush, which is exactly the data loss this must avoid.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = out_path.parent / ".lock"
    backfill_tokens._acquire_lock(lock_path)
    try:
        existing = backfill_tokens._read_existing_lines(out_path)
        combined = existing + new_lines
        combined.sort(key=lambda line: backfill_tokens._sort_key(line, milestone_rank_map))
        text = "".join(json.dumps(line) + "\n" for line in combined)
        backfill_tokens._atomic_write_text(out_path, text)
    finally:
        backfill_tokens._release_lock(lock_path)


def compact(out_path: Path, milestone_rank_map: Optional[Dict[str, int]] = None) -> None:
    """May rewrite the receiver's OWN `source: "otel"` lines to coalesce
    same-(issue, role, model) lines by summing -- permitted because these
    lines are additive, and safe because it never touches a
    `transcript-backfill` line. Not called from the per-flush path; a
    separate, occasional operation."""
    lock_path = out_path.parent / ".lock"
    backfill_tokens._acquire_lock(lock_path)
    try:
        existing = backfill_tokens._read_existing_lines(out_path)
        others = [l for l in existing if l.get("source") != SOURCE_NAME]
        mine = [l for l in existing if l.get("source") == SOURCE_NAME]
        coalesced: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
        for line in mine:
            key = (line["issue"], line["role"], line["model"])
            if key not in coalesced:
                coalesced[key] = dict(line)
                continue
            acc = coalesced[key]
            for counter in ("input", "cache_write", "cache_read", "output", "records"):
                acc[counter] = acc.get(counter, 0) + line.get(counter, 0)
            if line["generated"] > acc["generated"]:
                acc["generated"] = line["generated"]
            if line["window_start"] < acc["window_start"]:
                acc["window_start"] = line["window_start"]
            if line["window_end"] > acc["window_end"]:
                acc["window_end"] = line["window_end"]
        combined = others + [{k: v[k] for k in _OUTPUT_KEY_ORDER} for v in coalesced.values()]
        combined.sort(key=lambda line: backfill_tokens._sort_key(line, milestone_rank_map))
        text = "".join(json.dumps(line) + "\n" for line in combined)
        backfill_tokens._atomic_write_text(out_path, text)
    finally:
        backfill_tokens._release_lock(lock_path)


# --------------------------------------------------------------------------
# Config resolution -- repo-root anchored, never Path.cwd().
# --------------------------------------------------------------------------

def _receiver_port(repo_root: Path) -> int:
    """Addendum: `--port` default from config.yml's flat `otel_port` key,
    falling back to 4318. Read directly rather than through
    `cairn.load_config`'s defaulting machinery -- `otel_port` is this
    ticket's own addition, out of that function's existing schema."""
    config_path = repo_root / "process" / "cairn" / "config.yml"
    if not config_path.exists():
        return DEFAULT_OTEL_PORT
    parsed = cairn.parse_yaml_subset(config_path.read_text(encoding="utf-8"))
    port = parsed.get("otel_port")
    return port if isinstance(port, int) else DEFAULT_OTEL_PORT


def _resolve_prefix(repo_root: Path) -> str:
    data_dir = repo_root / "process" / "cairn"
    return cairn.load_config(data_dir)["prefix"]


# --------------------------------------------------------------------------
# Daemon lifecycle -- pidfile, listen probe, detached start, signals.
# --------------------------------------------------------------------------

def _port_is_listening(port: int, host: str = "127.0.0.1", timeout: float = 0.3) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _read_pidfile(pidfile: Path) -> Optional[int]:
    try:
        return int(pidfile.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None


def _pid_is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _compare_and_delete_pidfile(pidfile: Path, expected_pid: int) -> None:
    """Addendum §5: "unlink the pidfile compare-and-delete: read it back,
    delete only if it still holds our own pid" -- applies to EVERY
    shutdown path (`--stop`'s SIGTERM/SIGINT handler, `serve`'s own
    `finally`, and the PT-86 watchdog), not just the new one. As written
    before this ticket, an exiting receiver unconditionally unlinked the
    pidfile, which could delete a SUCCESSOR's pidfile if a new instance
    had already started and written its own pid to the same path in the
    narrow window between this process deciding to exit and actually
    removing the file."""
    if _read_pidfile(pidfile) != expected_pid:
        return
    try:
        pidfile.unlink()
    except OSError:
        pass


def _nudge_daemon(pidfile: Path, kill=os.kill) -> None:
    """PT-86: signals a running receiver (SIGUSR2) to re-evaluate its
    session registry right now instead of waiting for the watchdog's own
    next WATCHDOG_TICK_SECONDS poll -- sent after every
    `register_session`/`deregister_session` so an immediate `--status`
    (or the grace-window cancel/arm decision) reflects the change without
    a polling-latency window. Load-bearing for the on-decrement reap of a
    crashed SIBLING session (see `serve`'s watchdog docstring, and
    architect review Delta 1) -- a missed nudge never delays the stop for
    a clean exit (the registry file is already gone either way), but does
    skip that reap until the next `end` event, flush, or the slow
    periodic sweep (`--periodic-reap-seconds`) picks it up regardless.

    Architect review, Delta 6: gated on a capability marker
    (`NUDGE_CAPABLE_MARKER_NAME`, written by `serve` at startup, inside
    `_sessions_dir`) -- a receiver started before this change has no
    SIGUSR2 handler at all, and a Python process with no handler for a
    signal is TERMINATED by it (measured: exit -31), losing everything
    accrued since its last flush with no final flush at all. No marker
    present is the safe default (assume "maybe an old daemon", stay
    silent) -- the watchdog's own tick still does the work, just up to
    WATCHDOG_TICK_SECONDS later, for any daemon that IS new enough to
    have one.

    `kill` is injectable (default `os.kill`) so a test can assert exactly
    which signal was (or was not) sent without ever signalling a real
    process."""
    pid = _read_pidfile(pidfile)
    if pid is None or not _pid_is_alive(pid):
        return
    marker = _sessions_dir(pidfile) / NUDGE_CAPABLE_MARKER_NAME
    if not marker.exists():
        return
    try:
        kill(pid, signal.SIGUSR2)
    except OSError:
        pass


# --------------------------------------------------------------------------
# PT-86: session bookkeeping -- one small file per live session, named for
# the session id, holding its liveness-probe pid. A SIBLING of the pidfile
# (`_sessions_dir`), not a single JSON registry: two different sessions
# never touch the same path, so register/deregister/reap need no
# cross-process lock at all -- a plain create/read/unlink is already
# atomic enough for this, the same reasoning the pidfile itself already
# relies on.
# --------------------------------------------------------------------------

def _sessions_dir(pidfile: Path) -> Path:
    return pidfile.parent / SESSIONS_DIRNAME


def register_session(sessions_dir: Path, session_id: str, pid: Optional[int]) -> None:
    """Idempotent upsert -- a SessionStart hook firing twice for the same
    session id (shouldn't happen, but never fatal if it does) just
    rewrites the same file with the same content. `pid=None` (addendum
    C: "no usable pid -- record pid: null") is stored as an empty file,
    not the string "None" -- `live_session_ids` must be able to tell
    "no pid captured" apart from "a malformed entry" cheaply."""
    sessions_dir.mkdir(parents=True, exist_ok=True)
    (sessions_dir / session_id).write_text(str(pid) if pid is not None else "", encoding="utf-8")


def deregister_session(sessions_dir: Path, session_id: str) -> None:
    """No-op if the session was never registered (or already reaped) --
    a SessionEnd hook must never fail teardown over a missing file."""
    try:
        (sessions_dir / session_id).unlink()
    except FileNotFoundError:
        pass


def live_session_ids(sessions_dir: Path) -> Dict[str, Optional[int]]:
    """Non-mutating snapshot of every RECORDED session id and its pid
    (None when no pid was ever captured) -- deliberately does not probe
    liveness itself (a dead-but-not-yet-reaped id still appears here;
    `--status` depends on that to report an honest "dead" rather than
    silently vanishing it). Skips dotfiles -- `.closing` (the
    point-of-no-return marker, see `serve`) lives in this SAME directory
    and must never be mistaken for a session id."""
    if not sessions_dir.is_dir():
        return {}
    ids: Dict[str, Optional[int]] = {}
    for entry in sessions_dir.iterdir():
        if not entry.is_file() or entry.name.startswith("."):
            continue
        raw = entry.read_text(encoding="utf-8").strip()
        if not raw:
            ids[entry.name] = None
            continue
        try:
            ids[entry.name] = int(raw)
        except ValueError:
            continue  # genuinely malformed -- skip rather than crash a probe cycle
    return ids


def reap_dead_sessions(sessions_dir: Path, is_alive=None) -> List[str]:
    """The liveness probe (ruling item 1 / addendum §3): removes every
    recorded session confirmed dead, so a crashed session that never
    called `--session-ended` cannot pin the receiver forever. A `pid:
    null` entry (no pid ever captured) is NEVER reaped by this probe --
    addendum C: "never reaped, shown as unknown"; it only ever leaves the
    registry via its own `--session-ended`. Returns the reaped ids.

    `is_alive(pid, session_id) -> bool` is injectable (default: pid
    liveness alone, `_pid_is_alive`) so a test can substitute a pure
    liveness function without needing a real dead pid. POLY-49 ruling §4
    withdrew the old two-signal (pid + transcript-staleness) default --
    AC7 requires a dead-pid entry dropped within one watchdog beat of its
    process exiting, which a transcript-freshness grace period would
    delay."""
    if is_alive is None:
        is_alive = lambda pid, session_id: _pid_is_alive(pid)  # noqa: E731
    removed: List[str] = []
    for session_id, pid in live_session_ids(sessions_dir).items():
        if pid is None:
            continue
        if not is_alive(pid, session_id):
            deregister_session(sessions_dir, session_id)
            removed.append(session_id)
    return removed


_STDIN_READ_BUDGET_SECONDS = 0.5  # total wall-clock cap, see docstring below


def _session_id_from_stdin() -> Optional[str]:
    """Addendum §2/§D: "absent -> read session_id from the hook's stdin
    JSON, and only when stdin is not a TTY. Never block on stdin." A
    command hook's stdin carries the hook's own JSON payload (session_id,
    transcript_path, cwd, hook_event_name, ...) and Claude Code closes it
    promptly, so this returns fast in the real hook path.

    The TTY check alone is NOT sufficient (measured: a non-interactive
    but still-OPEN pipe -- neither a TTY nor EOF-terminated -- makes a
    bare blocking `sys.stdin.read()` hang forever, exactly the "never
    block" violation this addendum forbids). `select.select` with a
    bounded per-chunk timeout, plus an overall `_STDIN_READ_BUDGET_SECONDS`
    wall-clock cap, is what actually guarantees this returns: if nothing
    is EVER readable, or the writer never closes, this gives up and
    returns None rather than hanging -- a missed session id degrades to
    "untracked" (§6: never pins the receiver), which is always the safe
    direction per §0.
    """
    if sys.stdin is None or sys.stdin.isatty():
        return None
    try:
        deadline = time.monotonic() + _STDIN_READ_BUDGET_SECONDS
        chunks: List[bytes] = []
        fd = sys.stdin.fileno()
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            ready, _, _ = select.select([fd], [], [], remaining)
            if not ready:
                break  # nothing arrived within the budget -- give up, never hang
            chunk = os.read(fd, 65536)
            if not chunk:
                break  # EOF -- the writer closed stdin, exactly the real-hook case
            chunks.append(chunk)
        raw = b"".join(chunks).decode("utf-8", errors="replace")
    except (OSError, ValueError):
        return None
    if not raw.strip():
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    session_id = payload.get("session_id") if isinstance(payload, dict) else None
    return session_id if isinstance(session_id, str) and session_id else None


def _resolve_session_id(explicit_value: Optional[str], session_id_flag: Optional[str]) -> Optional[str]:
    """The fallback chain shared by `--ensure-running` and
    `--session-ended`: an id given directly to the flag wins, then
    `--session-id`, then the hook's stdin JSON (§2)."""
    if explicit_value:
        return explicit_value
    if session_id_flag:
        return session_id_flag
    return _session_id_from_stdin()


# PT-81 H1: the settings.json env block this ticket documents (TRACKER.md)
# already uses the bare string "1" for every boolean-shaped flag
# (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, CLAUDE_CODE_ENABLE_TODO_TOOLS,
# CLAUDE_CODE_ENABLE_TELEMETRY itself) -- this accepts that plus the
# handful of other spellings a human might type by hand into
# settings.local.json or a shell profile. Unset/empty/anything else is
# falsy; there is no ambiguous "maybe" here on purpose.
_TRUTHY_ENV_VALUES = {"1", "true", "yes", "on"}


def _env_flag_truthy(value: Optional[str]) -> bool:
    return value is not None and value.strip().lower() in _TRUTHY_ENV_VALUES


def _endpoint_port(endpoint: Optional[str]) -> Optional[int]:
    """The port named by OTEL_EXPORTER_OTLP_ENDPOINT (e.g.
    "http://127.0.0.1:4318" -> 4318), or None when the variable carries
    no explicit port (a malformed value -- not this function's job to
    diagnose further). Deliberately does NOT special-case an unset/empty
    `endpoint` -- see `_effective_endpoint_port`, the caller H3 actually
    uses, for why an unset variable is not "nothing to compare"."""
    if not endpoint:
        return None
    try:
        return urlparse(endpoint).port
    except ValueError:
        return None


def _effective_endpoint_port(endpoint: Optional[str]) -> int:
    """H3, architect's amendment (4c1b751, empirically confirmed live --
    `claude -p` with telemetry on and no endpoint var set genuinely POSTs
    claude_code.token.usage to 127.0.0.1:4318, a real scratch-sink
    capture, not just the OTel spec's documented default): an UNSET
    OTEL_EXPORTER_OTLP_ENDPOINT is not "nothing to compare" -- a
    conforming exporter falls back to the OTLP protocol default,
    `http://localhost:4318`, and keeps exporting there. A project with
    `otel_port: 4319` and telemetry on but no endpoint override gets a
    receiver bound to 4319 while the real exporter posts to 4318 --
    H3's exact silent mismatch, missed entirely by treating "unset" as
    "skip the check". Always returns a concrete port to compare against:
    the parsed value when the variable is set (and carries one), else
    DEFAULT_OTEL_PORT."""
    parsed = _endpoint_port(endpoint)
    return parsed if parsed is not None else DEFAULT_OTEL_PORT


def _default_user_settings_path(environ: Dict[str, str]) -> Path:
    """`$CLAUDE_CONFIG_DIR/settings.json` when that var is set, else
    `~/.claude/settings.json` -- Claude Code's OWN user-scope settings
    file. POLY-49 ruling §5/M7: as of Claude Code 2.1.282, this is the
    ONLY settings file the harness still reads `OTEL_*` telemetry vars
    from for its own exporter -- project (`.claude/settings.json`) and
    local settings are ignored for those keys now (each session prints
    an ignored-vars notice)."""
    config_dir = environ.get("CLAUDE_CONFIG_DIR")
    if config_dir:
        return Path(config_dir) / "settings.json"
    return Path.home() / ".claude" / "settings.json"


def _exporter_endpoint(
    environ: Dict[str, str], user_settings_path: Optional[Path] = None,
) -> Tuple[Optional[str], str]:
    """POLY-25/POLY-49 ruling §5: H3's expected endpoint, without ever
    assuming `OTEL_EXPORTER_OTLP_ENDPOINT` reaches this (hook-spawned)
    process's own `environ` -- POLY-10 M6/M7 measured that it never does
    in the real hook path, and M7 here additionally found that Claude
    Code >= 2.1.282 no longer applies PROJECT/local settings' `OTEL_*`
    vars to its own exporter either -- only its user-scope settings file
    still works. Precedence, first hit wins:

    1. `environ["OTEL_EXPORTER_OTLP_ENDPOINT"]` -- a real env var, on the
       rare chance one actually is set (e.g. a human's own shell, or a
       test), is still the most direct signal and wins outright.
    2. `env.OTEL_EXPORTER_OTLP_ENDPOINT` inside `user_settings_path`
       (default: `_default_user_settings_path(environ)`) -- an
       unreadable file, malformed JSON, a non-dict `env`, or a missing/
       non-string key are all treated the same as "not configured
       there", never raised: a caller's inability to introspect its own
       user settings must never crash the H1-H3 gate a SessionStart hook
       depends on.
    3. `(None, "default")` -- nothing anywhere; `_effective_endpoint_port`
       is what turns that into the real OTLP protocol default port.

    Returns `(endpoint, source)`, `source` one of `"env"`,
    `"user-settings"`, `"default"` -- both the H3 comparison and
    `--status`'s `exporter-endpoint:` line consume this same tuple so
    the file is read at most once per call, never twice for two
    different messages that must agree.
    """
    from_env = environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
    if from_env:
        return from_env, "env"
    path = user_settings_path if user_settings_path is not None else _default_user_settings_path(environ)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None, "default"
    if isinstance(data, dict):
        env_block = data.get("env")
        if isinstance(env_block, dict):
            value = env_block.get("OTEL_EXPORTER_OTLP_ENDPOINT")
            if isinstance(value, str) and value:
                return value, "user-settings"
    return None, "default"


def ensure_running(
    repo_root: Path, pidfile: Path, port: int,
    grace_period_seconds: float = DEFAULT_GRACE_PERIOD_SECONDS,
    session_id: Optional[str] = None, session_pid: Optional[int] = None,
    transcripts_dir: Optional[Path] = None,
    periodic_reap_seconds: float = DEFAULT_PERIODIC_REAP_SECONDS,
    registry_absent_recreate_seconds: float = REGISTRY_ABSENT_RECREATE_SECONDS,
    user_settings_path: Optional[Path] = None,
) -> bool:
    """Single instance enforced by pidfile + a listen probe; a second
    start is a no-op, never an error. Returns True if a (new or
    already-live) receiver is running, False if it declined to start --
    no cairn tracker at repo_root (a spin-off/non-cairn checkout must
    never get a background process it has no use for), telemetry off
    (H1), a port/endpoint disagreement (H3), or a genuine startup
    failure distinguished from an already-held port (H2). Every False
    path prints exactly why to stderr; the SessionStart hook still exits
    0 regardless -- telemetry must never fail a session -- but no longer
    swallows stderr, so these messages actually reach someone.

    `grace_period_seconds` (PT-86) only matters on a FRESH spawn -- it's
    threaded into the detached child's own argv so the long-lived daemon
    knows how long to wait after its last session ends before flushing
    and exiting. An already-running daemon keeps whatever value it was
    originally spawned with; a later `--ensure-running` cannot retune it.

    `session_id`/`session_pid` (PT-86, addendum §B) register a live
    session -- when `session_id` is given, this happens BEFORE deciding
    whether a receiver is already up ("both sides write first, then
    check": the registration file persists across a respawn, so it is
    never wasted even if this call ends up spawning a fresh daemon
    below), and the daemon's own `.closing` point-of-no-return marker is
    checked and waited out if present, so a session starting in the
    instant the daemon is mid-shutdown is never silently dropped.

    `transcripts_dir`, like `grace_period_seconds`, only matters on a
    FRESH spawn -- threaded into the child's own argv so role attribution
    (`_resolve_role_from_session`) consults the same transcripts
    directory this call resolved (a `--transcripts-dir` override in
    tests, or the real project's own).

    `user_settings_path` (POLY-25/POLY-49 ruling §5) is the H3 endpoint
    resolver's own override -- see `_exporter_endpoint`; `None` resolves
    the real `$CLAUDE_CONFIG_DIR/settings.json` (else `~/.claude/
    settings.json`), a test passes a tmp file instead.

    POLY-49 ruling §4: `register_session` now runs BEFORE the H1 gate
    (right after the config.yml check) -- registration is a fast, local
    file write that must succeed even when telemetry is off or Claude
    Code >= 2.1.282 has stripped `CLAUDE_CODE_ENABLE_TELEMETRY` from this
    process's own env (M8: the real-world "session never appeared"
    finding was H1 declining before registration ever ran). H1 still
    gates only whether a receiver gets SPAWNED/kept up.
    """
    data_dir = repo_root / "process" / "cairn"
    if not (data_dir / "config.yml").exists():
        return False

    sessions_dir = _sessions_dir(pidfile)
    if session_id:
        register_session(sessions_dir, session_id, session_pid)

    # H1: gate on the SAME env block that controls the exporter -- one
    # block, two consumers, checked here so a project with telemetry off
    # gets no bound port and no idle daemon it never opted into. POLY-49
    # ruling §4/M7: Claude Code >= 2.1.282 no longer reads this var from
    # project/local settings for its OWN exporter either -- only its
    # user-scope settings file works now -- so a decline here is loud
    # about where to actually set it, not just that it's unset.
    if not _env_flag_truthy(os.environ.get("CLAUDE_CODE_ENABLE_TELEMETRY")):
        print(
            "otel_receiver: not starting -- CLAUDE_CODE_ENABLE_TELEMETRY is not set in this "
            "process; Claude Code >= 2.1.282 reads telemetry vars from ~/.claude/settings.json, "
            "not project settings",
            file=sys.stderr,
        )
        return False

    pid = _read_pidfile(pidfile)
    already_running = pid is not None and _pid_is_alive(pid) and _port_is_listening(port)

    closing_marker = sessions_dir / CLOSING_MARKER_NAME
    if closing_marker.exists():
        # Addendum §B: the daemon is (or very recently was) at its point
        # of no return. Wait for its socket to actually close, bounded --
        # never indefinitely, this runs synchronously inside a
        # SessionStart hook.
        deadline = time.monotonic() + 1.0
        port_freed = False
        while time.monotonic() < deadline:
            if not _port_is_listening(port):
                port_freed = True
                break
            time.sleep(0.1)
        if not port_freed:
            # Either the daemon aborted on seeing our fresh registration
            # above (and already removed `.closing`) or it simply hasn't
            # gotten there yet -- either way this is NOT a stranger
            # holding the port, so H2's "already held" alarm below would
            # be a false one. We're already registered; report success.
            return True
        already_running = False  # the old daemon is genuinely gone -- fall through to a fresh spawn

    if already_running:
        return True  # no-op -- already up, and (if given) now registered too

    # H3: otel_port (config.yml, the single source of truth -- `port`
    # here) vs. the port the real exporter's destination endpoint
    # effectively names -- resolved by `_exporter_endpoint` (POLY-25/
    # POLY-49 ruling §5), NOT read from this process's own `os.environ`
    # (POLY-10 M6/M7: a hook-spawned process never sees `OTEL_*` there in
    # the real hook path). An UNSET/unresolvable endpoint still resolves
    # to the OTLP default 4318, not "nothing to compare" (architect's
    # amendment, 4c1b751; see `_effective_endpoint_port`). A real
    # disagreement doesn't lose telemetry, it silently DELIVERS it to
    # whatever else is listening on the wrong port (PT-79's real
    # contamination incident) -- refuse rather than start a receiver
    # nothing will actually reach, or start one that reaches a
    # stranger's.
    endpoint, endpoint_source = _exporter_endpoint(dict(os.environ), user_settings_path)
    effective_port = _effective_endpoint_port(endpoint)
    if effective_port != port:
        endpoint_desc = (
            f"unset (falls back to the OTLP default, {DEFAULT_OTEL_PORT})"
            if not endpoint else f"{effective_port!r}, from OTEL_EXPORTER_OTLP_ENDPOINT={endpoint!r} (source: {endpoint_source})"
        )
        print(
            f"otel_receiver: refusing to start -- otel_port ({port}, from "
            f"process/cairn/config.yml) disagrees with the exporter's destination "
            f"port ({endpoint_desc}); these must name the same receiver or "
            "telemetry silently goes to the wrong place",
            file=sys.stderr,
        )
        return False

    # H2, first half: the pidfile check above already ruled out "this is
    # OUR OWN already-running instance" -- so if something is STILL
    # listening on this port, it's a DIFFERENT process (very plausibly
    # another project's receiver sharing the same default otel_port).
    # Spawning our own child anyway would just hand it a doomed
    # "Address already in use" exit, silently, into a gitignored log --
    # refuse up front and say so instead.
    if _port_is_listening(port):
        print(
            f"otel_receiver: port {port} (otel_port) is already held by another "
            "process -- not this project's own receiver, per its pidfile -- "
            "refusing to start a second one; set a different otel_port in "
            "process/cairn/config.yml if this is expected",
            file=sys.stderr,
        )
        return False

    logfile = repo_root / LOGFILE_REL
    logfile.parent.mkdir(parents=True, exist_ok=True)
    spawn_argv = [
        sys.executable, str(Path(__file__).resolve()),
        "--out-file", str(repo_root / backfill_tokens.DEFAULT_OUT_REL),
        "--pidfile", str(pidfile), "--port", str(port),
        "--grace-period-seconds", str(grace_period_seconds),
        "--periodic-reap-seconds", str(periodic_reap_seconds),
        "--registry-absent-recreate-seconds", str(registry_absent_recreate_seconds),
    ]
    if transcripts_dir is not None:
        spawn_argv += ["--transcripts-dir", str(transcripts_dir)]
    with open(logfile, "ab") as log:
        subprocess.Popen(
            spawn_argv,
            stdout=log, stderr=log, stdin=subprocess.DEVNULL,
            start_new_session=True,
            cwd=str(repo_root),
        )
    # Give the child a brief window to bind before this call returns --
    # NOT a hard guarantee, just enough that a second SessionStart firing
    # moments later (team-agents spawns several teammates in a burst,
    # each running this same hook) sees a live port instead of racing a
    # duplicate start. Capped short (0.5s): this runs synchronously
    # inside a SessionStart hook, which must not stall session startup.
    for _ in range(5):
        if _port_is_listening(port):
            return True
        time.sleep(0.1)
    # H2, second half: distinguish "spawned but never came up" from
    # success instead of reporting True either way -- a caller (or a
    # human reading the hook's now-visible stderr) needs to know the
    # difference; the exit code alone can't carry it since --ensure-
    # running's own CLI path always returns 0 regardless (a SessionStart
    # hook must not fail a session over telemetry).
    print(
        f"otel_receiver: spawned but port {port} (otel_port) never started "
        f"listening within the wait window -- the child may have exited "
        f"immediately; see {logfile}",
        file=sys.stderr,
    )
    return False


def _status(
    pidfile: Path, port: int, out_path: Path, sessions_dir: Path, transcripts_dir: Path,
    exporter_endpoint_info: Optional[Tuple[Optional[str], str]] = None,
) -> int:
    """--status: running?, port, out-file, plus PT-86's session count and
    per-id liveness -- a caller-facing health check (what an operator or
    a test runs to ask "is it up"), distinct from --ensure-running (what
    the hook runs to make it so). Exit 0 when running, 1 when not -- the
    common status-command convention, scriptable without parsing stdout.

    The session lines are a FRESH, non-mutating probe every call -- a
    dead-but-not-yet-reaped id is reported honestly as "dead" rather than
    silently omitted; only `--session-ended` and a flush actually reap.

    Three states (POLY-49 ruling §4 withdrew the old four-state
    `dead-pending` distinction along with the two-signal reap predicate
    it diagnosed -- liveness is pid-only now, so there is no longer a
    "reap-eligible but not yet" middle state to report): `alive` (pid
    probe says alive), `dead` (pid probe says dead -- reap-eligible on
    the very next watchdog beat), and `unknown` (no pid ever captured --
    never reaped, addendum C). `transcripts_dir` is accepted for
    signature back-compat but no longer consulted by this function.

    POLY-10 gate-1 ruling (b): two new lines, after `out-file:` --
    `watchdog: alive|stale|absent (last beat <iso>)` (judged by the
    heartbeat FILE's own mtime, not its parsed content -- the daemon's own
    ISO timestamp is only ever printed for a human to read) and
    `last-flush: <iso> (<n> lines)` / `last-flush: never`. Exit codes:
    `0` running AND watchdog alive (unchanged for the already-passing
    case), `1` not running (unchanged), `2` running but the watchdog is
    NOT alive -- the forbidden state (a live listener over a dead
    watchdog thread) made scriptable, not just printed. `running:`,
    `port:`, `out-file:` stay the first three lines, byte-stable.

    POLY-25/POLY-49 ruling §5: a last line, `exporter-endpoint: <url>
    (source: env|user-settings|default)`, from the `_exporter_endpoint`
    resolver's `(endpoint, source)` result -- `exporter_endpoint_info`
    is that pre-resolved tuple (the caller already needed it for H3, so
    this never re-reads `os.environ`/the user settings file a second
    time); `None` (a caller that hasn't resolved one) omits the line
    entirely rather than guessing.
    """
    pid = _read_pidfile(pidfile)
    running = pid is not None and _pid_is_alive(pid) and _port_is_listening(port)
    print(f"running: {running}")
    print(f"port: {port}")
    print(f"out-file: {out_path}")

    heartbeat_path = sessions_dir / WATCHDOG_HEARTBEAT_MARKER_NAME
    heartbeat_iso: Optional[str] = None
    watchdog_state = "absent"
    try:
        heartbeat_iso = heartbeat_path.read_text(encoding="utf-8").strip() or None
        age = time.time() - heartbeat_path.stat().st_mtime
        watchdog_state = "alive" if age <= WATCHDOG_HEARTBEAT_ALIVE_SECONDS else "stale"
    except OSError:
        watchdog_state = "absent"
    if heartbeat_iso:
        print(f"watchdog: {watchdog_state} (last beat {heartbeat_iso})")
    else:
        print(f"watchdog: {watchdog_state} (no heartbeat)")

    last_flush_path = sessions_dir / LAST_FLUSH_MARKER_NAME
    try:
        last_flush_text = last_flush_path.read_text(encoding="utf-8").strip()
    except OSError:
        last_flush_text = ""
    parts = last_flush_text.split(" ", 1) if last_flush_text else []
    if len(parts) == 2:
        print(f"last-flush: {parts[0]} ({parts[1]} lines)")
    else:
        print("last-flush: never")

    ids = live_session_ids(sessions_dir)
    print(f"sessions: {len(ids)}")
    for session_id in sorted(ids):
        entry_pid = ids[session_id]
        if entry_pid is None:
            state = "unknown"  # addendum C/§7: no pid ever captured, never reaped
        elif _pid_is_alive(entry_pid):
            state = "alive"
        else:
            state = "dead"  # POLY-49 ruling §4: pid-only -- reap-eligible on the next watchdog beat
        print(f"session {session_id}: {state}")

    if exporter_endpoint_info is not None:
        endpoint, source = exporter_endpoint_info
        print(f"exporter-endpoint: {endpoint or f'http://127.0.0.1:{DEFAULT_OTEL_PORT}'} (source: {source})")

    if not running:
        return 1
    if watchdog_state == "stale":
        # `stale` (the heartbeat file EXISTS, inside a PRESENT sessions_dir,
        # but hasn't been touched within WATCHDOG_HEARTBEAT_ALIVE_SECONDS)
        # is the actionable forbidden-state signal -- a live listener over
        # a watchdog thread that has stopped ticking. `absent` (no file at
        # all) is deliberately NOT the same signal: ruling (a).1's hold
        # window means `sessions_dir` -- and so the heartbeat inside it --
        # can be legitimately unreadable for up to
        # `registry_absent_recreate_seconds` while the watchdog is doing
        # exactly its job (holding); the file also never existing at all
        # (an old daemon predating this ticket) is the same "can't tell"
        # case. Same asymmetry PT-86 §0 already established: a false alarm
        # here costs an operator's trust in `--status`, a missed one costs
        # nothing this ticket didn't already accept -- `stale` alone stays
        # the scriptable, unambiguous case.
        return 2
    return 0


def _signal_running(pidfile: Path, sig: int, label: str) -> int:
    """POLY-49 ruling §3: the failure text names the pidfile this call
    actually resolved, as an ABSOLUTE path -- since `main()` now anchors
    `pidfile` to the main checkout (`worktree_root.main_checkout_root`),
    a failure here from a linked worktree names the MAIN CHECKOUT's real
    pidfile, not the worktree's own never-mounted one, so an operator
    reading stderr can go look at the right file."""
    pid = _read_pidfile(pidfile)
    if pid is None or not _pid_is_alive(pid):
        print(f"error: no running receiver ({label}): pidfile {pidfile.resolve()} absent or stale", file=sys.stderr)
        return 1
    os.kill(pid, sig)
    return 0


# --------------------------------------------------------------------------
# HTTP server -- thin wrapper over parse_export/fold/flush.
# --------------------------------------------------------------------------

def _handle_export_body(state: ReceiverState, body: bytes, content_encoding: Optional[str], transcripts_dir: Path) -> None:
    """POLY-49 ruling §1.2: the foreign-session filter runs here, BEFORE
    `fold` -- a datapoint whose `session_id` has no transcript anywhere
    `backfill_tokens._transcript_path_for` looks (this repo's own slug
    dir, or a worktree-sibling of it) belongs to some OTHER project's
    session exporting to the same user-global endpoint (M7), and is
    dropped rather than folded into THIS repo's counts. A datapoint with
    no `session.id` at all is kept unchanged (nothing to check). See
    `flush`'s own reporting of `state.foreign_dropped_*` for why the
    stderr line is emitted per-FLUSH, not per-request."""
    payload = decode_otlp_json(body, content_encoding)
    datapoints = parse_export(payload)
    with state.lock:
        kept: List[Dict[str, Any]] = []
        for dp in datapoints:
            session_id = dp.get("session_id")
            if not session_id or session_id in state.known_sessions:
                kept.append(dp)
                continue
            if backfill_tokens._transcript_path_for(session_id, transcripts_dir) is not None:
                state.known_sessions.add(session_id)  # positive hit -- cached for the receiver's lifetime
                kept.append(dp)
                continue
            # Miss -- NOT cached (ordering assumption, unmeasured: a
            # session's transcript exists before its first token export;
            # a too-early miss must retry on the next datapoint rather
            # than pin a false "foreign" verdict forever).
            state.foreign_dropped_datapoints += 1
            state.foreign_dropped_sessions.add(session_id)
    fold(kept, state)


def make_handler(state: ReceiverState, transcripts_dir: Path, on_export=None, on_request=None):
    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = "cairn-otel-receiver/1.0"

        def log_message(self, fmt, *args):  # noqa: A003
            pass

        def do_POST(self) -> None:  # noqa: N802
            if self.path.rstrip("/") != "/v1/metrics":
                self.send_response(404)
                self.end_headers()
                return
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else b""
            try:
                _handle_export_body(state, body, self.headers.get("Content-Encoding"), transcripts_dir)
            except ReceiverError as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
                if on_request:
                    on_request()
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b"{}")
            if on_export:
                on_export()
            if on_request:
                on_request()

    return Handler


def run_once(port: int, out_path: Path, branch_repo_root: Path, prefix: str, roster: Set[str], transcripts_dir: Path) -> int:
    """`--once`: bind, accept exactly one **real POST /v1/metrics
    request**, flush, exit. Deliberately NOT a single bare
    `handle_request()` call: `HTTPServer.handle_request()` blocks until
    it accepts one CONNECTION, not one completed HTTP request -- a
    caller's own readiness probe (a bare `socket.create_connection`
    opened and immediately closed to confirm the port is listening, the
    same pattern this project's other subprocess-CLI tests already use)
    would itself consume the single shot and leave the real POST that
    follows moments later refused. Instead: loop `handle_request()`,
    tracked by `on_request` (fires once a real /v1/metrics POST has been
    handled, success or 400 alike), bounded by an overall deadline so a
    caller that never sends anything doesn't hang the process forever.
    """
    state = ReceiverState()
    got_one = threading.Event()
    handler_cls = make_handler(state, transcripts_dir, on_request=got_one.set)
    httpd = http.server.HTTPServer(("127.0.0.1", port), handler_cls)
    httpd.timeout = 5
    deadline = time.monotonic() + 30
    try:
        while not got_one.is_set() and time.monotonic() < deadline:
            httpd.handle_request()
    finally:
        httpd.server_close()

    branch = _current_branch(branch_repo_root)
    hint = _issue_hint_from_datapoints(state.series_meta.values())
    milestone_windows_table = cairn.milestone_windows(branch_repo_root)
    issue = resolve_issue(branch, prefix, hint, milestone_windows_table=milestone_windows_table)
    try:
        flush(state, out_path, issue, _now_iso(), roster=roster, transcripts_dir=transcripts_dir, milestone_windows_table=milestone_windows_table)
    except (ReceiverError, backfill_tokens.BackfillError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


def serve(
    port: int, out_path: Path, pidfile: Path, flush_interval: int,
    branch_repo_root: Path, prefix: str, roster: Set[str], transcripts_dir: Path,
    sessions_dir: Optional[Path] = None, grace_period_seconds: float = DEFAULT_GRACE_PERIOD_SECONDS,
    periodic_reap_seconds: float = DEFAULT_PERIODIC_REAP_SECONDS,
    registry_absent_recreate_seconds: float = REGISTRY_ABSENT_RECREATE_SECONDS,
) -> None:
    state = ReceiverState()
    sessions_dir = sessions_dir if sessions_dir is not None else _sessions_dir(pidfile)
    my_pid = os.getpid()
    # POLY-49 ruling §4: liveness = pid, every tick -- the old two-signal
    # (pid + transcript-staleness) probe is withdrawn from the reap
    # predicate entirely; `transcripts_dir` stays a `serve()` parameter
    # for role attribution (`_resolve_role_from_session`), unrelated to
    # liveness now.
    session_is_alive = lambda pid, session_id: _pid_is_alive(pid)  # noqa: E731

    # A crash can leave a stale `.closing` marker from a predecessor that
    # never got to remove it (addendum §B) -- a fresh daemon must not
    # inherit a false "mid-shutdown" state.
    closing_marker = sessions_dir / CLOSING_MARKER_NAME
    try:
        closing_marker.unlink()
    except OSError:
        pass

    # Delta 6: declare "I understand SIGUSR2" before anything could ever
    # nudge this process -- a receiver started before this change has no
    # handler for it at all, so `_nudge_daemon` must never send one
    # without first confirming, via this marker, that whatever is
    # actually listening on the other end is new enough to survive it.
    sessions_dir.mkdir(parents=True, exist_ok=True)
    (sessions_dir / NUDGE_CAPABLE_MARKER_NAME).write_text("", encoding="utf-8")
    # So a LATER, separate `--status` invocation can label a `dead`/
    # `dead-pending` entry using the transcripts_dir THIS daemon actually
    # resolved, not whatever that separate CLI call would resolve on its
    # own -- see TRANSCRIPTS_DIR_MARKER_NAME's own comment.
    (sessions_dir / TRANSCRIPTS_DIR_MARKER_NAME).write_text(str(transcripts_dir), encoding="utf-8")

    def _do_flush() -> int:
        """Returns the number of lines this flush wrote (PT-90) -- `0` on
        a no-op flush (nothing accrued) and on a refused flush (it wrote
        nothing, so `flushed 0 lines` at the self-stop log line is true,
        not a guess)."""
        branch = _current_branch(branch_repo_root)
        hint = _issue_hint_from_datapoints(state.series_meta.values())
        # PT-84 §5: built once for THIS flush (one `git log` per
        # milestone), never per datapoint -- shared by the issue
        # resolution and the line-sort below rather than computed twice.
        milestone_windows_table = cairn.milestone_windows(branch_repo_root)
        issue = resolve_issue(branch, prefix, hint, milestone_windows_table=milestone_windows_table)
        lines_written = 0
        try:
            lines_written = len(flush(state, out_path, issue, _now_iso(), roster=roster, transcripts_dir=transcripts_dir, milestone_windows_table=milestone_windows_table))
        except (ReceiverError, backfill_tokens.BackfillError) as e:
            print(f"otel_receiver: flush refused: {e}", file=sys.stderr)
        # Addendum §3: the liveness probe also runs "at each flush" -- an
        # independent backstop to the on-`end` reap, for the scenario
        # where EVERY session that ever registered crashed without ever
        # calling `--session-ended`.
        reap_dead_sessions(sessions_dir, is_alive=session_is_alive)
        # POLY-10 gate-1 ruling (b): recorded on EVERY flush, including a
        # no-op or refused one (`lines_written` stays 0) -- this is what
        # proves the flush path itself ran, not just that it wrote
        # something. Best-effort: a missing/absent sessions_dir (mid-swap)
        # must never turn a flush into an error.
        try:
            (sessions_dir / LAST_FLUSH_MARKER_NAME).write_text(f"{_now_iso()} {lines_written}", encoding="utf-8")
        except OSError:
            pass
        return lines_written

    def _on_export() -> None:
        # Runs on EVERY export, not per flush -- §5's "never per
        # datapoint" budget applies here specifically, so this
        # deliberately does NOT build a milestone table (that git-log
        # cost belongs only where it already ran pre-PT-84: inside
        # `_do_flush`). Detects a BRANCH-level bucket change only, same
        # as before PT-84; a milestone-only boundary crossed between
        # exports is caught by the `elapsed >= flush_interval` fallback
        # below within, at most, one flush interval -- `_do_flush` itself
        # always resolves the milestone fresh, at actual flush time, so
        # nothing is ever misattributed, only potentially flushed a bit
        # later than the earliest possible moment.
        branch = _current_branch(branch_repo_root)
        hint = _issue_hint_from_datapoints(state.series_meta.values())
        issue_now = resolve_issue(branch, prefix, hint)
        elapsed = time.monotonic() - state.last_flush_monotonic
        if (state.last_issue_bucket is not None and issue_now != state.last_issue_bucket) or elapsed >= flush_interval:
            _do_flush()

    handler_cls = make_handler(state, transcripts_dir, on_export=_on_export)

    class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
        # Multiple teammates are separate OS processes, each running
        # their own OTel SDK on its own export interval -- concurrent
        # POSTs are the normal case for this project's team-agents
        # workflow, not an edge case.
        daemon_threads = True

    httpd = Server(("127.0.0.1", port), handler_cls)

    pidfile.parent.mkdir(parents=True, exist_ok=True)
    pidfile.write_text(str(my_pid), encoding="utf-8")

    def _on_sigusr1(signum, frame):
        _do_flush()

    def _on_shutdown(signum, frame):
        """`--stop` / SIGINT / a process manager -- addendum §5's
        ordering applies here too, not just the watchdog path: close the
        listening socket BEFORE flushing (so the flush is complete by
        construction, not by luck), and compare-and-delete the pidfile
        rather than an unconditional unlink (a successor could already
        have written its own pid to this same path). `server_close()`,
        not `httpd.shutdown()`, is correct HERE: this handler runs ON
        THE SAME (main) THREAD as `serve_forever()` -- calling
        `.shutdown()` from that thread would deadlock waiting for a loop
        iteration that can never run while this handler is executing.
        """
        httpd.server_close()
        _do_flush()
        _compare_and_delete_pidfile(pidfile, my_pid)
        sys.exit(0)

    # PT-86 (addendum §4/§B): the watchdog. `--ensure-running`/
    # `--session-ended` are separate, short-lived CLI processes that
    # mutate `sessions_dir` directly (one file per session id, no lock
    # needed -- see that section's docstring) and then send SIGUSR2 as
    # the nudge below; this background thread is what actually notices
    # and acts, waking either on that nudge or at least every
    # WATCHDOG_TICK_SECONDS regardless. `ever_nonempty` starts true if
    # this daemon INHERITED a non-empty registry (a respawn after a
    # crash, addendum A.1/§6) -- an inherited registry is authoritative
    # and may legitimately drain to empty and stop; a registry that has
    # never been non-empty (nobody ever registered a session with this
    # daemon) never arms the timer at all.
    #
    # Declared BEFORE the SIGUSR2 handler is registered (architect
    # review, Delta 4): the handler closes over `wake_event`, and a
    # signal arriving between `signal.signal(...)` and this assignment
    # would otherwise raise NameError on the main thread.
    wake_event = threading.Event()
    stopping = False

    # A lightweight "please re-evaluate the session registry right now"
    # nudge (PT-86) -- carries no data (the registry files, mutated
    # directly by `--ensure-running`/`--session-ended`, remain the only
    # source of truth), so it does not reopen anything the addendum's
    # withdrawal of the HTTP control endpoint closed: it is derived from
    # the SAME local `pidfile` a cross-repo caller could never discover
    # in the first place (addendum A.2). A missed/coalesced signal never
    # delays a clean stop (the registry file is already gone either way)
    # but DOES skip the crashed-sibling reap until the next `end` event,
    # flush, or the slow periodic reap below -- see architect review
    # Delta 1's correction to this comment's earlier, overstated claim.
    def _on_session_nudge(signum, frame):
        wake_event.set()

    signal.signal(signal.SIGUSR1, _on_sigusr1)
    signal.signal(signal.SIGUSR2, _on_session_nudge)
    signal.signal(signal.SIGTERM, _on_shutdown)
    signal.signal(signal.SIGINT, _on_shutdown)

    def _watchdog_fatal_shutdown(exc: BaseException) -> None:
        """POLY-10 gate-1 ruling (a).5, the "belt": any watchdog exception
        OTHER than the known, recoverable ones (absent registry dir,
        `.closing` ENOENT race -- both handled in-loop below, never
        reaching here) must exit the WHOLE receiver loudly rather than
        leave a silently-dead thread under a still-listening socket --
        the forbidden state this ruling exists to eliminate. Same §5
        ordering as the normal self-stop path (socket closed, then flush,
        then pidfile), each step best-effort since we're already on the
        failure path and must not let a SECOND exception here prevent the
        hard exit below. `os._exit`, not `sys.exit`: this runs on a
        background daemon thread, where `sys.exit` only raises `SystemExit`
        in THIS thread (silently swallowed by the interpreter on a
        non-main thread) rather than terminating the process -- the exit
        code this ruling requires (3) needs a real process exit."""
        print(f"watchdog: fatal {type(exc).__name__}: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        try:
            httpd.shutdown()
        except Exception:
            pass
        try:
            httpd.server_close()
        except Exception:
            pass
        try:
            _do_flush()
        except Exception:
            pass
        try:
            _compare_and_delete_pidfile(pidfile, my_pid)
        except Exception:
            pass
        sys.stderr.flush()
        os._exit(3)

    def _watchdog_loop() -> None:
        # Mutable tick state, boxed so the nested `_tick` closure below can
        # update it (a plain local would need `nonlocal` per name; a dict
        # is one declaration). POLY-10 gate-1 ruling (a).5, the "belt":
        # each tick's body runs inside the OUTER try/except below, not
        # inline in this loop -- any exception it raises that isn't one of
        # the known, recoverable ones (handled in-tick, never propagating)
        # reaches `_watchdog_fatal_shutdown`, which exits the whole
        # receiver rather than leaving a silently-dead thread under a
        # still-listening socket.
        st = {
            "shutdown_deadline": None,       # type: Optional[float]
            "ever_nonempty": bool(live_session_ids(sessions_dir)),
            "last_heartbeat_write": None,    # type: Optional[float]
            "absent_since": None,            # type: Optional[float]
            "parent_absent_logged": False,   # POLY-27: log once per absence episode, not every tick
        }

        def _tick(nudged: bool) -> bool:
            """One watchdog tick. Returns True to keep looping, False once
            the normal self-stop has run to completion (the watchdog
            thread's own, non-fatal exit)."""
            now_mono = time.monotonic()

            # POLY-10 gate-1 ruling (b): a throttled liveness heartbeat,
            # skipped silently while the registry dir is absent (nothing
            # to write it into) -- `--status` judges freshness from this
            # file's own mtime.
            if sessions_dir.is_dir() and (
                st["last_heartbeat_write"] is None
                or (now_mono - st["last_heartbeat_write"]) >= WATCHDOG_HEARTBEAT_WRITE_INTERVAL_SECONDS
            ):
                try:
                    (sessions_dir / WATCHDOG_HEARTBEAT_MARKER_NAME).write_text(_now_iso(), encoding="utf-8")
                    st["last_heartbeat_write"] = now_mono
                except OSError:
                    pass

            # POLY-10 gate-1 ruling (a).1-3: an absent `.sessions/` dir is
            # *unknown*, never *empty* -- `live_session_ids` returning {}
            # for a MISSING dir is indistinguishable, at that call, from a
            # genuinely drained registry, which is exactly today's bug
            # (M1): a swap window reads as "everyone left", arms the grace
            # deadline, and dies on the ENOENT it hits trying to act on a
            # false conclusion. So this dir-existence check runs FIRST,
            # ahead of every other lifecycle decision this tick.
            if not sessions_dir.is_dir():
                if st["absent_since"] is None:
                    st["absent_since"] = now_mono
                    st["parent_absent_logged"] = False
                if (now_mono - st["absent_since"]) < registry_absent_recreate_seconds:
                    # Hold: cancel any armed deadline (a false "empty"
                    # conclusion must not carry forward once the dir comes
                    # back), do not reap, do not touch `ever_nonempty` --
                    # a swap window (M2, unbounded by network) must never
                    # be read as "the last session just left".
                    if st["shutdown_deadline"] is not None:
                        print(f"grace-window cancelled: registry dir absent at {_now_iso()}, holding, staying up", file=sys.stderr)
                        st["shutdown_deadline"] = None
                    return True
                # Absent past the bound. POLY-27 (ruling §6, gap in the
                # POLY-10 ruling, architect review 10040ad):
                # `sessions_dir.mkdir(parents=True)` would ALSO recreate
                # `sessions_dir.parent` (`process/cairn/metrics/` itself)
                # if that's missing too -- exactly what
                # `ensure_metrics_worktree.py`'s swap does for its own
                # unbounded (network-fetch-gated, M2) window: rename the
                # WHOLE metrics dir aside, not just `.sessions/`.
                # Recreating the parent mid-swap makes the target
                # non-empty and fails `git worktree add` outright. So the
                # bound only ever licenses recreating `.sessions/` ALONE
                # (no `parents=`), when its parent is still there.
                if sessions_dir.parent.is_dir():
                    # Only `.sessions/` itself went missing (something
                    # other than a bounded swap deleted it outright;
                    # `ensure_metrics_worktree.py`'s own restore step
                    # always brings it back well within this bound when
                    # the parent is what it touched). Recreate it and its
                    # two startup markers rather than hold forever; the
                    # freshly-recreated registry is empty with
                    # `ever_nonempty` UNCHANGED -- if it was already True,
                    # the normal empty-registry grace path now applies
                    # (sessions re-register on their next SessionStart, an
                    # `--ensure-running` one hook away).
                    sessions_dir.mkdir(exist_ok=True)
                    (sessions_dir / NUDGE_CAPABLE_MARKER_NAME).write_text("", encoding="utf-8")
                    (sessions_dir / TRANSCRIPTS_DIR_MARKER_NAME).write_text(str(transcripts_dir), encoding="utf-8")
                    print(f"watchdog: registry dir absent {registry_absent_recreate_seconds}s, recreated {sessions_dir}", file=sys.stderr)
                    st["absent_since"] = None
                    return True
                # The parent is ALSO absent (mid metrics-dir swap) --
                # keep holding past the bound too, indefinitely, rather
                # than recreate blindly; `ensure_metrics_worktree.py`'s
                # restore step is what ends this window, not a timer.
                # Narrow today: that swap runs once per checkout (this
                # repo's own `process/cairn/metrics/` is already a
                # worktree) and only after this same bound, so an
                # unbounded hold here is a live risk only for a swap that
                # itself never completes. Logged once per absence episode,
                # not every tick.
                if not st["parent_absent_logged"]:
                    print(f"watchdog: registry parent absent, holding {sessions_dir.parent}", file=sys.stderr)
                    st["parent_absent_logged"] = True
                if st["shutdown_deadline"] is not None:
                    print(f"grace-window cancelled: registry dir absent at {_now_iso()}, holding, staying up", file=sys.stderr)
                    st["shutdown_deadline"] = None
                return True
            st["absent_since"] = None

            # POLY-49 ruling §1.1: interval flush from the watchdog,
            # independent of exports. `_on_export`'s own `elapsed >=
            # flush_interval` check (below, in `serve`) only ever runs
            # when SOMETHING is actually exporting -- AC4's measured
            # cause (M1-M9) is Claude Code 2.1.282 sessions exporting
            # NOTHING at all in the real hook path, so a receiver that
            # relies solely on the export-triggered check never flushes,
            # ever, even once `flush_interval` has long since elapsed;
            # `--flush-now`/`--status`'s `last-flush` line is the only
            # way anyone would ever notice. This tick-driven check closes
            # that gap: every WATCHDOG_TICK_SECONDS beat, flush if the
            # interval has elapsed, whether or not any export ever
            # arrived to trigger `_on_export`. `_do_flush` itself is
            # already a safe no-op when nothing has accrued (returns 0,
            # still records `.last-flush`), so this never writes an empty
            # line, only proves (via that marker) that the flush path
            # itself keeps running on schedule.
            if (time.monotonic() - state.last_flush_monotonic) >= flush_interval:
                _do_flush()

            # POLY-49 ruling §4: "Liveness = pid, every tick." Reaps
            # unconditionally now, nudged or not -- AC7 requires a
            # registered session whose pid is gone to be dropped within
            # one watchdog beat of its process exiting, which the old
            # nudge-gated ("on every end event") reap could miss
            # indefinitely for a session that crashed without ever
            # calling `--session-ended` (no nudge ever arrives to trigger
            # it). `session_is_alive` is pid-only (see `serve`'s own
            # assignment) -- the transcript-staleness second signal
            # (PT-86 addendum C) is withdrawn from the reap predicate
            # entirely, so there is no longer a slower, idle-but-fresh
            # grace window to race; a merely-idle session (alive pid)
            # is never touched by this. `nudged` still wakes this loop
            # early (via SIGUSR2) so the self-stop grace re-evaluation
            # below runs sooner than the next ordinary tick, but no
            # longer gates reaping itself. `--periodic-reap-seconds`
            # stays accepted on the CLI/spawn-argv for back-compat; it no
            # longer has any effect now that every tick already reaps.
            reap_dead_sessions(sessions_dir, is_alive=session_is_alive)
            if live_session_ids(sessions_dir):
                st["ever_nonempty"] = True
                # PT-90 AC2: log only when a deadline is actually armed --
                # this branch runs on EVERY ordinary tick (most of which
                # have no grace window pending at all), so an unconditional
                # print here would flood the log once per
                # WATCHDOG_TICK_SECONDS forever.
                if st["shutdown_deadline"] is not None:
                    print(f"grace-window cancelled: registry non-empty at {_now_iso()}, session registered, staying up", file=sys.stderr)
                st["shutdown_deadline"] = None
                return True
            if not st["ever_nonempty"]:
                return True
            if st["shutdown_deadline"] is None:
                st["shutdown_deadline"] = time.monotonic() + grace_period_seconds
                return True
            if time.monotonic() < st["shutdown_deadline"]:
                return True
            # Deadline passed and the registry was empty as of the top
            # of this tick -- addendum §3: "once more immediately before
            # the point of no return", a fresh probe right now, since a
            # session that looked dead a tick ago may since have proven
            # itself alive via a flush-triggered reap elsewhere, or a
            # brand new session may have registered between ticks.
            reap_dead_sessions(sessions_dir, is_alive=session_is_alive)
            if live_session_ids(sessions_dir):
                # PT-90 AC2: a race window, not deterministically
                # triggerable by a test -- logged per the ruling anyway.
                if st["shutdown_deadline"] is not None:
                    print(f"grace-window cancelled: registry non-empty at {_now_iso()}, session proved alive at the pre-exit probe, staying up", file=sys.stderr)
                st["shutdown_deadline"] = None
                return True
            # The point of no return (addendum §B): exclusive-create
            # `.closing`, THEN re-read -- a session that registered in
            # the instant between the two must still cancel this.
            # POLY-10 gate-1 ruling (a).4: `FileNotFoundError` alongside
            # `FileExistsError` -- the SAME swap window (a).1-3 handles
            # above can, on a narrower race, vanish `.sessions/` between
            # this tick's dir-existence check and this exact open; a
            # single swallowed ENOENT here must never crash the thread.
            try:
                fd = os.open(str(closing_marker), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.close(fd)
            except (FileExistsError, FileNotFoundError):
                return True  # double-fire guard, or a vanished dir -- either way, safe to retry next tick
            if live_session_ids(sessions_dir):
                try:
                    closing_marker.unlink()
                except OSError:
                    pass
                # PT-90 AC2: a race window, not deterministically
                # triggerable by a test -- logged per the ruling anyway.
                if st["shutdown_deadline"] is not None:
                    print(f"grace-window cancelled: registry non-empty at {_now_iso()}, session registered during the closing race, staying up", file=sys.stderr)
                st["shutdown_deadline"] = None
                return True
            # Nothing after this aborts. §5 ordering: socket closed
            # first, then flush, then compare-and-delete the pidfile,
            # then remove `.closing`. `.shutdown()` (cross-thread safe --
            # `serve_forever()` is running on the main thread right now)
            # only stops the accept LOOP; it blocks until that loop has
            # genuinely exited, but the fd stays bound until
            # `server_close()` actually runs -- and a racing
            # `--ensure-running`'s port-freed probe depends on the fd
            # being gone, not just unaccepted. Close it here, from this
            # thread, right after `.shutdown()` unblocks, rather than
            # leaving it to `serve()`'s own `finally` (whose timing
            # relative to this thread is not guaranteed) -- a second
            # `server_close()` there afterward is a harmless no-op.
            httpd.shutdown()
            httpd.server_close()
            flushed = _do_flush()
            _compare_and_delete_pidfile(pidfile, my_pid)
            # PT-90 AC1 (gate-4 verdict delta 1, PT-90.md @ 390c07e): the
            # point of no return was passed at the `.closing` marker, not
            # at the pidfile, so everything this line reports is equally
            # true here -- and placing it after the pidfile removal takes
            # this buffered file write out of the window
            # `_wait_for_status_not_running` races between
            # `server_close()` and the pidfile actually being gone
            # (measured: 1-in-9 flake with the line inside that window).
            print(f"self-stop: registry drained at {_now_iso()}, grace {grace_period_seconds}s elapsed, flushed {flushed} lines, exiting", file=sys.stderr)
            try:
                closing_marker.unlink()
            except OSError:
                pass
            return False

        # An immediate first heartbeat, BEFORE the first tick's own
        # `wake_event.wait(WATCHDOG_TICK_SECONDS)` -- which always waits
        # the full tick interval unless nudged, and nothing nudges a
        # freshly-started daemon. Without this, `--status` (a separate,
        # polling CLI invocation) can observe "running" (port bound,
        # pidfile written -- both already true by the time this thread
        # starts) with no heartbeat file yet for up to one tick, which
        # `_status` correctly reports as `absent` rather than `alive` --
        # not the forbidden state, but not the steady-state answer a
        # caller polling for "genuinely up" expects either.
        if sessions_dir.is_dir():
            try:
                (sessions_dir / WATCHDOG_HEARTBEAT_MARKER_NAME).write_text(_now_iso(), encoding="utf-8")
                st["last_heartbeat_write"] = time.monotonic()
            except OSError:
                pass

        while True:
            nudged = wake_event.wait(WATCHDOG_TICK_SECONDS)
            wake_event.clear()
            if stopping:
                return
            try:
                keep_going = _tick(nudged)
            except BaseException as exc:  # noqa: BLE001 -- the belt, deliberately broad
                _watchdog_fatal_shutdown(exc)
                return  # unreachable in practice -- _watchdog_fatal_shutdown hard-exits the process
            if not keep_going:
                return

    watchdog = threading.Thread(target=_watchdog_loop, daemon=True)
    watchdog.start()
    try:
        httpd.serve_forever()
    finally:
        # Setting `stopping` + waking wakes an IDLING watchdog
        # immediately. But when THIS thread is here because the WATCHDOG
        # itself called `httpd.shutdown()` (the point-of-no-return path),
        # the watchdog is not idling -- it is mid-flight through its own
        # final flush / compare-and-delete-pidfile / `.closing` removal.
        # `daemon=True` means the interpreter will NOT wait for it once
        # this (main) thread finishes -- without an explicit join here, a
        # fast enough main-thread exit truncates that work mid-flush,
        # silently dropping the very grace-window datapoint AC 2 exists
        # to protect. Join (bounded, as a safety net -- this thread's own
        # work is already done at this point either way) before this
        # function is allowed to return.
        stopping = True
        wake_event.set()
        watchdog.join(timeout=10.0)
        try:
            httpd.server_close()
        except OSError:
            pass
        _compare_and_delete_pidfile(pidfile, my_pid)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main(argv: Optional[List[str]] = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    parser = argparse.ArgumentParser(description="PT-78 OTLP token-usage receiver (cairn)")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--out-file", type=Path, default=None)
    parser.add_argument("--flush-interval", type=int, default=DEFAULT_FLUSH_INTERVAL_SECONDS)
    parser.add_argument("--pidfile", type=Path, default=None)
    parser.add_argument("--repo-root", type=Path, default=None)
    parser.add_argument("--transcripts-dir", type=Path, default=None)
    parser.add_argument("--ingest", default=None, help="path to an OTLP-JSON payload, or '-' for stdin")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--ensure-running", action="store_true")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--flush-now", action="store_true")
    parser.add_argument("--stop", action="store_true")
    # PT-86: the last-session-ends-the-daemon-stops-itself lifecycle
    # (process/cairn/issues/PT-86.md, architect addendum §D -- the seam,
    # pinned). Both `--ensure-running`'s and `--session-ended`'s session
    # id are optional and fall back to the hook's stdin JSON when absent
    # (`_resolve_session_id`); `--session-ended` additionally accepts its
    # id as its OWN inline value (`nargs="?"`) since §D writes it as
    # `--session-ended [ID]` -- an explicit `--session-id` is still
    # accepted too and wins if the inline value is absent.
    parser.add_argument("--session-id", default=None, help="the SessionStart/SessionEnd hook's session_id")
    parser.add_argument("--session-pid", type=int, default=None, help="the liveness-probe pid ($PPID); absent/0 -> pid: null, never reaped")
    parser.add_argument(
        "--session-ended", nargs="?", const="", default=None, metavar="SESSION_ID",
        help="deregister SESSION_ID (or --session-id, or the hook's stdin JSON) -- the SessionEnd hook's target",
    )
    parser.add_argument("--grace-period-seconds", "--grace", dest="grace_period_seconds", type=float, default=DEFAULT_GRACE_PERIOD_SECONDS)
    parser.add_argument("--periodic-reap-seconds", type=float, default=DEFAULT_PERIODIC_REAP_SECONDS)
    parser.add_argument("--registry-absent-recreate-seconds", type=float, default=REGISTRY_ABSENT_RECREATE_SECONDS)
    parser.add_argument(
        "--user-settings-path", type=Path, default=None,
        help="override for the H3 resolver's user-scope settings file (default: $CLAUDE_CONFIG_DIR/settings.json "
        "or ~/.claude/settings.json) -- test-only, see _exporter_endpoint",
    )
    args = parser.parse_args(argv)

    # `repo_root` anchors everything: prefix, roster, --out-file's
    # default, the transcripts-dir slug, the pidfile, the sessions dir,
    # and the logfile always come from the REAL project's MAIN CHECKOUT
    # -- this receiver operates on ONE tracker, always, never a fake one,
    # and only ONE daemon/pidfile/sessions-dir, always the main
    # checkout's, regardless of which worktree this CLI call's own script
    # copy happens to be running from. POLY-49 ruling §3 (carried "flush
    # from a worktree" finding): before this redirect, `--ensure-running`/
    # `--session-ended`/`--status`/`--flush-now`/`--stop` invoked from a
    # teammate's linked worktree each resolved their OWN (never-mounted)
    # `process/cairn/metrics/` instead of the main checkout's real one --
    # a registration, a flush signal, or a status probe from a worktree
    # silently missed the actual running daemon entirely.
    # `worktree_root.main_checkout_root` is a no-op (returns its input
    # unchanged) everywhere except inside a LINKED worktree, so the main
    # checkout's own behaviour, and a fake-engine-root test copy's, are
    # both unaffected. `--repo-root` overrides ONLY where `_current_branch`
    # asks git, which is the sole reason a test (or an operator) would
    # ever need a different one: to control the branch signal without
    # touching cwd.
    repo_root = worktree_root.main_checkout_root(backfill_tokens._repo_root())
    branch_repo_root = args.repo_root or repo_root
    try:
        prefix = _resolve_prefix(repo_root)
    except cairn.CairnError as e:
        print(f"error: could not read the tracker prefix from config.yml: {e}", file=sys.stderr)
        return 1

    out_path = args.out_file or (repo_root / backfill_tokens.DEFAULT_OUT_REL)
    pidfile = args.pidfile or (repo_root / PIDFILE_REL)
    port = args.port if args.port is not None else _receiver_port(repo_root)
    roster = backfill_tokens._roster_names(repo_root)
    transcripts_dir = args.transcripts_dir or (
        Path.home() / ".claude" / "projects" / backfill_tokens._transcript_dir_slug(repo_root)
    )

    if args.ensure_running:
        # §2/§D: absent --session-id falls back to the hook's stdin JSON
        # (never blocks -- only reads when stdin is not a TTY). A bare
        # `--ensure-running` with no id anywhere (every pre-PT-86 call
        # site, and this project's own PT-81 hardening tests) registers
        # nothing -- back-compat, and §6: a registry that has never been
        # non-empty can never trigger a self-stop.
        session_id = _resolve_session_id(None, args.session_id)
        session_pid = args.session_pid if args.session_pid else None  # 0 or absent -> null
        ensure_running(
            repo_root, pidfile, port, grace_period_seconds=args.grace_period_seconds,
            session_id=session_id, session_pid=session_pid, transcripts_dir=transcripts_dir,
            periodic_reap_seconds=args.periodic_reap_seconds,
            registry_absent_recreate_seconds=args.registry_absent_recreate_seconds,
            user_settings_path=args.user_settings_path,
        )
        # Deliberately NOT nudged: the watchdog's regular
        # WATCHDOG_TICK_SECONDS tick already re-checks emptiness every
        # cycle regardless of any nudge (POLY-49 ruling §4: the reap
        # itself is unconditional every tick now too, nudge or not), so a
        # `start` still cancels a pending grace-shutdown within one tick
        # without this. Nudging here too would make a freshly-registered
        # (possibly already-dead-pid, e.g. a crashed session respawned
        # before its own SessionEnd could ever fire) entry get swept on
        # the very next tick regardless of whether anything actually
        # ended -- exactly the "on every decrement" boundary
        # `--session-ended`'s nudge used to draw (now moot for reaping,
        # but the nudge still wakes the loop early for the self-stop
        # grace re-evaluation).
        return 0  # never an error -- a non-cairn checkout just declines

    if args.session_ended is not None:
        session_id = _resolve_session_id(args.session_ended or None, args.session_id)
        # §10: every control-path failure is non-fatal -- one stderr
        # line, exit 0. No session id resolved at all is not even a
        # failure: a SessionEnd hook must never fail teardown over
        # telemetry, and cannot block it either way.
        if not session_id:
            return 0
        # Architect review (ef000d5), Delta 2: deregistration is a LOCAL
        # FILE OPERATION and must be unconditional -- a session ending
        # while no daemon is running (or mid-shutdown, just after its
        # pidfile was compare-and-deleted) must still remove its own
        # `.sessions/<id>` file. Skipping this when the pidfile check
        # fails left a phantom entry for the NEXT daemon to inherit,
        # pinned by its own fresh transcript for up to 30 minutes. Only
        # the nudge below (which has nothing to nudge) is gated on a
        # live pid.
        sessions_dir = _sessions_dir(pidfile)
        deregister_session(sessions_dir, session_id)
        # §3's "on every decrement" reap is done by the DAEMON, not here:
        # only the daemon (spawned with its own, possibly test-overridden
        # `--transcripts-dir`) knows the transcripts_dir its two-signal
        # probe (addendum C) must consult -- this CLI process's own
        # resolution is not guaranteed to agree (and in the real,
        # single-project-per-machine case it always does, so nothing is
        # lost there). The nudge makes that reap near-immediate rather
        # than waiting up to WATCHDOG_TICK_SECONDS -- but only if a
        # daemon is actually alive to receive it.
        pid = _read_pidfile(pidfile)
        if pid is not None and _pid_is_alive(pid):
            _nudge_daemon(pidfile)
        return 0

    if args.status:
        exporter_endpoint_info = _exporter_endpoint(dict(os.environ), args.user_settings_path)
        return _status(pidfile, port, out_path, _sessions_dir(pidfile), transcripts_dir, exporter_endpoint_info)

    if args.flush_now:
        return _signal_running(pidfile, signal.SIGUSR1, "--flush-now")

    if args.stop:
        return _signal_running(pidfile, signal.SIGTERM, "--stop")

    if args.ingest is not None:
        try:
            raw = sys.stdin.buffer.read() if args.ingest == "-" else Path(args.ingest).read_bytes()
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            print(f"error: malformed OTLP JSON in {args.ingest}: {e}", file=sys.stderr)
            return 1
        except OSError as e:
            print(f"error: could not read {args.ingest}: {e}", file=sys.stderr)
            return 1
        try:
            datapoints = parse_export(payload)
        except ReceiverError as e:
            print(f"error: {e}", file=sys.stderr)
            return 1
        state = ReceiverState()
        fold(datapoints, state)
        branch = _current_branch(branch_repo_root)
        hint = _issue_hint_from_datapoints(datapoints)
        milestone_windows_table = cairn.milestone_windows(branch_repo_root)
        issue = resolve_issue(branch, prefix, hint, milestone_windows_table=milestone_windows_table)
        try:
            lines = flush(state, out_path, issue, _now_iso(), roster=roster, transcripts_dir=transcripts_dir, milestone_windows_table=milestone_windows_table)
        except (ReceiverError, backfill_tokens.BackfillError) as e:
            print(f"error: {e}", file=sys.stderr)
            return 1
        print(f"flushed {len(lines)} line(s) to {out_path}")
        return 0

    if args.once:
        return run_once(port, out_path, branch_repo_root, prefix, roster, transcripts_dir)

    serve(
        port, out_path, pidfile, args.flush_interval, branch_repo_root, prefix, roster, transcripts_dir,
        sessions_dir=_sessions_dir(pidfile), grace_period_seconds=args.grace_period_seconds,
        periodic_reap_seconds=args.periodic_reap_seconds,
        registry_absent_recreate_seconds=args.registry_absent_recreate_seconds,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
