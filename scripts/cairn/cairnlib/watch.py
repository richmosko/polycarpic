"""cairnlib.watch — Live push (PT-1): a periodic fs-scan watcher + SSE
broadcaster; and engine-staleness detection (PT-49/POLY-58).

Stdlib only, per the boring-stack principle -- no watchdog/inotify dep. A
background thread os.scandirs the four tracked subdirs on a fixed cadence
and diffs (relative path, mtime_ns) against the previous scan; any
difference is one coarse "something changed" event broadcast to every
subscribed SSE client (never a per-id targeted diff -- deferred, see the
PT-1 issue file). Purely in-memory: no durable state, killing the server
drops every subscriber and the watcher with it (stateless lens,
unchanged).

The running Python PROCESS, not the data files it re-reads on every
request, is the thing that can go stale: `_send_static`/`build_board_
payload` already re-parse disk on every call, so an upgraded engine is
invisible to a server that was started before the upgrade landed --
exactly the "?archived=1 does nothing" bug this closes. Fingerprints the
engine's own source ONLY (§1) -- a content hash, not a git hash (§2): git
names the checked-out commit, not which bytes the running process
imported, and an uncommitted edit (the actual incident) has no commit at
all.

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 17).
"""

import hashlib
import queue
import sys
import threading
import urllib.parse
from pathlib import Path
from typing import Any, Dict, List

from cairnlib.store import _dir_glob, archived_issue_paths
from cairnlib.multiroot import Root

__all__ = [
    "DataDirWatcher",
    "_SSEBroadcaster",
    "_WATCHED_SUBDIRS",
    "_dashboard_is_servable",
    "_is_embed_request",
    "diff_scans",
    "engine_fingerprint",
    "engine_is_stale",
    "scan_data_dir",
]

_WATCHED_SUBDIRS = (
    "majors", "milestones", "issues",
    # PT-39 (architect's ruling § 4): additive -- the two new archive
    # subdirs, else the SSE watcher never notices a milestone/major
    # getting archived. _dir_glob/scan_data_dir already handle a
    # multi-segment subdir string fine (Path / str splits on "/").
    "archive/milestones", "archive/majors",
    # PT-50/PT-52: bare "archive" (issues) deliberately not in this tuple
    # -- archived-issue watching is handled below via archived_issue_paths,
    # the single read site every other archived-issue consumer routes
    # through. No change needed here across the PT-52 deletion: this
    # tuple never carried the legacy leg to begin with.
)


def scan_data_dir(data_dir: Path) -> Dict[str, int]:
    """{"<relative path>": mtime_ns} across majors/milestones/issues/
    archive/{issues,milestones,majors} -- the same directory set
    check_repo and build_board_payload already walk, via the same
    _dir_glob (so mkstemp's hidden ".*.tmp" temp files, which don't match
    "*.md", never show up as a false "change" mid-write). Missing subdirs
    are tolerated, mirroring _dir_glob's "if d.exists() else []".
    """
    data_dir = Path(data_dir)
    snapshot: Dict[str, int] = {}
    for sub in _WATCHED_SUBDIRS:
        for p in _dir_glob(data_dir / sub):
            try:
                snapshot[f"{sub}/{p.name}"] = p.stat().st_mtime_ns
            except FileNotFoundError:
                continue  # raced with a delete between the glob and the stat
    # PT-52: archived issues (archive/issues/ only) -- keys land as
    # "archive/issues/<id>.md", matching the pre-existing "<sub>/<file>.md"
    # key shape above (p is already under data_dir/archive/issues/).
    for p in archived_issue_paths(data_dir):
        try:
            snapshot[str(p.relative_to(data_dir))] = p.stat().st_mtime_ns
        except FileNotFoundError:
            continue  # raced with a delete between the glob and the stat
    return snapshot


