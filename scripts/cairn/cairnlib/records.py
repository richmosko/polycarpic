"""cairnlib.records — frontmatter fences + comment-log splitting, and
frontmatter-only write-back (byte-preserving body).

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 4).
"""

import os
import re
import stat
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from cairnlib.constants import AC_HEADING_RE, COMMENTS_HEADING_RE, COMMENT_DELIM_RE, ISSUE_FIELD_ORDER, _CHECKLIST_ITEM_RE, _today
from cairnlib.errors import FrontmatterError
from cairnlib.yamlsub import parse_yaml_subset

__all__ = [
    "LIST_FIELDS",
    "NULLABLE_FIELDS",
    "_BARE_RESERVED",
    "_NUMERIC_LOOKING_RE",
    "_atomic_write",
    "_atomic_write_bytes",
    "_description_before_ac",
    "_dump_value",
    "_is_issue_shaped",
    "_needs_quoting",
    "_quote",
    "_split_csv",
    "append_comment",
    "apply_patch",
    "checklist_items",
    "dump_frontmatter",
    "get_seen",
    "parse_frontmatter",
    "parse_issue",
    "split_comments",
]


def parse_frontmatter(text: str) -> Tuple[Dict[str, Any], str]:
    """Split a whole issue/milestone/major file into (frontmatter, body).

    Requires the first line to be exactly '---' and a later line to be
    exactly '---'. `body` is everything after the closing fence's newline,
    byte-for-byte (well, char-for-char post-decode).
    """
    if not text.startswith("---"):
        raise FrontmatterError("file must start with a '---' frontmatter delimiter")
    lines = text.split("\n")
    if lines[0] != "---":
        raise FrontmatterError("file must start with a '---' frontmatter delimiter")
    end_idx = None
    for i in range(1, len(lines)):
        if lines[i] == "---":
            end_idx = i
            break
    if end_idx is None:
        raise FrontmatterError("no closing '---' frontmatter delimiter found")
    fm_text = "\n".join(lines[1:end_idx])
    body = "\n".join(lines[end_idx + 1:])
    frontmatter = parse_yaml_subset(fm_text)
    return frontmatter, body


def split_comments(body: str) -> Tuple[str, List[Dict[str, str]]]:
    """Split an issue body on the first '^## Comments$' line.

    Returns (pre_comments_text, comments). Each comment is
    {"author": str, "date": "YYYY-MM-DD", "body": str}, oldest first.
    No '## Comments' heading -> (body, []).

    Spec-literal, no fence exception: "a new comment starts at a line
    matching exactly <COMMENT_DELIM_RE>; any other line is body content."
    A line inside a ```-fenced block that happens to match the delimiter
    shape IS a real boundary, full stop — fence-tracking was tried and
    reverted (architect conformance review, finding 4): it silently
    swallowed every comment after an *unclosed* fence for the rest of the
    file, an unbounded and invisible failure far worse than the one
    mis-split comment it was guarding against.
    """
    lines = body.split("\n")
    heading_idx = None
    for i, line in enumerate(lines):
        if COMMENTS_HEADING_RE.match(line):
            heading_idx = i
            break
    if heading_idx is None:
        return body, []

    pre = "\n".join(lines[:heading_idx])
    comment_lines = lines[heading_idx + 1:]
    comments: List[Dict[str, str]] = []
    current: Optional[Dict[str, str]] = None
    acc: List[str] = []
    for line in comment_lines:
        m = COMMENT_DELIM_RE.match(line)
        if m:
            if current is not None:
                current["body"] = "\n".join(acc).strip("\n")
                comments.append(current)
            current = {"author": m.group(1), "date": m.group(2)}
            acc = []
        else:
            if current is not None:
                acc.append(line)
    if current is not None:
        current["body"] = "\n".join(acc).strip("\n")
        comments.append(current)
    return pre, comments


def parse_issue(text: str) -> Dict[str, Any]:
    """Merge frontmatter + description + comments into one flat dict."""
    frontmatter, body = parse_frontmatter(text)
    description, comments = split_comments(body)
    issue = dict(frontmatter)
    issue["description"] = description
    issue["comments"] = comments
    return issue


def checklist_items(description: str) -> List[Dict[str, Any]]:
    """`- [ ]`/`- [x]` rows under the first `## Acceptance criteria` heading
    in `description` (the pre-`## Comments` half `split_comments` already
    cut -- items under Comments are never seen, same as before POLY-56).

    Returns `[{ordinal, text, checked, line}]`, oldest-first, `ordinal`
    1-based and `line` the 0-based index of that row within
    `description.split("\\n")` -- the SAME index a caller gets by splitting
    the containing issue's `body` the identical way, since `description` is
    always body's own leading slice (POLY-56 gate-1 ruling R1/R2: this is
    what lets cmd_check_item locate a row's byte offset without a second,
    diverging split).

    No `## Acceptance criteria` heading -> `[]`. Column 0 only -- an
    indented/nested `- [ ]` under a real item is not counted.
    """
    lines = (description or "").split("\n")
    heading_idx = None
    for i, line in enumerate(lines):
        if AC_HEADING_RE.match(line):
            heading_idx = i
            break
    if heading_idx is None:
        return []
    items: List[Dict[str, Any]] = []
    ordinal = 0
    for i in range(heading_idx + 1, len(lines)):
        m = _CHECKLIST_ITEM_RE.match(lines[i])
        if not m:
            continue
        ordinal += 1
        items.append({
            "ordinal": ordinal,
            "text": m.group(2),
            "checked": m.group(1).lower() == "x",
            "line": i,
        })
    return items


