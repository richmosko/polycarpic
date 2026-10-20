"""cairnlib.guards — PT-94 guardrails: budgets, docs lint, gate head-match,
and the foreign-hunk / stray-file commit and push guards.

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 7).
"""

import argparse
import collections
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from cairnlib.errors import CairnError
from cairnlib.records import _description_before_ac, parse_frontmatter, split_comments
from cairnlib.config import _glob_to_regex, resolve_data_dir, validate_path_glob
from cairnlib.store import _dir_glob, find_record_path

__all__ = [
    "COMMENT_LINE_CAP",
    "DOC_LINT_FILES",
    "DOC_PARAGRAPH_SENTENCE_CAP",
    "DOC_PHRASES",
    "ISSUE_SIZE_CAP_BYTES",
    "NAMED_PROCESS_DOCS",
    "TITLE_CHAR_CAP",
    "TRACKER_RECORD_DIRS",
    "_COMMENT_HEADER_RE",
    "_DIFF_COMMENT_HEADER_RE",
    "_DOCS_PREFIXES",
    "_QUOTED_SPAN_RE",
    "_added_comment_authors",
    "_cached_name_status",
    "_doc_paragraphs",
    "_docs_dir",
    "_files_added_by_author",
    "_files_touched_by_author",
    "_git_toplevel",
    "_is_allowed_process_path",
    "_resolve_push_base_ref",
    "_sibling_guard_paths",
    "check_budgets",
    "check_docs",
    "cmd_gate",
    "cmd_guard_commit",
    "cmd_guard_push",
    "gate_head_match",
    "uncommitted_comment_authors",
]

COMMENT_LINE_CAP = 40          # B6: an issue comment over this warns
ISSUE_SIZE_CAP_BYTES = 24 * 1024  # D14: an issue file over this warns
DOC_PARAGRAPH_SENTENCE_CAP = 8    # D13: a TRACKER/WORKFLOW paragraph over this warns
TITLE_CHAR_CAP = 70            # POLY-56 (gate-1 ruling R3): a title over this warns
# D13: instruction-shaped phrases fail the check in the operative docs --
# what to do belongs in the sentence, the persuasion in the ledger.
DOC_PHRASES = ("say why", "state both", "not just", "worth noting", "worth stating",
               "flag it", "flag this", "flag that", "be sure to", "make sure to", "don't forget")
DOC_LINT_FILES = ("TRACKER.md", "WORKFLOW.md")
_COMMENT_HEADER_RE = re.compile(r"^### @(\S+) — (\S+)")
_DIFF_COMMENT_HEADER_RE = re.compile(r"^\+### @(\S+) — ")
_QUOTED_SPAN_RE = re.compile(r"`[^`]*`|\"[^\"]*\"|“[^”]*”")


def _docs_dir(data_dir: Path) -> Path:
    """The operative docs sit one level above the data dir (process/cairn -> process/)."""
    return Path(data_dir).resolve().parent


def _doc_paragraphs(text: str):
    """(first_line_no, paragraph_text) for prose paragraphs -- tables,
    headings, lists, quotes, and fenced code are skipped."""
    lines = text.split("\n")
    i = 0
    in_fence = False
    while i < len(lines):
        if lines[i].lstrip().startswith("```"):
            in_fence = not in_fence
            i += 1
            continue
        if in_fence or not lines[i].strip():
            i += 1
            continue
        start = i
        block = []
        while i < len(lines) and lines[i].strip() and not lines[i].lstrip().startswith("```"):
            block.append(lines[i])
            i += 1
        first = block[0].lstrip()
        if block[0][:1].isspace() or first.startswith(("|", "#", "-", "*", ">", "<")) or re.match(r"^\d+\.", first):
            continue
        yield start + 1, "\n".join(block)


