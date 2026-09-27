"""cairnlib.lint — `cairn check`: the full-repo lint (`check_repo`) and its
dependency-cycle detector.

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 8).
`_rotate_cycle_to_canonical`/`_detect_blocked_by_cycles` relocate here from
the snapshot section (ruling §2 "+").
"""

from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from cairnlib.constants import (
    MILESTONE_KINDS,
    PREFIX_RE,
    PRIORITIES,
    STATUSES,
    _STAGE_ORDER,
    _SUFFIXED_ISSUE_ID_RE,
    _check_archived_record_status,
    _check_record_status,
    _definition_milestone_id_re,
    _development_milestone_id_re,
    _ga_target_tag_for_major,
    _issue_id_re,
    _major_id_re,
)
from cairnlib.errors import CairnError
from cairnlib.yamlsub import parse_yaml_subset
from cairnlib.records import parse_frontmatter
from cairnlib.config import validate_board_columns, validate_board_swimlane, validate_path_glob
from cairnlib.store import (
    _dir_glob,
    _id_sort_key,
    archived_issue_paths,
    archived_milestone_paths,
    is_archived_path,
    legacy_archived_issue_paths,
)
from cairnlib.guards import check_docs

__all__ = [
    "_detect_blocked_by_cycles",
    "_rotate_cycle_to_canonical",
    "check_repo",
]