def _description_before_ac(description: str) -> str:
    """`description`, cut at the first `## Acceptance criteria` heading --
    the JS drawer's `splitAcceptanceCriteria` description half, re-expressed
    here for `check_budgets`' empty-description lint (POLY-56 R3). No
    heading -> `description` unchanged."""
    lines = (description or "").split("\n")
    for i, line in enumerate(lines):
        if AC_HEADING_RE.match(line):
            return "\n".join(lines[:i])
    return description or ""


# --------------------------------------------------------------------------
# Write-back: frontmatter-only rewrite, byte-preserving body
# --------------------------------------------------------------------------

_NUMERIC_LOOKING_RE = re.compile(r"^-?\d+(\.\d+)?$")
_BARE_RESERVED = {"null", "~", "true", "false"}


def _needs_quoting(s: str) -> bool:
    if s == "":
        return True
    if s in _BARE_RESERVED:
        return True
    if _NUMERIC_LOOKING_RE.match(s):
        return True
    if s != s.strip():
        return True
    if s[0] in "[]{}&*!|>#'\"":
        return True
    if s.startswith("- "):
        return True
    return False


def _quote(s: str) -> str:
    escaped = s.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _dump_value(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, list):
        return "[" + ", ".join(_dump_value(v) for v in value) + "]"
    s = str(value)
    return _quote(s) if _needs_quoting(s) else s


def _is_issue_shaped(fields: Dict[str, Any]) -> bool:
    """True if `fields` matches the issue schema.

    `title` is required on every issue (TRACKER.md) and absent from both
    the milestone and major schemas — the cheapest reliable signal to tell
    "this is an issue frontmatter dict" from "this is some other schema
    dump_frontmatter/apply_patch got called on" (PT-13). Non-issue-shaped
    dicts keep their own field order untouched and never get an `updated`
    key injected — that field belongs to the issue schema only.
    """
    return "title" in fields


def dump_frontmatter(fields: Dict[str, Any]) -> str:
    """Render `fields` as a '---\\n...---\\n' block.

    Emits keys actually present in `fields` — never synthesizes an absent
    one. For issue-shaped `fields` (has a `title` key): ISSUE_FIELD_ORDER's
    keys lead in their canonical order, then any remaining (non-issue-
    schema) keys in their original insertion order — this is what lets a
    hand-added unknown field round-trip intact instead of being silently
    dropped (architect conformance review, finding 1). For a milestone/
    major file's entirely different schema (no `title` key), field order
    is left exactly as given — the reordering above is an issue-schema-only
    convention, not something to impose on a different schema (PT-13).
    """
    if not _is_issue_shaped(fields):
        lines = [f"{key}: {_dump_value(fields[key])}" for key in fields]
        return "---\n" + "\n".join(lines) + "\n---\n"
    canonical = [key for key in ISSUE_FIELD_ORDER if key in fields]
    extra = [key for key in fields.keys() if key not in ISSUE_FIELD_ORDER]
    lines = [f"{key}: {_dump_value(fields[key])}" for key in canonical + extra]
    return "---\n" + "\n".join(lines) + "\n---\n"


def _atomic_write(path: Path, text: str) -> None:
    """Write `text` to `path` via a same-directory temp file + os.replace.

    Preserves the original file's mode (PT-7): `os.replace` is a rename,
    so the final file's permission bits come from the *source* -- without
    an explicit chmod, mkstemp's 0600 default silently replaces whatever
    mode the file had (e.g. 0644 -> 0600) on every frontmatter rewrite.
    """
    path = Path(path)
    try:
        original_mode = stat.S_IMODE(path.stat().st_mode)
    except FileNotFoundError:
        original_mode = None
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        if original_mode is not None:
            os.chmod(tmp_name, original_mode)
        os.replace(tmp_name, str(path))
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    """The binary sibling of `_atomic_write` (POLY-56 gate-1 ruling R2):
    same same-directory temp file + `os.replace` + mode-preservation
    discipline, but `wb` instead of text mode -- `cmd_check_item`'s one-byte
    rewrite must never go through a newline-translating write, which is
    exactly the mutation the CRLF round-trip test is pinned to catch.
    """
    path = Path(path)
    try:
        original_mode = stat.S_IMODE(path.stat().st_mode)
    except FileNotFoundError:
        original_mode = None
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        if original_mode is not None:
            os.chmod(tmp_name, original_mode)
        os.replace(tmp_name, str(path))
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def get_seen(path: Path) -> str:
    """The `seen` mtime token for `path`: st_mtime_ns as a string."""
    return str(Path(path).stat().st_mtime_ns)