def check_docs(data_dir: Path) -> List[str]:
    """D13 phrase lint on process/TRACKER.md and process/WORKFLOW.md: an
    instruction-shaped phrase outside quotes, code spans, and fences is an
    ERROR. Docs that don't exist are skipped."""
    errors: List[str] = []
    for name in DOC_LINT_FILES:
        p = _docs_dir(data_dir) / name
        if not p.exists():
            continue
        in_fence = False
        for no, line in enumerate(p.read_text(encoding="utf-8").split("\n"), 1):
            if line.lstrip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            bare = _QUOTED_SPAN_RE.sub(" ", line).lower()
            for phrase in DOC_PHRASES:
                if re.search(r"\b" + re.escape(phrase) + r"\b", bare):
                    errors.append(f"{name}:{no}: instruction-shaped phrase \"{phrase}\" -- operative text says what to do; the rationale goes to the ledger")
    return errors


def check_budgets(data_dir: Path) -> List[str]:
    """Warnings, never errors: comments over COMMENT_LINE_CAP lines and
    issue files over ISSUE_SIZE_CAP_BYTES (issues/ only -- archived files
    are frozen history), doc paragraphs over the sentence cap, and (POLY-56
    gate-1 ruling R3) an over-cap title or an empty description on a live,
    open (non-done/cancelled) issue with no `stage:` -- sub-issues carry
    `stage:` and are exempt, the same scope `cairn new`'s own title warning
    has no need to repeat since it only ever sees one new file at a time."""
    warnings: List[str] = []
    data_dir = Path(data_dir)
    for p in _dir_glob(data_dir / "issues"):
        text = p.read_text(encoding="utf-8")
        size = len(text.encode("utf-8"))
        if size > ISSUE_SIZE_CAP_BYTES:
            warnings.append(f"{p.name} is {size / 1024:.1f} KB (cap {ISSUE_SIZE_CAP_BYTES // 1024} KB) -- move review logs to process/cairn/reviews/ or a linked file at the next gate")
        lines = text.split("\n")
        headers = [(i, m) for i, l in enumerate(lines) if (m := _COMMENT_HEADER_RE.match(l))]
        for idx, (i, m) in enumerate(headers):
            end = headers[idx + 1][0] if idx + 1 < len(headers) else len(lines)
            block = lines[i + 1:end]
            while block and not block[-1].strip():
                block.pop()
            while block and not block[0].strip():
                block.pop(0)
            if len(block) > COMMENT_LINE_CAP:
                warnings.append(f"{p.name}: comment by @{m.group(1)} ({m.group(2)}) is {len(block)} lines (cap {COMMENT_LINE_CAP}) -- verdicts as a table, constructions to a review-log file")
        # POLY-3 (design note §1): "a sub-issue with status: done and a
        # stage but no actual.* is a WARNING, not an error" -- it was
        # closed by `cairn set status=done` rather than `cairn close`.
        # POLY-33: keyed on `actual.gate_cycles`, not `actual.tokens` --
        # `cairn close` always writes gate_cycles (0 included), but a
        # legitimate close with no matching token-usage.jsonl line writes
        # actual.tokens: null (design note §2 addendum 1, "no evidence").
        # Keying on tokens made every such close indistinguishable from a
        # `cairn set status=done` close it never was.
        try:
            fm, body = parse_frontmatter(text)
        except CairnError:
            fm, body = {}, ""
        if fm.get("status") == "done" and fm.get("stage") is not None and fm.get("actual.gate_cycles") is None:
            warnings.append(f"{p.name}: status done with stage {fm['stage']!r} but no actual.* -- closed via `cairn set` rather than `cairn close`")
        # POLY-56 (gate-1 ruling R3): title/description lint, scoped to
        # live issues that are still open and are not sub-issue stage
        # records (M5: unscoped, this fires on 24/56 of the 71 issues on
        # disk today; scoped, on 8/8).
        if fm.get("status") not in ("done", "cancelled") and fm.get("stage") is None:
            title = fm.get("title")
            if title is not None and len(title) > TITLE_CHAR_CAP:
                warnings.append(
                    f"{p.name}: title is {len(title)} chars (cap {TITLE_CHAR_CAP}) -- "
                    "short label in the title, substance in the body"
                )
            description, _comments = split_comments(body)
            if _description_before_ac(description).strip() == "":
                warnings.append(
                    f"{p.name}: empty description -- a paragraph before '## Acceptance criteria' says what and why"
                )
    for name in DOC_LINT_FILES:
        doc = _docs_dir(data_dir) / name
        if not doc.exists():
            continue
        for no, para in _doc_paragraphs(doc.read_text(encoding="utf-8")):
            n = len(re.findall(r"[.!?](?:\s|$)", para))
            if n > DOC_PARAGRAPH_SENTENCE_CAP:
                warnings.append(f"{name}:{no}: paragraph has {n} sentences (cap {DOC_PARAGRAPH_SENTENCE_CAP})")
    return warnings