def check_repo(data_dir: Path) -> List[str]:
    """Lint the data dir. Returns pointed error strings; [] means clean.

    Catches per-file YamlError/FrontmatterError internally rather than
    propagating them.
    """
    data_dir = Path(data_dir)
    errors: List[str] = []

    # PT-3 (team-lead ruling C): `roots:` shape only, never reachability --
    # `cairn check` runs in CI and on any clone lacking a sibling repo, so
    # a missing/unreachable secondary root is a runtime warn-and-skip
    # concern (resolve_roots), not a lint error.
    #
    # PT-28 (architect's ruling § 3.1, confirmation #2): a missing or
    # prefix-less config.yml STOPS being tolerable the moment id shapes are
    # derived from `prefix:` -- every regex below needs it, and a lint that
    # quietly stops linting (or guesses) is worse than no lint. `prefix`
    # stays None on any failure path here, which is this function's single
    # signal to every id-shape check below to skip itself rather than run
    # against a regex it can't safely build -- never a guess, and never a
    # silent partial lint (PrefixFormatLintTests.
    # test_a_malformed_prefix_does_not_silently_skip_the_rest_of_the_lint:
    # the prefix error itself, appended immediately below, is what keeps
    # `errors` non-empty even when nothing else fires).
    config_path = data_dir / "config.yml"
    prefix: Optional[str] = None
    if not config_path.exists():
        errors.append(f"config.yml: missing at {config_path} -- required for the id-shape prefix lint")
        cfg: Dict[str, Any] = {}
    else:
        try:
            cfg = parse_yaml_subset(config_path.read_text(encoding="utf-8"))
        except CairnError as e:
            errors.append(f"config.yml: {e}")
            cfg = {}
        roots_val = cfg.get("roots")
        if roots_val is not None:
            if not isinstance(roots_val, list):
                errors.append(f"config.yml: roots must be a list of paths, got {type(roots_val).__name__}")
            else:
                for idx, entry in enumerate(roots_val):
                    if not isinstance(entry, str):
                        errors.append(f"config.yml: roots[{idx}] must be a path string, not {type(entry).__name__}")
                    elif not entry:
                        errors.append(f"config.yml: roots[{idx}] must be a non-empty relative path")
                    elif Path(entry).is_absolute():
                        errors.append(f"config.yml: roots[{idx}] {entry!r} must be relative to the repo root")

        raw_prefix = cfg.get("prefix")
        if raw_prefix is None:
            errors.append("config.yml: missing prefix: key -- required for the id-shape lint")
        elif not PREFIX_RE.match(str(raw_prefix)):
            errors.append(f"config.yml: prefix {raw_prefix!r} must match {PREFIX_RE.pattern}")
        else:
            prefix = str(raw_prefix)

        # PT-38 (ruling § 2): the HARD-error posture -- an explicitly
        # present but invalid board.columns/board.swimlane value is a lint
        # error, the opposite posture from load_config's silent fallback
        # for the SAME bad input (by design, not a discrepancy -- see
        # load_config's own docstring). An ABSENT key is not an error;
        # defaulting is fine, so these only run when the key is actually
        # present in the RAW parsed config (pre-load_config-defaulting).
        board_val = cfg.get("board")
        if isinstance(board_val, dict):
            if "columns" in board_val:
                ok, reason = validate_board_columns(board_val["columns"])
                if not ok:
                    errors.append(f"config.yml: board.columns invalid -- {reason}")
            if "swimlane" in board_val:
                ok, reason = validate_board_swimlane(board_val["swimlane"])
                if not ok:
                    errors.append(f"config.yml: board.swimlane invalid -- {reason}")
        elif board_val is not None:
            errors.append(f"config.yml: board must be a mapping, got {type(board_val).__name__}")

        # POLY-3 (design note §1): estimation.bloat_ratio -- absent/null is
        # fine (the token bloat rule stays skipped until POLY-A sets a
        # baseline); present must be a float()-parseable value > 1.0. Any
        # other estimation.* key is a typo guard, same posture as board.*.
        estimation_val = cfg.get("estimation")
        if isinstance(estimation_val, dict):
            unknown_keys = sorted(set(estimation_val.keys()) - {"bloat_ratio"})
            if unknown_keys:
                errors.append(f"config.yml: estimation has unknown key(s) {unknown_keys} -- expected only bloat_ratio")
            if "bloat_ratio" in estimation_val:
                bloat_ratio_val = estimation_val["bloat_ratio"]
                try:
                    if not (float(bloat_ratio_val) > 1.0):
                        errors.append(f"config.yml: estimation.bloat_ratio must be > 1.0, got {bloat_ratio_val!r}")
                except (TypeError, ValueError):
                    errors.append(f"config.yml: estimation.bloat_ratio {bloat_ratio_val!r} must be a float-parseable number")
        elif estimation_val is not None:
            errors.append(f"config.yml: estimation must be a mapping, got {type(estimation_val).__name__}")

    # PT-28: built once per call, only when the prefix validated -- every
    # id-shape check below reads through these four, never rebuilding its
    # own regex inline (that would be the exact "two copies must agree"
    # hazard PT-22/PT-29 exist to close, one layer down).
    major_re = _major_id_re(prefix) if prefix else None
    definition_re = _definition_milestone_id_re(prefix) if prefix else None
    development_re = _development_milestone_id_re(prefix) if prefix else None
    issue_re = _issue_id_re(prefix) if prefix else None

    known_majors = set()
    for p in _dir_glob(data_dir / "majors"):
        try:
            fm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        except CairnError as e:
            errors.append(f"{p.stem}: {e}")
            continue
        mid = fm.get("id")
        if mid is None or str(mid) != p.stem:
            errors.append(f"{p.stem}: id {mid!r} does not match filename {p.stem!r}")
        elif major_re is not None and not major_re.match(p.stem):
            # PT-28: NEW enforcement -- pre-PT-28, check_repo never
            # validated a major's id shape at all, only id==filename.
            errors.append(
                f"{p.stem}: major id shape {p.stem!r} does not match {major_re.pattern!r} "
                f"(configured prefix {prefix!r})"
            )
        if fm.get("title") is not None:
            errors.append(f"{p.stem}: unexpected title {fm['title']!r} -- title is issue-only")
        # PT-39 (architect's ruling § 3 item 1): NEW enforcement -- a
        # major's status: must be present and in RECORD_STATUSES. Pre-
        # PT-39, check_repo never validated a major's status value at
        # all, which is how "active" (not even documented anywhere)
        # survived undetected.
        _check_record_status(errors, p.stem, fm.get("status"))
        known_majors.add(p.stem)

    # PT-39 (architect's ruling § 3 item 3): known_majors ALSO resolves
    # against archive/majors/ -- an archived major is still a legitimate
    # reference target (a milestone naming it, or the archive precondition
    # itself), and excluding it here would dangle every reference to it
    # the moment `cairn archive --major` runs, self-defeating for a
    # command whose whole point is a clean post-archive lint. Resolution
    # ONLY -- id-shape/title/GENERAL-status validation is NOT re-run on
    # archived files: they already passed those checks at the moment they
    # were archived (archive_major moves files verbatim, never rewriting
    # frontmatter), so re-validating here would be redundant at best.
    #
    # PT-46 (architect's Pass-2 finding): the ONE exception -- an archived
    # record's OWN status must be done/cancelled, a stricter,
    # archive-location-specific rule the general check above never
    # asserted (the hand-`git mv` bypass this file's own precondition
    # exists to catch). This is why this loop parses frontmatter now,
    # unlike before PT-46.
    for p in _dir_glob(data_dir / "archive" / "majors"):
        known_majors.add(p.stem)
        try:
            fm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        except CairnError:
            continue
        _check_archived_record_status(errors, p.stem, fm.get("status"))

    known_milestones = set()
    parsed_milestones: List[Tuple[Path, Dict[str, Any]]] = []
    for p in _dir_glob(data_dir / "milestones"):
        try:
            fm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        except CairnError as e:
            errors.append(f"{p.stem}: {e}")
            continue
        parsed_milestones.append((p, fm))
        mid = fm.get("id")
        if mid is None or str(mid) != p.stem:
            errors.append(f"{p.stem}: id {mid!r} does not match filename {p.stem!r}")
        if fm.get("title") is not None:
            errors.append(f"{p.stem}: unexpected title {fm['title']!r} -- title is issue-only")
        known_milestones.add(p.stem)

    # PT-39 (ruling § 3 item 3, milestones half): same widening as
    # known_majors above, and the same reason -- archive_milestone moves a
    # milestone file into archive/milestones/ without rewriting any of the
    # issues that still name it (its own now-archived issues included),
    # so those refs must keep resolving. `milestone_status_by_id` is built
    # alongside it (live status from parsed_milestones, archived status
    # from this same scan) -- item 2 below is the one check that needs a
    # STATUS, not just a yes/no "does this id exist".
    milestone_status_by_id: Dict[str, Any] = {p.stem: fm.get("status") for p, fm in parsed_milestones}
    # PT-41 (architect's review finding #3): archived ga:true milestones
    # count toward their major's "at most one GA" cap too -- populated in
    # THIS SAME archive/milestones scan (not a second one -- the standing
    # duplicated-directory-read rule) alongside the two things PT-39/PT-46
    # already collect here. The live half is added to this dict further
    # down, once parsed_milestones' own loop runs.
    ga_milestones_by_major: Dict[str, List[str]] = {}
    # PT-47: which ga_milestones_by_major entries came from THIS (archived)
    # scan vs. the live one further down -- collected here, not a second
    # directory read, so the cap error below can mark siblings instead of
    # rendering an unlabeled stem list a reader has to go re-derive by hand.
    ga_milestones_archived: Set[str] = set()
    # PT-59 (2026-08-23 decision: milestone <-> target_tag is 1:1, never
    # enforced until now): every milestone -- live or archived -- whose
    # target_tag is non-null, keyed by tag. Same "collect in the loop
    # that's already reading this directory" discipline as
    # ga_milestones_by_major immediately above -- not a second directory
    # read. This is the SAME two-directory surface PT-54's release join
    # (_find_release_milestone) reads to resolve a shipped tag back to its
    # milestone; today, with no lint, glob order silently tiebreaks a state
    # this decision says can't exist at all.
    target_tag_owners: Dict[str, List[str]] = {}
    target_tag_owners_archived: Set[str] = set()
    # PT-66: single-sources the archive/milestones/ spelling via the
    # named helper (mirrors archived_issue_paths' own reasoning) instead
    # of this loop carrying that path fragment inline -- same directory,
    # same files, purely a naming/single-source change.
    for p in archived_milestone_paths(data_dir):
        try:
            fm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        except CairnError:
            continue
        known_milestones.add(p.stem)
        milestone_status_by_id[p.stem] = fm.get("status")
        # PT-46 (architect's Pass-2 finding): the same archive-location-
        # specific done/cancelled requirement as the majors loop above --
        # the hand-`git mv` bypass, milestone half.
        _check_archived_record_status(errors, p.stem, fm.get("status"))
        if fm.get("ga") is True:
            major_id = str(fm.get("major"))
            if major_id in known_majors:
                ga_milestones_by_major.setdefault(major_id, []).append(p.stem)
                ga_milestones_archived.add(p.stem)
        target_tag = fm.get("target_tag")
        if target_tag:
            target_tag_owners.setdefault(str(target_tag), []).append(p.stem)
            target_tag_owners_archived.add(p.stem)

    for p, fm in parsed_milestones:
        major = fm.get("major")
        if major is None:
            errors.append(f"{p.stem}: missing major")
        elif str(major) not in known_majors:
            errors.append(f"{p.stem}: unknown major {major!r}")

        # PT-39 (architect's ruling § 3 item 1): NEW enforcement -- a
        # milestone's status: must be present and in RECORD_STATUSES.
        # Same check as the major loop above -- routed through the one
        # shared helper (_check_record_status) rather than a second
        # inline copy of the condition (standing duplicated-inline-
        # expression rule: this exact "missing or invalid status" shape
        # would otherwise exist twice, one per schema, and could drift).
        _check_record_status(errors, p.stem, fm.get("status"))

        # PT-59: live half of the target_tag_owners collection -- the
        # archived half was already gathered above, in the same
        # archive/milestones scan PT-39/PT-46/PT-47 already read that
        # directory for.
        #
        # DEPENDENCY: this collection runs unconditionally, every
        # iteration, relying on the major check immediately above staying
        # if/elif (falling through), never `continue`. If a future
        # refactor turns that major check into a `continue`-on-invalid
        # guard, a milestone with a bad/dangling major would silently
        # stop contributing its target_tag here too -- dropped from this
        # lint with nothing failing. Enforced, not just documented:
        # test_check_lint.py's
        # test_a_record_that_trips_an_earlier_check_still_contributes_its_tag
        # pins exactly this shape (two milestones, same tag, an unknown
        # major each) and fails the moment that `elif` becomes `continue`.
        target_tag = fm.get("target_tag")
        if target_tag:
            target_tag_owners.setdefault(str(target_tag), []).append(p.stem)

        # PT-27/PT-28: milestone id-shape <-> kind agreement, now against
        # the PREFIXED shapes (definition_re/development_re, built above --
        # `V` joined `M` as a reserved definition letter, architect's
        # ruling § 1). The filename stem is authoritative (id/filename
        # mismatch is its own check above), so the shape check runs
        # against p.stem rather than the raw fm["id"]. Skipped entirely
        # when the prefix didn't validate (definition_re is None) -- there
        # is no safe shape to check against.
        stem = p.stem
        kind = fm.get("kind")
        if kind not in MILESTONE_KINDS:
            errors.append(
                f"{stem}: missing or invalid kind {kind!r} -- expected 'product' or 'process'"
            )
        elif definition_re is not None and development_re is not None:
            is_definition_shape = bool(definition_re.match(stem))
            is_development_shape = bool(development_re.match(stem))
            if not is_definition_shape and not is_development_shape:
                errors.append(
                    f"{stem}: unrecognised milestone id {stem!r} -- expected {prefix}-<letter> "
                    f"(e.g. {prefix}-A) for kind: process, or {prefix}-<version> / {prefix}-M<n> "
                    f"for kind: product"
                )
            elif kind == "process" and not is_definition_shape:
                errors.append(
                    f"{stem}: id shape {stem!r} is a development milestone but kind is 'process' -- "
                    f"definition milestones use letter ids ({prefix}-A, {prefix}-B, {prefix}-C...); "
                    f"rename the file and its id, then retarget its issues, or set kind: product"
                )
            elif kind == "product" and not is_development_shape:
                errors.append(
                    f"{stem}: id shape {stem!r} is a definition milestone but kind is 'product' -- "
                    f"development milestones use a version id ({prefix}-1.0) or {prefix}-M<n>"
                )

    # PT-41 (architect's Option A ruling, refined by their PT-41 review):
    # binds "V<n> means the line that culminates in v<n>.0.0" to the DATA
    # rather than leaving it as prose nobody enforces. Two riders, both
    # scoped PER MAJOR (two different major lines each designating their
    # own GA milestone is the normal concurrent-majors shape, not a
    # conflict):
    #
    #   1. At most one ga: true milestone per major -- counting an
    #      ARCHIVED ga:true milestone too (review finding #3): a shipped
    #      GA milestone that got archived is still that major's GA;
    #      ignoring it would let a second one be silently designated.
    #      Scoped only to milestones whose major ref actually RESOLVES
    #      (a dangling ref already produces "unknown major" elsewhere --
    #      not counted here, one broken field, one error).
    #   2. A LIVE ga: true milestone's target_tag must be EXACTLY
    #      v<N>.0.0 for its own major's N (a v1.1.0/v1.0.1/null
    #      target_tag all fail this). Also skipped for a dangling major
    #      ref (review finding #1) -- and N is derived only once
    #      major_re (this repo's configured-prefix shape, review finding
    #      #2) confirms the major id actually matches it, never from a
    #      prefix-agnostic literal. Not re-run on an ALREADY-ARCHIVED
    #      milestone -- same "don't re-validate archived files" posture
    #      PT-39 §3 item 1 already established (it passed this check at
    #      the moment it was archived; archive_milestone moves files
    #      verbatim, never rewriting frontmatter).
    #
    # ZERO ga: true milestones for a major is explicitly NOT an error --
    # a young major legitimately hasn't designated its GA milestone yet
    # (this repo's own PT-V1, today). The ARCHIVED half of
    # ga_milestones_by_major was already collected above, in the same
    # archive/milestones scan PT-39/PT-46 already read this directory
    # for -- this loop adds the LIVE half.
    for p, fm in parsed_milestones:
        if fm.get("ga") is True:
            major_id = str(fm.get("major"))
            if major_id in known_majors:
                ga_milestones_by_major.setdefault(major_id, []).append(p.stem)
    for major_id, ga_stems in ga_milestones_by_major.items():
        if len(ga_stems) > 1:
            # PT-47: mark archived siblings inline -- an unlabeled stem
            # list left a reader guessing which sibling was the (legit,
            # shipped) archived GA and which one is the actual conflict.
            sibling_list = ", ".join(
                f"{stem} (archived)" if stem in ga_milestones_archived else stem
                for stem in sorted(ga_stems)
            )
            for stem in ga_stems:
                errors.append(
                    f"{stem}: more than one ga: true milestone under major {major_id!r} "
                    f"({sibling_list}) -- exactly one GA milestone per major"
                )
    for p, fm in parsed_milestones:
        if fm.get("ga") is not True:
            continue
        major_id = str(fm.get("major"))
        if major_id not in known_majors:
            continue  # dangling major ref -- already reported above, not this rider's job
        expected_tag = _ga_target_tag_for_major(major_id, major_re)
        if expected_tag is None:
            continue  # major id doesn't match this repo's configured shape -- already reported elsewhere
        if fm.get("target_tag") != expected_tag:
            errors.append(
                f"{p.stem}: ga: true milestone's target_tag {fm.get('target_tag')!r} must be "
                f"{expected_tag!r} for major {major_id!r} (V<N> means the line that culminates in v<N>.0.0)"
            )

    # PT-59 (2026-08-23 decision, never enforced until now): milestone <->
    # target_tag is 1:1 -- no two milestone records, live or archived, may
    # carry the same non-null target_tag. Reported per offending record
    # (same convention as the ga-cap error two blocks up), naming the
    # shared tag and every sibling that carries it, archived siblings
    # marked so a reader isn't left guessing which is the (legitimate,
    # shipped) archived record and which is the actual conflict.
    for tag, stems in target_tag_owners.items():
        if len(stems) <= 1:
            continue
        sibling_list = ", ".join(
            f"{stem} (archived)" if stem in target_tag_owners_archived else stem
            for stem in sorted(stems)
        )
        for stem in stems:
            errors.append(
                f"{stem}: target_tag {tag!r} is shared with {sibling_list} -- milestone <-> "
                f"target_tag must be 1:1, never shared across records (TRACKER.md, ruled 2026-08-23)"
            )

    known_ids = set()
    parsed_issues: List[Tuple[Path, Dict[str, Any]]] = []
    for p in list(_dir_glob(data_dir / "issues")) + archived_issue_paths(data_dir):
        try:
            fm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        except CairnError as e:
            errors.append(f"{p.stem}: {e}")
            continue
        parsed_issues.append((p, fm))
        issue_id = fm.get("id")
        if issue_id == p.stem:
            known_ids.add(issue_id)
            # PT-28: NEW enforcement -- pre-PT-28, check_repo only ever
            # checked id == filename for issues, never the shape itself.
            if issue_re is not None and not issue_re.match(p.stem):
                errors.append(
                    f"{p.stem}: issue id shape {p.stem!r} does not match {issue_re.pattern!r} "
                    f"(configured prefix {prefix!r})"
                )
        else:
            errors.append(f"{p.stem}: id {issue_id!r} does not match filename {p.stem!r}")

    for p, fm in parsed_issues:
        label = p.stem
        if fm.get("title") is None:
            errors.append(f"{label}: missing title")
        status = fm.get("status")
        if status is not None and status not in STATUSES:
            errors.append(f"{label}: unknown status {status!r}")
        milestone = fm.get("milestone")
        if milestone is not None and str(milestone) not in known_milestones:
            errors.append(f"{label}: unknown milestone {milestone!r}")
        # PT-39 (architect's ruling § 3 item 2): the hand-`git mv` bypass
        # catch. `cairn archive --milestone` refuses unless the milestone
        # AND every issue under it are done/cancelled (test_archive_records
        # pins that precondition) -- but nothing stops a human from
        # `git mv`-ing ONE issue into archive/ directly, skipping the
        # precondition entirely. Scoped to issues actually living in
        # archive/ (is_archived_path) -- a LIVE issue under an
        # in-progress milestone is the normal, expected shape of every
        # unfinished milestone and must never trip this. Only fires once
        # the milestone ref has already resolved (str(milestone) in
        # known_milestones) -- a genuinely dangling ref is the check
        # above's job alone, not a second, confusing error on the same ref.
        if (
            is_archived_path(data_dir, p)
            and milestone is not None
            and str(milestone) in known_milestones
        ):
            ms_status = milestone_status_by_id.get(str(milestone))
            if ms_status not in ("done", "cancelled"):
                errors.append(
                    f"{label}: archived issue's milestone {milestone!r} is not done/cancelled "
                    f"(status: {ms_status!r}) -- looks like it was moved into archive/ by hand, "
                    f"bypassing `cairn archive`'s precondition"
                )
        parent = fm.get("parent")
        if parent is not None and parent not in known_ids:
            errors.append(f"{label}: dangling parent {parent!r}")
        # POLY-51 (ruling §3 new rule): a stem shaped `<P>-<n><letter>`
        # must declare `parent: <P>-<n>` -- the shape alone can't catch a
        # lie like `parent: PT-4` on a file named `PT-3a.md`, only this
        # agreement check can. Numbered sub-issues (pre-POLY-51 shape)
        # carry no such constraint -- their `parent:` is free-form, as
        # always.
        suffix_m = _SUFFIXED_ISSUE_ID_RE.match(label)
        if suffix_m and parent != suffix_m.group(1):
            errors.append(
                f"{label}: suffixed id implies parent {suffix_m.group(1)}, found {parent!r}"
            )
        priority = fm.get("priority")
        if priority is not None and priority not in PRIORITIES:
            errors.append(f"{label}: unknown priority {priority!r}")
        # POLY-2 (architect's gate-1 ruling § 4): `paths:` is validated for
        # SHAPE only, never existence -- a feature creates its own files,
        # so a glob naming a not-yet-created path is normal, not an error.
        # An absent key is fine (undeclared); an explicit `[]` is fine too
        # (validate_path_glob never runs against an empty list). Routed
        # through the one shared validator (validate_path_glob) rather
        # than an inline copy of the condition, same one-validator
        # discipline as board.columns/board.swimlane above.
        paths_val = fm.get("paths")
        if paths_val is not None:
            if not isinstance(paths_val, list):
                errors.append(f"{label}: paths must be a list of glob strings, got {type(paths_val).__name__}")
            else:
                for idx, entry in enumerate(paths_val):
                    ok, reason = validate_path_glob(entry)
                    if not ok:
                        errors.append(f"{label}: paths[{idx}] {entry!r} invalid -- {reason}")
        # POLY-3 (design note §1): stage/estimate.*/actual.*/ratio.
        stage = fm.get("stage")
        if stage is not None and stage not in _STAGE_ORDER:
            errors.append(f"{label}: unknown stage {stage!r} -- expected one of plan, execute, review")
        if stage is not None and parent is None:
            errors.append(f"{label}: stage {stage!r} set but parent is null -- stage belongs to a sub-issue")
        for field_name in (
            "estimate.tokens", "estimate.gate_cycles",
            "actual.tokens", "actual.gate_cycles", "actual.wall_clock",
        ):
            value = fm.get(field_name)
            if value is None:
                continue
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                errors.append(f"{label}: {field_name} must be a non-negative integer, got {value!r}")
            elif field_name == "estimate.tokens" and value == 0:
                errors.append(f"{label}: estimate.tokens must be > 0 -- 0 would make the ratio undefined")
        # POLY-34 (ruling §0.3): estimate.cost_usd / actual.cost_usd --
        # decimal strings (or, hand-written, a bare int/float) -- the
        # `ratio` operands below are now these, not the token pair.
        estimate_cost_usd = fm.get("estimate.cost_usd")
        if estimate_cost_usd is not None:
            if isinstance(estimate_cost_usd, bool) or not isinstance(estimate_cost_usd, (str, int, float)):
                errors.append(f"{label}: estimate.cost_usd must be a positive number, got {estimate_cost_usd!r}")
            else:
                try:
                    if not (float(estimate_cost_usd) > 0):
                        errors.append(f"{label}: estimate.cost_usd must be > 0, got {estimate_cost_usd!r}")
                except (TypeError, ValueError):
                    errors.append(f"{label}: estimate.cost_usd {estimate_cost_usd!r} must be a float-parseable number")
        actual_cost_usd = fm.get("actual.cost_usd")
        if actual_cost_usd is not None:
            if isinstance(actual_cost_usd, bool) or not isinstance(actual_cost_usd, (str, int, float)):
                errors.append(f"{label}: actual.cost_usd must be a float-parseable number, got {actual_cost_usd!r}")
            else:
                try:
                    if float(actual_cost_usd) < 0:
                        errors.append(f"{label}: actual.cost_usd must be >= 0, got {actual_cost_usd!r}")
                except (TypeError, ValueError):
                    errors.append(f"{label}: actual.cost_usd {actual_cost_usd!r} must be a float-parseable number")
        ratio = fm.get("ratio")
        if ratio is not None:
            try:
                if float(ratio) < 0:
                    errors.append(f"{label}: ratio must be >= 0, got {ratio!r}")
            except (TypeError, ValueError):
                errors.append(f"{label}: ratio {ratio!r} must be a float-parseable string")
            if actual_cost_usd is None or estimate_cost_usd is None:
                errors.append(f"{label}: ratio present without both actual.cost_usd and estimate.cost_usd")
        if status != "done":
            for field_name in ("actual.cost_usd", "actual.tokens", "actual.gate_cycles", "actual.wall_clock", "ratio"):
                if fm.get(field_name) is not None:
                    errors.append(
                        f"{label}: {field_name} is set but status is {status!r}, not done -- "
                        "actuals are close-time output only"
                    )
        # PT-26: blocked_by dangling reference + self-reference. Same terse
        # vocabulary as the dangling-parent check above (architect's
        # ruling #2) -- a self-reference gets its OWN message, never
        # folded into the cycle detector's verbose treatment below, so a
        # 1-node self-loop is reported once, here, not twice.
        for ref in fm.get("blocked_by") or []:
            issue_id = fm.get("id")
            if ref == issue_id:
                errors.append(f"{label}: blocked_by contains itself")
            elif ref not in known_ids:
                errors.append(f"{label}: dangling blocked_by {ref!r}")

    # PT-26: dependency cycles. The graph excludes self-edges (already
    # reported above, on their own) and dangling refs (already reported
    # above; you cannot walk to a node that doesn't exist, and including
    # one here could mask a real cycle behind it or fabricate a false
    # one) -- both anti-double-reporting rules from the architect's ruling.
    id_to_blocked: Dict[str, List[str]] = {}
    for p, fm in parsed_issues:
        issue_id = fm.get("id")
        if issue_id not in known_ids:
            continue  # id/filename mismatch already reported above
        id_to_blocked[issue_id] = [
            ref for ref in (fm.get("blocked_by") or []) if ref != issue_id and ref in known_ids
        ]
    for cycle in _detect_blocked_by_cycles(id_to_blocked):
        path_str = " -> ".join(cycle + [cycle[0]])
        errors.append(
            f"{cycle[0]}: dependency cycle {path_str} -- an issue cannot "
            f"transitively block itself; break the loop by removing one "
            f"blocked_by entry along that path"
        )

    # PT-52 (architect's ruling § 2): the engine no longer reads the
    # legacy flat archive/*.md layout at all -- this scan is the ONLY
    # remaining reader of it, via legacy_archived_issue_paths (its other
    # caller is allocate_and_create_issue's allocation guard; the two must
    # never disagree about what counts as legacy, or this error becomes
    # unactionable). Under PT-50 this meant "lint fails, everything still
    # works"; it now means "the engine cannot see these files" -- the
    # wording below says that and warns about the cascade (a legacy
    # file's dangling parent/blocked_by/milestone refs surface as
    # SEPARATE errors elsewhere in this list, which read as unrelated
    # unless this one flags the actual cause). POLY-6 gate-1 ruling
    # (section (b)): the fix hint naming the now-deleted
    # `migrate archive-issues` command is gone.
    # Inserted FIRST, not appended: a root cause read after fifteen
    # cascade symptoms gets read last.
    legacy_archived = legacy_archived_issue_paths(data_dir)
    if legacy_archived:
        errors.insert(
            0,
            f"{len(legacy_archived)} archived issue(s) at the legacy archive/*.md layout are NOT read "
            f"by the engine -- invisible to the board, to id allocation, and to reference resolution "
            f"(dangling-reference errors below may be caused by this)."
        )

    # PT-94 D13: the operative docs are linted with the data dir.
    errors.extend(check_docs(data_dir))
    return errors


