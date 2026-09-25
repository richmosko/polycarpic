"""POLY-57 RED tests: cairn's old design-notes directory mixed three
unrelated things -- one living design note (`estimation.md`), five loop-
scoped gate-1 rulings, and vendored board theme data. User decision
(2026-09-25, process/cairn/issues/POLY-57.md): cairn's docs stay inside
`scripts/cairn/`, renamed `docs/`, living-docs only; rulings become audit
records under `process/reviews/<ID>/ruling.md`, moved byte-for-byte from
the blob each held at `f686787` (the tip this feature branched from);
vendored theme data moves under the board directory that consumes it.

Nothing under test exists yet -- the old directory is still present and
`scripts/cairn/docs/` / `process/reviews/<ID>/ruling.md` do not exist, so
every test below is expected to fail on an explicit path or content
assertion, never an import error.
"""
from __future__ import annotations

import hashlib
import re
import subprocess
import sys
import unittest
from pathlib import Path

import helpers  # noqa: F401

REPO_ROOT = helpers.CAIRN_DIR.parent.parent
CAIRN_DIR = helpers.CAIRN_DIR
OLD_DESIGN_DIR = CAIRN_DIR / "design"
DOCS_DIR = CAIRN_DIR / "docs"

# The five rulings that moved out of the old directory, and the git blob
# sha1 each held at f686787 -- the tip this feature branched from
# (process/cairn/issues/POLY-57.md, "chore(POLY-57): feature started").
# Computed with `git rev-parse f686787:<old path>` from the main checkout;
# a byte-identical move preserves this hash exactly (git's blob hash is
# content-only, path-independent).
RULING_SOURCE_BLOBS = {
    "POLY-6": "999baf9465b019d138dbdf914f5f8bd621453d52",
    "POLY-10": "5b7e68959436addd54433b204f8b3c37e9256793",
    "POLY-26": "b4e290c419a634931122a747f5b1220b6acd548a",
    "POLY-48": "08152c6e2e2c6b6c005bd78d0db8030094df1ed9",
    "POLY-51": "62fb1aa5b4e5cb757ae670708f6e25c01ce8b546",
}

# Trees the "no stale reference" scan covers -- deliberately not the whole
# repo. docs/DESIGN and tests/workflow cite specific historical shas of a
# ruling's content under its old path as part of the historical record of
# what that ruling said at the time; only the trees a cairn loop reads
# every cycle, plus cairn's own tree, must resolve to the new layout.
SCANNED_ROOTS = (
    REPO_ROOT / "process",
    REPO_ROOT / ".claude",
    CAIRN_DIR,
)

# This file's own path, excluded from the scan below so describing the
# migration in plain English doesn't trip its own guard.
SELF_PATH = Path(__file__).resolve()

# Built from two literals (never one contiguous string in this file's own
# source text) so this guard's own source can't match the pattern it hunts.
STALE_PATH_TOKEN = "scripts/cairn" + "/design/"

TITLE_RE = re.compile(r"^#\s+(.+?)\s*$")


def _git_blob_sha1(data: bytes) -> str:
    header = f"blob {len(data)}\0".encode("ascii")
    return hashlib.sha1(header + data).hexdigest()


def _iter_text_files(root: Path):
    if not root.exists():
        return
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if ".git" in path.parts:
            continue
        if path.resolve() == SELF_PATH:
            continue
        try:
            yield path, path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue


def _first_heading(text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        m = TITLE_RE.match(stripped)
        return m.group(1) if m else stripped
    return ""


class DesignDirRemovedTests(unittest.TestCase):
    def test_old_design_dir_no_longer_exists(self):
        self.assertFalse(
            OLD_DESIGN_DIR.exists(),
            f"{OLD_DESIGN_DIR} still exists -- POLY-57 retires it in favor of docs/",
        )


class DocsDirLivingOnlyTests(unittest.TestCase):
    def test_docs_dir_exists(self):
        self.assertTrue(DOCS_DIR.is_dir(), f"{DOCS_DIR} does not exist yet")

    def test_estimation_md_lives_in_docs(self):
        self.assertTrue(
            (DOCS_DIR / "estimation.md").is_file(),
            "scripts/cairn/docs/estimation.md missing -- the one living design note",
        )

    def test_readme_exists_and_is_at_most_ten_lines(self):
        readme = DOCS_DIR / "README.md"
        self.assertTrue(readme.is_file(), f"{readme} missing")
        if not readme.is_file():
            return
        lines = readme.read_text(encoding="utf-8").splitlines()
        self.assertLessEqual(
            len(lines), 10,
            f"{readme} has {len(lines)} lines; AC caps it at ten",
        )

    def test_no_docs_file_titled_as_a_ruling(self):
        if not DOCS_DIR.is_dir():
            self.skipTest("docs/ does not exist yet")
        offenders = []
        for path in sorted(DOCS_DIR.rglob("*.md")):
            title = _first_heading(path.read_text(encoding="utf-8"))
            if "ruling" in title.lower():
                offenders.append(str(path.relative_to(REPO_ROOT)))
        self.assertEqual(
            offenders, [],
            f"living docs must never carry a ruling title: {offenders}",
        )


class RulingsMovedToReviewsTests(unittest.TestCase):
    def test_each_ruling_lives_at_process_reviews_and_is_byte_identical(self):
        for issue_id, expected_blob in sorted(RULING_SOURCE_BLOBS.items()):
            with self.subTest(issue=issue_id):
                dest = REPO_ROOT / "process" / "reviews" / issue_id / "ruling.md"
                self.assertTrue(
                    dest.is_file(),
                    f"{dest} missing -- {issue_id}'s ruling must move here unchanged",
                )
                if not dest.is_file():
                    continue
                actual_blob = _git_blob_sha1(dest.read_bytes())
                self.assertEqual(
                    actual_blob, expected_blob,
                    f"{dest} content differs from its blob at f686787 -- "
                    "the move must be byte-identical",
                )


class NoStaleDesignPathReferenceTests(unittest.TestCase):
    def test_no_reference_to_the_old_design_dir_remains(self):
        offenders = set()
        for root in SCANNED_ROOTS:
            for path, text in _iter_text_files(root):
                if STALE_PATH_TOKEN in text:
                    offenders.add(str(path.relative_to(REPO_ROOT)))
        self.assertEqual(
            sorted(offenders), [],
            f"stale {STALE_PATH_TOKEN} reference(s) remain: {sorted(offenders)}",
        )


class ThemeGeneratorNewLocationTests(unittest.TestCase):
    def test_gen_variants_runs_from_the_board_vendor_dir(self):
        gen_variants = CAIRN_DIR / "board" / "vendor" / "gen_variants.py"
        self.assertTrue(
            gen_variants.is_file(),
            f"{gen_variants} missing -- theme generator must move under board/",
        )
        if not gen_variants.is_file():
            self.skipTest("generator not moved yet")
        tmp = helpers.make_empty_tmp_dir(self)
        result = subprocess.run(
            [sys.executable, str(gen_variants), "--out-dir", str(tmp)],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            result.returncode, 0,
            f"gen_variants.py failed from its new location:\n"
            f"{result.stdout}\n{result.stderr}",
        )
        self.assertTrue(
            (tmp / "board" / "variants.css").is_file(),
            "gen_variants.py --out-dir did not emit board/variants.css",
        )


if __name__ == "__main__":
    unittest.main()
