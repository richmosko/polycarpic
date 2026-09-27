"""cairnlib.multiroot — Multi-root (PT-3): read-only cross-project
aggregation for `cairn serve`.

Every single-root function stays byte-identical. This layer adds a thin
aggregation on top: `resolve_roots` turns config + an optional CLI
override into an ordered list of `Root`s (primary always element 0,
unconditionally trusted; secondaries warn-and-skip on any problem rather
than raising), `build_multi_board_payload` calls the existing
`build_board_payload` once per root and stamps `repo` on every record,
and `compute_multi_etag`/`find_issue_in_roots` are the multi-root
counterparts of `compute_etag`/`find_issue_path`.

The read-only guarantee is structural, not a check someone has to
remember: `find_issue_in_roots` is deliberately a separate function from
`find_issue_path`, and the write handlers (`_create_issue`, `_mutate_issue`
in `make_server`) close over `data_dir` -- the primary root -- only.
Nothing in this section is ever reachable from a POST handler except the
explicit, truthful 403 guard in `_mutate_issue`.

Extracted verbatim from cairn.py (POLY-58 ruling §2 step 16).
"""

import hashlib
import sys
from pathlib import Path
from typing import Any, Dict, List, NamedTuple, Optional, Tuple

from cairnlib.errors import CairnError
from cairnlib.yamlsub import parse_yaml_subset
from cairnlib.config import load_config, resolve_board_columns, resolve_board_swimlane
from cairnlib.store import find_issue_path, find_record_path
from cairnlib.payloads import build_board_payload, compute_etag

__all__ = [
    "Root",
    "build_multi_board_payload",
    "compute_multi_etag",
    "find_issue_in_roots",
    "find_record_in_roots",
    "resolve_roots",
]

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
                    # POLY-58 §2: multiroot (this module) is a leaves-first
                    # step BEFORE watch (engine_fingerprint's owner) --
                    # inlined rather than calling engine_fingerprint, which
                    # would be a back-edge. Only mtime_ns/size are needed
                    # here (never the sha engine_fingerprint also computes).
                    mtimes = []
                    total_size = 0
                    for f in sorted(p.glob("*.py")):
                        fst = f.stat()
                        mtimes.append(fst.st_mtime_ns)
                        total_size += fst.st_size
                    mtime_ns = max(mtimes) if mtimes else 0
                    hasher.update(f"engine_source:{mtime_ns}:{total_size}\n".encode("utf-8"))
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
