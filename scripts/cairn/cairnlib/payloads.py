"""cairnlib.payloads — the board/dashboard/roster/issue/record HTTP
payload builders and their etag.

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 15);
build_dashboard_payload relocates here from the attribution section.
"""

import datetime
import hashlib
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from cairnlib.constants import MAJOR_HEALTH_VALUES, RECORD_STATUSES, STATUS_ORDER, _RECORD_BOARD_EDITABLE_FIELDS, _today
from cairnlib.records import checklist_items, get_seen, parse_frontmatter, parse_issue, split_comments
from cairnlib.store import (
    _read_frontmatter_dict,
    _record_schema_for_path,
    _repo_root_for,
    _dir_glob,
    archived_issue_paths,
    find_issue_path,
    find_record_path,
    is_archived_path,
    milestone_paths,
)
from cairnlib.lint import check_repo
from cairnlib.snapshot import read_git_tags
from cairnlib.roster import _WORKING_STATUSES, _read_agent_identities
from cairnlib.attribution import _find_release_milestone, _release_status, read_git_state

__all__ = [
    "_validate_record_patch",
    "build_board_payload",
    "build_dashboard_payload",
    "build_issue_payload",
    "build_record_payload",
    "build_roster_payload",
    "compute_etag",
]


def build_dashboard_payload(data_dir: Path) -> Dict[str, Any]:
    """`GET /api/dashboard`'s payload (PT-54) -- assembled server-side
    only, for the PRIMARY root's `data_dir` (git state is inherently
    single-repo; there is no multi-root "current branch"). Four
    independent groups, one honest join:

    - `git`: `read_git_state(data_dir)` -- branch/dirty/head/latest_tag,
      never raises.
    - `tracker`: issue counts BY THE SAME parse path `/api/board` uses --
      `build_board_payload(data_dir)`'s own `issues` list, tallied by
      `status`. Never a second parser over the same files (architect's
      ruling §4).
    - `check`: `check_repo(data_dir)`'s lint result, `{ok, errors}`.
    - `release`: the join the ruling's §4 spells out explicitly -- latest
      tag -> the milestone whose `target_tag` matches it -> that
      milestone's `id`/`name`/`status`/`ga`. Deliberately NOT parsed from
      STATE.md: that would read a file outside `process/cairn/` (breaking
      the same engine constraint `read_git_tags` protects) and couple the
      server to a human-maintained table. `None` when there's no matching
      milestone (including "no tags at all").

      This lookup searches BOTH live and archived milestones (a small,
      targeted glob -- `_find_release_milestone`, not a second full
      `/api/board` parse): this project's own workflow archives a
      milestone shortly after its tag ships (WORKFLOW.md's archive-on-done
      convention), so a live-only search would make `release` null for
      almost every real shipped tag -- verified against this very repo
      end to end (v0.7.1's milestone is archived). `tracker.
      counts_by_status` stays live-only on purpose (matches what
      `/api/board` shows by default) -- only this lookup widens.

    PT-60: reads git tags exactly ONCE per call (`read_git_tags(data_dir)`
    below), then hands that same `(tag_set, warning)` pair to both
    `read_git_state` (for `git.latest_tag`) and `build_board_payload` (for
    each milestone's `released` field, a value this function doesn't even
    read) -- previously two independent subprocess reads of identical
    data per `/api/dashboard` request.
    """
    data_dir = Path(data_dir)
    git_tags = read_git_tags(data_dir)
    git_state = read_git_state(data_dir, git_tags=git_tags)

    board = build_board_payload(data_dir, git_tags=git_tags)
    counts_by_status = {status: 0 for status in STATUS_ORDER}
    for issue in board["issues"]:
        status = issue.get("status")
        if status in counts_by_status:
            counts_by_status[status] += 1

    check_errors = check_repo(data_dir)

    release = None
    latest_tag = git_state["latest_tag"]
    if latest_tag:
        milestone = _find_release_milestone(data_dir, latest_tag)
        if milestone:
            release = {
                "id": milestone.get("id"),
                "name": milestone.get("name"),
                "status": milestone.get("status"),
                "ga": milestone.get("ga"),
            }

    return {
        "git": git_state,
        "tracker": {"counts_by_status": counts_by_status},
        "check": {"ok": check_errors == [], "errors": check_errors},
        "release": release,
        "generated_at": datetime.datetime.now().isoformat(),
    }


