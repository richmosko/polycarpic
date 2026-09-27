"""cairnlib.flow — Issue flow over time (PT-61/PT-85): GET /api/flow, a
git-reconstruction (blob-based) throughput view, memoized per HEAD sha.

A SEPARATE endpoint from /api/dashboard on PT-56's roster precedent
(different cost profile, different cache key, different freshness
cadence). Architect's ruling (process/cairn/issues/PT-61.md, commit
1eae1b2): "chart data source: (a) git reconstruction, blob-based" -- the
status field's history is already stored losslessly in git; reconstructing
it beats adding a writer this template has no trigger for, and beats a
second ad hoc parser of the file format (PT-54 §4: never a second parser
over the same files).

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 12).
"""

import datetime
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from cairnlib.errors import CairnError, FrontmatterError
from cairnlib.records import parse_frontmatter
from cairnlib.config import load_config
from cairnlib.store import _repo_root_for
from cairnlib.attribution import _MILESTONE_REL_PATHS, milestone_windows

__all__ = [
    "FLOW_THROUGHPUT_SCOPE_NOTE",
    "_FLOW_CACHE",
    "_FLOW_CACHE_MAX",
    "_FLOW_RAW_LINE_RE",
    "_compute_flow_payload",
    "_flow_cat_file_batch",
    "_flow_find_git_dir",
    "_flow_milestone_lookup",
    "_flow_read_head_sha_pure",
    "_parse_flow_events",
    "build_flow_payload",
]

FLOW_THROUGHPUT_SCOPE_NOTE = (
    "Opened/closed reflect real status transitions in git history, never the "
    "issue file's `created:` field -- an issue archived and later re-added is "
    "never double-counted as a new open. Each period is a UTC calendar day (or "
    "an ISO week of those days); a late-evening commit in another timezone can "
    "land on the next day. WIP (in-progress + in-review) is a point-in-time "
    "count at the END of each period, not an activity count -- and, like "
    "opened/closed, reflects the last COMMITTED state, never an uncommitted "
    "working-tree edit."
)

# Bounded in-process memo, per data_dir: {str(data_dir): (head_sha, payload)}.
# "Last few entries" per the ruling -- insertion-order eviction, plain dict
# (Python 3.7+ dicts preserve insertion order; no need for OrderedDict).
_FLOW_CACHE: Dict[str, Tuple[str, Dict[str, Any]]] = {}
_FLOW_CACHE_MAX = 8


def _flow_find_git_dir(start: Path) -> Optional[Path]:
    """Pure filesystem walk-up from `start` looking for a `.git` entry
    (directory, or a file for worktrees/submodules) -- NO subprocess.
    Mirrors git's own directory-walk-up discovery; used only as this
    cache's cheap "did HEAD move" probe below. Every actual git ANSWER
    (history, blob content, the authoritative HEAD sha in the payload)
    still comes from a real `git` subprocess in `_compute_flow_payload` --
    this never substitutes for that, it only decides whether re-running
    it is necessary.
    """
    current = Path(start).resolve()
    for _ in range(64):  # bounded -- never loops forever on a symlink cycle
        candidate = current / ".git"
        if candidate.exists():
            return candidate
        if current.parent == current:
            return None
        current = current.parent
    return None


def _flow_read_head_sha_pure(data_dir: Path) -> Optional[str]:
    """The current HEAD commit sha via plain file reads only -- no
    subprocess. Handles a symbolic HEAD (the common case: reads the loose
    ref file `.git/refs/heads/<branch>` it points at) and a detached HEAD
    (the sha sits directly in `.git/HEAD`). Returns `None` for anything it
    can't resolve this way (most commonly a PACKED ref with no loose
    override, e.g. right after `git gc`) -- callers must treat `None` as
    "unknown, don't trust the cache" and fall through to a real `git
    rev-parse HEAD` subprocess, never guess at a value. This is a cache-
    freshness probe, not a second implementation of git's ref resolution:
    it makes no claim beyond what it can read directly off disk.
    """
    git_dir = _flow_find_git_dir(data_dir)
    if git_dir is None:
        return None
    try:
        if git_dir.is_file():
            # worktree / submodule: ".git" is "gitdir: <path>"
            text = git_dir.read_text(encoding="utf-8").strip()
            if not text.startswith("gitdir:"):
                return None
            gd = Path(text[len("gitdir:"):].strip())
            git_dir = gd if gd.is_absolute() else (data_dir / gd).resolve()
        head_text = (git_dir / "HEAD").read_text(encoding="utf-8").strip()
    except OSError:
        return None
    sha_re = re.compile(r"^[0-9a-fA-F]{40,64}$")
    if head_text.startswith("ref:"):
        ref_rel = head_text[len("ref:"):].strip()
        try:
            sha = (git_dir / ref_rel).read_text(encoding="utf-8").strip()
        except OSError:
            return None  # likely a packed ref -- don't guess, fall through
        return sha if sha_re.match(sha) else None
    return head_text if sha_re.match(head_text) else None


