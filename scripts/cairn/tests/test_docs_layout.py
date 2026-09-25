"""POLY-57 RED tests (cairn-side): cairn's old design-notes directory
mixed a living design note, five loop-scoped gate-1 rulings, and vendored
board theme data. Gate-1 ruling (process/reviews/POLY-57/ruling.md @
ab8063b) §4: this file pins design/'s removal, docs/'s living-docs-only
contents, and the theme files' new home under board/theme/ -- everything
whose subject is data under scripts/cairn/ itself. The sibling repo-wide
check (every ruling file exists with the right blob, and no stale
reference survives anywhere in the repo) lives in tests/workflow/, per
the POLY-6 test boundary (repo layout is a workflow subject, not a
cairn one).

Nothing under test exists yet -- every assertion below is expected to
fail on an explicit path/content mismatch, never an import error.
"""
from __future__ import annotations

import unittest
from pathlib import Path

import helpers  # noqa: F401

REPO_ROOT = helpers.CAIRN_DIR.parent.parent
CAIRN_DIR = helpers.CAIRN_DIR
OLD_DESIGN_DIR = CAIRN_DIR / "design"
DOCS_DIR = CAIRN_DIR / "docs"
THEME_DIR = CAIRN_DIR / "board" / "theme"
THEME_FILES = ("variants.json", "gen_variants.py", "NOTICE.md", "bootstrap.snippet.html")

# Built from two literals -- never one contiguous string in this file's
# own source text -- so this guard's own source can't match the needle
# it hunts for.
STALE_NEEDLE = "cairn" + "/design"

SELF_PATH = Path(__file__).resolve()


class DesignDirRemovedTests(unittest.TestCase):
    def test_old_design_dir_no_longer_exists(self):
        self.assertFalse(
            OLD_DESIGN_DIR.exists(),
            f"{OLD_DESIGN_DIR} still exists -- POLY-57 retires it in favor of docs/",
        )


class DocsDirLivingOnlyTests(unittest.TestCase):
    def test_docs_dir_holds_exactly_readme_and_estimation(self):
        self.assertTrue(DOCS_DIR.is_dir(), f"{DOCS_DIR} does not exist yet")
        if not DOCS_DIR.is_dir():
            return
        names = sorted(p.name for p in DOCS_DIR.iterdir())
        self.assertEqual(
            names, ["README.md", "estimation.md"],
            f"{DOCS_DIR} must hold exactly README.md and estimation.md -- living docs only",
        )

    def test_readme_is_at_most_ten_lines(self):
        readme = DOCS_DIR / "README.md"
        if not readme.is_file():
            self.fail(f"{readme} missing")
            return
        lines = readme.read_text(encoding="utf-8").splitlines()
        self.assertLessEqual(
            len(lines), 10,
            f"{readme} has {len(lines)} lines; AC caps it at ten",
        )


class ThemeFilesMovedTests(unittest.TestCase):
    def test_four_theme_files_exist_under_board_theme(self):
        for name in THEME_FILES:
            with self.subTest(file=name):
                path = THEME_DIR / name
                self.assertTrue(
                    path.is_file(),
                    f"{path} missing -- theme data must live under board/theme/",
                )


class NoStaleDesignReferenceUnderCairnTests(unittest.TestCase):
    def test_no_file_under_scripts_cairn_contains_the_old_design_path(self):
        """`dist/` included -- CAIRN_DIR.rglob walks scripts/cairn/dashboard/dist/
        along with everything else; nothing is special-cased out."""
        offenders = []
        for path in sorted(CAIRN_DIR.rglob("*")):
            if not path.is_file():
                continue
            if ".git" in path.parts:
                continue
            if path.resolve() == SELF_PATH:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            if STALE_NEEDLE in text:
                offenders.append(str(path.relative_to(REPO_ROOT)))
        self.assertEqual(
            offenders, [],
            f"stale {STALE_NEEDLE} reference(s) remain under scripts/cairn/: {offenders}",
        )


if __name__ == "__main__":
    unittest.main()