def build_roster_payload(data_dir: Path) -> Dict[str, Any]:
    """`GET /api/roster`'s payload (PT-56) -- architect's presence-source
    ruling in full: identity from `_read_agent_identities` (never
    fabricated), work attribution from the tracker's `assignee` field on
    LIVE issues only (`archive/` excluded -- matches every other
    "live by default" convention in this codebase, PT-42's own
    precedent), presence strictly one of `working`/`idle`/`unknown` --
    never "active"/"online"/"live", which would claim an observation
    this engine cannot make.

    - `working`: assignee of >=1 live issue with status in
      `in-progress`/`in-review` AND that issue's `updated` is today.
    - `idle`: an assignment exists but doesn't qualify as `working`
      right now -- a backlog/todo/done/cancelled assignment, or a
      `working`-shaped one that's gone stale (its `updated` predates
      today). Staleness degrades one-directionally: never silently
      stays `working`.
    - `unknown`: no live issue references this identity at all. This is
      every agent's value on a fresh clone with no live team running --
      the ruling's stated correct output, not a defect.

    `work` is `None` for `unknown` (nothing to report), else a structured
    `{id, title, status, kind}` -- PT-65 (split out of PT-56/PT-60): the
    server used to compose an English sentence here ("last shipped PT-1:
    ...", "PT-2: ... (backlog)") that the client re-parsed with
    `.split(':')`. `id`/`title`/`status` are the underlying issue's raw
    field values, no punctuation glued in; `kind` is one of:

    - `"current"`: queued current-cycle work -- actively `working` today,
      or a pending backlog/todo assignment waiting to start. Never a
      `done`/`cancelled` issue.
    - `"stale"`: working-shaped (in-progress/in-review) but `updated`
      predates today -- the one cell where `stale_since` (below) also
      populates.
    - `"history"`: a terminal (`done` or `cancelled`) issue kept for
      provenance (team-lead's preserve-assignee-on-done decision keeps it
      in the live `issues/` dir until archived) -- reads as PAST work,
      never current. Team-lead's ruling (PT-65 issue thread, 2026-08-28)
      extends PT-56's original "a done assignment renders only as
      history" principle to the other terminal status: cancelled-only
      also reads `"history"`, not `"current"` -- pairing a live-work kind
      with a status that can never become live work again would
      contradict PT-56's own honesty framing. `status` still carries
      which terminal status it was, for the client to render.
    """
    data_dir = Path(data_dir)
    repo_root = _repo_root_for(data_dir)
    identities = _read_agent_identities(repo_root)

    live_issues = [_read_frontmatter_dict(p) for p in _dir_glob(data_dir / "issues")]
    today = _today()

    def _work(issue: Dict[str, Any], kind: str) -> Dict[str, Any]:
        return {
            "id": issue.get("id"),
            "title": issue.get("title"),
            "status": issue.get("status"),
            "kind": kind,
        }

    agents: List[Dict[str, Any]] = []
    for identity in identities:
        agent_id = identity["id"]
        assigned = [issue for issue in live_issues if issue.get("assignee") == agent_id]

        presence = "unknown"
        work: Optional[Dict[str, Any]] = None
        stale_since: Optional[str] = None
        if assigned:
            presence = "idle"
            working_issue = next(
                (i for i in assigned if i.get("status") in _WORKING_STATUSES and i.get("updated") == today),
                None,
            )
            if working_issue is not None:
                presence = "working"
                work = _work(working_issue, "current")
            else:
                stale = next((i for i in assigned if i.get("status") in _WORKING_STATUSES), None)
                if stale is not None:
                    # PT-56 (architect's explicit follow-up): the staleness
                    # date must be a SURFACED field, not just implied by
                    # `presence == "idle"` -- a UI can't render "last
                    # tracker update 2026-08-01" from the enum value alone.
                    stale_since = stale.get("updated")
                    work = _work(stale, "stale")
                else:
                    # PT-56 (architect's diff-review fix): a live PENDING
                    # assignment (backlog/todo -- anything that isn't
                    # done/cancelled) outranks "last shipped" history.
                    # The addendum's `done`-as-history framing was meant
                    # as the FALLBACK, not the preference -- an agent
                    # accumulates `done` issues over time while pending
                    # work is the more useful thing a roster reader wants,
                    # and once claim-time assignees populate for real,
                    # "has a done issue" will be true for almost everyone.
                    pending = next(
                        (i for i in assigned if i.get("status") not in ("done", "cancelled")),
                        None,
                    )
                    if pending is not None:
                        work = _work(pending, "current")
                    elif any(i.get("status") == "done" for i in assigned):
                        # PT-56 (architect's addendum, "done-but-live
                        # cell"): team-lead's preserve-assignee-on-done
                        # decision means a `done` issue stays in the live
                        # `issues/` dir until archived -- the common case,
                        # not an edge one. Presence stays `idle` (a
                        # completed assignment is real data, not "no
                        # data" -- collapsing it to `unknown` would
                        # discard exactly the provenance preserve-on-done
                        # exists to keep), but the work line must read as
                        # HISTORY, never current work.
                        done = next(i for i in assigned if i.get("status") == "done")
                        work = _work(done, "history")
                    else:
                        # Cancelled-only -- team-lead's ruling (this
                        # function's own docstring): reads as "history"
                        # too, same terminal-status principle as done.
                        other = assigned[0]
                        work = _work(other, "history")

        agents.append({
            "id": agent_id,
            "name": identity["name"],
            "role": identity["role"],
            "presence": presence,
            "work": work,
            "stale_since": stale_since,
        })

    return {"agents": agents}


