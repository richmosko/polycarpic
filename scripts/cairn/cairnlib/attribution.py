"""cairnlib.attribution — PT-84 milestone-window attribution: derives each
milestone's creation-time window from git history, maps a timestamp to the
milestone active at it, and reads the dashboard's git-state/release-join
group.

Lives here, not in backfill_tokens.py (the architect's addendum on
process/cairn/issues/PT-84.md, "@architect -- 2026-09-04", amending §4):
backfill_tokens.py imports cairn, cairn.py does not import backfill_tokens,
and otel_receiver.py imports both -- so with THREE consumers, one of them
the common ancestor the other two already depend on, placing the shared
function anywhere else would create a cycle or bury it downstream of one
of its own callers. Same "no new capability class" reasoning as
`read_git_tags`: this module already shells git from a `-C <dir>` anchor,
never CWD.

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 11).
"""

import datetime
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from cairnlib.errors import FrontmatterError, MilestoneWindowError
from cairnlib.records import parse_frontmatter
from cairnlib.store import _read_frontmatter_dict, _repo_root_for, milestone_paths
from cairnlib.snapshot import read_git_tags

__all__ = [
    "_MILESTONE_REL_PATHS",
    "_SEMVER_TAG_RE",
    "_find_release_milestone",
    "_git_iso_to_utc_z",
    "_latest_semver_tag",
    "_release_status",
    "milestone_for_timestamp",
    "milestone_rank_map",
    "milestone_windows",
    "read_git_state",
]

_MILESTONE_REL_PATHS = ("process/cairn/milestones/", "process/cairn/archive/milestones/")