_FLOW_RAW_LINE_RE = re.compile(
    r"^:(?:\d+) (?:\d+) [0-9a-f]+ ([0-9a-f]+) ([A-Z])\d*\t(.+)$"
)


def _parse_flow_events(raw_output: str) -> List[Dict[str, Any]]:
    """Parses `git log --reverse -M --format=%x00%H%x09%cI --raw
    --no-abbrev -- issues/ archive/issues/` output into an ordered list of
    change events, oldest first (git's own `--reverse` commit order):
    `{"day": "YYYY-MM-DD" (UTC), "path": <repo-root-relative path>,
    "status_letter": "A"|"M"|"D"|"R"|..., "blob_sha": <new blob sha, None
    for a delete>}`. `%x00` is a delimiter that cannot collide with any
    path/sha/date content, so this never needs to sniff for a "commit"
    keyword the way a `git log -p | grep` scrape would. A rename
    (`-M`, e.g. the issues/ -> archive/issues/ move) is ONE `R###` raw
    line carrying both paths tab-separated; the NEW path (last field) is
    what callers key on, matching "current filename wins" -- the entity's
    identity comes from the STEM the caller extracts from this path, not
    from the path itself (PT-61 ruling: "key by filename stem, never by
    path").
    """
    events: List[Dict[str, Any]] = []
    if not raw_output:
        return events
    for chunk in raw_output.split("\x00"):
        if not chunk:
            continue
        header, _, rest = chunk.partition("\n\n")
        _sha, _, date_part = header.partition("\t")
        if not date_part:
            continue
        try:
            commit_dt = datetime.datetime.fromisoformat(date_part.strip())
        except ValueError:
            continue
        if commit_dt.tzinfo is None:
            commit_dt = commit_dt.replace(tzinfo=datetime.timezone.utc)
        day = commit_dt.astimezone(datetime.timezone.utc).date().isoformat()
        for line in rest.split("\n"):
            if not line.startswith(":"):
                continue
            m = _FLOW_RAW_LINE_RE.match(line)
            if not m:
                continue
            new_blob, status_letter, paths_field = m.groups()
            path = paths_field.split("\t")[-1]  # R###/C###: old\tnew -- take new
            events.append({
                "day": day,
                "path": path,
                "status_letter": status_letter,
                "blob_sha": None if status_letter == "D" else new_blob,
            })
    return events


def _flow_cat_file_batch(data_dir: Path, shas: List[str]) -> Dict[str, bytes]:
    """`git cat-file --batch`, fed the DEDUPED blob shas once, parsed as
    raw BYTES throughout -- the ruling's own named failure mode: the batch
    header's `<size>` is a byte count, and decoding the stream as text
    before slicing mis-slices on any multi-byte UTF-8 character (an em
    dash, 3 bytes, broke the first prototype on this repo's own issue
    prose). `subprocess.run` here is deliberately NOT given `text=True` --
    `.stdout` stays `bytes`, sliced by the byte-count header, decoded only
    AFTER slicing. Returns `{sha: raw_content_bytes}`; a sha git reports
    "missing" (should not happen for shas this module just read from its
    own `git log`, but never trusted blindly) is simply absent.
    """
    if not shas:
        return {}
    import subprocess

    stdin_bytes = ("\n".join(shas) + "\n").encode("ascii")
    try:
        result = subprocess.run(
            ["git", "-C", str(data_dir), "cat-file", "--batch"],
            input=stdin_bytes, capture_output=True, timeout=30,
        )
    except (FileNotFoundError, OSError):
        return {}
    if result.returncode != 0:
        return {}
    out = result.stdout
    parsed: Dict[str, bytes] = {}
    pos = 0
    n = len(out)
    while pos < n:
        nl = out.find(b"\n", pos)
        if nl == -1:
            break
        header = out[pos:nl].decode("ascii", errors="replace")
        pos = nl + 1
        parts = header.split(" ")
        if len(parts) < 2:
            break
        sha = parts[0]
        if parts[1] == "missing":
            continue
        if len(parts) < 3:
            break
        try:
            size = int(parts[2])
        except ValueError:
            break
        parsed[sha] = out[pos:pos + size]  # BYTE slice -- never text-mode
        pos += size
        if pos < n and out[pos:pos + 1] == b"\n":
            pos += 1
    return parsed