def build_board_payload(
    data_dir: Path,
    archived: bool = False,
    git_tags: Optional[Tuple[Optional[Set[str]], Optional[str]]] = None,
) -> Dict[str, Any]:
    """{"majors": [...], "milestones": [...], "issues": [...]}.

    Board issues carry no "comments" key (spec: "without comment bodies").

    PT-40 (joint PT-40/43/44 ruling § 1): majors/milestones ALSO carry a
    `body` key -- the markdown after the closing frontmatter fence, so the
    client can render a viewable card (name, status, DoD text, ...) with
    NO second fetch/endpoint (`GET /api/milestone/<id>` was considered and
    rejected -- a second read path for data already in this payload).
    Issues are deliberately UNCHANGED: the issue drawer already has its
    own separate body-carrying fetch (`build_issue_payload`/`parse_issue`),
    and this ruling is milestone/major-only.

    PT-42 (architect's ruling § 0/1): `archived=False` (the default) is
    THE IDENTICAL code path that existed before this parameter -- a
    synthetic 1400-issue archive/ tree measured a 28x cost parsing it
    unconditionally, so it is paid only when a caller explicitly asks.
    Every major/milestone/issue ALWAYS carries an `archived` key (never
    absent -- PT-3's no-conditional-payload-shape precedent): `False` for
    every live record regardless of the flag. When `archived=True`, ALSO
    reads archive/ (issues), archive/milestones/, archive/majors/ -- ONE
    archive read path for all three record types via `_dir_glob`, exactly
    like the live dirs -- and every record from those three is stamped
    `archived: True`. Archived issues land in the SAME `issues` list,
    never a parallel array: a second array would need a second counting
    path, degrading PT-31/PT-35's "visible must equal counted" from a
    structural property of one producer to a hand-maintained agreement
    between two.
    """
    data_dir = Path(data_dir)

    # PT-44 (ruling § 4): read once per call (== once per root, once per
    # payload build) -- never crashes (git missing / not a repo -> every
    # milestone's `released` below falls back to None, one stderr line).
    # PT-60: `git_tags`, when given, is `read_git_tags(data_dir)`'s own
    # return value, already fetched by a caller (`build_dashboard_payload`)
    # that needs the SAME tag set for its own git.latest_tag/release join --
    # skips a second, redundant subprocess read of identical data. `None`
    # (the default) preserves the exact original per-call read, so every
    # multi-root caller (`root.path` in the loop below the single-root
    # dashboard's world) still gets its own fresh read, per root.
    tag_set, git_tags_warning = read_git_tags(data_dir) if git_tags is None else git_tags
    if git_tags_warning:
        print(f"cairn: warning: {git_tags_warning}", file=sys.stderr)

    major_paths = list(_dir_glob(data_dir / "majors"))
    milestone_file_paths = milestone_paths(data_dir, include_archived=archived)  # PT-60
    issue_paths = list(_dir_glob(data_dir / "issues"))
    if archived:
        major_paths += _dir_glob(data_dir / "archive" / "majors")
        issue_paths += archived_issue_paths(data_dir)  # PT-52: archive/issues/ only

    def _stamped(p: Path) -> Dict[str, Any]:
        # POLY-56 (gate-1 ruling R1): the board's checklist chip needs a
        # count, and a count needs the body -- so this reads the whole
        # file now, not just the frontmatter `_read_frontmatter_dict`
        # used to stop at (M2/M6: negligible at today's ~70-file scale).
        # `checklist` is a count only; the full `description` is
        # deliberately NOT added here -- that stays build_issue_payload's
        # job alone, unchanged from before this ruling.
        frontmatter, body = parse_frontmatter(p.read_text(encoding="utf-8"))
        fm = dict(frontmatter)
        # is_archived_path (PT-42's pre-PR extraction) is True for all
        # three archive shapes (archive/<id>.md, archive/milestones/
        # <id>.md, archive/majors/<id>.md) and none of the three live
        # shapes -- one derivation, not a per-record-type branch.
        fm["archived"] = is_archived_path(data_dir, p)
        description, _comments = split_comments(body)
        items = checklist_items(description)
        done = sum(1 for it in items if it["checked"])
        fm["checklist"] = {"done": done, "total": len(items)}
        return fm

    def _stamped_with_body(p: Path, include_released: bool = False) -> Dict[str, Any]:
        # PT-40 § 1: majors/milestones only -- reads via parse_frontmatter
        # (not _stamped's _read_frontmatter_dict) so the body half of its
        # (frontmatter, body) return isn't discarded. `body.strip() == ""`
        # for a record with no text after the fence is a real, present
        # empty string, never a missing key (PT-3 no-conditional-shape
        # precedent, same posture `archived` already gets on every record).
        fm, raw_body = parse_frontmatter(p.read_text(encoding="utf-8"))
        fm = dict(fm)
        fm["archived"] = is_archived_path(data_dir, p)
        # PT-51 §2: `body` becomes the PRE-`## Comments` half, via the
        # SAME split_comments issues already use -- one parser, not a
        # second body-vs-comments convention. For every record that
        # exists today (none has a Comments section yet) this is
        # byte-identical to the old `body` value: split_comments returns
        # `(body, [])` verbatim when there's no heading to split on.
        pre_comments_body, comments = split_comments(raw_body)
        fm["body"] = pre_comments_body
        fm["comments"] = comments
        # PT-51 §2: `seen` -- exactly `get_seen(p)`, the same mtime token
        # the issue loop below already stamps, so a record's inline
        # editors/comment box has a real seen to send back on write.
        fm["seen"] = get_seen(p)
        # PT-40 § 5: the card's file-path line, same contract as an
        # issue's own "path" (PT-10) -- the record's real on-disk path,
        # correct for an archived major/milestone too.
        fm["path"] = str(p)
        # PT-44 § 4: `released` is a MILESTONE-only key -- majors have no
        # `target_tag` in their schema at all, so `include_released` is
        # False for them and the key is never added (not even as `None`;
        # a key present-but-always-null on a schema it doesn't apply to
        # would be its own kind of confusing "always false-ish" signal).
        if include_released:
            fm["released"] = _release_status(fm.get("target_tag"), tag_set)
        return fm

    majors = [_stamped_with_body(p) for p in major_paths]
    milestones = [_stamped_with_body(p, include_released=True) for p in milestone_file_paths]

    # PT-25: no server-side child count -- the board's n/m badge is
    # computed client-side (board-logic.js's childProgress), mirroring
    # milestoneProgress. /api/board already carries every issue's `parent`
    # and `status`, which is everything that needs; a second, server-side
    # answer to "how many children does this have" is exactly the
    # duplicated-expression class the standing Validate criterion exists
    # to catch, so there is one producer, not two.
    issues = []
    for p in issue_paths:
        issue = _stamped(p)
        issue["seen"] = get_seen(p)
        issue["path"] = str(p)  # PT-10: same contract as build_issue_payload's "path"
        issues.append(issue)

    return {"majors": majors, "milestones": milestones, "issues": issues}


