#!/usr/bin/env python3
"""
cairn.py — cairn (the file-based issue tracker): parser, CLI, and board server.

Full design: process/TRACKER.md. Concrete function-level contract (names,
signatures) assumed by the test suite: scripts/cairn/tests/INTERFACE.md —
that file is the tie-breaker for "what is this function called", the spec
is the tie-breaker for "what must it do".

Summary:
  - Issues, milestones, and majors are markdown files with YAML frontmatter,
    living under a *data dir* (default: process/cairn/ in a project repo).
  - This module is the only non-file interface. It exists for the two jobs a
    plain Read/Write/Edit can't do safely: atomic ID allocation, and
    frontmatter-only rewrites that can't corrupt an issue's body.
  - A local, stateless HTTP server (`cairn serve`) renders a Kanban board by
    parsing the data dir at request time. It holds no state of its own.

Stdlib only. Targets stock macOS Python 3.9 — no `match`, no `X | Y` unions.

Locating the data dir (CLI):
  1. `--data-dir PATH`, if passed — used verbatim.
  2. Otherwise, `CAIRN_DATA_DIR` env var, if set.
  3. Otherwise, walk up from cwd looking for a `process/cairn/` directory
     (mirroring how git finds `.git`).
  4. Otherwise, fall back to `<cwd>/process/cairn`.

Run:
    scripts/cairn/cairn <command> ...     # via the bash shim
    python3 scripts/cairn/cairn.py ...    # direct invocation

Port override for `serve`: CAIRN_PORT=8899, or `--port`.

POLY-58: this file is the CLI entry point and a re-export facade only —
the implementation lives in the `cairnlib/` package, one module per
leaves-first extraction step (see process/reviews/POLY-58/ruling.md).
`import cairn` stays unchanged for every caller; `cairnlib.<mod>` is the
patch target for anything that needs to reach a specific module's own
name binding (ruling §5).
"""

import sys

import cairnlib
from cairnlib.constants import *  # noqa: F401,F403 (POLY-58 step 1)
from cairnlib.errors import *  # noqa: F401,F403 (POLY-58 step 2)
from cairnlib.yamlsub import *  # noqa: F401,F403 (POLY-58 step 3)
from cairnlib.records import *  # noqa: F401,F403 (POLY-58 step 4)
from cairnlib.config import *  # noqa: F401,F403 (POLY-58 step 5)
from cairnlib.store import *  # noqa: F401,F403 (POLY-58 step 6)
from cairnlib.guards import *  # noqa: F401,F403 (POLY-58 step 7)
from cairnlib.lint import *  # noqa: F401,F403 (POLY-58 step 8)
from cairnlib.snapshot import *  # noqa: F401,F403 (POLY-58 step 9)
from cairnlib.roster import *  # noqa: F401,F403 (POLY-58 step 10)
from cairnlib.attribution import *  # noqa: F401,F403 (POLY-58 step 11)
from cairnlib.flow import *  # noqa: F401,F403 (POLY-58 step 12)
from cairnlib.tokens import *  # noqa: F401,F403 (POLY-58 step 13)
from cairnlib.actuals import *  # noqa: F401,F403 (POLY-58 step 14)
from cairnlib.payloads import *  # noqa: F401,F403 (POLY-58 step 15)
from cairnlib.multiroot import *  # noqa: F401,F403 (POLY-58 step 16)
from cairnlib.watch import *  # noqa: F401,F403 (POLY-58 step 17)
from cairnlib.server import *  # noqa: F401,F403 (POLY-58 step 18)
from cairnlib.archive import *  # noqa: F401,F403 (POLY-58 step 19)
from cairnlib.estimate import *  # noqa: F401,F403 (POLY-58 step 20)
from cairnlib.cli import *  # noqa: F401,F403 (POLY-58 step 21)

__all__ = (
    cairnlib.constants.__all__
    + cairnlib.errors.__all__
    + cairnlib.yamlsub.__all__
    + cairnlib.records.__all__
    + cairnlib.config.__all__
    + cairnlib.store.__all__
    + cairnlib.guards.__all__
    + cairnlib.lint.__all__
    + cairnlib.snapshot.__all__
    + cairnlib.roster.__all__
    + cairnlib.attribution.__all__
    + cairnlib.flow.__all__
    + cairnlib.tokens.__all__
    + cairnlib.actuals.__all__
    + cairnlib.payloads.__all__
    + cairnlib.multiroot.__all__
    + cairnlib.watch.__all__
    + cairnlib.server.__all__
    + cairnlib.archive.__all__
    + cairnlib.estimate.__all__
    + cairnlib.cli.__all__
)

if __name__ == "__main__":
    sys.exit(main())