_DOCS_PREFIXES = ("process/", "docs/", "temp/")


def gate_head_match(repo_root: Path, verified_sha: str) -> Tuple[bool, List[str], str]:
    """C8: what changed between the verified sha and HEAD. Passes when every
    changed path is docs or tracker (process/, docs/, temp/, or *.md).
    Returns (ok, changed_paths, diff_stat)."""
    rng = f"{verified_sha}..HEAD"
    changed = [l for l in subprocess.run(["git", "diff", "--name-only", rng], cwd=repo_root, capture_output=True, text=True, check=True).stdout.split("\n") if l]
    stat = subprocess.run(["git", "diff", "--stat", rng], cwd=repo_root, capture_output=True, text=True, check=True).stdout
    ok = all(p.startswith(_DOCS_PREFIXES) or p.endswith(".md") for p in changed)
    return ok, changed, stat


def cmd_gate(args: argparse.Namespace) -> int:
    root = _git_toplevel(Path.cwd())
    if root is None:
        print("error: not inside a git repository", file=sys.stderr)
        return 1
    try:
        ok, changed, stat = gate_head_match(root, args.head)
    except subprocess.CalledProcessError as e:
        print(f"error: git diff failed: {e.stderr.strip()}", file=sys.stderr)
        return 1
    print(stat.rstrip() or "(no changes)")
    non_docs = [p for p in changed if not (p.startswith(_DOCS_PREFIXES) or p.endswith(".md"))]
    if ok:
        print(f"PASS: {args.head[:7]}..HEAD is docs/tracker only ({len(changed)} path(s)); the verified code is at HEAD")
        return 0
    print(f"FAIL: {len(non_docs)} non-docs path(s) changed since {args.head[:7]}: " + ", ".join(non_docs))
    return 1


def _git_toplevel(start: Path) -> Optional[Path]:
    try:
        out = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=start, capture_output=True, text=True, check=True).stdout.strip()
    except (subprocess.CalledProcessError, OSError):
        return None
    return Path(out) if out else None


def _added_comment_authors(diff_text: str) -> Set[str]:
    return {m.group(1) for l in diff_text.split("\n") if (m := _DIFF_COMMENT_HEADER_RE.match(l))}


def _cached_name_status(root: Path, env: Optional[Dict[str, str]] = None) -> List[Tuple[str, Optional[str], str]]:
    """`git diff --cached -M --name-status -z`, parsed. `-z` NUL-splits
    fields so a path containing a space still parses; a rename entry
    carries (status, src, dst), everything else (status, None, dst)."""
    raw = subprocess.run(
        ["git", "diff", "--cached", "-M", "--name-status", "-z"],
        cwd=root, capture_output=True, text=True, env=env,
    ).stdout
    fields = raw.split("\0")
    if fields and fields[-1] == "":
        fields = fields[:-1]
    entries: List[Tuple[str, Optional[str], str]] = []
    i = 0
    while i < len(fields):
        status = fields[i]
        if status.startswith(("R", "C")):
            entries.append((status, fields[i + 1], fields[i + 2]))
            i += 3
        else:
            entries.append((status, None, fields[i + 1]))
            i += 2
    return entries


def uncommitted_comment_authors(path: Path) -> Set[str]:
    """Authors of comment headers the working tree adds over HEAD for
    `path`. Empty outside a git repo or for an untracked file."""
    path = Path(path)
    root = _git_toplevel(path.parent)
    if root is None:
        return set()
    r = subprocess.run(["git", "diff", "HEAD", "--", str(path)], cwd=root, capture_output=True, text=True)
    if r.returncode != 0:
        return set()
    return _added_comment_authors(r.stdout)