def build_issue_payload(data_dir: Path, issue_id: str) -> Optional[Dict[str, Any]]:
    """Frontmatter + description + full comments + seen + path. None if not found.

    `path` (PT-10) is `str(path)` exactly as constructed by find_issue_path
    (data_dir joined with "issues" or "archive" and the filename) — not a
    hardcoded "issues/" guess. This is deliberately *not* normalized to
    absolute or to any fixed root: it inherits whatever relativity/
    absoluteness `data_dir` itself has, so it reads as
    "process/cairn/issues/PT-1.md" when the server is run the documented
    way (relative --data-dir from a repo root) and as a real absolute path
    under any other --data-dir setup — either way it's the file's actual
    on-disk path, correct for an archived issue (archive/) too, which the
    old hardcoded drawer string never was.
    """
    path = find_issue_path(data_dir, issue_id)
    if path is None:
        return None
    issue = parse_issue(path.read_text(encoding="utf-8"))
    issue["seen"] = get_seen(path)
    issue["path"] = str(path)
    # PT-42 (ruling § 5): so the HTTP handler can fold "this issue is
    # archived" into the SAME `read_only` stamp a foreign-root issue
    # already gets (do not invent a second read-only flag) -- the drawer's
    # inline editors already suppress on `read_only`, no client change
    # needed beyond that one flag's computation widening.
    issue["archived"] = is_archived_path(data_dir, path)
    # POLY-56 (gate-1 ruling R1): the drawer's Acceptance-criteria rows now
    # come from here, not a client-side re-parse of `description` -- one
    # parser (checklist_items), not two that could disagree.
    issue["checklist_items"] = checklist_items(issue["description"])
    return issue