NULLABLE_FIELDS = (
    "milestone", "assignee", "parent", "priority", "pr",
    # PT-51 §3: the record schema's own "(text, nullable)" board-editable
    # fields (milestone target_tag; major owner/target_ship) -- same "" ->
    # None coercion the issue fields above already get, same mechanism
    # (apply_patch is the one place both schemas funnel through), just
    # extended to cover the record-only field names. Safe to share one
    # tuple: none of these three names collides with an issue field.
    "target_tag", "owner", "target_ship",
)

# PT-26: list-valued fields never join NULLABLE_FIELDS -- clearing one
# writes `[]`, never `null` (labels already worked this way; blocked_by
# follows the same precedent). The list branch in _coerce_cli_value must
# be checked *before* the nullable branch for exactly this reason.
#
# POLY-2 (architect's gate-1 ruling § 4): `paths` joins this tuple so
# `--paths a,b` (cmd_new) and `paths=a,b` (cmd_set) share `_split_csv`
# rather than a third copy of the same comma-split. `paths=` (empty
# string) coerces to `[]` -- explicit "may touch nothing" -- same as
# labels/blocked_by already do; an ABSENT `paths:` key (never set at
# all) is a different state, "undeclared", and is never produced by this
# path -- only `cmd_new` omitting `--paths` entirely produces it.
LIST_FIELDS = ("labels", "blocked_by", "paths")


def _split_csv(value: str) -> List[str]:
    """Comma-split `value` into a list, stripping whitespace and dropping
    empty segments -- the shared helper behind both --labels/--blocked-by
    (cmd_new) and labels=/blocked_by= (cmd_set's _coerce_cli_value). One
    function, not two copies of the same comprehension (PT-26: cmd_new
    carried a pre-existing duplicate of _coerce_cli_value's labels split --
    the standing duplicated-inline-expression criterion, fixed here rather
    than adding a third copy for blocked_by).
    """
    return [v.strip() for v in value.split(",") if v.strip()]


def apply_patch(path: Path, patch: Dict[str, Any]) -> Dict[str, Any]:
    """Merge `patch` into `path`'s frontmatter and rewrite it in place.

    On issue-shaped files (has a `title` key), sets `updated` to today
    unless `patch` supplies it explicitly. `updated` belongs to the issue
    schema only — a milestone/major file never gets it injected (PT-13).
    Body bytes after the closing fence are untouched. Returns the new
    frontmatter dict.

    Coerces `""` -> `None` for the five nullable fields (milestone,
    assignee, parent, priority, pr): clearing a field — via the CLI
    (`cairn set PT-1 milestone=`) or the board's inline drawer editors —
    must write `null`, not an empty string. This is the durable place for
    the fix: both entry points funnel through here (architect conformance
    review, finding 2), so an empty string never reaches disk regardless
    of caller.
    """
    path = Path(path)
    text = path.read_text(encoding="utf-8")
    frontmatter, body = parse_frontmatter(text)
    coerced_patch = dict(patch)
    for field in NULLABLE_FIELDS:
        if field in coerced_patch and coerced_patch[field] == "":
            coerced_patch[field] = None
    is_issue = _is_issue_shaped(frontmatter)
    frontmatter.update(coerced_patch)
    if is_issue and "updated" not in patch:
        frontmatter["updated"] = _today()
    new_text = dump_frontmatter(frontmatter) + body
    _atomic_write(path, new_text)
    return frontmatter


def append_comment(path: Path, author: str, body: str, comment_date: Optional[str] = None) -> Dict[str, Any]:
    """Append one comment to the tail of `path` (adding a '## Comments'
    heading first if absent), and bump `updated` to today -- issue-shaped
    files only. Returns the new frontmatter dict.

    PT-51 §4 prerequisite: gated on `_is_issue_shaped`, the same guard
    `apply_patch` already uses. Records (milestone/major) have no
    `updated` field in their schema (PT-13) -- an unconditional bump
    would inject an off-schema key the first time anyone comments on one,
    which `dump_frontmatter`'s non-issue branch would then faithfully
    (and wrongly) emit forever after.
    """
    path = Path(path)
    text = path.read_text(encoding="utf-8")
    frontmatter, file_body = parse_frontmatter(text)
    date_str = comment_date or _today()
    comment_block = f"### @{author} — {date_str}\n\n{body.strip()}\n"

    has_heading = any(COMMENTS_HEADING_RE.match(l) for l in file_body.split("\n"))
    new_body = file_body
    if not new_body.endswith("\n"):
        new_body += "\n"
    if not new_body.endswith("\n\n"):
        new_body += "\n"
    if has_heading:
        new_body += comment_block
    else:
        new_body += "## Comments\n\n" + comment_block

    if _is_issue_shaped(frontmatter):
        frontmatter["updated"] = _today()
    new_text = dump_frontmatter(frontmatter) + new_body
    _atomic_write(path, new_text)
    return frontmatter