def cmd_guard_commit(args: argparse.Namespace) -> int:
    """`cairn guard-commit` (E15, the pre-commit hook's body): refuse when a
    staged tracker file adds comments by more than one author -- someone
    else's uncommitted hunk is riding in this commit.

    PT-109 (architect's ruling, PT-109.md @ 6831854): a `cairn archive`
    move (`issues/X.md` -> `archive/issues/X.md`, a real `git mv`) used to
    diff as 100% added lines with no rename detection, so every
    HISTORICAL comment author tripped this guard. One `git diff --cached
    -M --name-status -z` call enumerates staged entries (`-z`/NUL-split
    so a path containing a space still parses correctly -- name-status
    without it is whitespace-ambiguous); a rename entry's plain
    `--name-status` line names only the destination, so the source has to
    come from the SAME `-M` call, not a second lookup. Every `R` entry
    -- no branch on the similarity number, R100 (pure) and a partial
    rename are handled identically -- is diffed as `git diff --cached -M
    -- <src> <dst>`, which shows only the genuinely changed hunk between
    the two paths; a pure rename shows none, so no historical author
    counts as newly added.

    `git commit -m ... -- <dest-only-pathspec>` (the actual shape of a
    real archive commit) runs the pre-commit hook against a TEMPORARY,
    pathspec-restricted index (`$GIT_INDEX_FILE` pointed at a
    `next-index-*.lock`, not the real one) that holds only the
    destination's addition -- the source's deletion never lands in it,
    so `-M` has nothing to pair and the entry reports as a plain `A`
    even for a pure rename (measured: reproduced against a real `git
    commit -- <dest>` pre-commit invocation). A blanket "drop
    `GIT_INDEX_FILE` everywhere" over-corrects: a pathspec commit on a
    file that was never `git add`-ed at all stages it ONLY into that same
    temporary index (git's own doing, not ours) -- the real index has
    nothing for it, so ignoring the hook's index there would silently
    pass a genuine two-author violation (measured, PreCommitHookTests).
    So: enumerate with the hook's OWN index (respects that implicit
    staging), and for exactly the `A` entries, cross-reference the REAL
    index's own `-M` pairing (`GIT_INDEX_FILE` dropped only for this
    second, read-only lookup) to recover the dst -> src rename map that
    index alone can see. A cross-referenced `A` is diffed as a content
    comparison -- the dst's currently-staged headers (`git show :dst`,
    the hook's own index) minus the src's headers at HEAD -- since `-M`
    still can't pair src and dst within the hook's own restricted
    index."""
    root = _git_toplevel(Path.cwd())
    if root is None:
        return 0
    entries = _cached_name_status(root)

    rename_of: Dict[str, str] = {}
    if any(status == "A" for status, _, _ in entries):
        real_env = dict(os.environ)
        real_env.pop("GIT_INDEX_FILE", None)
        for status, src, dst in _cached_name_status(root, env=real_env):
            if status.startswith("R") and src is not None:
                rename_of[dst] = src

    bad = []
    for status, src, dst in entries:
        if not dst.endswith(".md") or "/cairn/" not in ("/" + dst):
            continue
        if status.startswith("R"):
            diff = subprocess.run(["git", "diff", "--cached", "-M", "--", src, dst], cwd=root, capture_output=True, text=True).stdout
            authors = _added_comment_authors(diff)
        elif status == "A" and dst in rename_of:
            dst_content = subprocess.run(["git", "show", f":{dst}"], cwd=root, capture_output=True, text=True).stdout
            src_content = subprocess.run(["git", "show", f"HEAD:{rename_of[dst]}"], cwd=root, capture_output=True, text=True).stdout
            # PT-109 gate-4 verdict (5a680b1): a set difference over
            # author NAMES lets an author already present anywhere in
            # the file add unlimited fresh comments without registering
            # as added. Diff the raw multiset of header LINES, aggregate
            # into authors only after.
            dst_headers = [l for l in dst_content.split("\n") if _COMMENT_HEADER_RE.match(l)]
            src_headers = [l for l in src_content.split("\n") if _COMMENT_HEADER_RE.match(l)]
            surplus = collections.Counter(dst_headers) - collections.Counter(src_headers)
            authors = {_COMMENT_HEADER_RE.match(l).group(1) for l in surplus.elements()}
        else:
            diff = subprocess.run(["git", "diff", "--cached", "--", dst], cwd=root, capture_output=True, text=True).stdout
            authors = _added_comment_authors(diff)
        if len(authors) > 1:
            bad.append((dst, sorted(authors)))
    if not bad:
        return 0
    for rel, authors in bad:
        print(f"guard-commit: {rel} stages comments by {', '.join('@' + a for a in authors)} -- a pathspec commit carries every uncommitted hunk in the file; commit your own comment only (the other author commits theirs)", file=sys.stderr)
    return 1