def _compute_flow_payload(data_dir: Path) -> Dict[str, Any]:
    """The real reconstruction -- always hits git (this is the cache-miss
    path; `build_flow_payload` below is the memoizing wrapper). Same
    whole-group-degrades posture as `read_git_state`: git missing or
    `data_dir` outside a worktree -> `series: []` + a warning, never a
    raise (the HTTP layer turns any payload from this module into 200,
    never 500 -- there is no exception path here to turn into one).
    """
    import subprocess

    data_dir = Path(data_dir)

    def _run(*args: str, timeout: float = 15) -> Optional["subprocess.CompletedProcess"]:
        try:
            return subprocess.run(
                ["git", "-C", str(data_dir)] + list(args),
                capture_output=True, timeout=timeout,
            )
        except (FileNotFoundError, OSError):
            return None

    # Full sha, not --short: this is compared byte-for-byte against
    # `_flow_read_head_sha_pure`'s pure-file-read result below (which
    # necessarily reads the FULL ref content) -- an abbreviated sha would
    # never match, permanently defeating the cache. `as_of` in the
    # payload is this same full value; nothing downstream needs it
    # shortened, and a short sha's length is itself repo-size-dependent,
    # one more way it could silently stop matching.
    head_result = _run("rev-parse", "HEAD", timeout=5)
    if head_result is None or head_result.returncode != 0:
        return {
            "period": "day",
            "series": [],
            "milestones": [],
            "default_milestone": None,
            "as_of": None,
            "scope": FLOW_THROUGHPUT_SCOPE_NOTE,
            "warning": "git unavailable or not a worktree -- issue flow history cannot be reconstructed",
            "closed_at": {},
        }
    head_sha = head_result.stdout.decode("utf-8", errors="replace").strip()

    log_result = _run(
        "log", "--reverse", "-M", "--format=%x00%H%x09%cI", "--raw", "--no-abbrev",
        "--", "issues/", "archive/issues/",
    )
    if log_result is None or log_result.returncode != 0:
        return {
            "period": "day",
            "series": [],
            "milestones": [],
            "default_milestone": None,
            "as_of": head_sha,
            "scope": FLOW_THROUGHPUT_SCOPE_NOTE,
            "warning": "git log failed -- issue flow history unavailable",
            "closed_at": {},
        }

    events = _parse_flow_events(log_result.stdout.decode("utf-8", errors="replace"))
    if not events:
        return {
            "period": "day", "series": [], "milestones": [], "default_milestone": None,
            "as_of": head_sha, "scope": FLOW_THROUGHPUT_SCOPE_NOTE, "warning": None,
            "closed_at": {},
        }

    blob_shas = sorted(set(e["blob_sha"] for e in events if e["blob_sha"]))
    blob_contents = _flow_cat_file_batch(data_dir, blob_shas)

    blob_status: Dict[str, Optional[str]] = {}
    blob_milestone: Dict[str, Optional[str]] = {}
    for sha, content in blob_contents.items():
        try:
            fm, _body = parse_frontmatter(content.decode("utf-8"))
        except Exception:  # noqa: BLE001 -- one bad historical blob must not break the whole reconstruction
            continue
        blob_status[sha] = fm.get("status")
        blob_milestone[sha] = fm.get("milestone")

    # PT-85: throughput reconstruction, extending the SAME walk (architect's
    # ruling 409d310, §1) -- `live`/`seen_stems` below replace the old
    # cumulative `counts` snapshot with opened/closed/cancelled/WIP,
    # per-milestone and overall, derived from real status TRANSITIONS
    # rather than frontmatter `created:` (which would make opened and
    # closed incomparable -- exactly PT-85's own defect, restated as a
    # fix). `seen_stems` is the §2 fix: an archive move is a delete-then-
    # add of the SAME stem and must never re-count as a new open; a
    # deletion removes the stem from `live` but never from `seen_stems`.
    # PT-85 addendum (ce521a5, corrected 76c970a): assignment is
    # historical (WHICH milestone an event belongs to still comes from
    # that event's own blob, unchanged), but IDENTITY is canonical --
    # the same line PT-84 already drew for milestone ids generally. A
    # bare, pre-PT-28 id (`0.6.1`) and its current form (`PT-0.6.1`) are
    # the SAME milestone; splitting one milestone's history across two
    # dropdown entries is worse than dropping the old activity entirely.
    # `parse_frontmatter` already strips quotes (verified, 76c970a) --
    # no quote-handling needed here, only the prefix step.
    repo_root = _repo_root_for(data_dir)
    milestone_info = _flow_milestone_lookup(repo_root)
    known_milestone_ids = set(milestone_info.keys())
    try:
        tracker_prefix = str(load_config(data_dir).get("prefix") or "")
    except CairnError:
        tracker_prefix = ""  # degrade to "no canonicalisation possible", never raise

    def _canonicalize_milestone_id(raw_id: str) -> str:
        if raw_id in known_milestone_ids:
            return raw_id
        if tracker_prefix:
            candidate = f"{tracker_prefix}-{raw_id}"
            if candidate in known_milestone_ids:
                return candidate
        # Fails closed: a genuinely unknown id (not a spelling of a known
        # one) survives as its own entry, per the addendum's own clause --
        # this is validated against real records, never alias-guessing.
        return raw_id

    live: Dict[str, str] = {}
    live_milestone: Dict[str, Optional[str]] = {}
    seen_stems: Set[str] = set()
    # Architect's review of 37f0cfe (f979784): a `D` clearing `live`
    # made the transition check read the re-add's `previous_status` as
    # `None`, so an archived-then-re-added `done` stem counted as a
    # FRESH close every time -- measured on the real corpus, `closed`
    # was inflated by exactly 43, the size of one bulk-archive commit.
    # `last_status` is the fix: it persists across a `D` exactly like
    # `seen_stems` does (never cleared there), so the transition check
    # below has the stem's true last-known status to compare against,
    # regardless of how many times it's been archived/re-added. `live`
    # keeps driving WIP unchanged -- a deleted stem must still stop
    # counting as in-flight, so only the TRANSITION's source changes.
    last_status: Dict[str, str] = {}
    # PT-102 (amended ruling, ccd4f48, item (a)): the status->done
    # transition date, per stem -- reused as `/api/tokens`'s chronological
    # sort key rather than a second git walk. Plain assignment, so a
    # reopened-then-reclosed stem's LATER close date wins for free, the
    # same "last write wins" shape `live`/`last_status` already use.
    closed_at: Dict[str, str] = {}
    # Milestone ids in FIRST-APPEARANCE order across the whole walk --
    # `by_milestone` (addendum 2f8eba0, change 1) is DENSE from a
    # milestone's first appearance onward, so this is also the set every
    # later `_emit_point` call iterates to emit a (possibly all-zero)
    # entry for every milestone already known, never just the ones with
    # an event that specific day.
    milestones_seen: List[str] = []
    milestones_seen_set: Set[str] = set()
    # milestone id -> latest day whose OWN opened/closed/cancelled was
    # non-zero (a transition day) -- addendum change 3: standing WIP
    # must never count as "activity" for default_milestone, or an
    # abandoned milestone with stale in-progress issues would stay the
    # default forever.
    transition_last_day: Dict[str, str] = {}

    series: List[Dict[str, Any]] = []
    current_day: Optional[str] = None
    # Per-day-in-progress transition counts, keyed by milestone id (None =
    # no milestone recorded on that blob) -- reset at each day boundary;
    # WIP is NOT accumulated here since it is a point-in-time snapshot of
    # `live` at period end, not a running count of events within the day.
    day_opened: Dict[Optional[str], int] = {}
    day_closed: Dict[Optional[str], int] = {}
    day_cancelled: Dict[Optional[str], int] = {}

    def _note_milestone_seen(mid: Optional[str]) -> None:
        if mid and mid not in milestones_seen_set:
            milestones_seen_set.add(mid)
            milestones_seen.append(mid)

    def _wip_by_milestone() -> Dict[Optional[str], int]:
        wip: Dict[Optional[str], int] = {}
        for stem, status in live.items():
            if status in ("in-progress", "in-review"):
                mid = live_milestone.get(stem)
                wip[mid] = wip.get(mid, 0) + 1
        return wip

    def _emit_point(day: str) -> None:
        wip = _wip_by_milestone()
        by_milestone: Dict[str, Dict[str, int]] = {}
        for mid in milestones_seen:  # DENSE: every milestone seen so far, not just today's
            opened = day_opened.get(mid, 0)
            closed = day_closed.get(mid, 0)
            cancelled = day_cancelled.get(mid, 0)
            by_milestone[mid] = {
                "opened": opened, "closed": closed, "cancelled": cancelled, "wip": wip.get(mid, 0),
            }
            if opened or closed or cancelled:
                transition_last_day[mid] = day
        series.append({
            "date": day,
            "opened": sum(day_opened.values()),
            "closed": sum(day_closed.values()),
            "cancelled": sum(day_cancelled.values()),
            "wip": sum(wip.values()),
            "by_milestone": by_milestone,
        })
        day_opened.clear()
        day_closed.clear()
        day_cancelled.clear()

    for event in events:
        day = event["day"]
        if current_day is not None and day != current_day:
            _emit_point(current_day)
        current_day = day
        stem = Path(event["path"]).stem
        if event["status_letter"] == "D":
            # §2: a deletion removes the stem from the live/WIP snapshot
            # but NEVER from seen_stems -- if this exact stem is ever
            # re-added later (the real archive-move shape), it must not
            # be counted as a new open.
            live.pop(stem, None)
            live_milestone.pop(stem, None)
            continue
        status = blob_status.get(event["blob_sha"])
        if status is None:
            # Unparseable/unresolved blob -- drop the stale entry rather
            # than guess at a status this reconstruction couldn't read;
            # deliberately does NOT touch seen_stems either, so a LATER,
            # parseable appearance of this same stem still counts as its
            # true first-ever open.
            live.pop(stem, None)
            live_milestone.pop(stem, None)
            continue
        milestone_id = blob_milestone.get(event["blob_sha"])
        if milestone_id:
            milestone_id = _canonicalize_milestone_id(milestone_id)
        _note_milestone_seen(milestone_id)
        previous_status = last_status.get(stem)
        if stem not in seen_stems:
            seen_stems.add(stem)
            day_opened[milestone_id] = day_opened.get(milestone_id, 0) + 1
        if status == "done" and previous_status != "done":
            day_closed[milestone_id] = day_closed.get(milestone_id, 0) + 1
            closed_at[stem] = day
        elif status == "cancelled" and previous_status != "cancelled":
            day_cancelled[milestone_id] = day_cancelled.get(milestone_id, 0) + 1
        live[stem] = status
        live_milestone[stem] = milestone_id
        last_status[stem] = status
    if current_day is not None:
        _emit_point(current_day)

    # default_milestone: the milestone whose LATEST transition day is the
    # most recent (addendum change 3); ties break toward the milestone
    # whose FILE was created later in real history -- qa's test names
    # the exact real shape this matters for: a lower-numbered hotfix
    # milestone (PT-0.11.1) opened AFTER a higher-numbered one (PT-0.12)
    # is already live, so numeric/lexicographic id order picks the wrong
    # one. `milestone_windows` already resolves true creation order (the
    # same derivation `_flow_milestone_lookup` above's sibling concern,
    # PT-84's own git-creation-commit walk) -- reused here rather than
    # inventing a second heuristic; a milestone with no resolvable window
    # (git failure, or dropped by that function's own collision guard)
    # sorts first via "", never crashes the tie-break.
    default_milestone = None
    if transition_last_day:
        creation_order = {mid: start_iso for start_iso, mid in milestone_windows(repo_root)}
        default_milestone = max(
            transition_last_day.keys(),
            key=lambda mid: (transition_last_day[mid], creation_order.get(mid, "")),
        )

    milestones_out = [
        {"id": mid, "name": milestone_info.get(mid, {}).get("name"), "status": milestone_info.get(mid, {}).get("status")}
        for mid in milestones_seen
    ]

    return {
        "period": "day",
        "series": series,
        "milestones": milestones_out,
        "default_milestone": default_milestone,
        "as_of": head_sha,
        "scope": FLOW_THROUGHPUT_SCOPE_NOTE,
        "warning": None,
        "closed_at": closed_at,
    }