def milestone_windows(repo_root: Path, strict: bool = False) -> List[Tuple[str, str]]:
    """§2/§4 (amended §3.2, addendum c0affa5): a milestone's window is
    `[creation of its file, creation of the next milestone's file)` --
    half-open, so a record on a boundary belongs to exactly one window
    (the later one) by construction. §1 measured this against all 14
    real milestones and eliminated the two alternatives (issue-derived
    dates: `PT-0.3` has zero issues, and several milestones share a day;
    archive-move timestamps: retroactive bulk-commit bookkeeping that
    overlaps six ways) -- creation commits are the only source that is
    unique, non-overlapping, and defined for every milestone.

    Two lookups, deliberately split by source of truth (§3.2 amendment):
    - **Ids come from CURRENT file content** -- a plain glob over
      `process/cairn/milestones/` and `process/cairn/archive/milestones/`
      under `repo_root`, no git for this half. Measured: the first six
      milestones' FRONTMATTER, not just the filename, said the bare,
      quoted `id: "0.3"` at creation time -- reading `git show
      <add-commit>:<path>` (historical content) reproduces that exact
      stale id one level below the filename bug. Only HEAD's content is
      ever correct.
    - **Timestamps come from PER-FILE `git log --follow --diff-filter=A
      --format=%aI -- <current path>`,** taking the LAST line (git log
      is newest-first; the origin commit is oldest). `--follow` accepts
      exactly one path, which is why this cannot be one combined call
      over both directories: `--follow` walks the CURRENT, live path's
      history backward through its own renames to the true origin commit
      -- confirmed against `PT-0.3.md`: it finds the 2026-08-20 creation
      commit even though that commit's own path and frontmatter both
      said `0.3`. A combined `--name-status` walk would give
      `(timestamp, historical path)` pairs and leave the rename chain to
      be reconstructed by hand.

    `-C repo_root`, never CWD (this module's standing convention,
    `read_git_tags` above) -- a CWD-relative git call returns different,
    or silently empty, answers depending on where the process happens to
    run. Author-date timezone offsets are normalised to UTC before
    return (git's `%aI` carries the COMMITTER's own local offset, not
    UTC; a transcript's own `timestamp` field is always UTC `Z` --
    comparable strings require the same normalisation, not just the same
    ISO8601 grammar, or an offset would sort as if later than it truly
    is).

    Cost, measured (addendum c0affa5): 0.23 s for all 14 real milestones
    (~16 ms each), linear in milestone count. Built ONCE per flush (the
    receiver) or once per run (the backfill), never per datapoint or per
    record, and never on the hook path (`--ensure-running` never calls
    this). If milestone count ever makes this matter, the fix is caching
    keyed on the two directories' mtimes -- not a hand-rolled rename-chain
    parser; the per-file `--follow` is the correct derivation and should
    stay the one that runs (confirmed against the real repo: plain
    `--follow --diff-filter=A` reproduces all 14 milestones' true,
    distinct creation timestamps with no collapsing -- an earlier
    `-M100%` variant of this function broke that, misread at the time as
    a defect in the ruling's own invocation rather than in that edit;
    withdrawn once the architect's own independent run of the literal
    ruling text failed to reproduce it).

    A synthetic-fixture-only edge remains open, not an engine defect:
    two DIFFERENT milestone files sharing the exact same template body
    (differing only in `id`/`name`) are similar enough for `--follow`'s
    default content-similarity rename detection to jump one's history
    onto the other's -- reproducible in a throwaway repo, never observed
    against a real milestone file (whose `name`/definition-of-done prose
    differs substantially, confirmed by the architect building both
    shapes: distinct prose eliminates it). Per the architect's ruling
    (7341e2e): fix the fixture to look like the real artifact, not the
    engine to tolerate an unrepresentative one. In its place, an
    invariant (below) converts the residual risk into a named error
    instead of carrying permanent rename-disambiguation machinery for
    an input this codebase's own milestone files don't produce.

    Returns `[(start_iso, milestone_id), ...]` sorted ASCENDING by start
    -- creation-timestamp order, never id string-compare (§6: `PT-0.10`
    sorts before `PT-0.5` lexicographically, which is exactly wrong).
    Returns `[]` on any git failure (no repo, git not on PATH, timeout),
    a missing directory, or a file this repo's own git history has no
    record of (a freshly-created, uncommitted milestone file) -- the
    caller's job to decide what "no window" means, not this function's;
    every caller in this codebase treats an empty/failed lookup as
    "everything stays `main`", the same fail-safe direction this
    project's gating rulings consistently take.

    Invariant (7341e2e, severity corrected by architect's review at
    4a7c2c3): the derived windows must be exactly one entry per
    milestone id, strictly increasing in start time -- a duplicate id,
    or two milestones resolving to the same (or an inverted) timestamp,
    is exactly the failure shape a `--follow` rename false-merge (or a
    genuinely duplicated milestone file) produces. The ORIGINAL ruling
    had this raise `MilestoneWindowError`; the architect's review found
    that a raise here runs inside the receiver's own flush path, so a
    milestone-file naming coincidence could abort telemetry collection
    outright -- the exact asymmetry PT-86 §0 already rejected once (a
    loud, degraded result beats a silent stop). Default (`strict=False`,
    every real caller): the colliding milestone(s) are DROPPED from the
    returned list and a named warning is printed to stderr identifying
    them and their shared/inverted timestamp; any record that would have
    matched a dropped window falls back to `main` (the documented
    "outside any window" bucket) -- under-attributed, never
    mis-attributed, never a stop. `strict=True` (qa's own test surface,
    exercising the detector in isolation) restores the original raise.

    POLY-50 gate-1 ruling §3 (this repo's own POLY-A/POLY-B, bootstrapped
    in one commit): BEFORE the collision check above runs, each TIE GROUP
    (>= 2 ids sharing one start) is given a chance to disambiguate on its
    own STATUS history -- see the tie-handling block below for the exact
    rule. Only a genuine residual tie (both members resolve to the same
    status-derived start, or one can't be status-derived and isn't
    currently `planned`) still reaches the collision check above.
    """
    import subprocess

    windows: List[Tuple[str, str, str, Optional[str]]] = []  # start_iso, milestone_id, rel_path, status
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
            milestone_id = frontmatter.get("id")
            if not milestone_id:
                continue
            status = frontmatter.get("status")
            rel_path = path.relative_to(repo_root).as_posix()
            try:
                log = subprocess.run(
                    ["git", "-C", str(repo_root), "log", "--follow", "--diff-filter=A",
                     "--format=%aI", "--", rel_path],
                    capture_output=True, text=True, timeout=10,
                )
            except (OSError, subprocess.TimeoutExpired):
                continue
            if log.returncode != 0:
                continue
            lines = [l for l in log.stdout.splitlines() if l.strip()]
            if not lines:
                continue
            git_iso = lines[-1]  # git log is newest-first; the origin commit is the last line
            start_iso = _git_iso_to_utc_z(git_iso)
            if start_iso is None:
                continue
            windows.append((start_iso, str(milestone_id), rel_path, str(status) if status else None))

    windows.sort(key=lambda w: w[0])

    # POLY-50 gate-1 ruling §3: for each GROUP of >= 2 milestones sharing one
    # creation start (a `--follow` false-merge or, on this repo, two files
    # bootstrapped in the same commit), take each member's own STATUS-derived
    # start instead of the shared creation start -- the first commit that
    # added a `status: in-progress|paused|done|cancelled` frontmatter line to
    # THAT file (git log -G, oldest match = last line, newest-first log). A
    # member CURRENTLY `planned` with no such commit is removed SILENTLY --
    # a planned milestone owns no window yet, which is correct, not a
    # collision, so no warning fires for it. A member that is NOT currently
    # `planned` (e.g. `archived`) but still has no such commit (a milestone
    # whose history never says `in-progress`/`paused`/`done`/`cancelled` --
    # the synthetic `--follow` false-merge shape, never a real milestone's
    # own lifecycle) is left at its ORIGINAL shared start: the unchanged
    # collision check below still sees the tie and drops + warns, exactly
    # as it did before this ruling -- this is a genuine engine-defect
    # collision, not a planned-milestone non-collision, and must not be
    # silently swallowed. Non-tied milestones are untouched -- no extra
    # `git log` call for them, PT-84 semantics unchanged. Re-sorted
    # afterward so the unchanged collision check sees the adjusted starts.
    groups: Dict[str, List[int]] = {}
    for i, (start, _milestone_id, _rel_path, _status) in enumerate(windows):
        groups.setdefault(start, []).append(i)
    tie_group_indices = [idxs for idxs in groups.values() if len(idxs) > 1]
    if tie_group_indices:
        removed: Set[int] = set()
        adjusted_start: Dict[int, str] = {}
        for idxs in tie_group_indices:
            for i in idxs:
                _start, _milestone_id, rel_path_i, status_i = windows[i]
                try:
                    status_log = subprocess.run(
                        ["git", "-C", str(repo_root), "log", "--follow", "--format=%aI",
                         "-G", r"^status: *(in-progress|paused|done|cancelled)", "--", rel_path_i],
                        capture_output=True, text=True, timeout=10,
                    )
                except (OSError, subprocess.TimeoutExpired):
                    continue  # leave at its original (still-tied) start
                if status_log.returncode != 0:
                    continue  # leave at its original (still-tied) start
                status_lines = [l for l in status_log.stdout.splitlines() if l.strip()]
                if not status_lines:
                    if status_i == "planned":
                        removed.add(i)  # still `planned` -- no window yet, silently
                    # else: leave at its original (still-tied) start -- a
                    # genuine residual tie for the unchanged check below.
                    continue
                status_start = _git_iso_to_utc_z(status_lines[-1])
                if status_start is None:
                    continue  # leave at its original (still-tied) start
                adjusted_start[i] = status_start
        windows = [
            (adjusted_start.get(i, start), milestone_id, rel_path, status)
            for i, (start, milestone_id, rel_path, status) in enumerate(windows)
            if i not in removed
        ]
        windows.sort(key=lambda w: w[0])

    windows = [(start, milestone_id) for start, milestone_id, _rel_path, _status in windows]

    ids = [milestone_id for _start, milestone_id in windows]
    dup_ids = {milestone_id for milestone_id in ids if ids.count(milestone_id) > 1}
    if dup_ids and strict:
        raise MilestoneWindowError(
            f"milestone_windows found more than one window for the same milestone id(s) "
            f"{sorted(dup_ids)!r} -- a milestone file present under both milestones/ and "
            f"archive/milestones/ at once, or a duplicated id in frontmatter -- "
            f"windows: {windows!r}"
        )

    # Duplicate/inverted TIMESTAMPS -- grouped by start_iso (the windows
    # are already sorted, so an "inverted" pair is impossible here; the
    # only shape left is a TIE, two different ids sharing one start,
    # which is exactly what a `--follow` false-merge produces).
    by_start: Dict[str, List[str]] = {}
    for start, milestone_id in windows:
        by_start.setdefault(start, []).append(milestone_id)
    tied_ids = {mid for group in by_start.values() if len(group) > 1 for mid in group}
    if tied_ids and strict:
        tied_start = next(start for start, group in by_start.items() if len(group) > 1)
        raise MilestoneWindowError(
            f"milestone_windows produced a non-increasing timestamp: milestone(s) "
            f"{sorted(tied_ids)!r} all resolved to {tied_start!r} -- two milestone files "
            f"resolved to the same or an inverted creation time, most likely a `--follow` "
            f"rename false-merge against unrepresentative content (see this function's "
            f"docstring) rather than a genuine same-instant creation"
        )

    colliding = dup_ids | tied_ids
    if colliding:
        sys.stderr.write(
            f"cairn: warning: milestone_windows dropped colliding milestone window(s) "
            f"{sorted(colliding)!r} -- two or more milestone files resolved to the same "
            f"(or a duplicate) creation id/timestamp, most likely a `--follow` rename "
            f"false-merge; records that would have matched a dropped window fall back to "
            f"`main`\n"
        )
        windows = [(start, milestone_id) for start, milestone_id in windows if milestone_id not in colliding]

    return windows