def _resolve_push_base_ref(root: Path) -> Optional[str]:
    """`origin/main` if it resolves, else local `main`, else `None`
    (POLY-2, architect's gate-1 ruling § 1). Checked with `git rev-parse
    --verify --quiet`, which exits non-zero -- never raises -- on an
    unresolvable ref, so a repo with no `origin` remote or no local
    `main` falls through cleanly to the next candidate / to `None`."""
    for ref in ("origin/main", "main"):
        result = subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", ref],
            cwd=root, capture_output=True, text=True,
        )
        if result.returncode == 0:
            return ref
    return None


def _files_touched_by_author(root: Path, base: str, assignee: str) -> Set[str]:
    """Files changed by commits authored by `assignee` (git `%an`, exact
    match) in `base..HEAD` -- `--no-merges` (a merge of `main` into the
    feature branch must never count, POLY-2 ruling § 1) and `--no-renames`
    (both sides of a rename are listed, ruling § 3). Deletions count as
    touches -- `--name-only`'s default diff-filter already includes them.

    The git log format is `%x01%an` -- a `\\x01`-prefixed author name --
    rather than the ruling's literal `%an`: with a bare `%an`, two
    adjacent commits whose bodies are empty print with NO blank line
    between the first commit's file list and the second commit's author
    line (measured), so a plain per-line state machine can't tell an
    author name from a same-shaped file path. `\\x01` never appears in a
    git author name or a repo-relative path, so splitting the raw stdout
    on it recovers the exact same author -> files mapping the ruling's
    command produces, unambiguously.
    """
    result = subprocess.run(
        ["git", "log", "--no-merges", "--no-renames", "--format=%x01%an", "--name-only", f"{base}..HEAD"],
        cwd=root, capture_output=True, text=True, check=True,
    )
    files: Set[str] = set()
    for block in result.stdout.split("\x01"):
        if not block:
            continue
        lines = block.split("\n")
        author = lines[0]
        if author != assignee:
            continue
        # lines[1] is the mandatory blank line git emits between the
        # format output and the --name-only file list; real filenames
        # start at lines[2].
        for line in lines[2:]:
            if line:
                files.add(line)
    return files


# POLY-80 (Principal's ruling, 2026-09-28, principle 3): "a hand-off is never
# committed" -- a genuinely NEW file under process/ that is neither a tracker
# record nor one of the named process docs is exactly a hand-off (a
# construction, harness output, retro prose) that leaked onto the shared
# branch instead of staying in the sender's own gitignored temp/. Tracker
# records: process/cairn/{issues,milestones,majors,archive,reviews}/ -- the
# same five subdirectories `cairn`'s own store code reads/writes, plus
# `reviews` (this ruling's own new one). Named docs: the fixed set every
# process/ file that ISN'T a tracker record is allowed to be.
TRACKER_RECORD_DIRS = ("issues", "milestones", "majors", "archive", "reviews")
NAMED_PROCESS_DOCS = frozenset({
    "process/WORKFLOW.md",
    "process/TRACKER.md",
    "process/STATE.md",
    "process/DECISIONS.md",
    "process/cairn/config.yml",
})


