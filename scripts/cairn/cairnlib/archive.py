"""cairnlib.archive — `cairn archive`: milestone/major archiving, the
git-mv-or-rename helper, and the CLI command.

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 19).
"""

import argparse
import datetime
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

from cairnlib.errors import CairnError
from cairnlib.records import parse_frontmatter
from cairnlib.config import resolve_data_dir
from cairnlib.store import _dir_glob

__all__ = [
    "_DONE_BEFORE_RE",
    "_git_mv_or_rename",
    "_issues_for_milestone",
    "_milestone_precondition",
    "_print_archive_milestone_report",
    "_validate_done_before",
    "archive_major",
    "archive_milestone",
    "cmd_archive",
]


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