def _git_iso_to_utc_z(git_iso: str) -> Optional[str]:
    """`%aI` renders the AUTHOR's own local offset (e.g. `-07:00`), which
    varies by committer/DST and is NOT the same representation Claude
    Code's own transcript `timestamp` field uses (always UTC, `Z`
    suffix). Converts to the exact `%Y-%m-%dT%H:%M:%SZ` shape this
    codebase already uses elsewhere (e.g. `otel_receiver._now_iso`)."""
    try:
        parsed = datetime.datetime.fromisoformat(git_iso)
    except ValueError:
        return None
    return parsed.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def milestone_for_timestamp(ts: str, windows: List[Tuple[str, str]]) -> Optional[str]:
    """Pure (§4: "this is where the boundary tests aim", §8: "no git in
    the unit tests") -- `windows` is `milestone_windows`'s own return
    shape, already sorted ascending by start.

    Canonicalises `ts` before comparing (addendum, precision ruling):
    the two collectors disagree not just on timezone offset but on
    PRECISION -- a real backfill transcript timestamp carries
    milliseconds (`"2026-08-22T06:38:52.326Z"`), the receiver's
    `_ns_to_iso` and this function's own `windows` do not
    (`"...52Z"`). Demonstrated: `"...52.326Z" < "...52Z"` is `True` under
    plain string compare, because `.` (0x2E) sorts before `Z` (0x5A) --
    so a record 326 ms INTO a window would compare as BEFORE its own
    boundary and land in the PREVIOUS milestone. Truncating any
    fractional-second component to whole seconds before comparing is
    what makes the half-open `[start, next)` boundary rule actually
    hold; it only ever bites when a record falls in the same second as
    a milestone-creation commit, which is exactly the boundary case this
    function exists to get right. Canonicalising HERE (not at each call
    site) keeps this the one place that invariant is enforced -- two
    collectors already demonstrably emit different precisions, and nothing
    stops a third one from doing so again.

    Half-open windows: the LAST window whose start is `<= ts` wins,
    matching §2's "a record landing exactly on a boundary belongs to the
    later window" -- iterating windows in ascending order and keeping
    the last match, rather than stopping at the first `>` window, gets
    this right without a separate boundary special-case. Returns `None`
    when `ts` is before the first window's start (records that old stay
    `main` -- §2's "pre-cairn answer") or when `windows` is empty.
    """
    if ts.endswith("Z") and "." in ts:
        ts = ts.split(".", 1)[0] + "Z"
    result: Optional[str] = None
    for start_iso, milestone_id in windows:
        if start_iso <= ts:
            result = milestone_id
        else:
            break
    return result


