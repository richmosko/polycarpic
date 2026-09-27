"""cairnlib.yamlsub — strict-subset, fenceless YAML parser (operates on a
frontmatter block's inner text, or a whole file like config.yml that has
no '---' fences).

Supports: top-level and one-level-nested mappings, block lists of scalars,
flow lists (`[a, b]`), single/double-quoted strings (always str), bare
scalars (bare true/false -> bool, bare integers -> int, bare null/~ ->
None, anything else bare -> str), and trailing `# comment` text.

Rejects (raises YamlError): anchors (&x), aliases (*x), tags (!!str),
flow mappings ({a: b}), block scalars (| or >), tabs in indentation,
duplicate keys, list items shaped like mappings, and nesting deeper than
one level. One parser, one behaviour.

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 3).
"""

import re
from typing import Any, Dict, List, Tuple

from cairnlib.errors import YamlError

__all__ = [
    "_LIST_MAPPING_ITEM_RE",
    "_MAPPING_LINE_RE",
    "_line_indent",
    "_parse_scalar",
    "_split_flow",
    "_strip_inline_comment",
    "parse_yaml_subset",
]


def _strip_inline_comment(s: str) -> str:
    """Strip a trailing ` # comment`, respecting simple quoted strings."""
    in_dq = False
    in_sq = False
    i = 0
    while i < len(s):
        c = s[i]
        if c == '"' and not in_sq:
            in_dq = not in_dq
        elif c == "'" and not in_dq:
            in_sq = not in_sq
        elif c == "#" and not in_dq and not in_sq and (i == 0 or s[i - 1] in " \t"):
            return s[:i].rstrip()
        i += 1
    return s.rstrip()


def _split_flow(inner: str) -> List[str]:
    items: List[str] = []
    depth = 0
    in_dq = False
    in_sq = False
    cur: List[str] = []
    for c in inner:
        if c == '"' and not in_sq:
            in_dq = not in_dq
            cur.append(c)
        elif c == "'" and not in_dq:
            in_sq = not in_sq
            cur.append(c)
        elif c == "[" and not in_dq and not in_sq:
            depth += 1
            cur.append(c)
        elif c == "]" and not in_dq and not in_sq:
            depth -= 1
            cur.append(c)
        elif c == "," and depth == 0 and not in_dq and not in_sq:
            items.append("".join(cur))
            cur = []
        else:
            cur.append(c)
    if cur:
        items.append("".join(cur))
    return [i.strip() for i in items]


def _parse_scalar(raw: str, ctx: str) -> Any:
    raw = raw.strip()
    if raw == "":
        return None
    if raw[0] == '"':
        if len(raw) < 2 or raw[-1] != '"':
            raise YamlError(f"{ctx}: unterminated double-quoted string: {raw!r}")
        return raw[1:-1].replace('\\"', '"').replace("\\\\", "\\")
    if raw[0] == "'":
        if len(raw) < 2 or raw[-1] != "'":
            raise YamlError(f"{ctx}: unterminated single-quoted string: {raw!r}")
        return raw[1:-1]
    if raw in ("null", "~"):
        return None
    if raw == "true":
        return True
    if raw == "false":
        return False
    if re.match(r"^-?\d+$", raw):
        return int(raw)
    if raw.startswith("["):
        if not raw.endswith("]"):
            raise YamlError(f"{ctx}: malformed flow list: {raw!r}")
        inner = raw[1:-1].strip()
        if inner == "":
            return []
        return [_parse_scalar(item, ctx) for item in _split_flow(inner)]
    if raw.startswith("{"):
        raise YamlError(f"{ctx}: flow mappings are not supported: {raw!r}")
    if raw[0] in "&*":
        if raw[0] == "*":
            # POLY-9 (ruling, process/reviews/POLY-49/ruling.md §7):
            # ruled (architect) -- no parser exception; an unquoted `*x`
            # really IS an alias in YAML, so the reject stays. But the
            # overwhelmingly likely intent of a hand-typed `paths:` entry
            # shaped like `*.py` or `**/**` is a literal glob, not an
            # alias reference -- the hint names the exact fix (quote it)
            # rather than making the caller go look up what an "alias"
            # even is.
            raise YamlError(f"{ctx}: {raw!r} starts with '*' and reads as a YAML alias; quote it: \"{raw}\"")
        raise YamlError(f"{ctx}: anchors/aliases are not supported: {raw!r}")
    if raw.startswith("!"):
        raise YamlError(f"{ctx}: tags are not supported: {raw!r}")
    if raw in ("|", ">") or raw[0] in "|>":
        raise YamlError(f"{ctx}: block scalars ('|'/'>') are not supported: {raw!r}")
    return raw