def build_record_payload(data_dir: Path, record_id: str) -> Optional[Dict[str, Any]]:
    """The milestone/major analog of `build_issue_payload` -- single-file,
    O(1) in the tree size. Backs `POST /api/record/<id>`'s 200/409
    response body (PT-51 §1/§2): "the fresh record payload, same shape as
    the 409's `current`".

    Resolves via `find_record_path`, which ALSO resolves issue ids (it's
    the shared six-subdir resolver PT-39 built for `cairn set`/`cairn
    comment`) -- but the HTTP handler rejects an issue id with `400
    wrong_endpoint` before ever calling this, so in practice this is only
    ever reached for a milestone or major. None if `record_id` resolves
    nowhere at all.

    Same fields `build_board_payload`'s per-record stamping adds (§2):
    `archived`, `body` (the PRE-`## Comments` half via `split_comments`),
    `comments`, `seen`, `path`, and -- milestones only -- `released`
    (`_release_status`, the SAME derivation the board payload's milestone
    loop uses, not a second copy).
    """
    data_dir = Path(data_dir)
    path = find_record_path(data_dir, record_id)
    if path is None:
        return None
    fm, raw_body = parse_frontmatter(path.read_text(encoding="utf-8"))
    fm = dict(fm)
    fm["archived"] = is_archived_path(data_dir, path)
    pre_comments_body, comments = split_comments(raw_body)
    fm["body"] = pre_comments_body
    fm["comments"] = comments
    fm["seen"] = get_seen(path)
    fm["path"] = str(path)
    if _record_schema_for_path(data_dir, path) == "milestone":
        tag_set, git_tags_warning = read_git_tags(data_dir)
        if git_tags_warning:
            print(f"cairn: warning: {git_tags_warning}", file=sys.stderr)
        fm["released"] = _release_status(fm.get("target_tag"), tag_set)
    return fm


