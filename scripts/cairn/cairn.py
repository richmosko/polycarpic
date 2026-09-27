#!/usr/bin/env python3
"""
cairn.py — cairn (the file-based issue tracker): parser, CLI, and board server.

Full design: process/TRACKER.md. Concrete function-level contract (names,
signatures) assumed by the test suite: scripts/cairn/tests/INTERFACE.md —
that file is the tie-breaker for "what is this function called", the spec
is the tie-breaker for "what must it do".

Summary:
  - Issues, milestones, and majors are markdown files with YAML frontmatter,
    living under a *data dir* (default: process/cairn/ in a project repo).
  - This module is the only non-file interface. It exists for the two jobs a
    plain Read/Write/Edit can't do safely: atomic ID allocation, and
    frontmatter-only rewrites that can't corrupt an issue's body.
  - A local, stateless HTTP server (`cairn serve`) renders a Kanban board by
    parsing the data dir at request time. It holds no state of its own.

Stdlib only. Targets stock macOS Python 3.9 — no `match`, no `X | Y` unions.

Locating the data dir (CLI):
  1. `--data-dir PATH`, if passed — used verbatim.
  2. Otherwise, `CAIRN_DATA_DIR` env var, if set.
  3. Otherwise, walk up from cwd looking for a `process/cairn/` directory
     (mirroring how git finds `.git`).
  4. Otherwise, fall back to `<cwd>/process/cairn`.

Run:
    scripts/cairn/cairn <command> ...     # via the bash shim
    python3 scripts/cairn/cairn.py ...    # direct invocation

Port override for `serve`: CAIRN_PORT=8899, or `--port`.
"""

import argparse
import subprocess
import collections
import datetime
import hashlib
import http.server
import itertools
import json
import os
import queue
import re
import socketserver
import stat
import statistics
import sys
import tempfile
import threading
import time
import urllib.parse
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, NamedTuple, Optional, Set, Tuple

from cairnlib.constants import *  # noqa: F401,F403 (POLY-58 step 1)
from cairnlib.errors import *  # noqa: F401,F403 (POLY-58 step 2)
from cairnlib.yamlsub import *  # noqa: F401,F403 (POLY-58 step 3)
from cairnlib.records import *  # noqa: F401,F403 (POLY-58 step 4)
from cairnlib.config import *  # noqa: F401,F403 (POLY-58 step 5)
from cairnlib.store import *  # noqa: F401,F403 (POLY-58 step 6)
from cairnlib.guards import *  # noqa: F401,F403 (POLY-58 step 7)
from cairnlib.lint import *  # noqa: F401,F403 (POLY-58 step 8)
from cairnlib.snapshot import *  # noqa: F401,F403 (POLY-58 step 9)
from cairnlib.roster import *  # noqa: F401,F403 (POLY-58 step 10)
from cairnlib.attribution import *  # noqa: F401,F403 (POLY-58 step 11)
from cairnlib.flow import *  # noqa: F401,F403 (POLY-58 step 12)
from cairnlib.tokens import *  # noqa: F401,F403 (POLY-58 step 13)
from cairnlib.actuals import *  # noqa: F401,F403 (POLY-58 step 14)


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


# --------------------------------------------------------------------------
# Multi-root (PT-3): read-only cross-project aggregation for `cairn serve`.
#
# Every single-root function above stays byte-identical. This layer adds a
# thin aggregation on top: `resolve_roots` turns config + an optional CLI
# override into an ordered list of `Root`s (primary always element 0,
# unconditionally trusted; secondaries warn-and-skip on any problem rather
# than raising), `build_multi_board_payload` calls the existing
# `build_board_payload` once per root and stamps `repo` on every record,
# and `compute_multi_etag`/`find_issue_in_roots` are the multi-root
# counterparts of `compute_etag`/`find_issue_path`.
#
# The read-only guarantee is structural, not a check someone has to
# remember: `find_issue_in_roots` is deliberately a separate function from
# `find_issue_path`, and the write handlers (`_create_issue`,
# `_mutate_issue` in `make_server`) close over `data_dir` -- the primary
# root -- only. Nothing in this section is ever reachable from a POST
# handler except the explicit, truthful 403 guard in `_mutate_issue`.
# --------------------------------------------------------------------------

Root = NamedTuple("Root", [("id", str), ("label", str), ("path", Path), ("primary", bool)])


def resolve_roots(
    data_dir: Path,
    config: Dict[str, Any],
    cli_repos: Optional[List[str]] = None,
) -> Tuple[List[Root], List[Dict[str, str]]]:
    """Resolve the primary root plus any configured/CLI secondary roots.

    Returns `(roots, warnings)`. The primary (`data_dir`, already resolved
    and validated upstream by `resolve_data_dir`) is always `roots[0]` and
    is never skipped or warned about -- a broken primary is a hard
    `CairnError` raised before this function is ever called, not a
    warn-and-skip candidate.

    `cli_repos`, when given (not `None`), REPLACES `config["roots"]`
    entirely rather than extending it (team-lead ruling, PT-3 §7-B) --
    "what I typed is what I get". The primary root is included either way.
    `cli_repos=[]` (an explicit empty override) means "no secondaries",
    distinct from `cli_repos=None` (defer to `config["roots"]`).

    Each secondary entry must be a non-empty string. `config["roots"]`
    entries must additionally be relative (not absolute) -- committed,
    portable across clones/machines (§4.1); `cli_repos` entries may be
    absolute (§4.3) -- ad-hoc and uncommitted, so portability doesn't
    apply. It resolves against the repo root (`data_dir.parent.parent`)
    two ways, tried in order: `<entry>/config.yml` (points directly at a
    data dir) or `<entry>/process/cairn/config.yml` (points at a repo
    root, the normal case). Anything else -- missing, unreadable,
    malformed config.yml, or a prefix colliding with an already-loaded
    root -- is skipped with a warning (reason codes: not_found,
    unreadable, bad_config, duplicate, bad_entry), never raised.
    """
    data_dir = Path(data_dir)
    repo_root = data_dir.parent.parent
    primary = Root(
        id=str(config.get("prefix") or "ISS"),
        label=repo_root.name,
        path=data_dir,
        primary=True,
    )
    roots: List[Root] = [primary]
    warnings: List[Dict[str, str]] = []
    seen_ids = {primary.id}

    from_cli = cli_repos is not None
    if from_cli:
        entries: List[Any] = list(cli_repos)
    else:
        raw = config.get("roots")
        entries = raw if isinstance(raw, list) else []

    for entry in entries:
        if not isinstance(entry, str) or not entry:
            warnings.append({
                "root": str(entry), "reason": "bad_entry",
                "detail": "roots entries must be non-empty relative path strings",
            })
            continue
        # §4.3: config.yml's roots: must be relative (committed, portable
        # across clones/machines) -- --repos is ad-hoc/uncommitted, so an
        # absolute path there is fine and deliberately allowed.
        if Path(entry).is_absolute() and not from_cli:
            warnings.append({
                "root": entry, "reason": "bad_entry",
                "detail": "roots entries must be relative to the repo root",
            })
            continue

        candidate = (repo_root / entry).resolve()
        if (candidate / "config.yml").is_file():
            secondary_data_dir = candidate
        elif (candidate / "process" / "cairn" / "config.yml").is_file():
            secondary_data_dir = candidate / "process" / "cairn"
        else:
            warnings.append({"root": entry, "reason": "not_found", "detail": str(candidate)})
            continue

        cfg_path = secondary_data_dir / "config.yml"
        try:
            cfg_text = cfg_path.read_text(encoding="utf-8")
        except OSError as e:
            warnings.append({"root": entry, "reason": "unreadable", "detail": str(e)})
            continue
        try:
            parsed_cfg = parse_yaml_subset(cfg_text)
        except CairnError as e:
            warnings.append({"root": entry, "reason": "bad_config", "detail": str(e)})
            continue

        secondary_id = str(parsed_cfg.get("prefix") or "")
        if not secondary_id or secondary_id in seen_ids:
            warnings.append({"root": entry, "reason": "duplicate", "detail": secondary_id})
            continue

        label = secondary_data_dir.parent.parent.name
        roots.append(Root(id=secondary_id, label=label, path=secondary_data_dir, primary=False))
        seen_ids.add(secondary_id)

    return roots, warnings