def _is_allowed_process_path(path: str) -> bool:
    """True if `path` is not under `process/` at all, or is one of the
    tracker-record subdirectories / named docs POLY-80 allow-lists. False
    is the "this looks like a leaked hand-off" verdict."""
    if not path.startswith("process/"):
        return True
    if path in NAMED_PROCESS_DOCS:
        return True
    prefix = "process/cairn/"
    if path.startswith(prefix):
        rest = path[len(prefix):]
        return any(rest == d or rest.startswith(d + "/") for d in TRACKER_RECORD_DIRS)
    return False


def _files_added_by_author(root: Path, base: str, assignee: str) -> Set[str]:
    """Like `_files_touched_by_author`, but only files a commit authored by
    `assignee` ADDED (git `--name-status` filter `A`) in `base..HEAD` --
    POLY-80's principle-3 guard cares about a new file appearing, not an
    existing allowed one being edited. `--no-merges --no-renames`, same
    rationale as the sibling function; the same `\\x01`-prefixed-author
    format sidesteps the same empty-commit-body ambiguity."""
    result = subprocess.run(
        ["git", "log", "--no-merges", "--no-renames", "--format=%x01%an", "--name-status", f"{base}..HEAD"],
        cwd=root, capture_output=True, text=True, check=True,
    )
    files: Set[str] = set()
    for block in result.stdout.split("\x01"):
        if not block:
            continue
        lines = block.split("\n")
        author = lines[0]
        if author != assignee:
            continue
        for line in lines[2:]:
            if line.startswith("A\t"):
                files.add(line[2:])
    return files


def _sibling_guard_paths(data_dir: Path, issue_id: str, parent: str, assignee: str) -> List[str]:
    """POLY-48 item 6 (guard-push same-assignee scope, gate-1 ruling
    process/cairn/reviews/POLY-48/ruling.md §1(c)): the `paths:` globs of every OTHER
    live issue sharing this one's `parent` and `assignee` (any stage, any
    status) -- unioned into the caller's own allowed set, so the second
    same-assignee sub-issue under one parent doesn't trip on the first
    one's already-pushed files. Rejected alternative: time-scoping to a
    sibling's close (`window.to`) -- that lives in the metrics worktree
    mount, which a teammate worktree doesn't have.

    A sibling's own malformed `paths:` raises `CairnError` naming that
    sibling (the same validation the caller already runs on its own
    `paths:`), letting `cmd_guard_push` turn it into an exit-2 line
    without silently dropping the sibling's globs.
    """
    globs: List[str] = []
    for p in _dir_glob(Path(data_dir) / "issues"):
        if p.stem == issue_id:
            continue
        try:
            sib_fm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        except CairnError:
            continue
        if sib_fm.get("parent") != parent or sib_fm.get("assignee") != assignee:
            continue
        sib_paths = sib_fm.get("paths")
        if sib_paths is None:
            continue
        if not isinstance(sib_paths, list):
            raise CairnError(f"{p.stem}'s paths: must be a list, got {type(sib_paths).__name__}")
        for idx, entry in enumerate(sib_paths):
            ok, reason = validate_path_glob(entry)
            if not ok:
                raise CairnError(f"{p.stem}'s paths[{idx}] {entry!r} invalid -- {reason}")
        globs.extend(sib_paths)
    return globs