def milestone_rank_map(milestone_windows_table: Optional[List[Tuple[str, str]]]) -> Dict[str, int]:
    """`milestone_windows_table` is already sorted ascending by creation
    timestamp (`milestone_windows`'s own contract) -- so a milestone
    id's RANK is just its position in that list. Computed ONCE per sort
    call and passed into each per-item sort key, rather than rebuilt on
    every one of the O(n) comparisons a single `.sort()` already makes.
    Lives here (not `backfill_tokens.py`) for the same three-consumer
    reason as `milestone_windows`/`milestone_for_timestamp` above --
    `backfill_tokens.py`'s own on-disk sort (§6) and `cairn.py`'s own
    `/api/tokens` payload sort (§7) both need the identical rank, and
    `cairn.py` is the common ancestor.

    `None`/empty (a caller with no table -- e.g. a test exercising a
    sort key in isolation, or a `MilestoneWindowError` caught upstream
    and degraded) yields an empty map; every milestone id then falls
    back to rank 0, degrading to insertion/stable-sort order rather than
    raising -- still deterministic, just not creation-time-ordered
    without the table.
    """
    if not milestone_windows_table:
        return {}
    return {milestone_id: i for i, (_start, milestone_id) in enumerate(milestone_windows_table)}


def _release_status(target_tag: Optional[str], tag_set: Optional[Set[str]]) -> Optional[bool]:
    """Whether `target_tag` has shipped, per `tag_set` (PT-44 §4's
    formula) -- extracted so `build_board_payload`'s milestone loop and
    `build_record_payload` (PT-51, the POST /api/record/<id> response)
    compute it identically, one derivation rather than two copies that
    could drift. `None` when there's nothing to check: no `target_tag`
    (a definition milestone) or `tag_set` itself is `None` (a git read
    failure -- degrades to "unknown", never a false `False`).
    """
    if target_tag is None or tag_set is None:
        return None
    return target_tag in tag_set