def _line_indent(line: str, lineno: int) -> int:
    i = 0
    while i < len(line) and line[i] == " ":
        i += 1
    if i < len(line) and line[i] == "\t":
        raise YamlError(f"line {lineno}: tabs are not supported for indentation")
    return i


_MAPPING_LINE_RE = re.compile(r"^([^:\s][^:]*?):(?:\s+(.*))?$")
_LIST_MAPPING_ITEM_RE = re.compile(r'^[^:\s][^:]*:\s')


def parse_yaml_subset(text: str) -> Dict[str, Any]:
    """Parse a strict subset of fenceless YAML into a dict. See module docstring."""
    raw_lines = text.splitlines()
    entries: List[Tuple[int, int, str]] = []
    for i, line in enumerate(raw_lines, start=1):
        if line.strip() == "":
            continue
        if line.strip().startswith("#"):
            continue
        indent = _line_indent(line, i)
        content = _strip_inline_comment(line.strip())
        if content == "":
            continue
        entries.append((i, indent, content))

    pos = [0]

    def parse_list(indent: int) -> List[Any]:
        items: List[Any] = []
        while pos[0] < len(entries):
            lineno, cur_indent, content = entries[pos[0]]
            if cur_indent != indent or not content.startswith("- "):
                break
            item_raw = content[2:].strip()
            pos[0] += 1
            if _LIST_MAPPING_ITEM_RE.match(item_raw):
                raise YamlError(f"line {lineno}: list items must be scalars, not mappings")
            items.append(_parse_scalar(item_raw, f"line {lineno}"))
        return items

    def parse_mapping(indent: int, depth: int) -> Dict[str, Any]:
        result: Dict[str, Any] = {}
        while pos[0] < len(entries):
            lineno, cur_indent, content = entries[pos[0]]
            if cur_indent != indent:
                if cur_indent > indent:
                    raise YamlError(
                        f"line {lineno}: unexpected indentation (expected {indent}, got {cur_indent})"
                    )
                break
            if content.startswith("- "):
                raise YamlError(f"line {lineno}: unexpected list item in mapping")
            m = _MAPPING_LINE_RE.match(content)
            if not m:
                raise YamlError(f"line {lineno}: expected 'key: value', got {content!r}")
            key, value_raw = m.group(1), (m.group(2) or "")
            if key in result:
                raise YamlError(f"line {lineno}: duplicate key {key!r}")
            pos[0] += 1
            if value_raw.strip() == "":
                if pos[0] < len(entries) and entries[pos[0]][1] > cur_indent:
                    if depth >= 1:
                        raise YamlError(f"line {lineno}: nesting deeper than one level is not supported")
                    next_indent = entries[pos[0]][1]
                    next_content = entries[pos[0]][2]
                    if next_content.startswith("- "):
                        result[key] = parse_list(next_indent)
                    else:
                        result[key] = parse_mapping(next_indent, depth + 1)
                else:
                    result[key] = None
            else:
                result[key] = _parse_scalar(value_raw, f"line {lineno}")
        return result

    if not entries:
        return {}
    return parse_mapping(entries[0][1], 0)