def cmd_guard_push(args: argparse.Namespace) -> int:
    """`cairn guard-push <ID>` (POLY-2, architect's gate-1 ruling): fails
    loudly when the ISSUE'S ASSIGNEE's own commits between the branch
    base and HEAD touch a file outside that issue's declared `paths:`,
    UNIONED with the `paths:` of every other same-parent, same-assignee
    sibling (POLY-48 item 6) -- top-level issues (no `parent`) are
    unchanged, since there is no sibling set to union. Keys on the
    issue's assignee, never on the invoking identity -- this is what lets
    the lead run it from the main checkout as a valid audit of a
    teammate's commits.

    Exit codes: 0 pass (including every opt-out case below), 1 stray
    files found (each listed on its own stderr line, sorted), 2 usage/
    config error (unknown id, unresolvable base, `paths:` set with a null
    assignee -- there is nothing to attribute commits to -- or a
    sibling's own `paths:` malformed).
    """
    data_dir = resolve_data_dir(args)
    path = find_record_path(data_dir, args.id)
    if path is None:
        print(f"guard-push: no such record: {args.id}", file=sys.stderr)
        return 2
    fm, _ = parse_frontmatter(path.read_text(encoding="utf-8"))
    paths_val = fm.get("paths")
    assignee = fm.get("assignee")
    parent = fm.get("parent")

    if paths_val is None:
        print(f"guard-push: {args.id} has no paths: declared -- warn-only, not enforced", file=sys.stderr)
        return 0
    # Architect's gate-4 verdict (defect B, POLY-2.md @ c311ae7): a
    # malformed `paths:` (a scalar string -- iterated character by
    # character -- or a non-string entry, which raises) must never be
    # indistinguishable from a real stray-file failure (exit 1). Validated
    # here, before any matcher is built, so a config error always exits 2.
    if not isinstance(paths_val, list):
        print(f"guard-push: {args.id}'s paths: must be a list, got {type(paths_val).__name__}", file=sys.stderr)
        return 2
    for idx, entry in enumerate(paths_val):
        ok, reason = validate_path_glob(entry)
        if not ok:
            print(f"guard-push: {args.id}'s paths[{idx}] {entry!r} invalid -- {reason}", file=sys.stderr)
            return 2
    if assignee is None:
        print(f"guard-push: {args.id} has paths: declared but assignee: null -- cannot attribute commits", file=sys.stderr)
        return 2
    if assignee.startswith("@"):
        print(f"guard-push: {args.id} assignee {assignee} is human -- not under the protocol", file=sys.stderr)
        return 0

    allowed_globs = list(paths_val)
    if parent is not None:
        try:
            allowed_globs += _sibling_guard_paths(data_dir, args.id, parent, assignee)
        except CairnError as e:
            print(f"guard-push: {e}", file=sys.stderr)
            return 2

    root = _git_toplevel(Path.cwd())
    if root is None:
        print("guard-push: not inside a git repository", file=sys.stderr)
        return 2
    base_ref = _resolve_push_base_ref(root)
    if base_ref is None:
        print("guard-push: cannot resolve origin/main or main as a base ref", file=sys.stderr)
        return 2
    merge_base = subprocess.run(["git", "merge-base", base_ref, "HEAD"], cwd=root, capture_output=True, text=True)
    if merge_base.returncode != 0:
        print(f"guard-push: cannot compute merge-base against {base_ref}: {merge_base.stderr.strip()}", file=sys.stderr)
        return 2
    base = merge_base.stdout.strip()

    # POLY-80 principle 3, unconditional (not scoped to this issue's own
    # `paths:`): a NEW file this assignee added under process/ that is
    # neither a tracker record nor a named process doc is a hand-off that
    # leaked onto the shared branch -- refused regardless of whether it
    # happens to fall inside the issue's declared paths, since a `paths:`
    # glob like `process/cairn/**` was never meant to license an arbitrary
    # new file the moment it's a prefix match.
    added = _files_added_by_author(root, base, assignee)
    leaked = sorted(f for f in added if not _is_allowed_process_path(f))
    failed = False
    for f in leaked:
        print(
            f"guard-push: {f} is a new file under process/ that is not a tracker record "
            f"(process/cairn/{{issues,milestones,majors,archive,reviews}}/) or a named process doc "
            f"(WORKFLOW.md, TRACKER.md, STATE.md, DECISIONS.md, cairn/config.yml) -- hand-offs go in "
            f"temp/, never committed",
            file=sys.stderr,
        )
        failed = True

    touched = _files_touched_by_author(root, base, assignee)
    if touched:
        matchers = [_glob_to_regex(p) for p in allowed_globs]
        stray = sorted(f for f in touched if not any(m.match(f) for m in matchers) and f not in leaked)
        for f in stray:
            print(f, file=sys.stderr)
            failed = True

    return 1 if failed else 0