def diff_scans(previous: Dict[str, int], current: Dict[str, int]) -> Dict[str, List[str]]:
    """{"created": [...], "changed": [...], "removed": [...]} of relative
    path strings, sorted. `any(diff.values())` is the watcher's cheap
    "did anything happen at all" signal before it bothers broadcasting.
    """
    created = sorted(k for k in current if k not in previous)
    removed = sorted(k for k in previous if k not in current)
    changed = sorted(k for k in current if k in previous and current[k] != previous[k])
    return {"created": created, "changed": changed, "removed": removed}


class _SSEBroadcaster:
    """In-memory registry of connected SSE clients' queues -- no durable
    state, exactly the stateless-lens contract: killing the server drops
    every subscriber with it.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: List["queue.Queue[Dict[str, Any]]"] = []

    def subscribe(self) -> "queue.Queue[Dict[str, Any]]":
        q: "queue.Queue[Dict[str, Any]]" = queue.Queue()
        with self._lock:
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q: "queue.Queue[Dict[str, Any]]") -> None:
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def broadcast(self, event: Dict[str, Any]) -> None:
        with self._lock:
            subscribers = list(self._subscribers)
        for q in subscribers:
            q.put(event)


class DataDirWatcher:
    """Periodic fs-scan watcher (PT-1). Every `interval` seconds, rescans
    every root in `roots` and diffs the merged scan against the previous
    one; any change gets broadcast as one coarse event to every subscribed
    SSE client (the COARSE event contract, per team-lead's ruling --
    clients refetch the whole board on any event, no per-id targeted
    diff).

    PT-3: takes `roots` (a `List[Root]`), not a bare `data_dir` --
    `scan_data_dir`'s keys ("<sub>/<file>.md") collide across roots (two
    repos can each have a milestones/0.5.md), so each root's scan is
    merged under a `"<root.id>:<sub>/<file>.md"` prefix before diffing.
    Single-root callers pass a one-element `roots` list; the merged-key
    format costs them nothing since there's nothing to collide with.

    Lifecycle is bound to the caller that constructs it (make_server),
    not to `cmd_serve`: the baseline snapshot is taken synchronously in
    __init__, before `start()` -- so a client that connects to the SSE
    endpoint immediately after the server object exists never sees the
    data dir's pre-existing files misreported as freshly "created".
    `stop()` is idempotent and returns promptly (Event.wait, not a sleep
    loop) so server teardown in tests isn't slowed down by it.
    """

    def __init__(self, roots: List[Root], broadcaster: _SSEBroadcaster, interval: float = 1.0) -> None:
        self._roots = roots
        self._broadcaster = broadcaster
        self._interval = interval
        self._stop_event = threading.Event()
        self._snapshot = self._scan_all()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _scan_all(self) -> Dict[str, int]:
        merged: Dict[str, int] = {}
        for root in self._roots:
            for key, mtime in scan_data_dir(root.path).items():
                merged[f"{root.id}:{key}"] = mtime
        return merged

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def _run(self) -> None:
        while not self._stop_event.wait(self._interval):
            current = self._scan_all()
            diff = diff_scans(self._snapshot, current)
            self._snapshot = current
            if any(diff.values()):
                self._broadcaster.broadcast(diff)


def engine_fingerprint(source_path: Path) -> Dict[str, Any]:
    """`{"sha": sha256(bytes)[:12], "mtime_ns": ..., "size": ...}` for
    `source_path` (§2). Captured ONCE, at server construction
    (`make_server`), and held on the handler closure as the immutable
    "boot" fingerprint every later `engine_is_stale` call compares
    against -- never recomputed mid-process.

    POLY-58 §4: `source_path` may also be a directory (the post-split
    `cairnlib/` package) -- `mtime_ns` is the max and `size` the sum over
    the directory's `*.py` files, `sha` is sha256 over the sorted
    `(name, NUL, bytes)` of the same files, first 12 hex. A file keeps
    the original single-file behavior unchanged."""
    source_path = Path(source_path)
    if source_path.is_dir():
        hasher = hashlib.sha256()
        mtimes = []
        total_size = 0
        for f in sorted(source_path.glob("*.py")):
            data = f.read_bytes()
            st = f.stat()
            mtimes.append(st.st_mtime_ns)
            total_size += st.st_size
            hasher.update(f.name.encode("utf-8"))
            hasher.update(b"\x00")
            hasher.update(data)
        return {
            "sha": hasher.hexdigest()[:12],
            "mtime_ns": max(mtimes) if mtimes else 0,
            "size": total_size,
        }
    data = source_path.read_bytes()
    st = source_path.stat()
    return {"sha": hashlib.sha256(data).hexdigest()[:12], "mtime_ns": st.st_mtime_ns, "size": st.st_size}


def engine_is_stale(source_path: Path, boot: Dict[str, Any]) -> bool:
    """§3's two-tier self-check, run fresh on each `/api/board` build.
    `os.stat` first: `(mtime_ns, size)` equal to `boot` -> not stale, no
    read at all (the common case, one stat). Different -> hash the file
    and compare shas; only a DIFFERING sha is stale -- a `git checkout`
    that touches mtime without changing bytes must never raise a false
    alarm. Source missing/unreadable -> not stale (never invent an
    alarm from a read failure), one stderr line.

    POLY-58 §4: `source_path` may also be a directory -- there is no
    single-stat shortcut across multiple files, so a directory always
    recomputes the full fingerprint and compares shas directly."""
    source_path = Path(source_path)
    try:
        is_dir = source_path.is_dir()
    except OSError as e:
        print(f"cairn: warning: engine staleness check could not stat {source_path}: {e}", file=sys.stderr)
        return False
    if is_dir:
        try:
            current = engine_fingerprint(source_path)
        except OSError as e:
            print(f"cairn: warning: engine staleness check could not read {source_path}: {e}", file=sys.stderr)
            return False
        return current["sha"] != boot["sha"]
    try:
        st = source_path.stat()
    except OSError as e:
        print(f"cairn: warning: engine staleness check could not stat {source_path}: {e}", file=sys.stderr)
        return False
    if st.st_mtime_ns == boot["mtime_ns"] and st.st_size == boot["size"]:
        return False
    try:
        current_sha = hashlib.sha256(source_path.read_bytes()).hexdigest()[:12]
    except OSError as e:
        print(f"cairn: warning: engine staleness check could not read {source_path}: {e}", file=sys.stderr)
        return False
    return current_sha != boot["sha"]


def _dashboard_is_servable(dashboard_dir: Path) -> bool:
    """PT-73 (architect ruling §2): the ONE shared predicate the root
    redirect and `/dashboard` route both call, so the two routes can
    never drift into disagreeing about whether the dashboard exists --
    that disagreement's only failure modes are a redirect loop or a dead
    end, and it would only ever surface in the exact "half-built dist"
    state nobody tests by hand. Deliberately `(dashboard_dir /
    "index.html").is_file()`, NOT `dashboard_dir.is_dir()`: a dist/ that
    exists but is empty or partially cleaned must not send a user away
    from a perfectly serviceable board and into a broken dashboard.
    """
    return (dashboard_dir / "index.html").is_file()


def _is_embed_request(query: str) -> bool:
    """PT-73 (architect ruling §3): the root redirect's embed carve-out
    is a RECURSION GUARD, not a convenience -- the dashboard shell
    iframes `/?embed=1`. If that request redirected, the iframe would
    load `/dashboard`, which renders the SPA, which mounts an iframe
    pointing at `/?embed=1`, which would redirect again. This is the
    exact infinite-recursion bug board-logic.js's `isEmbedMode` was
    created for in PT-55, and this function mirrors its semantics
    EXACTLY: key `embed` present with value `"1"`, position in the query
    string irrelevant, other params (`readonly`, `open`) ignored,
    first-match-wins on a repeated key. A mismatch between this and the
    JS-side reading of the same param would be a recursion, not a
    cosmetic bug -- keep the two in lockstep if either ever changes.
    """
    for key, value in urllib.parse.parse_qsl(query, keep_blank_values=True):
        if key == "embed":
            return value == "1"
    return False
