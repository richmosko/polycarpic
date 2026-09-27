"""cairnlib.enginesrc — the engine-source dir-stat helper.

POLY-60 ruling R2: `multiroot.compute_multi_etag`'s directory branch and
`watch.engine_fingerprint`'s directory branch each carried their own
`sorted(glob("*.py"))` -> max mtime, sum size loop (POLY-58 verdict,
222f15a: commit d0b06a9 copied it instead of sharing it, since `watch`
imports `multiroot` and `multiroot` cannot import `watch` back). This
module is a new LEAF -- no `cairnlib` imports of its own -- that sits
below both, so either can import it with no back-edge.

Extracted fresh for POLY-60 (not a POLY-58 leaves-first extraction step).
"""

from pathlib import Path
from typing import List, Tuple

__all__ = [
    "engine_source_files",
    "engine_source_stat",
]


def engine_source_files(path: Path) -> List[Path]:
    """The `*.py` files `path` fingerprints: sorted directory listing for
    a directory, `[path]` for a file (existence is not checked here --
    a missing single-file `path` is still returned as `[path]`, so a
    caller that stats each entry gets a natural `OSError`, not a silent
    empty list).
    """
    path = Path(path)
    if path.is_dir():
        return sorted(path.glob("*.py"))
    return [path]


def engine_source_stat(path: Path) -> Tuple[int, int]:
    """`(max st_mtime_ns, sum st_size)` over `engine_source_files(path)`.

    `(0, 0)` for an empty directory. Raises `OSError` (e.g.
    `FileNotFoundError`) if any file can't be stat'd -- callers keep their
    own handling, same posture the pre-POLY-60 inlined loops already had.
    """
    files = engine_source_files(path)
    if not files:
        return (0, 0)
    mtimes = []
    total_size = 0
    for f in files:
        st = f.stat()
        mtimes.append(st.st_mtime_ns)
        total_size += st.st_size
    return (max(mtimes), total_size)