_SEMVER_TAG_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)")


def _latest_semver_tag(tags: Optional[Set[str]]) -> Optional[str]:
    """The highest-semver tag in a tag SET (`read_git_tags`'s return type
    carries no ordering or dates to sort by) -- WORKFLOW.md's "strict
    semver" convention is what makes "latest" well-defined at all. A
    non-conforming tag sorts lowest (never raises), so one stray
    non-release tag can't take down the whole /api/dashboard payload.
    `None`/empty input -> `None`, never a crash.

    PT-54 (architect's diff-review fix, blocking): a pre-release suffix
    (`-alpha`/`-beta`/`-rc*`, all three prescribed by WORKFLOW.md) must
    rank BELOW its own final release -- `(major, minor, patch)` alone
    ties `v1.0.0` and `v1.0.0-rc1`, and the string tiebreak that followed
    put the rc ahead (`'v1.0.0-rc1' > 'v1.0.0'` lexicographically),
    which is backwards per semver §11 and silently wrong the first time
    this project's own rc-tag procedure is followed: the Release card
    would show the rc as latest, then the tracker/git join returns null
    (the shipped milestone's `target_tag` is the FINAL tag, never the
    rc). `is_release` (1 for a bare `vX.Y.Z`, 0 for anything with a
    `-`-prefixed suffix after it) breaks that tie explicitly.
    """
    if not tags:
        return None

    def _key(tag: str) -> Tuple[int, int, int, int, str]:
        m = _SEMVER_TAG_RE.match(tag)
        if not m:
            return (-1, -1, -1, -1, tag)
        rest = tag[m.end():]
        is_release = 0 if rest.startswith("-") else 1  # 1.0.0-rc.1 < 1.0.0
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)), is_release, tag)

    return max(tags, key=_key)


