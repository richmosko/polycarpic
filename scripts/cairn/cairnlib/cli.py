"""cairnlib.cli — the generic CLI commands, argparse wiring, and `main`.

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 21). Domain
modules keep their own `cmd_*` handlers (guards: gate/guard-commit/
guard-push; archive; estimate: close/estimate/loop-stats); this module
holds the generic commands, `build_arg_parser`, and `main`.
"""

import argparse
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from cairnlib.constants import DEFAULT_STATUS, ISSUE_FIELD_ORDER, RECORD_STATUSES, STATUSES
from cairnlib.errors import CairnError
from cairnlib.records import LIST_FIELDS, NULLABLE_FIELDS, _atomic_write_bytes, _split_csv, append_comment, apply_patch, checklist_items, parse_frontmatter, parse_issue, split_comments
from cairnlib.config import load_config, resolve_data_dir
from cairnlib.store import _dir_glob, _id_sort_key, _record_schema_for_path, _RECORD_FIELD_ORDER, allocate_and_create_issue, find_issue_path, find_record_path, is_archived_path
from cairnlib.guards import TITLE_CHAR_CAP, check_budgets, cmd_gate, cmd_guard_commit, cmd_guard_push, uncommitted_comment_authors
from cairnlib.lint import check_repo
from cairnlib.snapshot import build_snapshot_markdown
from cairnlib.multiroot import resolve_roots
from cairnlib.server import make_server
from cairnlib.archive import cmd_archive
from cairnlib.estimate import cmd_close, cmd_estimate, cmd_loop_stats

__all__ = [
    "DEFAULT_ISSUE_BODY",
    "ESTIMATION_DECIMAL_FIELDS",
    "ESTIMATION_INT_FIELDS",
    "_coerce_cli_value",
    "_format_checklist_item_line",
    "_line_byte_offsets",
    "_normalize_milestone_input",
    "_print_issue_list",
    "_scan_issues",
    "build_arg_parser",
    "cmd_check",
    "cmd_check_item",
    "cmd_comment",
    "cmd_ls",
    "cmd_new",
    "cmd_serve",
    "cmd_set",
    "cmd_show",
    "cmd_snapshot",
    "main",
]


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


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except CairnError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
