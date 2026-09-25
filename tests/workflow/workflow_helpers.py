"""Shared constant for tests/workflow/ (POLY-6 gate-1 ruling, section (a)
Mechanics): `tests/workflow/` exercises repo conventions, not code under
`scripts/cairn/`, so it must not import `cairn`, `helpers`, or put
`scripts/cairn` on `sys.path` -- that coupling is exactly what would block
a future `/spin-off-component` of cairn from extracting its suite intact.

`REPO_ROOT` replaces the `helpers.CAIRN_DIR.parent.parent` idiom the moved
files used before the move (scripts/cairn -> scripts -> repo root); here
it's one `.parents[2]` hop up from this file's own location
(tests/workflow -> tests -> repo root).
"""
from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