def read_git_state(
    data_dir: Path,
    git_tags: Optional[Tuple[Optional[Set[str]], Optional[str]]] = None,
) -> Dict[str, Any]:
    """PT-54 (architect ruling §4): the `/api/dashboard` "git" group --
    `{branch, dirty, head, latest_tag, warning, repo_name}`. Same `-C
    data_dir, walk up to find the repo, never raise` contract as
    `read_git_tags`/`_git_mv_or_rename`; reuses `read_git_tags` for the
    tag set rather than a fourth subprocess call, per the ruling.

    A single failure anywhere in the GIT-DEPENDENT half of this group
    (git missing, or `data_dir` not inside a worktree) degrades
    `branch`/`dirty`/`head`/`latest_tag` to `None` plus a warning --
    never a partially-populated dict that could look more trustworthy
    than it is. `dirty` is `None` (not `False`) when the `status
    --porcelain` read itself failed, so "no changes" and "we don't know"
    stay distinguishable.

    `repo_name` (PT-68) is the ONE deliberate exception to "whole group
    degrades together": it's a directory basename, not a git read, so it
    needs no subprocess to exist at all -- `_repo_root_for` already falls
    back to `data_dir.parent.parent` when git is unavailable, so a repo
    with no git history (or git itself missing) still gets an honest
    sidebar header instead of one that goes blank alongside the fields
    that genuinely can't be known without git.

    PT-60: `git_tags`, when given, is the exact `(tag_set, warning)` pair
    `read_git_tags(data_dir)` itself returns -- lets `build_dashboard_payload`
    read git tags ONCE and hand the same result to this function AND
    `build_board_payload`, instead of two independent subprocess reads of
    the same tag set per `/api/dashboard` request. `None` (the default)
    preserves the exact original behavior -- read internally -- so every
    other caller/test is unaffected.
    """
    import subprocess

    def _run(*args: str) -> Optional[str]:
        try:
            result = subprocess.run(
                ["git", "-C", str(data_dir), *args],
                capture_output=True, text=True, timeout=5,
            )
        except (FileNotFoundError, OSError):
            return None
        if result.returncode != 0:
            return None
        return result.stdout.strip()

    repo_name = _repo_root_for(data_dir).name

    branch = _run("rev-parse", "--abbrev-ref", "HEAD")
    if branch is None:
        return {
            "branch": None,
            "dirty": None,
            "head": None,
            "latest_tag": None,
            "warning": "git unavailable or not a worktree -- every dashboard git field is null",
            "repo_name": repo_name,
        }

    head = _run("rev-parse", "--short", "HEAD")
    # --untracked-files=no: "dirty" means uncommitted changes to TRACKED
    # files -- an untracked issue/milestone file sitting in the tree (the
    # routine, expected state of a repo mid-`cairn new`) must not read as
    # a dirty working tree.
    status_out = _run("status", "--porcelain", "--untracked-files=no")
    dirty = None if status_out is None else bool(status_out)
    tag_set, tags_warning = read_git_tags(data_dir) if git_tags is None else git_tags

    return {
        "branch": branch,
        "dirty": dirty,
        "head": head,
        "latest_tag": _latest_semver_tag(tag_set),
        "warning": tags_warning,
        "repo_name": repo_name,
    }


def _find_release_milestone(data_dir: Path, target_tag: str) -> Optional[Dict[str, Any]]:
    """The milestone whose `target_tag` matches, for `build_dashboard_payload`'s
    release join -- searches BOTH live and archived milestones. A small,
    targeted glob + frontmatter read (two dirs, non-recursive), not a
    second full `/api/board` parse: this template's own workflow archives
    a milestone shortly after its tag ships, so a live-only search would
    make a shipped release invisible almost immediately. `None` if
    nothing matches.
    """
    data_dir = Path(data_dir)
    for p in milestone_paths(data_dir, include_archived=True):
        fm = _read_frontmatter_dict(p)
        if fm.get("target_tag") == target_tag:
            return fm
    return None