def _flow_milestone_lookup(repo_root: Path) -> Dict[str, Dict[str, Optional[str]]]:
    """`{milestone id: {"name": ..., "status": ...}}` from CURRENT milestone
    file content only (plain glob over `_MILESTONE_REL_PATHS`, no git) --
    the addendum's own instruction: "`name`/`status` come from the current
    milestone records." An id the walk saw that has no current file at
    all (renamed, or the milestone record itself was later deleted) is
    simply absent from this dict; the caller renders `name: null,
    status: null` for it rather than dropping the id from the control."""
    info: Dict[str, Dict[str, Optional[str]]] = {}
    for rel in _MILESTONE_REL_PATHS:
        milestone_dir = repo_root / rel
        if not milestone_dir.is_dir():
            continue
        for path in sorted(milestone_dir.glob("*.md")):
            try:
                text = path.read_text(encoding="utf-8")
                frontmatter, _ = parse_frontmatter(text)
            except (OSError, FrontmatterError):
                continue
            mid = frontmatter.get("id")
            if not mid:
                continue
            info[str(mid)] = {"name": frontmatter.get("name"), "status": frontmatter.get("status")}
    return info


def build_flow_payload(data_dir: Path) -> Dict[str, Any]:
    """`GET /api/flow`'s payload -- PT-61's original cumulative status-
    stack shape, replaced by PT-85's throughput view (architect's ruling
    409d310, shape pinned at 2f8eba0; the cumulative view is retired, not
    kept behind a toggle, §7): `{period: "day", series: [{date, opened,
    closed, cancelled, wip, by_milestone: {<id>: {opened, closed,
    cancelled, wip}, ...}}], milestones: [{id, name, status}, ...],
    default_milestone: <id or null>, as_of: <head sha>, scope, warning}`.

    `series` is oldest-first, one point per day that had at least one
    committed change (never one point per calendar day in range -- a gap
    day has nothing to plot and isn't backfilled) -- this sparseness is
    unchanged from PT-61. Per-point `opened`/`closed`/`cancelled`/`wip`
    are OVERALL totals (every stem, including one with no `milestone`
    recorded at all). `by_milestone` is DENSE from a milestone's first
    appearance in the walk onward (every point from then on carries an
    entry for it, zeros for a day with no transitions) -- deliberately
    NOT sparse: `opened`/`closed`/`cancelled` are per-period DELTAS
    (missing = zero) while `wip` is POINT-IN-TIME (missing would have to
    mean "unchanged", a different gap semantic entirely); a sparse dict
    would force the client to know which rule applies to which key,
    reproducing PT-85's own inconsistent-measure defect in the schema.

    `milestones` lists every id the WALK saw (so archived/historical ids
    remain selectable), with `name`/`status` from the CURRENT milestone
    file content (an id with no current file gets `name: null, status:
    null` rather than being dropped -- dropping it would erase real
    history from the scope control). `default_milestone` is the id whose
    latest TRANSITION day (a day with a non-zero opened/closed/cancelled,
    never standing WIP alone) is most recent, ties broken toward the
    milestone whose FILE was created LATER in real history (via
    `milestone_windows`, never a numeric/lexicographic id compare -- a
    lower-numbered hotfix milestone opened after a higher-numbered one
    is already live is the real shape this matters for), or `null` if
    the walk carries no milestone data at all (degrades to the overall/
    all-milestones view). The server emits day granularity only; a week
    view is a client-side aggregation (sum the deltas, take the LAST wip
    of the week -- never sum or average a point-in-time value).

    Memoized in-process, keyed by `data_dir` and the CURRENT HEAD sha --
    history is a pure function of HEAD, so a repeat call at an unchanged
    HEAD is a cache hit; a new commit invalidates by construction (the key
    changes). The freshness check itself (`_flow_read_head_sha_pure`) is a
    pure filesystem read, never a subprocess -- only a CACHE MISS pays for
    the real `git log`/`git cat-file` work in `_compute_flow_payload`.
    When the pure read can't determine HEAD (e.g. a packed ref), this
    always falls through to a real recompute rather than trust a stale
    entry.
    """
    data_dir = Path(data_dir)
    cache_key = str(data_dir)
    probed_sha = _flow_read_head_sha_pure(data_dir)
    if probed_sha is not None:
        cached = _FLOW_CACHE.get(cache_key)
        if cached is not None and cached[0] == probed_sha:
            return cached[1]

    payload = _compute_flow_payload(data_dir)
    effective_sha = payload.get("as_of")
    if effective_sha:
        _FLOW_CACHE[cache_key] = (effective_sha, payload)
        while len(_FLOW_CACHE) > _FLOW_CACHE_MAX:
            oldest_key = next(iter(_FLOW_CACHE))
            if oldest_key == cache_key:
                break
            del _FLOW_CACHE[oldest_key]
    return payload