def _validate_record_patch(schema: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """PT-51 §3: the record write path's field policy. Returns a 400
    error body (`{"error": "bad_request", "message": ...}`), or `None`
    when `patch` is clean.

    `id`/`kind` are legal CLI fields (`_RECORD_FIELD_ORDER`) but
    deliberately NOT board-editable -- both are simply absent from
    `_RECORD_BOARD_EDITABLE_FIELDS`, not special-cased here; "unknown
    field for the resolved schema" and "id/kind rejected" are the SAME
    check by construction, not two.

    Cross-record invariants (one `ga: true` per major, `target_tag ==
    v<N>.0.0`, `major:` resolves) are explicitly NOT checked here --
    `cairn check` is the backstop, the same posture `cairn set` and
    `blocked_by` already take (a write-path re-implementation of a lint
    rule has nowhere to report a SIBLING record's failure).
    """
    editable = _RECORD_BOARD_EDITABLE_FIELDS[schema]
    for key in patch:
        if key not in editable:
            return {
                "error": "bad_request",
                "message": f"{key!r} is not board-editable for a {schema} -- use `cairn set` instead",
            }
    if "status" in patch and patch["status"] not in RECORD_STATUSES:
        return {
            "error": "bad_request",
            "message": f"invalid status {patch['status']!r} -- expected one of {sorted(RECORD_STATUSES)}",
        }
    if schema == "major" and "health" in patch and patch["health"] not in MAJOR_HEALTH_VALUES:
        return {
            "error": "bad_request",
            "message": f"invalid health {patch['health']!r} -- expected one of {sorted(MAJOR_HEALTH_VALUES)}",
        }
    if schema == "milestone" and "ga" in patch and not isinstance(patch["ga"], bool):
        return {"error": "bad_request", "message": "ga must be a boolean"}
    return None


def compute_etag(data_dir: Path, archived: bool = False) -> str:
    """PT-42 (ruling § 1): folds `archived` into the hash input, and --
    only when it's True -- ALSO hashes the three archive dirs' (path,
    mtime_ns) pairs, mirroring the live-dir loop below. Two representations
    (with/without archive/ data) must never collide on one etag; hashing
    the literal flag first (not just conditionally adding more input)
    means even an archive/ tree that happens to produce the same combined
    mtime-hash as some live tree still can't collide across the two modes.
    """
    data_dir = Path(data_dir)
    hasher = hashlib.sha256()
    hasher.update(f"archived:{archived}\n".encode("utf-8"))
    paths: List[Path] = (
        _dir_glob(data_dir / "majors") + milestone_paths(data_dir, include_archived=archived)
        + _dir_glob(data_dir / "issues")
    )
    if archived:
        paths += _dir_glob(data_dir / "archive" / "majors")
        paths += archived_issue_paths(data_dir)  # PT-52: archive/issues/ only
    for p in paths:
        try:
            st = p.stat()
        except FileNotFoundError:
            continue
        hasher.update(f"{p}:{st.st_mtime_ns}\n".encode("utf-8"))
    return hasher.hexdigest()[:16]