def build_multi_board_payload(
    roots: List[Root],
    warnings: List[Dict[str, str]],
    archived: bool = False,
    engine: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Aggregate `build_board_payload` across every root, stamping
    `record["repo"] = root.id` on every major/milestone/issue.

    PT-42 (ruling § 1): `archived` threads straight through to every
    per-root `build_board_payload(root.path, archived=archived)` call --
    applied per root, same as everything else this function aggregates.

    A per-root `CairnError` (any file in that root fails to parse) is
    caught here and converted into a `parse_error` warning -- that root
    contributes nothing to the payload, the same warn-and-skip contract
    `resolve_roots` applies one level up, applied to file-level breakage
    inside an otherwise-reachable root.

    `warnings` is the caller's existing list (typically `resolve_roots`'s
    second return value); this function returns a **new** list that
    includes it plus any parse_error entries discovered here -- callers
    must use the returned `payload["warnings"]`, not assume their input
    list was mutated in place.

    PT-38 (ruling § 3): also carries `columns`/`swimlane`, the RESOLVED
    (config-or-default) values -- always present, single-root included (no
    conditional payload shape, the PT-3 precedent). Sourced from
    `load_config(roots[0].path)` ONLY -- the PRIMARY root's config governs;
    a secondary root's own `board.*` config is read (nothing stops a
    secondary root having one) but never reaches this payload. `roots[0]`
    is always the primary by `resolve_roots`'s own contract, so no
    `root.primary` scan is needed here.

    THE stderr print site for an invalid board.columns/board.swimlane
    (ruling § 2's server posture): `resolve_board_columns`/
    `resolve_board_swimlane` only return a warning as data; this function
    -- called fresh on every `/api/board` request, no caching, matching
    this whole module's stateless-lens design -- is where it actually
    reaches stderr, one line per field, naming the offending value.

    PT-49 (ruling § 4): `engine`, when given, is embedded VERBATIM under
    the top-level `engine` key -- `{source_sha, started_at, stale}`,
    per-process (belongs beside `roots`/`warnings`, never on a record,
    never per root). Computing that dict (the boot fingerprint, the §3
    self-check) is the caller's job (`do_GET`'s `/api/board` handler) --
    this function only places it, same posture it already takes with
    `warnings`. `None` (every pre-PT-49 caller/test) omits the key
    entirely rather than a fabricated placeholder.
    """
    all_warnings = list(warnings)
    majors: List[Dict[str, Any]] = []
    milestones: List[Dict[str, Any]] = []
    issues: List[Dict[str, Any]] = []

    # Architect's review of 109fd25, delta 2: `resolve_roots` always seeds
    # `roots[0]` with the primary root and never removes it (its own
    # contract, restated in this function's docstring above), so an empty
    # `roots` is unreachable from any real caller -- the `load_config(Path("."))`
    # fallback this used to have was dead code whose only visible effect,
    # post-PT-80, would have been a confusing `no config.yml at config.yml`
    # on a state that should never occur. Assert the contract instead of
    # quietly working around a violation of it.
    assert roots, "build_multi_board_payload: roots must never be empty -- resolve_roots always seeds the primary"
    primary_config = load_config(roots[0].path)
    resolved_columns, columns_warning = resolve_board_columns(primary_config)
    resolved_swimlane, swimlane_warning = resolve_board_swimlane(primary_config)
    if columns_warning:
        print(f"cairn: warning: {columns_warning}", file=sys.stderr)
    if swimlane_warning:
        print(f"cairn: warning: {swimlane_warning}", file=sys.stderr)

    for root in roots:
        try:
            payload = build_board_payload(root.path, archived=archived)
        except CairnError as e:
            all_warnings.append({"root": root.id, "reason": "parse_error", "detail": str(e)})
            continue
        for m in payload["majors"]:
            m = dict(m)
            m["repo"] = root.id
            majors.append(m)
        for m in payload["milestones"]:
            m = dict(m)
            m["repo"] = root.id
            milestones.append(m)
        for i in payload["issues"]:
            i = dict(i)
            i["repo"] = root.id
            issues.append(i)

    result = {
        "roots": [{"id": r.id, "label": r.label, "primary": r.primary} for r in roots],
        "warnings": all_warnings,
        "columns": resolved_columns,
        "swimlane": resolved_swimlane,
        "majors": majors,
        "milestones": milestones,
        "issues": issues,
    }
    if engine is not None:
        result["engine"] = engine
    return result


def compute_multi_etag(
    roots: List[Root],
    archived: bool = False,
    boot_sha: Optional[str] = None,
    source_path: Optional[Path] = None,
) -> str:
    """Fold `compute_etag` over every root -- correct with no key-collision
    risk, since `compute_etag` already hashes each file's full path (which
    differs across roots) plus its mtime.

    PT-42 (ruling § 1): `archived` threads through to each per-root
    `compute_etag` call, same as build_multi_board_payload above -- the
    two representations get two etags, never one shared between them.

    PT-49 (ruling § 5, the part that would otherwise silently defeat the
    whole feature): `boot_sha` + the CURRENT `(mtime_ns, size)` of
    `source_path` are folded in ONCE, at the top -- not per root. Without
    this, a stale flip with no data-file change leaves every per-root
    etag unchanged, the client 304s, and the banner never appears. Both
    args default to `None` (opt-in, back-compat with every pre-PT-49
    caller/test): `None` skips the fold entirely rather than hashing a
    literal "None" string, so an omitted engine identity can never
    collide with a real one.
    """
    hasher = hashlib.sha256()
    if boot_sha is not None or source_path is not None:
        hasher.update(f"engine_boot_sha:{boot_sha}\n".encode("utf-8"))
        if source_path is not None:
            try:
                p = Path(source_path)
                if p.is_dir():
                    fp = engine_fingerprint(p)
                    hasher.update(f"engine_source:{fp['mtime_ns']}:{fp['size']}\n".encode("utf-8"))
                else:
                    st = p.stat()
                    hasher.update(f"engine_source:{st.st_mtime_ns}:{st.st_size}\n".encode("utf-8"))
            except OSError:
                hasher.update(b"engine_source:missing\n")
    for root in roots:
        hasher.update(compute_etag(root.path, archived=archived).encode("utf-8"))
        hasher.update(b"\n")
    return hasher.hexdigest()[:16]


def find_issue_in_roots(roots: List[Root], issue_id: str) -> Optional[Root]:
    """The root `issue_id` lives in, or `None`.

    Deliberately a *separate* function from `find_issue_path` -- never
    called from `do_POST` -- so there is no code path from a mutation
    handler to a secondary root's filesystem. That separation is what
    makes read-only structural rather than a check someone has to
    remember (design note §5.1).
    """
    for root in roots:
        if find_issue_path(root.path, issue_id) is not None:
            return root
    return None


def find_record_in_roots(roots: List[Root], record_id: str) -> Optional[Root]:
    """The `find_issue_in_roots` sibling for `POST /api/record/<id>`
    (PT-51 §1 step 1). Same contract, one resolver over: used ONLY to
    tell `403 read_only_root` from a genuine `404` for the HTTP mutation
    handler, NEVER to locate a file to write -- `find_record_path`
    (`data_dir`-scoped, i.e. primary-root-only by construction) stays the
    only resolver `_mutate_record` can reach, exactly like
    `find_issue_path`/`_mutate_issue`.
    """
    for root in roots:
        if find_record_path(root.path, record_id) is not None:
            return root
    return None


# --------------------------------------------------------------------------
# Live push (PT-1): a periodic fs-scan watcher + SSE broadcaster.
#
# Stdlib only, per the boring-stack principle -- no watchdog/inotify dep.
# A background thread os.scandirs the four tracked subdirs on a fixed
# cadence and diffs (relative path, mtime_ns) against the previous scan;
# any difference is one coarse "something changed" event broadcast to
# every subscribed SSE client (never a per-id targeted diff -- deferred,
# see the PT-1 issue file). Purely in-memory: no durable state, killing
# the server drops every subscriber and the watcher with it (stateless
# lens, unchanged).
# --------------------------------------------------------------------------

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


# --------------------------------------------------------------------------
# Engine staleness detection (PT-49, architect's ruling in the issue file).
#
# The running Python PROCESS, not the data files it re-reads on every
# request, is the thing that can go stale: `_send_static`/`build_board_
# payload` already re-parse disk on every call, so an upgraded cairn.py
# is invisible to a server that was started before the upgrade landed --
# exactly the "?archived=1 does nothing" bug this closes. Fingerprints
# `cairn.py` ONLY (§1) -- a content hash, not a git hash (§2): git names
# the checked-out commit, not which bytes the running process imported,
# and an uncommitted edit (the actual incident) has no commit at all.
# --------------------------------------------------------------------------

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


# --------------------------------------------------------------------------
# HTTP server — a lens, not a source of truth. No state held here.
# --------------------------------------------------------------------------

def make_server(
    data_dir: Path,
    config: Optional[Dict[str, Any]] = None,
    port: Optional[int] = None,
    roots: Optional[List[Root]] = None,
    source_path: Path = Path(__file__),
    dashboard_dir: Path = DASHBOARD_DIR,
):
    """Build (but do not start) the board's HTTPServer, bound to 127.0.0.1.

    port=0 -> ephemeral (read back via server.server_address[1]).
    port=None -> load_config(data_dir)["port"].
    Caller owns serve_forever() so tests can run it in a thread.

    PT-3: `roots`, when omitted (`None`), is synthesised by calling
    `resolve_roots(data_dir, config)` -- the exact same function multi-root
    callers use -- so single-root behaviour (the overwhelming majority of
    callers: every existing test, `cmd_serve` without `--repos`) is
    exercised by the *same* code path multi-root uses, not a separate one
    that could silently drift. `cmd_serve` resolves roots itself (for its
    startup banner) and passes the result in explicitly.

    PT-49 (§9's required test seam): `source_path` defaults to THIS
    module's own file -- a real server fingerprints the actual running
    `cairn.py` with zero caller effort -- but is overridable so a test can
    point it at a throwaway file and rewrite THAT, never the live,
    imported `cairn.py`. Fingerprinted exactly once here, at construction
    (§2's "boot" fingerprint); every later `/api/board` build re-checks
    against it via `engine_is_stale`, never re-fingerprints from scratch.

    PT-54 (architect ruling §4): `dashboard_dir` defaults to the real
    committed `DASHBOARD_DIR` -- overridable so a test can exercise the
    missing-dist 503 branch (or serve a throwaway fixture) without
    touching the real `scripts/cairn/dashboard/dist/`, same seam
    `source_path` already established.
    """
    data_dir = Path(data_dir)
    dashboard_dir = Path(dashboard_dir)
    if config is None:
        config = load_config(data_dir)
    if port is None:
        port = int(os.environ.get("CAIRN_PORT", config.get("port", DEFAULT_PORT)))
    if roots is None:
        roots, root_warnings = resolve_roots(data_dir, config)
    else:
        root_warnings = []
    host = "127.0.0.1"

    # PT-49 §2: captured once, held on the handler closure below, compared
    # against on every /api/board build (§3) -- never recomputed here.
    engine_boot = engine_fingerprint(source_path)
    engine_started_at = datetime.datetime.now().isoformat()

    # PT-1: Server is per-connection threaded (ThreadingMixIn below) so a
    # held-open SSE connection can't starve the accept loop for every
    # other client. That's a real behavior change from the old
    # single-threaded HTTPServer, where request handling was inherently
    # serialized -- two concurrent POST /api/issue/<id> on the *same*
    # issue could never race, because the server processed one full
    # request/response cycle at a time. Once concurrent request threads
    # are possible, that serialization has to be re-created explicitly:
    # write_lock below serializes only the mutate path (the
    # seen-check-then-write critical section), so two concurrent writers
    # to the same issue can't both pass the staleness check against the
    # same pre-write state and silently lose one of their patches. Reads
    # (GET /api/board, GET /api/issue/<id>, the SSE stream) stay fully
    # concurrent -- only writes serialize. allocate_and_create_issue's own
    # O_EXCL retry loop already makes concurrent *creates* safe without
    # this lock (each gets a distinct ID), so _create_issue isn't wrapped.
    write_lock = threading.Lock()

    # PT-1: watcher lifecycle is bound to make_server itself (server
    # object exists => watching), not to cmd_serve -- so every test (and
    # every other caller) that builds a server via make_server gets a
    # live watcher for free. Baseline snapshot happens synchronously
    # inside DataDirWatcher.__init__, below, before .start() is called.
    broadcaster = _SSEBroadcaster()
    watcher = DataDirWatcher(roots, broadcaster)

    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = "cairn/1.0"

        def log_message(self, fmt, *fmt_args):  # noqa: A003
            # PT-34 (architect's E0 prerequisite, ruled permanent): the
            # prior override discarded every argument log_request/log_error
            # pass through fmt_args, including the HTTP status code -- a
            # request that returned 200 and one that returned 503 produced
            # an identical server-log line. That gap is what turned this
            # investigation into an afternoon of Chrome-side reasoning
            # instead of a grep. BaseHTTPRequestHandler.log_request's own
            # call shape (kept here as the reference format) is
            # `log_message('"%s" %s %s', requestline, code, size)` --
            # fmt_args[1] is the status code on that path.
            #
            # PT-31 (architect's comment-accuracy fix, item 8): the
            # previous version of this comment claimed any OTHER call
            # shape (log_error, etc.) "degrades to the terse form" -- that
            # is false. log_error's own call shape is
            # `log_message("code %d, message %s", code, message)`, so at
            # fmt_args[1] it carries the MESSAGE ("Not Found"), not a
            # status code -- that string lands in this line's status
            # column verbatim, not a "-" placeholder. Harmless for E0's
            # actual purpose (the real numeric status still appears on
            # log_request's own line for the same request), but the prior
            # comment described a fallback that doesn't exist. No
            # format-string guard added to distinguish the two shapes --
            # that would couple this handler to a CPython stdlib internal
            # (the exact positional args http.server happens to pass)
            # for a cosmetic gain on an already-non-blocking log line.
            status = fmt_args[1] if len(fmt_args) >= 2 else "-"
            sys.stderr.write("  %s %s %s\n" % (self.command, self.path, status))

        def _send_json(self, status: int, payload: Any) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _send_static(self, rel_path: str, base: Path = BOARD_DIR) -> None:
            # PT-54 (architect ruling §4): widened to take `base` so the
            # dashboard's static assets go through the SAME traversal
            # guard as the board's (BOARD_DIR stays the default -- every
            # pre-PT-54 caller is unaffected).
            target = (base / rel_path).resolve()
            try:
                target.relative_to(base.resolve())
            except ValueError:
                self.send_error(403)
                return
            if not target.is_file():
                self.send_error(404)
                return
            content_type = {
                ".html": "text/html; charset=utf-8",
                ".js": "application/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".woff2": "font/woff2",
                ".svg": "image/svg+xml",
                ".png": "image/png",
                ".ico": "image/x-icon",
                ".json": "application/json",
                ".map": "application/json",
            }.get(target.suffix, "application/octet-stream")
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            # PT-49 §7: closes the browser-cache half of staleness cheaply
            # -- matches what /api/board already sends. No client-side
            # asset-version handshake: with no-store, a stale board.js/
            # board.css is not a reachable state, so there is nothing left
            # for a handshake to protect against.
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _send_dashboard_unbuilt_503(self) -> None:
            """PT-54 (architect ruling §3/§4): the dashboard's `dist/` is
            COMMITTED, never built at serve time -- when it's missing (a
            clone that hasn't run `npm ci && npm run build` under
            `scripts/cairn/dashboard/` specifically; the rest of `cairn
            serve` needs nothing but python3), name the literal fix
            rather than a bare 404/500. `/api/dashboard` is unaffected --
            it's pure python, no build dependency.
            """
            body = (
                "<!doctype html><html><head><title>Dashboard not built</title></head>"
                "<body><h1>503 &mdash; Dashboard not built</h1>"
                "<p>Run <code>cd scripts/cairn/dashboard &amp;&amp; npm ci &amp;&amp; "
                "npm run build</code>, then restart <code>cairn serve</code>.</p>"
                "</body></html>"
            ).encode("utf-8")
            self.send_response(503)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _handle_sse(self) -> None:
            """GET /api/events -- an SSE stream. Holds the connection
            open (no Content-Length, no keep-alive) and pushes one
            `data: <json>\\n\\n` frame per broadcaster event -- coarse
            per team-lead's ruling: the frame's contents (created/
            changed/removed path lists) are informational only, the
            client refetches the whole board on any event, never a
            per-id targeted diff.

            A 30s heartbeat comment (standard SSE keep-alive cadence)
            bounds how long a dead connection's thread can sit blocked
            on q.get() with nothing to detect the disconnect -- 30s is
            comfortably above every test's read-timeout budget (this is
            a localhost single-user tool, not proxied through anything
            with its own idle-connection timeout, so nothing here is
            tuned to the test suite's timing). A write failure on either
            a heartbeat or a real event (client gone) ends the loop and
            unsubscribes.
            """
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            q = broadcaster.subscribe()
            try:
                while True:
                    try:
                        event = q.get(timeout=30.0)
                    except queue.Empty:
                        self.wfile.write(b": keep-alive\n\n")
                        self.wfile.flush()
                        continue
                    body = json.dumps(event).encode("utf-8")
                    self.wfile.write(b"data: " + body + b"\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                broadcaster.unsubscribe(q)

        def do_GET(self):  # noqa: N802
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            if path == "/api/board":
                # PT-42 (ruling § 1): `?archived=1` is the ONLY accepted
                # spelling -- absent, empty, or any other value is OFF, so
                # a typo'd/garbage query param can never accidentally
                # trigger the 28x-cost archive/ read. `parse_qs` (not a
                # hand-split on "&"/"="): stdlib, handles the usual query-
                # string edge cases (repeated keys, missing values, url-
                # decoding) this endpoint doesn't otherwise need to worry
                # about the first time it grows a query param at all.
                query = urllib.parse.parse_qs(parsed.query)
                archived = query.get("archived", [""])[0] == "1"
                # PT-49 §3/§5: the self-check runs on EVERY build (cheap:
                # one stat in the common case), folded into the etag (§5,
                # the part that would otherwise silently defeat the whole
                # feature -- without it a stale flip with no data change
                # 304s forever and the banner never appears).
                engine_stale = engine_is_stale(source_path, engine_boot)
                engine_status = {
                    "source_sha": engine_boot["sha"],
                    "started_at": engine_started_at,
                    "stale": engine_stale,
                }
                etag = compute_multi_etag(
                    roots, archived=archived, boot_sha=engine_boot["sha"], source_path=source_path
                )
                if self.headers.get("If-None-Match") == etag:
                    self.send_response(304)
                    self.send_header("ETag", etag)
                    self.end_headers()
                    return
                payload = build_multi_board_payload(
                    roots, root_warnings, archived=archived, engine=engine_status
                )
                body = json.dumps(payload).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("ETag", etag)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            if path.startswith("/api/issue/"):
                issue_id = urllib.parse.unquote(path[len("/api/issue/"):])
                # PT-3: read side is roots-aware -- an issue from ANY
                # loaded root is readable, stamped with which root it came
                # from and whether that root is writable. The write side
                # (_mutate_issue below) is deliberately NOT roots-aware in
                # the same way -- that asymmetry is the read-only guarantee.
                owning_root = find_issue_in_roots(roots, issue_id)
                if owning_root is None:
                    self._send_json(404, {"error": "not_found", "message": f"no such issue: {issue_id}"})
                    return
                payload = build_issue_payload(owning_root.path, issue_id)
                payload["repo"] = owning_root.id
                # PT-42 (ruling § 5): folds the archived stamp
                # build_issue_payload already computes into the SAME
                # read_only flag a foreign-root issue gets -- the drawer's
                # inline editors already suppress on this one flag (PT-3),
                # so an archived issue's read-only-ness needs no second
                # client-side flag to check.
                payload["read_only"] = (not owning_root.primary) or payload["archived"]
                self._send_json(200, payload)
                return
            if path == "/api/events":
                self._handle_sse()
                return
            if path == "/api/dashboard":
                # PT-54 (architect ruling §4): primary-root only -- git
                # state is inherently single-repo, there is no multi-root
                # "current branch". Same ETag/no-store posture as
                # /api/board, but hashing the SERIALIZED BODY (the
                # ruling's own words: "cheap to write") rather than a
                # file-mtime fold -- every field here already comes from
                # either a bounded git subprocess or a fresh parse, so
                # there's no cheaper fingerprint to reuse.
                payload = build_dashboard_payload(roots[0].path)
                body = json.dumps(payload).encode("utf-8")
                # `generated_at` is excluded from the hash input --
                # otherwise every request's own timestamp would change
                # the ETag, defeating 304 entirely even when nothing
                # else in the payload moved.
                etag_input = {k: v for k, v in payload.items() if k != "generated_at"}
                etag = hashlib.sha256(json.dumps(etag_input, sort_keys=True).encode("utf-8")).hexdigest()[:16]
                if self.headers.get("If-None-Match") == etag:
                    self.send_response(304)
                    self.send_header("ETag", etag)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("ETag", etag)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            if path == "/api/roster":
                # PT-56 (architect ruling § "Where the code lives"): a
                # SEPARATE endpoint, never a key on /api/dashboard --
                # keeps PT-54's five-key payload contract intact and
                # isolates failure (an unreadable .claude/agents/ degrades
                # only this endpoint). No SSE-driven freshness: the
                # watcher scans process/cairn/ only, so a change under
                # .claude/agents/ would emit nothing regardless -- the
                # dashboard client polls this on its own cadence instead.
                payload = build_roster_payload(roots[0].path)
                self._send_json(200, payload)
                return
            if path == "/api/flow":
                # PT-61 (architect ruling): a SEPARATE endpoint from
                # /api/dashboard, same reasoning as /api/roster above --
                # different cost profile (two bounded git subprocesses on
                # a cache miss vs. a data-dir parse), different cache key
                # (HEAD sha, not the dashboard body hash), different
                # freshness cadence (polled by the client, never SSE --
                # the watcher scans process/cairn/ only, and history
                # doesn't change on a working-tree edit anyway). Degrades
                # to 200 + `series: []` + a warning, never 500 --
                # build_flow_payload never raises.
                payload = build_flow_payload(roots[0].path)
                body = json.dumps(payload).encode("utf-8")
                etag = payload.get("as_of") or hashlib.sha256(body).hexdigest()[:16]
                if self.headers.get("If-None-Match") == etag:
                    self.send_response(304)
                    self.send_header("ETag", etag)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("ETag", etag)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            if path == "/api/tokens":
                # PT-79 (architect ruling § 2): a SEPARATE endpoint, same
                # PT-56/PT-61 precedent as /api/roster and /api/flow
                # above. Memoized on (mtime, size) of token-usage.jsonl
                # via build_tokens_payload_cached -- never raises,
                # degrades to warning + issues: [] for a missing or
                # unreadable metrics file (the one place "missing means
                # error" does not apply here -- the file is optional
                # data, unlike config.yml).
                payload = build_tokens_payload_cached(roots[0].path)
                body = json.dumps(payload).encode("utf-8")
                etag = payload.get("generated") or hashlib.sha256(body).hexdigest()[:16]
                if self.headers.get("If-None-Match") == etag:
                    self.send_response(304)
                    self.send_header("ETag", etag)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("ETag", etag)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            if path == "/":
                # PT-73 (Mosko's ruling: "bare / loads the dashboard" +
                # architect's mechanics ruling): 302 (never 301/308 --
                # the predicate is filesystem state that CHANGES when
                # dist/ gets built or deleted, and a permanent redirect
                # would get cached past the point it stops being true,
                # with no way for the server to correct a browser that's
                # stopped asking) + Cache-Control: no-store (some
                # browsers/proxies cache 302s too). Query strings are
                # NOT forwarded -- nothing today needs to survive the
                # hop to bare /dashboard. The embed carve-out below is
                # the recursion guard _is_embed_request's own docstring
                # names -- without it, the shell's `/?embed=1` iframe
                # would redirect into /dashboard, which mounts another
                # `/?embed=1` iframe, forever.
                if _dashboard_is_servable(dashboard_dir) and not _is_embed_request(parsed.query):
                    self.send_response(302)
                    self.send_header("Location", "/dashboard")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    return
                self._send_static("board.html")
                return
            if path in ("/list", "/board"):
                # PT-73 (architect ruling §5): `/list` was always a
                # deep-link and stays one. `/board` is new -- a never-
                # redirecting alias so the standalone Kanban view stays
                # reachable once `/` starts redirecting when dist is
                # present (board.html's Kanban tab now points here
                # instead of bare `/`, which would otherwise bounce a
                # standalone user into the dashboard mid-click).
                self._send_static("board.html")
                return
            if path.startswith("/board/"):
                self._send_static(path[len("/board/"):])
                return
            if path in ("/dashboard", "/dashboard/"):
                # PT-73 (architect ruling §2, §6): same shared predicate
                # as the `/` redirect above -- this route must never
                # itself gain a redirect, or the shared helper's "can't
                # drift" guarantee becomes a loop.
                if not _dashboard_is_servable(dashboard_dir):
                    self._send_dashboard_unbuilt_503()
                    return
                self._send_static("index.html", base=dashboard_dir)
                return
            if path.startswith("/dashboard/"):
                # PT-54 (architect ruling §4): SPA fallback, narrowly --
                # a real file wins; a no-suffix path (client-side route)
                # falls back to index.html; a SUFFIXED path that doesn't
                # exist (a missing .js/.css) stays a 404, never silently
                # becomes index.html -- "the classic hours-lost debugging
                # trap."
                if not dashboard_dir.is_dir():
                    self._send_dashboard_unbuilt_503()
                    return
                rel = path[len("/dashboard/"):]
                if (dashboard_dir / rel).is_file():
                    self._send_static(rel, base=dashboard_dir)
                elif Path(rel).suffix == "":
                    self._send_static("index.html", base=dashboard_dir)
                else:
                    self.send_error(404)
                return
            self.send_error(404)

        def do_POST(self):  # noqa: N802
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length else b""
            try:
                payload = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                self._send_json(400, {"error": "bad_request", "message": "invalid JSON body"})
                return

            if path == "/api/issue":
                self._create_issue(payload)
                return
            if path.startswith("/api/issue/"):
                issue_id = urllib.parse.unquote(path[len("/api/issue/"):])
                self._mutate_issue(issue_id, payload)
                return
            if path.startswith("/api/record/"):
                record_id = urllib.parse.unquote(path[len("/api/record/"):])
                self._mutate_record(record_id, payload)
                return
            self.send_error(404)

        def _create_issue(self, payload: Dict[str, Any]) -> None:
            title = payload.get("title")
            if not title:
                self._send_json(400, {"error": "bad_request", "message": "title is required"})
                return
            fields = {
                "title": title,
                "status": payload.get("status") or DEFAULT_STATUS,
                "milestone": payload.get("milestone"),
                "parent": payload.get("parent"),
                "assignee": payload.get("assignee"),
                "labels": payload.get("labels") or [],
                "priority": payload.get("priority"),
                "pr": None,
            }
            # PT-52 §3 / POLY-51 ruling §2 / POLY-48 item 7 (gate-1 ruling
            # process/reviews/POLY-48/ruling.md §1, "confirmed as filed"):
            # allocate_and_create_issue raises one of three named errors,
            # each caught before the plain-`CairnError` fallback (both
            # subclass it) so they map to distinct, truthful HTTP codes:
            #   - LegacyArchiveError (the legacy-layout guard): 400
            #     legacy_archive -- a client retry of the identical request
            #     can't fix this, only running the migration can.
            #   - BadParentError (an unresolvable/nested `--parent`, OR
            #     a..z letter exhaustion under a valid parent): 400
            #     bad_parent -- a client CAN fix this, by retrying with a
            #     different `--parent` or once a letter frees up.
            #   - anything else (e.g. the numeric path's own attempt-budget
            #     exhaustion): 409 allocation_failed -- a transient
            #     collision under concurrent allocation; retrying the same
            #     request can plausibly succeed next time.
            try:
                new_path = allocate_and_create_issue(data_dir, fields)
            except LegacyArchiveError as e:
                self._send_json(400, {"error": "legacy_archive", "message": str(e)})
                return
            except BadParentError as e:
                self._send_json(400, {"error": "bad_parent", "message": str(e)})
                return
            except CairnError as e:
                self._send_json(409, {"error": "allocation_failed", "message": str(e)})
                return
            self._send_json(200, build_issue_payload(data_dir, new_path.stem))

        def _mutate_issue(self, issue_id: str, payload: Dict[str, Any]) -> None:
            # PT-3: find_issue_path is scoped to `data_dir` (the primary
            # root) only -- structurally, not by a check that could be
            # forgotten (design note §5.1). A foreign id is truthfully
            # refused with 403 read_only_root; an id no root recognizes at
            # all is a genuine 404. find_issue_in_roots is only ever
            # called here to produce that distinction -- never to locate a
            # file to write to.
            issue_path = find_issue_path(data_dir, issue_id)
            if issue_path is None:
                foreign_root = find_issue_in_roots(roots, issue_id)
                if foreign_root is not None and not foreign_root.primary:
                    self._send_json(403, {
                        "error": "read_only_root",
                        "message": f"{issue_id} lives in root {foreign_root.id} — "
                                   "the board is read-only across roots",
                    })
                    return
                self._send_json(404, {"error": "not_found", "message": f"no such issue: {issue_id}"})
                return

            # PT-42 (ruling § 5): an id that resolves in archive/ is
            # refused 403, file untouched -- mirrors read_only_root's
            # shape exactly. find_issue_path itself is UNCHANGED (still
            # resolves archive/, same PT-3/PT-39 precedent) -- this check
            # is HTTP-only; the CLI (`cairn set`/`cairn comment`, which
            # calls find_issue_path directly, never through here) stays
            # deliberately able to write an archived issue. A drag is a
            # one-pixel gesture that would leave a live-looking issue
            # sitting in archive/, invisible the moment Show-archived goes
            # off -- un-archiving is `git mv`, deliberately.
            if is_archived_path(data_dir, issue_path):
                self._send_json(403, {
                    "error": "archived",
                    "message": f"{issue_id} is archived — read-only on the board; use the CLI instead",
                })
                return

            if "seen" not in payload:
                self._send_json(400, {
                    "error": "bad_request",
                    "message": "seen is required (send the loaded token, or explicit null to override)",
                })
                return

            # PT-1: serializes the seen-check-then-write critical section
            # across request threads -- see write_lock's docstring above
            # for why this became necessary once Server went threaded.
            with write_lock:
                seen = payload["seen"]
                current_seen = get_seen(issue_path)
                if seen is not None and str(seen) != current_seen:
                    current = build_issue_payload(data_dir, issue_id)
                    self._send_json(409, {
                        "error": "stale",
                        "message": f"{issue_id} changed on disk since you loaded it",
                        "current": current,
                    })
                    return

                patch = payload.get("patch")
                if patch:
                    apply_patch(issue_path, patch)
                comment = payload.get("comment")
                if comment:
                    append_comment(issue_path, comment.get("author", "board"), comment.get("body", ""))

                self._send_json(200, build_issue_payload(data_dir, issue_id))

        def _mutate_record(self, record_id: str, payload: Dict[str, Any]) -> None:
            """`POST /api/record/<id>` -- the milestone/major sibling of
            `_mutate_issue` (PT-51 §1). A NEW endpoint, not a widening of
            `/api/issue/<id>`: `find_issue_path` stays the only resolver
            THAT path can reach (PT-3/PT-39's structural read-only/single-
            write-path guarantee), and this one is scoped to
            `find_record_path` the same way. Six checks, in the ruled
            order -- the order is part of the ruling, not an
            implementation detail:
              1. resolve (403 read_only_root / 404 not_found)
              2. an issue id -> 400 wrong_endpoint (this is NOT a second
                 write path to issues)
              3. archived -> 403, BEFORE the seen comparison
              4. seen missing -> 400; then the critical section + 409 stale
              5. patch -> field policy (§3) -> apply_patch
              6. comment -> append_comment (§4)
            """
            # Step 1 -- same distinguishing pattern as _mutate_issue:
            # find_record_path is data_dir- (primary root-) scoped by
            # construction; find_record_in_roots is ONLY ever called here
            # to tell 403 from 404, never to locate a file to write.
            record_path = find_record_path(data_dir, record_id)
            if record_path is None:
                foreign_root = find_record_in_roots(roots, record_id)
                if foreign_root is not None and not foreign_root.primary:
                    self._send_json(403, {
                        "error": "read_only_root",
                        "message": f"{record_id} lives in root {foreign_root.id} — "
                                   "the board is read-only across roots",
                    })
                    return
                self._send_json(404, {"error": "not_found", "message": f"no such record: {record_id}"})
                return

            # Step 2 -- an issue id resolves here too (find_record_path
            # searches issues/ first); rejecting it is what stops this
            # endpoint from becoming a second write path to issues with a
            # different field policy, the exact drift the single-write-
            # path rule exists to prevent.
            schema = _record_schema_for_path(data_dir, record_path)
            if schema == "issue":
                self._send_json(400, {
                    "error": "wrong_endpoint",
                    "message": f"{record_id} is an issue — use /api/issue/{record_id}",
                })
                return

            # Step 3 -- verbatim _mutate_issue's archived rule, checked
            # BEFORE the seen comparison so it holds regardless of body
            # (proven by the archived-with-a-garbage-body test).
            if is_archived_path(data_dir, record_path):
                self._send_json(403, {
                    "error": "archived",
                    "message": f"{record_id} is archived — read-only on the board; use the CLI instead",
                })
                return

            # Step 4a
            if "seen" not in payload:
                self._send_json(400, {
                    "error": "bad_request",
                    "message": "seen is required (send the loaded token, or explicit null to override)",
                })
                return

            # Step 4b/5/6 -- same write_lock critical section _mutate_issue
            # uses (write_lock serializes across BOTH endpoints; it's one
            # lock for the whole write surface, not per-endpoint).
            with write_lock:
                seen = payload["seen"]
                current_seen = get_seen(record_path)
                if seen is not None and str(seen) != current_seen:
                    current = build_record_payload(data_dir, record_id)
                    self._send_json(409, {
                        "error": "stale",
                        "message": f"{record_id} changed on disk since you loaded it",
                        "current": current,
                    })
                    return

                patch = payload.get("patch")
                if patch:
                    error = _validate_record_patch(schema, patch)
                    if error is not None:
                        self._send_json(400, error)
                        return
                    apply_patch(record_path, patch)
                comment = payload.get("comment")
                if comment:
                    append_comment(record_path, comment.get("author", "board"), comment.get("body", ""))

                self._send_json(200, build_record_payload(data_dir, record_id))

    # PT-1: ThreadingMixIn -- one thread per connection, so a long-held
    # SSE stream can't block the accept loop for every other client
    # (see write_lock above for the write-safety half of this change).
    # daemon_threads=True so a request thread (notably an open SSE
    # connection) never blocks process/test-suite shutdown.
    class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
        allow_reuse_address = True
        daemon_threads = True

        def server_close(self) -> None:
            # PT-1 lifecycle ruling: server close => watcher stopped.
            watcher.stop()
            super().server_close()

    server = Server((host, port), Handler)
    watcher.start()  # PT-1 lifecycle ruling: server object exists => watcher running
    return server


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

# POLY-3 (design note §1): `estimate.*`/`actual.*` are non-negative ints
# on disk (the YAML subset has no float type). `cairn set POLY-9
# estimate.tokens=400000` must therefore write an int, not the bare
# string `_coerce_cli_value` would otherwise pass through unchanged.
ESTIMATION_INT_FIELDS = (
    "estimate.tokens", "estimate.gate_cycles",
    "actual.tokens", "actual.gate_cycles", "actual.wall_clock",
)

# POLY-34 (ruling §0.3): `estimate.cost_usd` is a decimal STRING on disk
# (the YAML subset is int-only) -- `cairn set POLY-9 estimate.cost_usd=3`
# writes "3.00", not the int 3 `_coerce_cli_value` would otherwise pass
# through. `actual.cost_usd` is close-written only, never through this path.
ESTIMATION_DECIMAL_FIELDS = ("estimate.cost_usd",)


def _coerce_cli_value(key: str, value: str) -> Any:
    if key in LIST_FIELDS:
        return _split_csv(value)
    if key in NULLABLE_FIELDS and value == "":
        return None
    if key in ESTIMATION_DECIMAL_FIELDS:
        if value == "":
            return None
        try:
            parsed = float(value)
        except ValueError:
            raise CairnError(f"{key} must be a positive number, got {value!r}")
        if not (parsed > 0):
            raise CairnError(f"{key} must be a positive number, got {value!r}")
        return f"{parsed:.2f}"
    if key in ESTIMATION_INT_FIELDS:
        if value == "":
            return None
        try:
            return int(value)
        except ValueError:
            raise CairnError(f"{key} must be an integer, got {value!r}")
    if value.lower() == "null":
        return None
    return value


def _normalize_milestone_input(value: Optional[str], prefix: str) -> Optional[str]:
    """PT-28 (architect's ruling § 3, item 2). Accepts the BARE form on any
    CLI input that carries a milestone value -- `cairn ls --milestone 0.6`,
    `cairn new --milestone 0.6`, `cairn set <id> milestone=0.6` -- and
    normalizes to the configured prefix, since the prefix is fixed per repo
    and typing it on every local invocation is pure friction where it adds
    nothing. An already-prefixed value passes through unchanged (idempotent
    -- typing the full form still works). Falsy (`None`/`""`) passes through
    unchanged too -- "no milestone" / "clear this field" is not "a bare
    value", and must keep coercing to `null`, not `"PT-"`.
    This is CLI input leniency only, distinct from the lint (files must
    still be prefixed) -- see check_repo's id-shape enforcement.

    PT-28 Validate-phase finding (QA, adf1cce): originally wired into
    cmd_ls's read-path filter ONLY. cmd_new/cmd_set's write paths wrote
    the bare value straight to disk, succeeding (exit 0) while leaving
    the repo lint-failing with a dangling milestone: ref -- worse than no
    leniency at all, since the failure surfaced later at `cairn check`
    time, disconnected from the command that caused it. All three call
    sites route through this one function now, so they can't drift out
    of agreement the way the pre-fix two-out-of-three state did.
    """
    if not value or value.startswith(f"{prefix}-"):
        return value
    return f"{prefix}-{value}"


# POLY-56 (gate-1 ruling R3): the body `cairn new` seeds when `--body` is
# absent -- an empty Acceptance-criteria item, so the file is already
# shaped for the authoring convention (TRACKER.md) without forcing a title
# any longer than the label it's meant to be.
DEFAULT_ISSUE_BODY = "\n## Acceptance criteria\n\n- [ ] \n"


def cmd_new(args: argparse.Namespace) -> int:
    data_dir = resolve_data_dir(args)
    prefix = load_config(data_dir)["prefix"]
    # POLY-56 (gate-1 ruling R3): warns, never refuses -- the issue is
    # still created, exit 0. `>`, not `>=`: exactly TITLE_CHAR_CAP chars
    # is the cap, not yet over it.
    if len(args.title) > TITLE_CHAR_CAP:
        print(
            f"warning: title is {len(args.title)} chars (cap {TITLE_CHAR_CAP}) -- "
            "short label in the title, substance in the body",
            file=sys.stderr,
        )
    fields = {
        "title": args.title,
        "status": args.status,
        "milestone": _normalize_milestone_input(args.milestone, prefix),
        "parent": args.parent,
        "blocked_by": _split_csv(args.blocked_by) if args.blocked_by else [],
        "assignee": args.assignee,
        "labels": _split_csv(args.labels) if args.labels else [],
        "priority": args.priority,
        "pr": None,
    }
    # POLY-2 (architect's gate-1 ruling § 4): an absent `--paths` must
    # leave the key OUT of fields entirely -- "undeclared" is not the same
    # state as an explicit `paths: []` ("may touch nothing"), so this
    # can't reuse the `else []` shape labels/blocked_by use just above.
    if args.paths:
        fields["paths"] = _split_csv(args.paths)
    # POLY-56 (gate-1 ruling R3): `-` reads stdin, the same convention
    # `cairn comment --body -` already uses; an absent `--body` seeds the
    # default skeleton rather than leaving the file bodyless.
    if args.body == "-":
        body = sys.stdin.read()
    elif args.body is not None:
        body = args.body
    else:
        body = DEFAULT_ISSUE_BODY
    path = allocate_and_create_issue(data_dir, fields, body=body)
    frontmatter, _ = parse_frontmatter(path.read_text(encoding="utf-8"))
    print(frontmatter["id"])
    return 0


def cmd_ls(args: argparse.Namespace) -> int:
    data_dir = resolve_data_dir(args)
    milestone_filter = _normalize_milestone_input(args.milestone, load_config(data_dir)["prefix"])
    matched: List[Dict[str, Any]] = []
    for p in _dir_glob(Path(data_dir) / "issues"):
        try:
            fm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        except CairnError as e:
            print(f"warning: skipping {p}: {e}", file=sys.stderr)
            continue
        if args.status and fm.get("status") != args.status:
            continue
        if milestone_filter and str(fm.get("milestone")) != milestone_filter:
            continue
        if args.assignee and fm.get("assignee") != args.assignee:
            continue
        matched.append(fm)
    # PT-21: _dir_glob's filename order is lexicographic ("PT-10" sorts
    # before "PT-2") -- print in numeric-by-id order instead, reusing the
    # same _id_sort_key PT-2's build_snapshot_markdown already introduced
    # rather than a second copy of the same sort key.
    matched.sort(key=lambda fm: _id_sort_key(fm.get("id")))
    for fm in matched:
        milestone = fm.get("milestone") if fm.get("milestone") is not None else "-"
        assignee = fm.get("assignee") if fm.get("assignee") is not None else "-"
        print(f"{fm.get('id')}\t{fm.get('status')}\t{milestone}\t{assignee}\t{fm.get('title')}")
    return 0


def cmd_set(args: argparse.Namespace) -> int:
    data_dir = resolve_data_dir(args)
    path = find_record_path(data_dir, args.id)
    if path is None:
        print(f"error: no such record: {args.id}", file=sys.stderr)
        return 1
    schema = _record_schema_for_path(data_dir, path)
    field_order = _RECORD_FIELD_ORDER[schema]
    valid_statuses = STATUSES if schema == "issue" else RECORD_STATUSES
    prefix = load_config(data_dir)["prefix"]
    patch: Dict[str, Any] = {}
    for kv in args.assignments:
        if "=" not in kv:
            print(f"error: expected key=value, got {kv!r}", file=sys.stderr)
            return 1
        key, _, value = kv.partition("=")
        if key not in field_order:
            print(f"error: unknown field {key!r} for {schema} {args.id}", file=sys.stderr)
            return 1
        try:
            coerced = _coerce_cli_value(key, value)
        except CairnError as e:
            print(f"error: {e}", file=sys.stderr)
            return 1
        # PT-28 (Validate-phase fix): `milestone=0.6` must normalize the
        # same way `cairn ls --milestone 0.6` does -- _coerce_cli_value
        # already turned "" / "null" into None (clear the field), which
        # _normalize_milestone_input passes through unchanged (falsy is
        # not "a bare value"). Only reachable for the issue schema --
        # "milestone" isn't a MILESTONE_FIELD_ORDER/MAJOR_FIELD_ORDER key,
        # so the field_order check above already excludes it there.
        if key == "milestone" and coerced is not None:
            coerced = _normalize_milestone_input(coerced, prefix)
        # PT-39 (architect's ruling § 6): status= is now validated inline
        # against the resolved schema's vocabulary -- cmd_set previously
        # did zero status-value validation, relying entirely on a later
        # `cairn check` to catch a bad value. Checked before `patch` is
        # written to (not just before apply_patch is called) so a
        # multi-assignment invocation with an early valid key and a later
        # invalid status writes NOTHING, same all-or-nothing contract as
        # the unknown-field check above.
        if key == "status" and coerced not in valid_statuses:
            print(
                f"error: invalid status {coerced!r} for {schema} {args.id} -- "
                f"expected one of {sorted(valid_statuses)}",
                file=sys.stderr,
            )
            return 1
        patch[key] = coerced
    try:
        apply_patch(path, patch)
    except CairnError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    print(args.id)
    return 0


def cmd_comment(args: argparse.Namespace) -> int:
    # PT-51 §4: find_issue_path -> find_record_path -- records may now
    # carry a '## Comments' section too (identical format/parser/author
    # vocabulary as issues, no second convention), so `cairn comment`
    # works uniformly on issues, milestones, majors, and archived records
    # -- matching what `cairn set` (PT-39) already does. append_comment
    # itself already gates its `updated` bump on _is_issue_shaped, so a
    # record comment injects no off-schema key.
    data_dir = resolve_data_dir(args)
    path = find_record_path(data_dir, args.id)
    if path is None:
        print(f"error: no such record: {args.id}", file=sys.stderr)
        return 1
    body = sys.stdin.read() if args.body == "-" else args.body
    # PT-94 E15: someone else's comment is uncommitted in this file -- an
    # append now would ride in their pathspec commit (or theirs in yours).
    foreign = uncommitted_comment_authors(path) - {args.author}
    if foreign and not getattr(args, "allow_foreign", False):
        print(f"error: {path.name} has an uncommitted comment by {', '.join('@' + a for a in sorted(foreign))} -- "
              f"wait for it to be committed (or pass --allow-foreign if you are sweeping it in on purpose)", file=sys.stderr)
        return 1
    append_comment(path, args.author, body)
    return 0


def _line_byte_offsets(s: str) -> List[int]:
    """The utf-8 byte offset, within `s`, of the start of each line of
    `s.split("\\n")` -- POLY-56 (gate-1 ruling R2) `cmd_check_item`'s one
    building block for turning a `checklist_items` `line` index into an
    exact byte position, without re-deriving this arithmetic inline."""
    offsets = []
    pos = 0
    for line in s.split("\n"):
        offsets.append(pos)
        pos += len(line.encode("utf-8")) + 1  # +1 for the '\n' this split ate
    return offsets


def _format_checklist_item_line(issue_id: str, item: Dict[str, Any]) -> str:
    """`<ID> #<k> [x] <text>` -- POLY-56 (gate-1 ruling R2): what
    `cmd_check_item` prints so the caller can see which line it hit (or
    would have hit, on the already-in-state no-write path)."""
    mark = "x" if item["checked"] else " "
    return f"{issue_id} #{item['ordinal']} [{mark}] {item['text']}"


def cmd_check_item(args: argparse.Namespace) -> int:
    """`cairn check-item <ID> <ordinal> [--uncheck] [--text <exact>]`
    (POLY-56 gate-1 ruling R2): flips exactly one byte -- the state
    character inside `- [ ]`/`- [x]` -- for the ordinal-th checklist item
    under `<ID>`'s `## Acceptance criteria` heading. `updated` is not
    bumped and the frontmatter is not re-emitted; this is a body-only,
    single-byte rewrite, deliberately NOT routed through `apply_patch`.

    Line identity is text+ordinal over a FRESH read every invocation, never
    an index cached across processes -- `--text <exact>` is the optional
    anchor for a scripted caller that wants to refuse rather than tick the
    wrong row if the file moved under it.
    """
    data_dir = resolve_data_dir(args)
    path = find_issue_path(data_dir, args.id)
    if path is None:
        print(f"error: no such record: {args.id}", file=sys.stderr)
        return 1
    if is_archived_path(data_dir, path):
        print(f"error: {args.id} is archived -- read-only", file=sys.stderr)
        return 1
    try:
        st_before = path.stat()
    except FileNotFoundError:
        print(f"error: no such record: {args.id}", file=sys.stderr)
        return 1
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        print(f"error: {path}: {e}", file=sys.stderr)
        return 1
    try:
        _frontmatter, body = parse_frontmatter(text)
    except CairnError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    description, _comments = split_comments(body)
    items = checklist_items(description)
    if not items:
        print(f"error: {args.id} has no Acceptance criteria section", file=sys.stderr)
        return 1
    if not (1 <= args.ordinal <= len(items)):
        print(f"error: {args.id} has {len(items)} checklist item(s); ordinal {args.ordinal} is out of range", file=sys.stderr)
        return 1
    item = items[args.ordinal - 1]
    if args.text is not None and item["text"] != args.text:
        print(
            f"error: {args.id} #{item['ordinal']}: text {item['text']!r} does not match --text {args.text!r}",
            file=sys.stderr,
        )
        return 1

    want_checked = not args.uncheck
    if item["checked"] == want_checked:
        # Already in the requested state: no write, so the file's mtime
        # (and every other byte) is untouched -- idempotent by construction,
        # not by comparing-then-skipping a would-be-identical write.
        print(_format_checklist_item_line(args.id, item))
        return 0

    # `body` is exactly the tail of `text` (parse_frontmatter's contract),
    # so its start offset in `text` -- and, since encode/decode round-trips
    # for valid utf-8, in `raw` too -- is `len(text) - len(body)`, no
    # separate re-scan for the closing fence needed.
    body_start_byte = len(text[:len(text) - len(body)].encode("utf-8"))
    line_offset = _line_byte_offsets(body)[item["line"]]
    target_offset = body_start_byte + line_offset + len("- [")
    current = raw[target_offset:target_offset + 1]
    if current not in (b" ", b"x", b"X"):
        print(f"error: {args.id}: could not locate item #{item['ordinal']}'s checkbox byte", file=sys.stderr)
        return 1

    st_now = path.stat()
    if st_now.st_mtime_ns != st_before.st_mtime_ns:
        print(f"error: {args.id} changed on disk since it was read -- refusing to write (re-run to retry)", file=sys.stderr)
        return 1

    new_char = b"x" if want_checked else b" "
    new_raw = raw[:target_offset] + new_char + raw[target_offset + 1:]
    _atomic_write_bytes(path, new_raw)
    item["checked"] = want_checked
    print(_format_checklist_item_line(args.id, item))
    return 0


def _scan_issues(data_dir: Path, exclude: Path, predicate) -> List[Dict[str, Any]]:
    """Frontmatter of every issue in issues/ (except `exclude`) satisfying
    `predicate` -- the one scan behind cmd_show's Children and Blocks
    sections. Per-file parse errors are skipped, not raised (mirrors
    check_repo). One function, not two copies differing only in the
    predicate -- the Python-side twin of board.js's issueLinkListEl.
    """
    out = []
    for p in _dir_glob(Path(data_dir) / "issues"):
        if p == exclude:
            continue
        try:
            fm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        except CairnError:
            continue
        if predicate(fm):
            out.append(fm)
    return out


def _print_issue_list(heading: str, records: List[Dict[str, Any]]) -> None:
    """Print a `_id_sort_key`-ordered id/status/title block under `heading`,
    or nothing at all when `records` is empty -- an issue with no
    dependencies must print no section header for them."""
    if not records:
        return
    print(f"\n{heading}:")
    for fm in sorted(records, key=lambda fm: _id_sort_key(fm.get("id"))):
        print(f"  {fm.get('id')}\t{fm.get('status')}\t{fm.get('title')}")


def cmd_show(args: argparse.Namespace) -> int:
    data_dir = resolve_data_dir(args)
    path = find_issue_path(data_dir, args.id)
    if path is None:
        print(f"error: no such issue: {args.id}", file=sys.stderr)
        return 1
    issue = parse_issue(path.read_text(encoding="utf-8"))
    print(f"{issue.get('id')} — {issue.get('title')}")
    for key in ISSUE_FIELD_ORDER[2:]:
        # PT-26: blocked_by gets its own "Blocked by:"/"Blocks:" sections
        # below (sorted, both directions, blank when there's nothing to
        # show) rather than a raw `blocked_by: [...]` line here -- an
        # issue with no dependencies at all must print no "block"-shaped
        # text anywhere in the output.
        if key == "blocked_by":
            continue
        print(f"  {key}: {issue.get(key)}")
    print()
    print(issue.get("description", ""))
    comments = issue.get("comments") or []
    if comments:
        print("\nComments:")
        for c in comments:
            print(f"  @{c['author']} — {c['date']}")
            for line in c["body"].split("\n"):
                print(f"    {line}")

    # PT-25: a parent issue also lists its children (id, status, title),
    # sorted numerically by id. The child->parent half of the acceptance
    # criterion needs no code here: `parent:` is already printed above via
    # the ISSUE_FIELD_ORDER[2:] loop (verified against real output,
    # architect's PT-25 ruling #3).
    _print_issue_list(
        "Children", _scan_issues(data_dir, path, lambda fm: fm.get("parent") == args.id)
    )

    # PT-26: this issue's own blockers (its blocked_by field -- direct
    # find_issue_path lookups, no scan) and the reverse "blocks" list (who
    # names THIS issue in their own blocked_by -- a directory scan, same
    # shape as the children scan above). Both sorted by _id_sort_key.
    blocked_by = issue.get("blocked_by") or []
    blockers = []
    for ref in blocked_by:
        ref_path = find_issue_path(data_dir, ref)
        if ref_path is not None:
            blockers.append(parse_issue(ref_path.read_text(encoding="utf-8")))
        else:
            # Dangling ref on an unchecked tree -- cairn check would flag
            # this; cmd_show still renders it rather than crash.
            blockers.append({"id": ref, "status": "?", "title": "(not found)"})
    _print_issue_list("Blocked by", blockers)
    _print_issue_list(
        "Blocks", _scan_issues(data_dir, path, lambda fm: args.id in (fm.get("blocked_by") or []))
    )

    return 0


def _git_mv_or_rename(src: Path, dest: Path) -> None:
    """`git mv src dest`, falling back to a plain filesystem move when
    git isn't applicable (no git binary, or `src`/`dest` aren't inside a
    git worktree at all -- both legitimate, expected outcomes for a
    non-git data dir, never an error).

    PT-53: `src`/`dest` are resolved to ABSOLUTE paths before the
    subprocess call. The subprocess's `cwd=src.parent` is unchanged --
    still needed so a relative `--data-dir` invocation's git command runs
    from somewhere that exists -- but the ARGUMENT strings used to be
    whatever `src`/`dest` were handed as (relative, when `--data-dir` is
    relative -- `resolve_data_dir` never calls `.resolve()`), which
    `git mv` then read relative to the WRONG base once the subprocess's
    cwd had already changed to `src.parent`. `git mv` looked for a
    source file that didn't exist there, failed, and the failure was
    swallowed (only `returncode == 0` was ever checked, stderr never
    surfaced) -- silently downgrading a real invocation to the plain-move
    fallback, which leaves an untracked add + unstaged delete instead of
    a staged rename. Resolving both paths up front makes the argument
    correct regardless of the caller's cwd or the relativity of what it
    was given; `.resolve()` doesn't require either path to already exist.
    """
    import subprocess
    src = Path(src).resolve()
    dest = Path(dest).resolve()
    try:
        result = subprocess.run(
            ["git", "mv", str(src), str(dest)],
            cwd=str(src.parent), capture_output=True, text=True,
        )
        if result.returncode == 0:
            return
        # PT-53: surfaced, not swallowed -- this fallback stays
        # LEGITIMATE for a non-git data dir ("fatal: not a git
        # repository" is exactly what a plain move should silently
        # absorb), but a genuine failure for a data dir that IS a git
        # repo (a dirty index mid-merge, permissions, ...) was previously
        # indistinguishable from that case. One warning line, never
        # raised -- the operation still completes via the fallback below.
        if result.stderr:
            print(f"cairn: warning: git mv fell back to a plain move ({result.stderr.strip()})", file=sys.stderr)
    except FileNotFoundError:
        pass
    os.replace(str(src), str(dest))


# --------------------------------------------------------------------------
# PT-39 (architect's ruling § 5): milestone/major archiving. "Archive never
# sweeps issues out from under a live milestone" is the load-bearing
# invariant -- a milestone/major can only be archived when IT and every
# issue/milestone under it is already done/cancelled. This is what lets
# the board compute an honest n/m progress count from issues/ alone, with
# zero archive reads (PT-40/43/44 ruling § 3).
# --------------------------------------------------------------------------

def _issues_for_milestone(data_dir: Path, milestone_id: str) -> List[Tuple[Path, Dict[str, Any]]]:
    """Every LIVE issue (issues/ only) whose `milestone:` resolves to
    `milestone_id`. Never reads archive/ -- an already-archived issue, by
    construction, already passed this exact precondition at the moment it
    was archived; re-checking it here would be redundant at best and,
    for --milestone/--major's refuse-on-failure semantics, could wrongly
    block a valid archive on an issue this operation was never going to
    touch again.
    """
    data_dir = Path(data_dir)
    out: List[Tuple[Path, Dict[str, Any]]] = []
    for p in _dir_glob(data_dir / "issues"):
        try:
            fm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        except CairnError:
            continue
        if str(fm.get("milestone")) == milestone_id:
            out.append((p, fm))
    return out


def _milestone_precondition(data_dir: Path, milestone_fm: Dict[str, Any]) -> None:
    """Raises CairnError (nothing written -- callers check this BEFORE
    moving any file) unless `milestone_fm`'s own status AND every live
    issue under it are done/cancelled. Silent (no return value) when
    clear -- callers call this for its raise-or-not effect only.
    """
    milestone_id = milestone_fm.get("id")
    status = milestone_fm.get("status")
    if status not in ("done", "cancelled"):
        raise CairnError(
            f"milestone {milestone_id} is not done/cancelled (status: {status!r}) -- refusing to archive"
        )
    for _, ifm in _issues_for_milestone(data_dir, milestone_id):
        if ifm.get("status") not in ("done", "cancelled"):
            raise CairnError(
                f"milestone {milestone_id} has an issue that is not done/cancelled "
                f"({ifm.get('id')}: status {ifm.get('status')!r}) -- refusing to archive"
            )


def archive_milestone(data_dir: Path, milestone_id: str, dry_run: bool = False) -> Dict[str, Any]:
    """Archive `milestone_id`: moves its done/cancelled issues (no date
    filter) then the milestone file itself into archive/ / archive/
    milestones/ respectively. Raises CairnError (nothing written) if the
    milestone is unknown or fails `_milestone_precondition`. Returns
    `{"milestone": id, "issues": [ids moved]}` -- the report is still
    returned in `dry_run` mode, just without touching disk.
    """
    data_dir = Path(data_dir)
    ms_path = data_dir / "milestones" / f"{milestone_id}.md"
    if not ms_path.exists():
        raise CairnError(f"unknown milestone {milestone_id!r} -- nothing archived")
    fm, _body = parse_frontmatter(ms_path.read_text(encoding="utf-8"))
    _milestone_precondition(data_dir, fm)
    issues = _issues_for_milestone(data_dir, milestone_id)
    report: Dict[str, Any] = {"milestone": milestone_id, "issues": [ifm.get("id") for _, ifm in issues]}
    if not dry_run:
        # PT-50 (§2 write target #10): issues land in archive/issues/, NOT
        # bare archive/ -- writes only ever produce the new layout.
        archive_issues_dir = data_dir / "archive" / "issues"
        archive_ms_dir = data_dir / "archive" / "milestones"
        archive_issues_dir.mkdir(parents=True, exist_ok=True)
        archive_ms_dir.mkdir(parents=True, exist_ok=True)
        for p, _ in issues:
            _git_mv_or_rename(p, archive_issues_dir / p.name)
        _git_mv_or_rename(ms_path, archive_ms_dir / ms_path.name)
    return report


def archive_major(data_dir: Path, major_id: str, dry_run: bool = False) -> Dict[str, Any]:
    """Archive `major_id`: archives each of its milestones (per
    archive_milestone above) then the major file itself into archive/
    majors/. Two-phase, all-or-nothing: validates the major's OWN status
    AND every one of its milestones' `_milestone_precondition` BEFORE
    moving anything -- a partially-archived major (some milestones moved,
    one refused) must never be a reachable state. Raises CairnError
    (nothing written) if the major is unknown or any precondition fails.
    Returns `{"major": id, "milestones": [archive_milestone's report, ...]}`.
    """
    data_dir = Path(data_dir)
    major_path = data_dir / "majors" / f"{major_id}.md"
    if not major_path.exists():
        raise CairnError(f"unknown major {major_id!r} -- nothing archived")
    mfm, _mbody = parse_frontmatter(major_path.read_text(encoding="utf-8"))
    if mfm.get("status") not in ("done", "cancelled"):
        raise CairnError(
            f"major {major_id} is not done/cancelled (status: {mfm.get('status')!r}) -- refusing to archive"
        )
    milestones: List[Dict[str, Any]] = []
    for p in _dir_glob(data_dir / "milestones"):
        try:
            fm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        except CairnError:
            continue
        if str(fm.get("major")) == major_id:
            milestones.append(fm)
    # Phase 1: validate every milestone's own precondition first -- nothing
    # written yet. A failure here must leave the tree byte-identical to
    # how it started, even if an earlier milestone in this same major
    # would otherwise have archived cleanly on its own.
    for fm in milestones:
        _milestone_precondition(data_dir, fm)
    # Phase 2: every precondition passed -- now it's safe to move files.
    report: Dict[str, Any] = {"major": major_id, "milestones": []}
    for fm in milestones:
        report["milestones"].append(archive_milestone(data_dir, fm.get("id"), dry_run=dry_run))
    if not dry_run:
        archive_major_dir = data_dir / "archive" / "majors"
        archive_major_dir.mkdir(parents=True, exist_ok=True)
        _git_mv_or_rename(major_path, archive_major_dir / major_path.name)
    return report


_DONE_BEFORE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _validate_done_before(value: str) -> str:
    """Validate `value` as a real YYYY-MM-DD calendar date; returns it unchanged.

    PT-8: `cmd_archive` string-compares this against each issue's `updated`
    with no validation at all — malformed input either silently skips
    issues it should archive, or (worse) archives issues it shouldn't,
    depending on how the garbage string happens to sort lexicographically.
    Called before any file is touched. `date.fromisoformat` alone is too
    lenient (accepts "20260201", ISO week dates, etc.) — the regex pins
    the exact YYYY-MM-DD shape the CLI documents; fromisoformat then
    proves it's a real calendar date, not just the right shape.
    """
    if not _DONE_BEFORE_RE.match(value):
        raise CairnError(f"--done-before must be a YYYY-MM-DD date, got {value!r}")
    try:
        datetime.date.fromisoformat(value)
    except ValueError as e:
        raise CairnError(f"--done-before is not a real calendar date: {value!r} ({e})")
    return value


def _print_archive_milestone_report(report: Dict[str, Any], dry_run: bool) -> None:
    """Shared print body for a single archive_milestone report -- used both
    directly (--milestone) and once per entry from archive_major's report
    (--major), so the two selectors render identically for the same unit
    of work (PT-39 standing dedupe convention).
    """
    verb = "would archive" if dry_run else "archived"
    print(f"{verb} milestone {report['milestone']}")
    for issue_id in sorted(report["issues"]):
        print(f"  {verb} issue {issue_id}")


def cmd_archive(args: argparse.Namespace) -> int:
    data_dir = resolve_data_dir(args)

    # PT-39 (architect's ruling § 5): --milestone/--major are new,
    # mutually-exclusive-with-each-other-and-with---done-before selectors
    # (enforced by argparse's mutually exclusive group at parse time --
    # by the time we're here, exactly one of the three is set).
    if args.milestone is not None:
        report = archive_milestone(data_dir, args.milestone, dry_run=args.dry_run)
        _print_archive_milestone_report(report, args.dry_run)
        return 0
    if args.major is not None:
        report = archive_major(data_dir, args.major, dry_run=args.dry_run)
        verb = "would archive" if args.dry_run else "archived"
        print(f"{verb} major {report['major']}")
        for ms_report in report["milestones"]:
            _print_archive_milestone_report(ms_report, args.dry_run)
        return 0

    # Existing --done-before path.
    _validate_done_before(args.done_before)
    # PT-50 (§2 write target #9): issues land in archive/issues/, NOT bare
    # archive/ -- writes only ever produce the new layout.
    archive_dir = Path(data_dir) / "archive" / "issues"
    if not args.dry_run:
        archive_dir.mkdir(parents=True, exist_ok=True)

    # PT-39 (ruling § 5 table, NEW column): an issue whose milestone isn't
    # done/cancelled is SKIPPED, not archived -- "archive never sweeps
    # issues out from under a live milestone" applies here too, not just
    # to the new selectors. Milestone statuses looked up once into a dict
    # rather than re-parsed per issue.
    #
    # Architect's review finding (PT-39 Slice C, post-§3-items-2/3): reads
    # BOTH milestones/ and archive/milestones/ -- once a milestone can
    # live in archive/milestones/ (§4), an issue whose milestone was
    # already archived would otherwise miss this dict entirely and print
    # the FALSE "milestone X is not done/cancelled" skip reason for a
    # milestone that's actually done (that's WHY it was archived).
    milestone_status: Dict[str, Any] = {}
    for sub in ("milestones", "archive/milestones"):
        for p in _dir_glob(Path(data_dir) / sub):
            try:
                mfm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
            except CairnError:
                continue
            milestone_status[str(mfm.get("id"))] = mfm.get("status")

    verb = "would archive" if args.dry_run else "archived"
    moved = 0
    skipped = 0
    for p in _dir_glob(Path(data_dir) / "issues"):
        try:
            fm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        except CairnError:
            continue
        if fm.get("status") not in ("done", "cancelled"):
            continue
        updated = fm.get("updated")
        if not updated or str(updated) >= args.done_before:
            continue
        milestone = fm.get("milestone")
        if milestone is not None and milestone_status.get(str(milestone)) not in ("done", "cancelled"):
            print(f"skipped {fm.get('id', p.stem)}: milestone {milestone} is not done/cancelled")
            skipped += 1
            continue
        if not args.dry_run:
            _git_mv_or_rename(p, archive_dir / p.name)
        moved += 1
        print(f"{verb} {fm.get('id', p.stem)}")
    summary = f"{moved} issue(s) {verb}"
    if skipped:
        summary += f", {skipped} skipped (non-done/cancelled milestone)"
    print(summary)
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    data_dir = resolve_data_dir(args)
    errors = check_repo(data_dir)
    # PT-94 B6 / D13 / D14: budgets warn, never fail -- the exit code is
    # the lint's, and the warning is what the lead acts on at the next gate.
    for w in check_budgets(data_dir):
        print(f"warning: {w}", file=sys.stderr)
    if errors:
        for e in errors:
            print(e, file=sys.stderr)
        print(f"\n{len(errors)} error(s)", file=sys.stderr)
        return 1
    print("ok")
    return 0


def cmd_snapshot(args: argparse.Namespace) -> int:
    data_dir = resolve_data_dir(args)
    sys.stdout.write(build_snapshot_markdown(data_dir))
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    data_dir = resolve_data_dir(args)
    config = load_config(data_dir)
    port = args.port if args.port is not None else None

    # PT-3: --repos REPLACES config.yml's roots: list (team-lead ruling B)
    # -- primary root is always included regardless, by resolve_roots
    # itself. Comma-split, same convention as `cairn new --labels`.
    cli_repos = None
    if args.repos is not None:
        cli_repos = [r.strip() for r in args.repos.split(",") if r.strip()]

    roots, warnings = resolve_roots(data_dir, config, cli_repos)
    for w in warnings:
        detail = f" ({w['detail']})" if w.get("detail") else ""
        print(f"cairn: warning: skipping root {w['root']!r} — {w['reason']}{detail}", file=sys.stderr)

    # seceng D: multi-root widens cairn serve's read surface to whatever
    # roots: (or --repos) names -- a human tripwire so a fat-fingered or
    # stale entry that silently serves the wrong project's tracker becomes
    # visible instead of silent, printed as a RESOLVED ABSOLUTE path. This
    # is the CLI operator's own terminal, not a network-exposed surface --
    # unlike the /api/board payload's `roots[]` array, which deliberately
    # withholds every root's filesystem path (design note §3.1: keeps a
    # localhost HTTP surface from leaking the user's directory layout).
    # That withholding is scoped to `roots[]` specifically, not the whole
    # payload -- GET /api/issue/<id>'s `path` field (PT-10, unchanged by
    # PT-3) already carries a real on-disk path for any root, primary or
    # secondary; seceng's nit (2026-08-21) was this comment overclaiming
    # "the payload" withholds path info in general, which it doesn't.
    if len(roots) > 1:
        print("Serving across multiple roots:", file=sys.stderr)
        for root in roots:
            marker = " (primary)" if root.primary else ""
            print(f"  {root.id}: {root.path.resolve()}{marker}", file=sys.stderr)

    server = make_server(data_dir, config, port, roots=roots)
    bound_port = server.server_address[1]
    print(f"Serving cairn board at http://127.0.0.1:{bound_port}/")
    print(f"  Kanban:    http://127.0.0.1:{bound_port}/")
    print(f"  List:      http://127.0.0.1:{bound_port}/list")
    print(f"  Dashboard: http://127.0.0.1:{bound_port}/dashboard")
    print("\nCtrl+C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    # default=SUPPRESS (PT-9): when --data-dir isn't given after the
    # subcommand, this parser must not set the dest at all, so the
    # subparsers dispatch (which parses into a *new* namespace and copies
    # every key back onto the parent, per argparse's _SubParsersAction)
    # doesn't stomp a value the top-level --data-dir already set. See
    # build_arg_parser's top-level --data-dir for the precedence contract.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--data-dir", dest="data_dir", default=argparse.SUPPRESS)

    parser = argparse.ArgumentParser(prog="cairn", description="cairn — the file-based issue tracker")
    parser.add_argument(
        "--data-dir", dest="data_dir", default=None,
        help="path to the cairn data dir (default: walk up from cwd for process/cairn/). "
             "May be given here (before the subcommand) or after it — if given in both "
             "places, the value after the subcommand takes precedence.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_new = sub.add_parser("new", parents=[common], help="create a new issue")
    p_new.add_argument("title")
    p_new.add_argument("--milestone", default=None)
    p_new.add_argument("--assignee", default=None)
    p_new.add_argument("--status", default=DEFAULT_STATUS, choices=sorted(STATUSES))
    p_new.add_argument("--parent", default=None)
    p_new.add_argument("--priority", default=None)
    p_new.add_argument("--labels", default=None, help="comma-separated")
    p_new.add_argument("--blocked-by", default=None, help="comma-separated issue ids")
    p_new.add_argument("--paths", default=None, help="comma-separated repo-relative glob patterns (POLY-2); omitted -> undeclared, not []")
    p_new.add_argument("--body", default=None, help="issue body text, or '-' to read from stdin (POLY-56); omitted -> the default Acceptance-criteria skeleton")
    p_new.set_defaults(func=cmd_new)

    p_ls = sub.add_parser("ls", parents=[common], help="list issues")
    p_ls.add_argument("--status", default=None)
    p_ls.add_argument("--milestone", default=None)
    p_ls.add_argument("--assignee", default=None)
    p_ls.set_defaults(func=cmd_ls)

    p_set = sub.add_parser("set", parents=[common], help="set frontmatter fields on an issue")
    p_set.add_argument("id")
    p_set.add_argument("assignments", nargs="+", help="key=value pairs")
    p_set.set_defaults(func=cmd_set)

    p_comment = sub.add_parser("comment", parents=[common], help="append a comment to an issue")
    p_comment.add_argument("id")
    p_comment.add_argument("--author", required=True)
    p_comment.add_argument("--body", required=True, help="comment text, or '-' to read from stdin")
    p_comment.add_argument("--allow-foreign", dest="allow_foreign", action="store_true", help="append even though another author's comment is uncommitted in the file (PT-94 E15)")
    p_comment.set_defaults(func=cmd_comment)

    p_check_item = sub.add_parser("check-item", parents=[common], help="tick/untick one checklist item (POLY-56)")
    p_check_item.add_argument("id")
    p_check_item.add_argument("ordinal", type=int)
    p_check_item.add_argument("--uncheck", action="store_true", help="untick instead of tick")
    p_check_item.add_argument("--text", default=None, help="refuse (exit 1, no write) unless the item's text matches exactly")
    p_check_item.set_defaults(func=cmd_check_item)

    p_show = sub.add_parser("show", parents=[common], help="print a single issue")
    p_show.add_argument("id")
    p_show.set_defaults(func=cmd_show)

    p_archive = sub.add_parser(
        "archive", parents=[common],
        help="move done/cancelled issues (or a done/cancelled milestone/major) to archive/",
    )
    # PT-39 (architect's ruling § 5): exactly one selector, required,
    # mutually exclusive -- --milestone/--major are new, --done-before is
    # the pre-existing (previously standalone-required) flag.
    archive_selector = p_archive.add_mutually_exclusive_group(required=True)
    archive_selector.add_argument("--done-before", default=None, help="YYYY-MM-DD")
    archive_selector.add_argument(
        "--milestone", default=None, help="archive a done/cancelled milestone and its done/cancelled issues",
    )
    archive_selector.add_argument(
        "--major", default=None, help="archive a done/cancelled major and its milestones (each per --milestone)",
    )
    p_archive.add_argument(
        "--dry-run", action="store_true", help="preview without moving anything (all three selectors)",
    )
    p_archive.set_defaults(func=cmd_archive)

    p_check = sub.add_parser("check", parents=[common], help="lint the data dir")
    p_check.set_defaults(func=cmd_check)

    # PT-94: gate head-match (C8), loop scorecard (E16), foreign-hunk guard (E15)
    p_gate = sub.add_parser("gate", parents=[common], help="head-match check: is everything since the verified sha docs/tracker only?")
    p_gate.add_argument("--head", required=True, metavar="VERIFIED_SHA", help="the sha the reviewer/qa measured")
    p_gate.set_defaults(func=cmd_gate)

    p_loop = sub.add_parser("loop-stats", parents=[common], help="per-loop scorecard for an issue's feature branch")
    p_loop.add_argument("id")
    p_loop.add_argument("--base", default="main")
    p_loop.add_argument("--since", help="ISO timestamp; default: the branch's first commit")
    p_loop.add_argument("--until", help="ISO timestamp; default: now")
    p_loop.add_argument("--transcripts-dir", dest="transcripts_dir", help="override ~/.claude/projects/<repo-slug>")
    p_loop.add_argument("--steps", metavar="DIR", help="also write the per-agent step tables here")
    p_loop.add_argument("--json", action="store_true")
    p_loop.set_defaults(func=cmd_loop_stats)

    p_guard = sub.add_parser("guard-commit", parents=[common], help="pre-commit body: refuse a staged tracker file with comments by >1 author")
    p_guard.set_defaults(func=cmd_guard_commit)

    p_guard_push = sub.add_parser("guard-push", parents=[common], help="push-time check (POLY-2): fail if the issue's assignee touched a file outside its declared paths:")
    p_guard_push.add_argument("id")
    p_guard_push.set_defaults(func=cmd_guard_push)

    p_close = sub.add_parser("close", parents=[common], help="close a sub-issue (POLY-3): pull actuals, write ratio/bloat, append a calibration record")
    p_close.add_argument("id")
    p_close.add_argument("--base", default="main")
    p_close.add_argument("--ref", default="HEAD")
    p_close.add_argument("--at", dest="at_sha", default=None, help="ceiling (POLY-16): close_ts becomes <sha>'s author time and ref becomes <sha> -- must be on ref's first-parent history after the parent flip; re-closing a merged feature's sub-issues needs --base <merge-base> --ref <merge-sha>^2, since the default --ref HEAD doesn't reach commits on the merge's second parent")
    p_close.add_argument("--no-flush", dest="no_flush", action="store_true", help="skip signaling the otel receiver to flush before reading actuals")
    p_close.add_argument("--dry-run", action="store_true", help="print the computed actuals without writing either file")
    p_close.set_defaults(func=cmd_close)

    p_estimate = sub.add_parser("estimate", parents=[common], help="print reference-class actuals to seed a new estimate (POLY-3)")
    p_estimate.add_argument("id")
    p_estimate.add_argument("--limit", type=int, default=5)
    p_estimate.add_argument("--json", action="store_true")
    p_estimate.set_defaults(func=cmd_estimate)

    p_snapshot = sub.add_parser(
        "snapshot", parents=[common],
        help="render a point-in-time markdown snapshot of the tracker to stdout",
    )
    p_snapshot.set_defaults(func=cmd_snapshot)

    p_serve = sub.add_parser("serve", parents=[common], help="run the board server")
    p_serve.add_argument("--port", type=int, default=None)
    p_serve.add_argument(
        "--repos", default=None,
        help="comma-separated root paths (relative to the repo root, or absolute) -- "
             "REPLACES config.yml's roots: list entirely; the primary root is always included",
    )
    p_serve.set_defaults(func=cmd_serve)

    return parser


# --------------------------------------------------------------------------
# POLY-3: `cairn close` / `cairn estimate` (design note §7)
# --------------------------------------------------------------------------


def _normalize_iso_z(value: str) -> str:
    """Any ISO-8601 timestamp (git's `+00:00` offset or the receiver's
    `Z`) -> the `%Y-%m-%dT%H:%M:%SZ` form `token-usage.jsonl`'s
    `generated` stamps use, so `token_actuals`'s lexical `since`/`until`
    comparison never mixes two suffix conventions for what is the same
    instant."""
    dt = _parse_iso_any(value).astimezone(datetime.timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _same_stage_sibling_assignees(data_dir: Path, issue_id: str, parent: str, stage: str, assignee: str) -> List[str]:
    """Other sub-issues under the same `parent` and `stage` -- their
    assignees are the "same-stage sibling" authors whose commits don't
    break `assignee`'s own gate-cycle run (design note §2)."""
    siblings: List[str] = []
    for p in _dir_glob(Path(data_dir) / "issues"):
        if p.stem == issue_id:
            continue
        try:
            fm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        except CairnError:
            continue
        if fm.get("parent") == parent and fm.get("stage") == stage:
            sib_assignee = fm.get("assignee")
            if sib_assignee and sib_assignee != assignee:
                siblings.append(sib_assignee)
    return siblings


def _flush_receiver_and_wait(repo_root: Path, usage_path: Path, timeout: float = 5.0) -> None:
    """Design note §2/§7: best-effort -- signals the running otel receiver
    to flush (`otel_receiver.py --flush-now`), then polls
    `token-usage.jsonl` for up to `timeout` seconds for its `generated`
    stamp to advance. Never raises: no running receiver, or a flush that
    doesn't land in time, degrades to reading whatever is already on disk
    -- the same never-block posture `token_actuals` already takes for a
    missing file entirely."""
    def _latest_generated() -> Optional[str]:
        if not usage_path.is_file():
            return None
        lines, _ = _read_token_usage_lines(usage_path)
        gens = [l.get("generated") for l in lines if l.get("generated")]
        return max(gens) if gens else None

    before = _latest_generated()
    receiver_script = Path(__file__).resolve().parent / "otel_receiver.py"
    try:
        subprocess.run(
            [sys.executable, str(receiver_script), "--flush-now", "--repo-root", str(repo_root)],
            cwd=repo_root, capture_output=True, text=True, timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError):
        return
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _latest_generated() != before:
            return
        time.sleep(0.2)


def _token_ceiling(
    usage_path: Path, at_sha: str, at_ts: str, max_gap_seconds: int,
) -> Tuple[str, Optional[str]]:
    """POLY-48 item 4 (POLY-47, gate-1 ruling process/reviews/POLY-48/ruling.md
    §1(b)): the TOKEN-side ceiling for a `--at <sha>` close. `at_ts`
    (the commit's own author time) almost never lines up with a flush
    boundary -- the flush actually carrying this stage's last tokens can
    land seconds to minutes after the commit, and the plain commit-time
    ceiling drops that whole interval's usage (POLY-41, measured 55 s).

    Returns `(to_ts, warning)`:
    - `to_ts` is the smallest `generated` stamp over lines with
      `source == "otel"` in `token-usage.jsonl` strictly after `at_ts` --
      a flush is a global event, not scoped to one issue/role, but a
      `transcript-backfill` line's `generated` is the backfill RUN time,
      not a flush (architect's review of d1f2e08, addendum 1 -- a
      backfill line landing inside the gap was previously mistaken for
      the flush and hid the real one) -- provided it lands within
      `max_gap_seconds` of `at_ts` (the receiver's own flush interval).
      That flush is never double-counted: the next same-assignee stage's
      floor reads this close's `window.to`, i.e. `to_ts` itself.
    - Otherwise `to_ts` falls back to `at_ts` (unchanged from before this
      fix), and `warning` is the stderr line `cmd_close` should print,
      naming the nearest otel flush actually found after `at_ts` (even
      one excluded for being too far away) or, when none exists at all,
      `at_ts` itself. `warning` is `None` when a flush was admitted.

    No special tip case: when `--at` names the branch's own tip, the
    caller's forced flush (`_flush_receiver_and_wait`) already ran first,
    so IT is the first flush after the commit and shows up here as an
    ordinary candidate.
    """
    at_dt = _parse_iso_any(at_ts)
    nearest_after: Optional[Tuple[datetime.datetime, str]] = None
    if usage_path.is_file():
        rows, _ = _read_token_usage_lines(usage_path)
        for row in rows:
            if row.get("source") != "otel":
                continue
            gen = row.get("generated")
            if not gen:
                continue
            gen_dt = _parse_iso_any(gen)
            if gen_dt > at_dt and (nearest_after is None or gen_dt < nearest_after[0]):
                nearest_after = (gen_dt, gen)
    if nearest_after is not None and (nearest_after[0] - at_dt).total_seconds() <= max_gap_seconds:
        return nearest_after[1], None
    last_flush = nearest_after[1] if nearest_after is not None else at_ts
    warning = (
        f"close: warning: no flush within {max_gap_seconds} s after --at {at_sha}; "
        f"tokens after {last_flush} unattributed"
    )
    return at_ts, warning


def _parent_flip(repo_root: Path, base: str, ref: str) -> Optional[str]:
    """Addendum 1 (design note @ 85c5fd6 §2): the author date of the
    OLDEST commit in `<base>..<ref>` -- `/start-feature`'s own "feature
    started" commit, the same default `loop-stats` uses for `since`.
    `None` when the range is empty (no divergence between `base` and
    `ref` -- e.g. `base` itself resolves to `ref`), which lets `from_ts`
    fall back to the sibling floor alone, or to no floor at all.
    """
    result = subprocess.run(
        ["git", "log", "--first-parent", "--reverse", "--format=%aI", f"{base}..{ref}"],
        cwd=repo_root, capture_output=True, text=True, check=True,
    )
    lines = [l for l in result.stdout.splitlines() if l]
    return lines[0] if lines else None


def _sibling_floor(data_dir: Path, parent: str, assignee: str, self_id: str, stage: Optional[str]) -> Optional[str]:
    """Addendum 1 + POLY-16 ruling (design note §2 -- Stage windows): the
    latest calibration `window.to` (last line per id) among closed
    sub-issues sharing this one's `parent` AND `assignee`, with a
    **different id** and a stage **no later** than `stage`
    (plan < execute < review) -- the floor that keeps a second
    same-(parent, assignee) sub-issue's actuals from re-counting the first
    one's already-closed window. Excluding `self_id` makes a re-close
    re-measure from the same floor instead of flooring at its own prior
    close; excluding later-stage siblings keeps a plan re-close from
    flooring at its own review's close. `None` when there is no such
    sibling yet."""
    cal_path = Path(data_dir) / "metrics" / "calibration.jsonl"
    if not cal_path.is_file():
        return None
    self_rank = _STAGE_ORDER.get(stage) if stage is not None else None
    # Last line per id wins -- a sibling's own re-close must not let its
    # earlier calibration line outvote its latest one.
    rows_by_id: Dict[str, Dict[str, Any]] = {}
    for line in cal_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        row_id = row.get("id")
        if row_id:
            rows_by_id[row_id] = row
    latest_dt: Optional[datetime.datetime] = None
    latest_str: Optional[str] = None
    for row_id, row in rows_by_id.items():
        if row_id == self_id:
            continue
        if row.get("parent") != parent or row.get("assignee") != assignee:
            continue
        sib_rank = _STAGE_ORDER.get(row.get("stage"))
        if self_rank is not None and sib_rank is not None and sib_rank > self_rank:
            continue  # a later-stage sibling never floors an earlier stage
        window_to = (row.get("window") or {}).get("to")
        if not window_to:
            continue
        dt = _parse_iso_any(window_to)
        if latest_dt is None or dt > latest_dt:
            latest_dt = dt
            latest_str = window_to
    return latest_str


def _at_ceiling(repo_root: Path, base: str, ref: str, at_arg: str) -> Optional[Tuple[str, str]]:
    """POLY-16 ruling (design note §2 -- Stage windows): resolves `--at
    <at_arg>` to a `(full_sha, author_ts)` pair, but only when the commit
    sits on `ref`'s first-parent history strictly AFTER the parent flip
    (the oldest commit in `base..ref`, the same commit `_parent_flip`
    would report). Returns `None` when `at_arg` doesn't resolve to a
    commit, isn't on that first-parent range at all, or IS the flip commit
    itself (at, not after) -- the caller turns `None` into an exit-1
    refusal rather than silently accepting an arbitrary commit as the
    ceiling."""
    resolved = subprocess.run(
        ["git", "rev-parse", "--verify", f"{at_arg}^{{commit}}"],
        cwd=repo_root, capture_output=True, text=True,
    )
    if resolved.returncode != 0:
        return None
    at_sha = resolved.stdout.strip()
    range_result = subprocess.run(
        ["git", "log", "--first-parent", "--reverse", "--format=%H%x1f%aI", f"{base}..{ref}"],
        cwd=repo_root, capture_output=True, text=True, check=True,
    )
    rows = [tuple(l.split("\x1f", 1)) for l in range_result.stdout.splitlines() if l]
    if not rows:
        return None
    shas = [sha for sha, _ in rows]
    if at_sha not in shas or at_sha == shas[0]:
        return None
    at_ts = next(date for sha, date in rows if sha == at_sha)
    return at_sha, _normalize_iso_z(at_ts)


def _append_calibration_record(data_dir: Path, record: Dict[str, Any]) -> None:
    import backfill_tokens  # sibling module; imported here so `cairn` stays import-light
    out_path = Path(data_dir) / "metrics" / "calibration.jsonl"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = out_path.parent / ".lock"
    backfill_tokens._acquire_lock(lock_path)
    try:
        existing = out_path.read_text(encoding="utf-8") if out_path.exists() else ""
        if existing and not existing.endswith("\n"):
            existing += "\n"
        backfill_tokens._atomic_write_text(out_path, existing + json.dumps(record) + "\n")
    finally:
        backfill_tokens._release_lock(lock_path)


def _linked_worktree_main_checkout(start: Path) -> Optional[Path]:
    """POLY-48 item 9 (`close` from a worktree, gate-1 ruling
    process/reviews/POLY-48/ruling.md §1(d)): `git rev-parse --git-dir` vs
    `--git-common-dir` is the one reliable test for "is `start` inside a
    LINKED git worktree" -- the two paths are identical in the main
    checkout and differ in a linked worktree, regardless of layout (never
    a `.git`-file-vs-directory guess, which a submodule can also produce).

    Returns the main checkout's root (the common dir's parent) when
    `start` is inside a linked worktree; `None` when it's the main
    checkout, or when git itself is unavailable/not a repo at all --
    `_git_toplevel`'s own check already covers that case with its own
    message.
    """
    def _rev_parse(flag: str) -> Optional[str]:
        try:
            out = subprocess.run(
                ["git", "rev-parse", flag], cwd=start, capture_output=True, text=True, check=True,
            ).stdout.strip()
        except (subprocess.CalledProcessError, OSError):
            return None
        return out or None

    git_dir = _rev_parse("--git-dir")
    common_dir = _rev_parse("--git-common-dir")
    if git_dir is None or common_dir is None:
        return None
    git_dir_path = (start / git_dir).resolve()
    common_dir_path = (start / common_dir).resolve()
    if git_dir_path == common_dir_path:
        return None  # the main checkout: git-dir IS the common dir
    return common_dir_path.parent


def cmd_close(args: argparse.Namespace) -> int:
    """`cairn close <ID>` (design note §7, §2, §3, §5): pulls actuals for
    a sub-issue's assignee from the OTel receiver and the commit log,
    writes `actual.*`/`ratio`/`status: done`/a `bloat` label through one
    `apply_patch`, and appends a calibration record. Never commits either
    file -- the caller commits the issue file by pathspec; the metrics
    branch is committed the usual way (WORKFLOW.md → Metrics branch).

    `--at <sha>` (POLY-16 ruling, design note §2 -- Stage windows) sets the
    ceiling: `close_ts` becomes `<sha>`'s own author time and `ref` becomes
    `<sha>`, so a close run late measures as if it had run at the gate.
    `close` on an already-`done` sub-issue is a re-close: it rewrites
    `actual.*`/`ratio`, adds or removes `bloat` to match the new
    evaluation, leaves `status: done`, and appends a fresh calibration
    line -- the last line per id is the record readers trust.

    POLY-48 item 9: refuses outright, before any flush or read (including
    `--dry-run`), when run from a linked git worktree -- a worktree has
    no `process/cairn/metrics/` mount (`ensure_metrics_worktree.py` is a
    no-op there), so it would otherwise silently write null actuals
    instead of ever reading the real token log.
    """
    main_checkout = _linked_worktree_main_checkout(Path.cwd())
    if main_checkout is not None:
        print(
            f"close: {args.id}: run from the main checkout ({main_checkout}) -- a worktree has no metrics "
            "mount; nothing written",
            file=sys.stderr,
        )
        return 2

    data_dir = resolve_data_dir(args)
    path = find_record_path(data_dir, args.id)
    if path is None:
        print(f"close: no such issue: {args.id}", file=sys.stderr)
        return 1
    fm, _ = parse_frontmatter(path.read_text(encoding="utf-8"))

    stage = fm.get("stage")
    parent = fm.get("parent")
    assignee = fm.get("assignee")
    missing = []
    if stage is None:
        missing.append("stage")
    if parent is None:
        missing.append("parent")
    if assignee is None:
        missing.append("assignee")
    if (
        fm.get("estimate.cost_usd") is None
        and fm.get("estimate.tokens") is None
        and fm.get("estimate.gate_cycles") is None
    ):
        missing.append("estimate.cost_usd, estimate.tokens, or estimate.gate_cycles")
    if missing:
        print(f"close: {args.id} is missing required field(s): {', '.join(missing)}", file=sys.stderr)
        return 1

    root = _git_toplevel(Path.cwd())
    if root is None:
        print("close: not inside a git repository", file=sys.stderr)
        return 2

    # POLY-16 ruling (design note §2 -- Stage windows): `--at <sha>` sets
    # the ceiling -- close_ts becomes <sha>'s author time and ref becomes
    # <sha>, so a close run late (as in POLY-3) measures as if it had run
    # at the gate. Validated against the ORIGINAL ref/base, before ref is
    # overwritten below.
    at_sha: Optional[str] = None
    at_ts: Optional[str] = None
    if args.at_sha:
        ceiling = _at_ceiling(root, args.base, args.ref, args.at_sha)
        if ceiling is None:
            print(
                f"close: --at {args.at_sha!r} is not on {args.ref}'s first-parent history after the parent "
                f"flip ({args.base}..{args.ref}) -- refusing an arbitrary ceiling",
                file=sys.stderr,
            )
            return 1
        at_sha, at_ts = ceiling
        args.ref = at_sha

    # Addendum 1 (design note @ 85c5fd6 §2): W's floor is
    # from_ts = max(parent flip, sibling floor) -- the sub-issue file's
    # own creation commit is no longer used at all (sub-issues are often
    # written after work has started; the assignee/role filters already
    # keep other agents' commits and tokens out of W). Neither candidate
    # is required: with no divergence from `base` and no closed sibling,
    # from_ts is `None` -- no floor at all, only `close_ts` bounds W.
    parent_flip = _parent_flip(root, args.base, args.ref)
    sibling_floor = _sibling_floor(data_dir, parent, assignee, args.id, stage)
    floor_candidates = [(v, _parse_iso_any(v)) for v in (parent_flip, sibling_floor) if v]
    if floor_candidates:
        from_ts = _normalize_iso_z(max(floor_candidates, key=lambda pair: pair[1])[0])
    else:
        # Architect's review of bbbc8f7 (R2, note @ c195c37): a bounded
        # window is mandatory once `gate_cycle_actuals` walks `ref`'s full
        # history rather than a `base..ref` range -- an undefined floor
        # must refuse, not silently read the assignee's whole-repo/
        # whole-file history as if it were all this sub-issue's own work.
        print(
            f"close: {args.id}'s window has no floor -- {args.base}..{args.ref} is empty (no feature-branch "
            f"divergence) and no closed sibling exists for (parent={parent}, assignee={assignee}); "
            "refusing an unbounded window",
            file=sys.stderr,
        )
        return 1

    usage_path = data_dir / TOKEN_USAGE_REL
    if not args.no_flush and not args.dry_run:
        _flush_receiver_and_wait(root, usage_path)

    # POLY-16 ruling: `--at` pins close_ts to the ceiling commit's own
    # author time; the default ceiling is real wall-clock now(). Commits
    # and wall-clock (gate_cycle_actuals below) stay bounded by close_ts,
    # unchanged (POLY-48 item 4, gate-1 ruling
    # process/reviews/POLY-48/ruling.md §1(b)) -- only the TOKEN ceiling differs.
    close_ts = at_ts if at_sha is not None else datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # POLY-34 (ruling §0.2): prices loaded once here (not inside
    # token_actuals) so `prices_retrieved` can be stamped on the
    # calibration record from the exact table that priced this close.
    prices = load_prices()

    # POLY-48 item 4 (POLY-47): with `--at`, admit the first flush after
    # the ceiling commit (within one flush interval) as the TOKEN
    # window's upper bound, rather than the commit's own timestamp --
    # see `_token_ceiling`. Without `--at`, close_ts is already real
    # wall-clock now() and the forced flush above already ran
    # synchronously, so there is no ceiling to admit.
    token_until_ts = close_ts
    if at_sha is not None:
        import otel_receiver  # sibling module; imported here so cairn stays import-light (mirrors _append_calibration_record's backfill_tokens import) -- safe despite otel_receiver itself importing cairn, since by now cairn is already fully loaded
        token_until_ts, ceiling_warning = _token_ceiling(
            usage_path, at_sha, close_ts, otel_receiver.DEFAULT_FLUSH_INTERVAL_SECONDS,
        )
        if ceiling_warning is not None:
            print(ceiling_warning, file=sys.stderr)

    token_result = token_actuals(data_dir, parent, role=assignee, since=from_ts, until=token_until_ts, prices=prices)
    if token_result["tokens"] is None:
        if usage_path.is_file():
            print(
                f"close: warning: no matching {usage_path} line for (parent={parent}, role={assignee}, window) "
                "-- actual.tokens: null",
                file=sys.stderr,
            )
        else:
            print(f"close: warning: {usage_path} not found -- actual.tokens: null", file=sys.stderr)
    if token_result["unpriced_models"]:
        print(
            f"close: warning: unpriced model(s) {token_result['unpriced_models']} in window "
            "-- actual.cost_usd: null",
            file=sys.stderr,
        )

    same_stage_authors = _same_stage_sibling_assignees(data_dir, args.id, parent, stage, assignee)
    gate_result = gate_cycle_actuals(root, args.base, args.ref, assignee, same_stage_authors, since=from_ts, until=close_ts)
    if gate_result["commits"] == 0:
        print(f"close: warning: zero commits by {assignee} in window -- actual.gate_cycles: 0", file=sys.stderr)

    # Addendum 1: wall_clock is measured against the assignee's own last
    # commit in W, not close_ts -- a sub-issue closed long after its work
    # finished (POLY-11 closes only once `cairn close` exists) must not
    # count the idle gap. `None` with zero commits, or no floor to
    # measure from.
    last_ts = gate_result.get("last_commit_ts")
    wall_clock: Optional[int] = None
    if last_ts is not None and from_ts is not None:
        wall_clock = round((_parse_iso_any(last_ts) - _parse_iso_any(from_ts)).total_seconds() / 60)

    estimate_cost_usd_raw = fm.get("estimate.cost_usd")
    estimate_cost_val: Optional[float] = float(estimate_cost_usd_raw) if estimate_cost_usd_raw is not None else None
    estimate_tokens = fm.get("estimate.tokens")
    estimate_gate_cycles = fm.get("estimate.gate_cycles")

    actual_cost_val = token_result["cost_usd"]

    # POLY-34 (ruling §0.3): `ratio` is now the COST ratio; the token
    # ratio is kept in the calibration record only, as `ratio_tokens`,
    # for continuity -- nothing reads it.
    ratio_val: Optional[float] = None
    if actual_cost_val is not None and estimate_cost_val:
        ratio_val = actual_cost_val / estimate_cost_val
    ratio_tokens_val: Optional[float] = None
    if token_result["tokens"] is not None and estimate_tokens:
        ratio_tokens_val = token_result["tokens"] / estimate_tokens

    config = load_config(data_dir)
    bloat_ratio_raw = (config.get("estimation") or {}).get("bloat_ratio")
    bloat_ratio: Optional[float] = None
    if bloat_ratio_raw is not None:
        try:
            bloat_ratio = float(bloat_ratio_raw)
        except (TypeError, ValueError):
            bloat_ratio = None
    else:
        print("close: bloat: cost threshold unset (estimation.bloat_ratio) — skipped", file=sys.stderr)

    gate_bloat = estimate_gate_cycles is not None and gate_result["gate_cycles"] > estimate_gate_cycles
    cost_bloat = bloat_ratio is not None and ratio_val is not None and ratio_val > bloat_ratio
    bloat_reasons = []
    if gate_bloat:
        bloat_reasons.append("gate_cycles")
    if cost_bloat:
        bloat_reasons.append("cost")
    if gate_bloat or cost_bloat:
        calibration_bloat: Optional[bool] = True
    elif bloat_ratio_raw is not None:
        calibration_bloat = False
    else:
        calibration_bloat = None  # not evaluated: threshold unset and no gate overrun

    # POLY-34 (ruling §0.3): close always writes actual.cost_usd/
    # actual.tokens/actual.wall_clock as a value or null -- a stale value
    # from an earlier close must not survive a re-close that no longer
    # computes one. `ratio` is the one exception: it is only written when
    # a value now exists OR the file already carried one to clear (a
    # sub-issue that was never closed with a cost estimate must not grow
    # a `ratio: null` line it never had).
    patch: Dict[str, Any] = {
        "status": "done",
        "actual.gate_cycles": gate_result["gate_cycles"],
        "actual.wall_clock": wall_clock,
        "actual.tokens": token_result["tokens"],
        "actual.cost_usd": (f"{actual_cost_val:.4f}" if actual_cost_val is not None else None),
    }
    if ratio_val is not None:
        patch["ratio"] = f"{ratio_val:.2f}"
    elif fm.get("ratio") is not None:
        patch["ratio"] = None
    # POLY-16 ruling: a re-close adds OR REMOVES the `bloat` label to match
    # the new evaluation -- a revised estimate (or a corrected window) that
    # no longer overruns must not leave the label stuck from an earlier close.
    labels = list(fm.get("labels") or [])
    if bloat_reasons and "bloat" not in labels:
        labels.append("bloat")
        patch["labels"] = labels
    elif not bloat_reasons and "bloat" in labels:
        labels = [l for l in labels if l != "bloat"]
        patch["labels"] = labels

    ref_sha = subprocess.run(
        ["git", "rev-parse", args.ref], cwd=root, capture_output=True, text=True,
    ).stdout.strip() or None

    record = {
        "schema": 2, "closed": close_ts, "id": args.id, "parent": parent,
        "stage": stage, "assignee": assignee, "labels": labels,
        "milestone": fm.get("milestone"),
        "estimate": {"cost_usd": estimate_cost_val, "tokens": estimate_tokens, "gate_cycles": estimate_gate_cycles},
        "actual": {
            "tokens": token_result["tokens"], "gate_cycles": gate_result["gate_cycles"],
            "wall_clock": wall_clock, "input": token_result["input"],
            "cache_write": token_result["cache_write"], "cache_read": token_result["cache_read"],
            "output": token_result["output"], "cost_usd": actual_cost_val,
        },
        "ratio": ratio_val, "ratio_tokens": ratio_tokens_val, "prices_retrieved": prices.get("retrieved"),
        "bloat": calibration_bloat, "bloat_reasons": bloat_reasons,
        # POLY-48 item 4: window.to is the admitted TOKEN ceiling
        # (token_until_ts), not the commit-time close_ts -- the next
        # same-assignee stage's floor reads this value (_sibling_floor),
        # so the admitted flush is never counted twice.
        "window": {"from": from_ts, "to": token_until_ts, "at": at_sha},
        "base": args.base, "ref_sha": ref_sha,
    }

    print(
        f"close {args.id}: cost={patch['actual.cost_usd']} tokens={token_result['tokens']} "
        f"gate_cycles={gate_result['gate_cycles']} wall_clock={wall_clock}m "
        f"ratio={patch.get('ratio')} bloat={bloat_reasons or 'no'}"
    )
    if args.dry_run:
        print("close: --dry-run -- nothing written")
        return 0

    apply_patch(path, patch)
    _append_calibration_record(data_dir, record)
    return 0


def cmd_estimate(args: argparse.Namespace) -> int:
    """`cairn estimate <ID>` (design note §4): prints the closest
    reference classes (same stage + assignee, then same stage + shared
    labels) with their actuals, to seed a new estimate. Reads only the
    calibration records -- never the token log or git -- so it is fast
    and deterministic. Never writes.
    """
    data_dir = resolve_data_dir(args)
    path = find_record_path(data_dir, args.id)
    if path is None:
        print(f"estimate: no such issue: {args.id}", file=sys.stderr)
        return 1
    fm, _ = parse_frontmatter(path.read_text(encoding="utf-8"))
    stage = fm.get("stage")
    parent = fm.get("parent")
    if stage is None or parent is None:
        print(f"estimate: {args.id} has no stage/parent set -- both are required to query reference classes", file=sys.stderr)
        return 1
    assignee = fm.get("assignee")
    labels = set(fm.get("labels") or [])

    cal_path = Path(data_dir) / "metrics" / "calibration.jsonl"
    rows_by_id: Dict[str, Dict[str, Any]] = {}
    if cal_path.is_file():
        for line in cal_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("id") == args.id:
                continue  # self-exclusion
            rows_by_id[row["id"]] = row  # last line per id wins

    tier_a = sorted(
        (r for r in rows_by_id.values() if r.get("stage") == stage and r.get("assignee") == assignee),
        key=lambda r: r.get("closed") or "", reverse=True,
    )[: args.limit]
    tier_b = sorted(
        (
            r for r in rows_by_id.values()
            if r.get("stage") == stage and r.get("assignee") != assignee
            and (set(r.get("labels") or []) & labels)
        ),
        key=lambda r: (len(set(r.get("labels") or []) & labels), r.get("closed") or ""), reverse=True,
    )[: args.limit]

    if not tier_a and not tier_b:
        print("no closed reference classes yet — hand-estimate")
        return 0

    if args.json:
        print(json.dumps({"tier_a": tier_a, "tier_b": tier_b}, indent=1, default=str))
        return 0

    out = [f"reference classes for {args.id} ({stage} / {assignee} / {sorted(labels)})"]
    suggestion = None
    for tier_name, tier_desc, rows in (("A", "same stage + assignee", tier_a), ("B", "same stage, shared labels", tier_b)):
        if not rows:
            continue
        out.append(f"tier {tier_name} — {tier_desc} ({len(rows)})")
        # POLY-34 (ruling §0.4): cost columns lead; tokens is a printed
        # secondary (`act.tok`), never an estimate/median input.
        out.append("  id       closed      est.$    act.$     ratio  est.gc  act.gc  wall  act.tok   bloat")
        for r in rows:
            est, act = r.get("estimate") or {}, r.get("actual") or {}

            def _cell(v: Any) -> str:
                return "null" if v is None else str(v)

            # A schema-1 row's stored `ratio` is the OLD token ratio --
            # not comparable to a schema-2 cost ratio, so it prints as a
            # dash rather than a misleading number.
            ratio_cell = "-" if r.get("schema") != 2 else _cell(r.get("ratio"))
            out.append(
                f"  {r.get('id', ''):<8} {str(r.get('closed') or '')[:10]:<11} "
                f"{_cell(est.get('cost_usd')):<8} {_cell(act.get('cost_usd')):<9} "
                f"{ratio_cell:<6} {_cell(est.get('gate_cycles')):<7} "
                f"{_cell(act.get('gate_cycles')):<7} {_cell(act.get('wall_clock')):<5} "
                f"{_cell(act.get('tokens')):<9} "
                f"{'yes' if r.get('bloat') else 'no'}"
            )
        # POLY-34 (architect verdict R1, @ 6a6df12; §9.1 item 9 rewritten
        # @ 0a0b1f7): only a null `actual.cost_usd` is excluded from the
        # cost median (an unpriced model, or a schema-1 row with no cost
        # at all) -- the same "no evidence must never enter a median"
        # rule the token median already followed (addendum 1, design
        # note @ 85c5fd6 §2). A schema-1 row's non-null `cost_usd` STILL
        # COUNTS: it came from the same `token_actuals` pricing as a
        # schema-2 row's -- only its `ratio` (the token ratio) is
        # incomparable, which is why that column prints a dash instead.
        cost_values = [
            r["actual"]["cost_usd"] for r in rows
            if r["actual"].get("cost_usd") is not None
        ]
        cost_median = round(statistics.median(cost_values), 2) if cost_values else None
        gc_median = int(statistics.median(r["actual"]["gate_cycles"] for r in rows))
        wall_values = [r["actual"]["wall_clock"] for r in rows if r["actual"].get("wall_clock") is not None]
        wall_median = int(statistics.median(wall_values)) if wall_values else None
        token_values = [r["actual"]["tokens"] for r in rows if r["actual"].get("tokens") is not None]
        tok_median = int(statistics.median(token_values)) if token_values else None
        out.append(
            f"  median actual: cost {'$' + format(cost_median, '.2f') if cost_median is not None else 'n/a'} · "
            f"gate_cycles {gc_median} · wall {wall_median if wall_median is not None else 'n/a'}m · "
            f"tokens {tok_median if tok_median is not None else 'n/a'}"
        )
        if suggestion is None:
            suggestion = (cost_median, gc_median, tier_name)

    if suggestion is not None:
        cost, gc, tier_name = suggestion
        if cost is not None:
            out.append(f"suggested: estimate.cost_usd={cost:.2f} estimate.gate_cycles={gc}   (tier {tier_name} median)")
        else:
            out.append(f"suggested: estimate.gate_cycles={gc}   (tier {tier_name} median; no non-null cost actuals)")
    print("\n".join(out))
    return 0


def cmd_loop_stats(args: argparse.Namespace) -> int:
    import loop_stats  # sibling module; imported here so `cairn` stays import-light
    data_dir = resolve_data_dir(args)
    root = _git_toplevel(Path.cwd()) or data_dir.resolve().parent.parent
    tdir = Path(args.transcripts_dir) if args.transcripts_dir else _default_transcripts_dir(root)
    since = loop_stats.parse_ts(args.since) if args.since else None
    until = loop_stats.parse_ts(args.until) if args.until else None
    try:
        card = loop_stats.scorecard(root, data_dir, args.id, base=args.base, since=since, until=until, transcripts_dir=tdir)
    except subprocess.CalledProcessError as e:
        print(f"error: git failed: {e.stderr.strip() if e.stderr else e}", file=sys.stderr)
        return 1
    if args.steps:
        out = Path(args.steps)
        s, u = loop_stats.parse_ts(card["since"]), loop_stats.parse_ts(card["until"])
        seen: Dict[str, int] = {}
        for p, role in loop_stats.transcript_roles(tdir).items():
            steps, _ = loop_stats.audit_agent(p, s, u, lead=(role == "team-lead"))
            if not steps:
                continue
            seen[role] = seen.get(role, 0) + 1
            name = role if seen[role] == 1 else f"{role}-{p.stem[:8]}"
            loop_stats.write_steps(out, name, steps, card["since"][:16], card["until"][:16])
            if role == "team-lead":
                rows, _ = loop_stats.lead_inbound(p, s, u)
                loop_stats.write_lead_inbound(out, rows)
        print(f"steps written to {out}", file=sys.stderr)
    if args.json:
        card = dict(card)
        card["per_agent"] = {k: {kk: (dict(vv) if isinstance(vv, collections.Counter) else vv) for kk, vv in v.items()} for k, v in card["per_agent"].items()}
        print(json.dumps(card, indent=1, default=str))
    else:
        print(loop_stats.format_scorecard(card), end="")
    return 0


def _default_transcripts_dir(repo_root: Path) -> Path:
    return Path.home() / ".claude" / "projects" / re.sub(r"[/_.]", "-", str(Path(repo_root).resolve()))


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except CairnError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
