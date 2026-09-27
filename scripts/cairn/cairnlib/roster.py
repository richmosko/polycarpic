"""cairnlib.roster — Agent roster (PT-56): `.claude/agents/*.md` +
`.claude/roles/team-lead.md` identity reader for GET /api/roster.

A SEPARATE composed reader, deliberately NOT part of build_dashboard_payload
/ the engine proper. `.claude/agents/` and `.claude/roles/` are a template
concept, not a tracker one -- reading them from inside cairn.py's engine
functions would cross the same "reads nothing outside process/cairn/ +
git" boundary read_git_tags's docstring protects, and would survive a
cairn spin-off incorrectly (the module would ship with cairn; the ruling
says it must stay with the template instead). Isolated here so an
unreadable/missing `.claude/` tree degrades the roster panel alone, never
the rest of the dashboard.

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 10).
"""

import re
from pathlib import Path
from typing import Any, Dict, List

from cairnlib.store import _read_frontmatter_dict

__all__ = [
    "_SENTENCE_END_RE",
    "_WORKING_STATUSES",
    "_first_sentence",
    "_read_agent_identities",
]

_SENTENCE_END_RE = re.compile(r"^(.*?[.!?])(\s|$)")


def _first_sentence(text: str) -> str:
    """The role line's source text (architect ruling § "Identity"): an
    agent's frontmatter `description` is usually several sentences of
    operating detail (`.claude/agents/*.md` convention) -- the roster
    card only has room for the first one. Falls back to the whole
    (stripped) string if no sentence-ending punctuation is found, rather
    than returning an empty role.
    """
    text = (text or "").strip()
    if not text:
        return ""
    match = _SENTENCE_END_RE.match(text)
    return match.group(1) if match else text


def _read_agent_identities(repo_root: Path) -> List[Dict[str, Any]]:
    """PT-56 (architect ruling § "Identity"): `.claude/agents/*.md`
    (`name`/`description` frontmatter) plus `.claude/roles/team-lead.md`
    -- every clone of this template ships these, so a roster with zero
    live team running still shows every identity (the ruling's "empty
    state is not empty" point). `id` and `name` are both the frontmatter
    `name` value -- this system has no separate "display name" concept.
    Never raises: a missing `.claude/agents/` dir, a missing role file,
    or one malformed agent file among many all degrade quietly (an
    unreadable individual file is skipped, not fatal to the rest).
    """
    repo_root = Path(repo_root)
    identities: List[Dict[str, Any]] = []

    agents_dir = repo_root / ".claude" / "agents"
    if agents_dir.is_dir():
        for p in sorted(agents_dir.glob("*.md")):
            try:
                fm = _read_frontmatter_dict(p)
            except Exception:  # noqa: BLE001 -- one bad file must not blank the roster
                continue
            name = fm.get("name")
            if not name:
                continue
            identities.append({"id": name, "name": name, "role": _first_sentence(fm.get("description"))})

    role_path = repo_root / ".claude" / "roles" / "team-lead.md"
    if role_path.is_file():
        try:
            fm = _read_frontmatter_dict(role_path)
            name = fm.get("name") or "team-lead"
            identities.append({"id": name, "name": name, "role": _first_sentence(fm.get("description"))})
        except Exception:  # noqa: BLE001
            pass

    return identities


_WORKING_STATUSES = ("in-progress", "in-review")