def _rotate_cycle_to_canonical(cycle: List[str]) -> List[str]:
    """Rotate `cycle` (a list of ids in edge order) so the `_id_sort_key`-
    smallest id leads -- the canonical form for deduping "the same cycle,
    discovered from a different entry point" down to one reported error
    (PT-26). A rotation, never a re-sort: the edge order within the cycle
    is preserved, only the starting point moves.
    """
    smallest_idx = min(range(len(cycle)), key=lambda i: _id_sort_key(cycle[i]))
    return cycle[smallest_idx:] + cycle[:smallest_idx]


def _detect_blocked_by_cycles(id_to_blocked: Dict[str, List[str]]) -> List[List[str]]:
    """Iterative three-colour (white/grey/black) DFS over the blocked_by
    graph. Returns one path per distinct cycle (each on its canonical
    rotation, deduped), in the order discovered.

    Iterative, not recursive, because `check_repo` must never raise on
    user data -- a long enough dependency chain would blow the recursion
    limit. A plain visited set is not enough: it cannot distinguish
    "already fully explored" from "on the current path", and reports a
    false cycle on any reconvergent DAG (two nodes both blocked_by a third,
    unrelated, common ancestor). Grey (on the current path) is the only
    color a real back-edge can land on.

    Callers must pre-filter self-edges and dangling refs out of
    `id_to_blocked` -- this function assumes every edge target is itself a
    key in `id_to_blocked`. Walks roots in `_id_sort_key` order and, within
    each node, neighbours in `blocked_by` order (a plain dict/list walk,
    already in file order) -- deterministic output regardless of
    filesystem iteration order.
    """
    WHITE, GREY, BLACK = 0, 1, 2
    color: Dict[str, int] = {node: WHITE for node in id_to_blocked}
    cycles: List[List[str]] = []
    seen_rotations = set()

    for root in sorted(id_to_blocked, key=_id_sort_key):
        if color[root] != WHITE:
            continue
        color[root] = GREY
        path = [root]
        stack = [iter(id_to_blocked[root])]
        while stack:
            try:
                nxt = next(stack[-1])
            except StopIteration:
                finished = path.pop()
                color[finished] = BLACK
                stack.pop()
                continue
            if color[nxt] == WHITE:
                color[nxt] = GREY
                path.append(nxt)
                stack.append(iter(id_to_blocked[nxt]))
            elif color[nxt] == GREY:
                # Back-edge to a node on the current path -- the slice from
                # its first occurrence to here is the cycle.
                idx = path.index(nxt)
                rotated = _rotate_cycle_to_canonical(path[idx:])
                key = tuple(rotated)
                if key not in seen_rotations:
                    seen_rotations.add(key)
                    cycles.append(rotated)
            # BLACK: already fully explored via another path -- no new info.
    return cycles
