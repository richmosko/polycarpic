#!/usr/bin/env python3
"""
check_dist_freshness.py — PT-58: the `/finish-feature` dashboard dist-
freshness gate.

Follow-up from the architect's PT-54 build-output ruling: committed dist
accepts staleness as PR discipline. This script hardens that: it answers
"is scripts/cairn/dashboard/dist/ stale relative to the source it ships?"
so `/finish-feature` can refuse (or warn loudly) instead of trusting PR
discipline alone.

Git-aware, not raw mtime (the architect's own caveat, taken seriously): a
checkout/clone resets file mtimes arbitrarily, so `dist/`'s mtime vs
`src/`'s mtime would be unreliable the moment anyone re-clones or
re-checks-out the branch. Instead: the latest COMMIT that touches
dashboard source vs the latest commit that touches `dist/`, compared by
ANCESTRY (`git merge-base --is-ancestor <src-commit> <dist-commit>`), not
commit timestamp. Architect's blocking finding on the first cut (peer
review 8bd6896): comparing `%cI` strings directly has two failure modes
--- same-second commits (common when agents commit programmatically in
rapid succession) tie, and a strict `>` resolves a tie toward "fresh" --
exactly backwards for a gate; and ISO-8601 offsets compare LEXICALLY, so
ordering can invert across timezones. Ancestry dissolves both: it asks
git "is the source commit reachable from the dist commit's history"
rather than "which clock reading is bigger", so identical timestamps and
cross-timezone commits stop mattering entirely. A commit that touches
neither (a doc-only PR) never flips a previously-fresh repo to stale --
if no commit in the repo's history touches source at all, there is
nothing to compare `dist/`'s history against, so the gate reports fresh.

"Dashboard source" is the whole `scripts/cairn/dashboard/` subtree EXCEPT
`dist/` and a short, deliberate noise list (`_NOISE_EXCLUDES`: README.md,
.gitignore, .vscode) -- the INVERSE of an enumerated by-name build-input
list (architect's non-blocking review suggestion, adopted as in-scope:
"did we remember to exclude it" beats "did we remember to list it"). An
enumerated INCLUDE list silently stops watching the day someone adds a
config file Vite picks up automatically (`.env`, `postcss.config.js`, a
reintroduced `tailwind.config.js`) -- the exclude-formulation can't drift
that way; only a handful of provably-inert paths are ever carved out, and
the asymmetry that makes this safe is the same one that made the inverse
formulation right in the first place: a forgotten EXCLUSION is a
false-stale (safe, visible, self-correcting), while a forgotten INCLUSION
would be a false-fresh (silent -- the exact failure this gate exists to
prevent). Beyond that noise list, this deliberately overreaches in the
safe direction: a types-only `tsconfig.json` edit still demands a rebuild
it doesn't strictly need. False-stale is the safe failure for a gate --
don't optimize it away.

This is a standalone script (sibling of cairn.py), not a new `cairn`
subcommand — dist freshness is dashboard-specific, not tracker
functionality.

Stated failure modes, honestly:
  - Assumes COMMITTED state. An uncommitted edit to a source path is
    `stale` (reason `uncommitted-src-changes`) — this tool cannot know
    whether an uncommitted edit is reflected in the committed `dist/`,
    and `/finish-feature` runs before a PR is opened, so "commit your
    dashboard changes first" is the honest ask at that point in the
    workflow.
  - A `dist/` with NO commit history at all (never built/committed) is
    its own distinct reason (`dist-never-built`) — the fix ("build and
    commit dist/") differs from "rebuild dist/", and the message says so.
  - Never raises. A repo with no dashboard subtree at all (e.g. a spin-
    off) reports fresh with reason `no-dashboard` — same "degrade, don't
    crash" posture as cairn.py's read_git_tags/read_git_state.

POLY-102 generalises the one dashboard check into a pair-generic core. A *pair*
is a committed generated output plus the source it comes from. The dashboard
dist is the built-in pair `dashboard-dist` (mode `ancestry`, the algorithm
above); project pairs live in `infra/ci/generated.json` and are either
`ancestry` or `regenerate` (copy the root to a tmp dir outside the repo, run
the generator there, compare the output tree byte for byte; history is never
read, which is what makes it right for Drizzle migrations: ancestry cannot see
that a later `generate --custom` commit left the schema change ungenerated).
Contract: process/cairn/reviews/POLY-102/ruling.md R2.

Flag mode (`--pair`, `--ci`, `--all`) fails closed: exit 0 every selected pair
fresh, 1 any stale, 2 the check could not run (outranks 1). The no-flag call
keeps the PT-58 contract exactly.

Library contract:
    check_dist_freshness(repo_root: Path) -> dict
        {"stale": bool, "reason": str, "message": str}
    reason is one of:
        "fresh", "stale", "dist-never-built",
        "uncommitted-src-changes", "no-dashboard", "git-unavailable"

CLI contract:
    python3 scripts/cairn/check_dist_freshness.py [repo_root]
    Prints `message` and exits 1 if stale, 0 otherwise. `repo_root`
    defaults to the repo this script lives in.
    python3 scripts/cairn/check_dist_freshness.py [--pair NAME]... [--ci] [--all] [repo_root]
    One line per pair: `<name>: <reason>: <message>`; exit 0/1/2 as above.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

DASHBOARD_REL = Path("scripts") / "cairn" / "dashboard"
DIST_REL = DASHBOARD_REL / "dist"
REGISTRY_REL = Path("infra") / "ci" / "generated.json"
BUILTIN_NAME = "dashboard-dist"

# Paths that are part of the dashboard dir but provably CANNOT affect the
# build output -- excluded alongside dist/ (architect's non-blocking
# follow-up on the inverse formulation). A forgotten exclusion is a
# false-stale (safe, visible, self-correcting); a forgotten INCLUSION would
# be a false-fresh (silent, the exact failure this gate exists to prevent).
_NOISE_EXCLUDES = ("README.md", ".gitignore", ".vscode")

BUILTIN_PAIR: Dict[str, Any] = {
    "name": BUILTIN_NAME, "mode": "ancestry", "root": str(DASHBOARD_REL), "output": "dist",
    "exclude": list(_NOISE_EXCLUDES), "link": [], "skip": [], "command": ["npm", "run", "build"],
    "timeout": 180, "ci": False,
}

_REQUIRED = ("name", "mode", "root", "output", "link", "skip", "command", "timeout", "ci")
_MINIMAL_ENV = ("PATH", "HOME", "LANG", "TMPDIR")


class RegistryError(Exception):
    pass


def _run_git(repo_root: Path, *args: str) -> Optional[str]:
    """`None` on a missing git binary or a non-zero exit, otherwise the
    stripped stdout (which may legitimately be empty -- not an error)."""
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_root), *args],
            capture_output=True, text=True, timeout=5,
        )
    except (FileNotFoundError, OSError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def _root_rel(pair: Dict[str, Any]) -> Path:
    return Path(pair["root"])


def _output_rel(pair: Dict[str, Any]) -> Path:
    return _root_rel(pair) / pair["output"]


def _source_pathspecs(pair: Dict[str, Any] = BUILTIN_PAIR) -> List[str]:
    """The inverse-formulation pathspec: all of the pair's root EXCEPT its
    output and its short `exclude` list. `:(exclude)` is git pathspec magic;
    every exclusion is by PATH, not an enumerated, driftable list of
    build-input names."""
    root, out = _root_rel(pair), _output_rel(pair)
    pathspecs = [str(root), f":(exclude){out}"]
    pathspecs += [f":(exclude){root / name}" for name in pair.get("exclude", [])]
    return pathspecs


def _last_commit_sha(repo_root: Path, pathspecs: List[str]) -> Optional[str]:
    out = _run_git(repo_root, "log", "-1", "--format=%H", "--", *pathspecs)
    return out or None


def _commit_timestamp(repo_root: Path, sha: str) -> Optional[str]:
    """Display only, never used for freshness ordering (see `_is_ancestor`)."""
    return _run_git(repo_root, "show", "-s", "--format=%cI", sha) or None


def _is_ancestor(repo_root: Path, ancestor_sha: str, descendant_sha: str) -> bool:
    """Whether `ancestor_sha` is reachable from `descendant_sha` (or is the
    same commit). Ancestry, not a timestamp comparison (architect's
    peer-review fix, 8bd6896): a `%cI` compare ties on same-second commits
    -- resolving toward "fresh", backwards for a gate -- and inverts across
    timezones, since ISO-8601 offsets sort lexically. Conservatively `False`
    (stale, never silently fresh) if the check itself can't run.

    Known failure mode: after a merge the src and dist commits can sit on
    divergent branches with neither an ancestor of the other; that reads
    `stale`, which is the conservative resolution. Ancestry shows the dist
    commit came AFTER the source commit, not that dist's bytes were built
    from it -- a reliable heuristic, not a content guarantee."""
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_root), "merge-base", "--is-ancestor", ancestor_sha, descendant_sha],
            capture_output=True, text=True, timeout=5,
        )
    except (FileNotFoundError, OSError):
        return False
    return result.returncode == 0


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

def _is_str_list(v: Any) -> bool:
    return isinstance(v, list) and all(isinstance(x, str) and x for x in v)


def _safe_rel(v: str) -> bool:
    p = Path(v)
    return not p.is_absolute() and ".." not in p.parts and v not in ("", ".")


def _validate_pair(raw: Any, idx: int) -> Dict[str, Any]:
    where = f"pairs[{idx}]"
    if not isinstance(raw, dict):
        raise RegistryError(f"{where} is not an object")
    mode = raw.get("mode")
    keys = set(_REQUIRED) | ({"exclude"} if mode == "ancestry" else set())
    extra, missing = set(raw) - keys, keys - set(raw)
    if extra:
        raise RegistryError(f"{where}: unknown key(s) {sorted(extra)}")
    if missing:
        raise RegistryError(f"{where}: missing key(s) {sorted(missing)}")
    if mode not in ("regenerate", "ancestry"):
        raise RegistryError(f"{where}: mode must be 'regenerate' or 'ancestry'")
    for k in ("name", "root", "output"):
        if not isinstance(raw[k], str) or not raw[k]:
            raise RegistryError(f"{where}: {k} must be a non-empty string")
    for k in ("root", "output"):
        if not _safe_rel(raw[k]):
            raise RegistryError(f"{where}: {k} must be a relative path without '..'")
    for k in ("link", "skip", "exclude", "command"):
        if k in raw and not _is_str_list(raw[k]):
            raise RegistryError(f"{where}: {k} must be a list of non-empty strings")
    for k in ("link", "skip"):
        if not all(_safe_rel(x) for x in raw[k]):
            raise RegistryError(f"{where}: {k} entries must be relative paths without '..'")
    if not raw["command"]:
        raise RegistryError(f"{where}: command must not be empty")
    t = raw["timeout"]
    if isinstance(t, bool) or not isinstance(t, (int, float)) or t <= 0:
        raise RegistryError(f"{where}: timeout must be a positive number")
    if not isinstance(raw["ci"], bool):
        raise RegistryError(f"{where}: ci must be a boolean")
    if raw["name"] == BUILTIN_NAME:
        raise RegistryError(f"{where}: '{BUILTIN_NAME}' is a built-in pair and cannot be registered")
    return dict(raw)


def load_registry(repo_root: Path) -> List[Dict[str, Any]]:
    f = Path(repo_root) / REGISTRY_REL
    try:
        doc = json.loads(f.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise RegistryError(f"{REGISTRY_REL} does not exist")
    except (OSError, ValueError) as exc:
        raise RegistryError(f"{REGISTRY_REL} is unreadable or not JSON: {exc}")
    if not isinstance(doc, dict) or set(doc) != {"pairs"} or not isinstance(doc["pairs"], list):
        raise RegistryError(f"{REGISTRY_REL} must be an object with exactly one key, 'pairs' (a list)")
    pairs = [_validate_pair(p, i) for i, p in enumerate(doc["pairs"])]
    names = [p["name"] for p in pairs]
    if len(set(names)) != len(names):
        raise RegistryError(f"{REGISTRY_REL}: duplicate pair name")
    return pairs


# ---------------------------------------------------------------------------
# Generator runs in an isolated copy
# ---------------------------------------------------------------------------

def _prepare_copy(repo_root: Path, pair: Dict[str, Any], tmp: Path) -> Path:
    """Copy the pair's root into `tmp` minus its `skip` entries; `link`
    entries are symlinked to their real absolute path (pnpm's per-package
    node_modules holds relative links that dangle in a copy). Raises OSError."""
    src = repo_root / _root_rel(pair)
    dst = tmp / "root"
    top_skip = set(pair["skip"]) | set(pair["link"])

    def ignore(d: str, names: List[str]) -> List[str]:
        return [n for n in names if n in top_skip] if Path(d) == src else []

    # Not `ignore_patterns("dist")`: fnmatch at every level would also drop
    # node_modules/vite/dist. Top-level entries only, by exact name.
    shutil.copytree(src, dst, symlinks=True, ignore=ignore)
    for entry in pair["link"]:
        target = src / entry
        if target.exists():
            link = dst / entry
            link.parent.mkdir(parents=True, exist_ok=True)
            os.symlink(target.resolve(), link)
    return dst


def _run_generator(pair: Dict[str, Any], cwd: Path, minimal_env: bool, scratch: Path) -> Optional[str]:
    """Run the pair's command in `cwd`. Returns None on success, else a
    description of why it could not be run. Stdin is /dev/null so a prompt
    exits at once; the whole process group is killed on timeout."""
    # The child gets its own TMPDIR inside our tmp tree, so whatever it caches
    # (npm's compile cache, drizzle-kit scratch) is removed with the copy.
    scratch.mkdir(parents=True, exist_ok=True)
    env = {k: os.environ[k] for k in _MINIMAL_ENV if k in os.environ} if minimal_env else dict(os.environ)
    env["TMPDIR"] = str(scratch)
    try:
        proc = subprocess.Popen(
            pair["command"], cwd=str(cwd), env=env, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True,
        )
    except FileNotFoundError:
        return f"generator {pair['command'][0]!r} is not available"
    except OSError as exc:
        return f"generator could not be started: {exc}"
    try:
        out, _ = proc.communicate(timeout=pair["timeout"])
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
        proc.communicate()
        return f"generator exceeded its {pair['timeout']} s timeout"
    if proc.returncode != 0:
        return f"generator failed (exit {proc.returncode}): {(out or '')[-2000:]}"
    return None


def _diff_trees(committed: Path, rebuilt: Path) -> List[str]:
    """Every file-level difference between two output trees, byte-for-byte --
    present-only-in-one and content-mismatches alike. `[]` means identical."""
    def files(root: Path) -> set:
        return {p.relative_to(root) for p in root.rglob("*") if p.is_file()} if root.is_dir() else set()
    a, b = files(committed), files(rebuilt)
    diffs: List[str] = []
    for rel in sorted(a - b):
        diffs.append(f"{rel} (only in the committed output)")
    for rel in sorted(b - a):
        diffs.append(f"{rel} (only in the rebuild)")
    for rel in sorted(a & b):
        if (committed / rel).read_bytes() != (rebuilt / rel).read_bytes():
            diffs.append(f"{rel} (content differs)")
    return diffs


def _regenerate_and_compare(repo_root: Path, pair: Dict[str, Any], *, drop_output: bool, minimal_env: bool) -> Dict[str, Any]:
    """Regenerate into an ISOLATED tmp dir outside the repo and compare to the
    committed output on disk. `reason` is `fresh`, `stale` (a genuine
    difference) or `rebuild-verification-failed` (the toolchain could not be
    exercised -- never a pass)."""
    committed = repo_root / _output_rel(pair)
    with tempfile.TemporaryDirectory(prefix="cairn-regen-") as t:
        try:
            copy = _prepare_copy(repo_root, pair, Path(t))
            if drop_output and (copy / pair["output"]).exists():
                shutil.rmtree(copy / pair["output"])
        except OSError as exc:
            return {"match": False, "reason": "rebuild-verification-failed",
                    "detail": f"could not copy {pair['root']} into an isolated tmp dir: {exc}"}
        failure = _run_generator(pair, copy, minimal_env, Path(t) / "scratch")
        if failure:
            return {"match": False, "reason": "rebuild-verification-failed", "detail": failure}
        diffs = _diff_trees(committed, copy / pair["output"])
        if diffs:
            return {"match": False, "reason": "stale", "detail": "regenerated output differs from the committed one: " + "; ".join(diffs)}
        return {"match": True, "reason": "fresh", "detail": "regenerated output is byte-identical to the committed one"}


# ---------------------------------------------------------------------------
# Per-pair checks
# ---------------------------------------------------------------------------

def _res(stale: bool, reason: str, message: str) -> Dict[str, Any]:
    return {"stale": stale, "reason": reason, "message": message}


def _check_regenerate(repo_root: Path, pair: Dict[str, Any]) -> Dict[str, Any]:
    # The run comes first: "could not run" outranks "uncommitted" (an unreadable
    # file also shows up as modified in `git status`).
    r = _regenerate_and_compare(repo_root, pair, drop_output=False, minimal_env=True)
    if r["reason"] == "rebuild-verification-failed":
        return _res(True, "cannot-run", r["detail"])
    dirty = _run_git(repo_root, "status", "--porcelain", "--", str(_root_rel(pair)))
    if dirty:
        return _res(True, "uncommitted-src-changes",
                    f"{pair['root']} has uncommitted (or untracked) changes -- commit them first so freshness "
                    "is judged on committed state:\n" + dirty)
    if r["match"]:
        return _res(False, "fresh", f"{pair['root']}/{pair['output']} matches a fresh run of the generator.")
    return _res(True, "stale", f"{pair['root']}/{pair['output']} is stale: {r['detail']}. "
                               f"Run the generator ({' '.join(pair['command'])}) in {pair['root']} and commit the result.")


def _check_ancestry(repo_root: Path, pair: Dict[str, Any]) -> Dict[str, Any]:
    """The PT-58 algorithm over any root/output/exclude. The rebuild is only a
    rescue for an ancestry-stale verdict, so an unrunnable rebuild leaves the
    verdict `stale` (a failing exit either way)."""
    src_specs = _source_pathspecs(pair)
    out_rel = str(_output_rel(pair))
    shown = out_rel + "/"

    dirty = _run_git(repo_root, "status", "--porcelain", "--", *src_specs)
    if dirty:
        return _res(True, "uncommitted-src-changes",
                    f"{pair['root']} source has uncommitted (or untracked) changes -- commit them "
                    "first so freshness can be verified against the committed source:\n" + dirty)

    last_src = _last_commit_sha(repo_root, src_specs)
    # An output with no tracked file at HEAD was never built (or was removed).
    last_out = _last_commit_sha(repo_root, [out_rel]) if _run_git(repo_root, "ls-files", "--", out_rel) else None
    if last_src is None:
        return _res(False, "fresh", f"no commit touches {pair['root']} source -- {shown} has nothing to be stale against.")
    if last_out is None:
        src_ts = _commit_timestamp(repo_root, last_src)
        return _res(True, "dist-never-built",
                    f"{shown} has never been committed, but {pair['root']} source has (last touched "
                    f"{src_ts or last_src}) -- build it and commit {shown}.")

    src_ts = _commit_timestamp(repo_root, last_src)
    out_ts = _commit_timestamp(repo_root, last_out)
    if _is_ancestor(repo_root, last_src, last_out):
        return _res(False, "fresh", f"{shown} ({out_ts or last_out}) is up to date with source (last touched {src_ts or last_src}).")

    # PT-82 post-verdict delta 1: ancestry is a PROXY for "the committed output
    # matches what this source builds". Measure the real predicate on the
    # already-stale path: rebuild in an isolated tmp dir and compare bytes.
    r = _regenerate_and_compare(repo_root, pair, drop_output=True, minimal_env=False)
    if r["match"]:
        return _res(False, "fresh",
                    f"{shown} looks stale by git ancestry (source last committed at {src_ts or last_src}, "
                    f"the output's last commit ({out_ts or last_out}) does not include it), but an isolated rebuild "
                    "reproduces the committed output byte-for-byte -- stale by ancestry, rebuilt byte-identical.")
    return _res(True, "stale",
                f"{shown} is stale: source was last committed at {src_ts or last_src}, but the output's last commit "
                f"({out_ts or last_out}) does not include it, and an isolated rebuild does not reproduce it "
                f"byte-for-byte ({r['detail']}). Rebuild and commit {shown} before finishing this feature.")


def check_dist_freshness(repo_root: Path) -> Dict[str, Any]:
    """The PT-58 contract, unchanged: the built-in dashboard pair, lenient
    about a missing subtree or git."""
    repo_root = Path(repo_root)
    if not (repo_root / DASHBOARD_REL).is_dir():
        return _res(False, "no-dashboard", f"no dashboard subtree at {DASHBOARD_REL} -- nothing to check.")
    if _run_git(repo_root, "rev-parse", "--abbrev-ref", "HEAD") is None:
        return _res(False, "git-unavailable", "git is unavailable or this isn't a git worktree -- dist freshness cannot be checked.")
    return _check_ancestry(repo_root, BUILTIN_PAIR)


def check_pair(repo_root: Path, pair: Dict[str, Any]) -> Dict[str, Any]:
    """Flag-mode check of one pair: fails closed (`cannot-run`, exit 2)."""
    repo_root = Path(repo_root)
    if not (repo_root / _root_rel(pair)).is_dir():
        return _res(True, "cannot-run", f"root {pair['root']} does not exist -- the pair cannot be checked.")
    if _run_git(repo_root, "rev-parse", "--abbrev-ref", "HEAD") is None:
        return _res(True, "cannot-run", "git is unavailable or this isn't a git worktree.")
    if pair["mode"] == "ancestry":
        if _run_git(repo_root, "rev-parse", "--is-shallow-repository") != "false":
            return _res(True, "cannot-run", "shallow clone: ancestry needs full history (fetch-depth: 0).")
        return _check_ancestry(repo_root, pair)
    return _check_regenerate(repo_root, pair)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _select(repo_root: Path, args: argparse.Namespace) -> List[Dict[str, Any]]:
    need_registry = args.ci or args.all or any(n != BUILTIN_NAME for n in args.pair)
    registry = load_registry(repo_root) if need_registry else []
    by_name = {p["name"]: p for p in registry}
    chosen: List[Dict[str, Any]] = []

    def add(p: Dict[str, Any]) -> None:
        if all(c["name"] != p["name"] for c in chosen):
            chosen.append(p)

    if args.all:
        add(BUILTIN_PAIR)
        for p in registry:
            add(p)
    if args.ci:
        ci = [p for p in registry if p["ci"]]
        if not ci:
            raise RegistryError("--ci selects no pair: no registered pair has ci: true")
        for p in ci:
            add(p)
    for n in args.pair:
        if n == BUILTIN_NAME:
            add(BUILTIN_PAIR)
        elif n in by_name:
            add(by_name[n])
        else:
            raise RegistryError(f"unknown pair {n!r}")
    return chosen


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="check_dist_freshness.py")
    parser.add_argument("--pair", action="append", default=[])
    parser.add_argument("--ci", action="store_true")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("repo_root", nargs="?")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    if args.repo_root:
        repo_root = Path(args.repo_root)
    else:
        # scripts/cairn/check_dist_freshness.py -> scripts/cairn -> scripts -> repo root
        repo_root = Path(__file__).resolve().parent.parent.parent

    if not (args.pair or args.ci or args.all):
        result = check_dist_freshness(repo_root)
        print(result["message"])
        return 1 if result["stale"] else 0

    try:
        pairs = _select(repo_root, args)
    except RegistryError as exc:
        print(f"generated-output freshness: cannot run: {exc}", file=sys.stderr)
        return 2
    code = 0
    for pair in pairs:
        try:
            r = check_pair(repo_root, pair)
        except Exception as exc:  # fail closed: a crash is "could not run", never a pass
            r = _res(True, "cannot-run", f"unexpected error: {exc!r}")
        print(f"{pair['name']}: {r['reason']}: " + " ".join(r["message"].split("\n")))
        if r["reason"] == "cannot-run":
            code = 2
        elif r["stale"] and code == 0:
            code = 1
    return code


if __name__ == "__main__":
    sys.exit(main())
