"""Tests for POLY-51: sub-issue letter ids (`cairn new --parent <ID>`).

Contract: scripts/cairn/design/sub-issue-letter-ids.md (architect's gate-1
ruling, POLY-51 @ f22c704). Covers ruling §6 items 1-8 -- items 9 and 10
(the Python/JS `_id_sort_key`/`idSortKey` drift pair, PT-25) live next to
their existing siblings in test_id_sort.py and tests/js/id-sort.test.js;
item 11 (the HTTP create path) lives next to its sibling in
test_server.py's CreateIssueTests.

Every scenario here builds its own from-scratch tree via `_fresh_repo`
rather than the shared `tests/fixtures/` copy: that fixture's PT-3 already
carries `parent: PT-1` (a legacy numbered sub-issue used elsewhere to
exercise the pre-POLY-51 shape), so `--parent PT-3` against it would hit
the depth-1 refusal (§2 step 3) instead of allocating -- the opposite of
what ruling §6 items 1-5's literal "PT-3a, PT-3b, ..." examples need. A
fresh tree with PT-3 as a genuine top-level issue matches the ruling's
examples exactly.
"""
from __future__ import annotations

import re
import string
import unittest
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import helpers  # noqa: F401

import cairn
from test_cli import run_cairn  # noqa: E402 -- established cross-test-file import pattern


def base_fields(title: str, parent: str | None = None) -> dict:
    return {
        "title": title,
        "status": "backlog",
        "milestone": None,
        "parent": parent,
        "assignee": None,
        "labels": [],
        "priority": None,
        "pr": None,
    }


def _write_issue(data_dir: Path, issue_id: str, parent: str = "null", archived: bool = False) -> Path:
    subdir = "archive/issues" if archived else "issues"
    path = data_dir / subdir / f"{issue_id}.md"
    path.write_text(
        "---\n"
        f"id: {issue_id}\ntitle: Issue {issue_id}\nstatus: todo\nmilestone: null\n"
        f"parent: {parent}\nassignee: null\nlabels: []\npriority: null\npr: null\n"
        "created: 2026-08-01\nupdated: 2026-08-01\n"
        "---\n\nBody.\n",
        encoding="utf-8",
    )
    return path


def _fresh_repo(testcase, *top_level_ids: str) -> Path:
    """A from-scratch data dir (config.yml + issues/ + archive/issues/, no
    fixture baggage), with each of `top_level_ids` written as a plain
    top-level issue (parent: null)."""
    empty = helpers.make_empty_tmp_dir(testcase)
    data_dir = empty / "cairn"
    (data_dir / "issues").mkdir(parents=True)
    (data_dir / "archive" / "issues").mkdir(parents=True)
    (data_dir / "config.yml").write_text("prefix: PT\nport: 8766\ndata_dir: process/cairn\n", encoding="utf-8")
    for issue_id in top_level_ids:
        _write_issue(data_dir, issue_id)
    return data_dir


class SubIssueAllocationTests(unittest.TestCase):
    """Ruling §6 items 1-2."""

    def test_parent_allocates_letter_ids_in_creation_order(self):
        data_dir = _fresh_repo(self, "PT-3")
        first = cairn.allocate_and_create_issue(data_dir, base_fields("First sub-issue", parent="PT-3"))
        second = cairn.allocate_and_create_issue(data_dir, base_fields("Second sub-issue", parent="PT-3"))
        self.assertEqual(first.name, "PT-3a.md")
        self.assertEqual(second.name, "PT-3b.md")
        for path, expected_id in ((first, "PT-3a"), (second, "PT-3b")):
            frontmatter, _ = cairn.parse_frontmatter(path.read_text(encoding="utf-8"))
            self.assertEqual(frontmatter["id"], expected_id)
            self.assertEqual(frontmatter["parent"], "PT-3")

    def test_top_level_counter_ignores_suffixed_sub_issue_ids(self):
        data_dir = _fresh_repo(self, "PT-3")
        cairn.allocate_and_create_issue(data_dir, base_fields("Sub-issue", parent="PT-3"))  # -> PT-3a
        top_level = cairn.allocate_and_create_issue(data_dir, base_fields("Top-level issue"))
        self.assertEqual(top_level.name, "PT-4.md")


class NoGapReuseTests(unittest.TestCase):
    """Ruling §6 item 3."""

    def test_no_gap_reuse_among_live_siblings(self):
        data_dir = _fresh_repo(self, "PT-3")
        _write_issue(data_dir, "PT-3a", parent="PT-3")
        _write_issue(data_dir, "PT-3c", parent="PT-3")
        path = cairn.allocate_and_create_issue(data_dir, base_fields("Next sub-issue", parent="PT-3"))
        self.assertEqual(path.name, "PT-3d.md")

    def test_no_gap_reuse_against_an_archived_sibling(self):
        data_dir = _fresh_repo(self, "PT-3")
        _write_issue(data_dir, "PT-3b", parent="PT-3", archived=True)
        path = cairn.allocate_and_create_issue(data_dir, base_fields("Next sub-issue", parent="PT-3"))
        self.assertEqual(path.name, "PT-3c.md")


class ExhaustionTests(unittest.TestCase):
    """Ruling §6 item 4."""

    def test_exhaustion_past_z_errors_without_writing_a_file(self):
        data_dir = _fresh_repo(self, "PT-3")
        for letter in string.ascii_lowercase:
            _write_issue(data_dir, f"PT-3{letter}", parent="PT-3")
        before = sorted((data_dir / "issues").glob("PT-3*.md"))
        with self.assertRaises(cairn.CairnError) as ctx:
            cairn.allocate_and_create_issue(data_dir, base_fields("One too many", parent="PT-3"))
        self.assertIn("exhaust", str(ctx.exception).lower())
        after = sorted((data_dir / "issues").glob("PT-3*.md"))
        self.assertEqual(before, after, "exhaustion must not write a partial/wrong file")


class ConcurrentSubIssueAllocationTests(unittest.TestCase):
    """Ruling §6 item 5 (O_EXCL race).

    The ruling's own phrasing ("pre-create PT-3b.md after the scan
    (monkeypatch the scan)") presumes a specific internal scan seam --
    but this file is written before the allocator's letter path exists
    (TDD), so no such seam can be named yet without guessing at the
    implementer's factoring. A genuine multi-threaded race exercises the
    SAME O_CREAT|O_EXCL retry-on-collision path from outside, with no
    presumption about internal helper names -- the identical substitution
    ConcurrentAllocationTests (test_id_allocation.py) already makes for
    the numeric path, for the same reason.
    """

    def test_concurrent_sub_issue_allocation_produces_no_duplicate_letters(self):
        data_dir = _fresh_repo(self, "PT-3")
        n_workers = 20  # comfortably under the a..z = 26 ceiling

        def create_one(i: int):
            return cairn.allocate_and_create_issue(data_dir, base_fields(f"Race sub-issue {i}", parent="PT-3"))

        paths = []
        errors = []
        with ThreadPoolExecutor(max_workers=n_workers) as pool:
            futures = [pool.submit(create_one, i) for i in range(n_workers)]
            for future in as_completed(futures):
                try:
                    paths.append(future.result())
                except Exception as exc:  # noqa: BLE001
                    errors.append(exc)

        self.assertEqual(errors, [], f"allocation raised under concurrency: {errors}")
        self.assertEqual(len(paths), n_workers)
        names = [p.name for p in paths]
        self.assertEqual(len(names), len(set(names)), f"duplicate sub-issue ids allocated: {names}")
        # Not just uniqueness: pre-POLY-51, `parent` is ignored for id
        # generation, so n_workers unique TOP-LEVEL numeric ids (PT-4.md,
        # PT-5.md, ...) would ALSO satisfy plain uniqueness -- passing this
        # test for the wrong reason, never touching the letter path this
        # test exists to race. Every id must actually be letter-shaped.
        letter_re = re.compile(r"^PT-3([a-z])\.md$")
        for name in names:
            self.assertRegex(name, letter_re, f"not a PT-3<letter> sub-issue id: {name}")
        letters = sorted(letter_re.match(name).group(1) for name in names)
        self.assertEqual(letters, sorted(set(letters)), f"duplicate letters allocated: {letters}")
        for path in paths:
            frontmatter, _ = cairn.parse_frontmatter(path.read_text(encoding="utf-8"))
            self.assertEqual(frontmatter["id"] + ".md", path.name)
            self.assertEqual(frontmatter["parent"], "PT-3")


class ParentRefusalTests(unittest.TestCase):
    """Ruling §6 item 6 -- the three `--parent` refusals (§2 steps 2-3)."""

    def test_parent_on_a_suffixed_id_refuses(self):
        data_dir = _fresh_repo(self, "PT-3")
        first = cairn.allocate_and_create_issue(data_dir, base_fields("First", parent="PT-3"))  # PT-3a
        with self.assertRaises(cairn.CairnError) as ctx:
            cairn.allocate_and_create_issue(data_dir, base_fields("x", parent=first.stem))
        self.assertIn("sub-issue", str(ctx.exception).lower())

    def test_parent_on_a_legacy_numbered_sub_issue_refuses(self):
        data_dir = _fresh_repo(self, "PT-3")
        _write_issue(data_dir, "PT-5", parent="PT-3")  # legacy numbered sub-issue (pre-POLY-51 shape)
        with self.assertRaises(cairn.CairnError) as ctx:
            cairn.allocate_and_create_issue(data_dir, base_fields("x", parent="PT-5"))
        self.assertIn("sub-issue", str(ctx.exception).lower())

    def test_parent_on_a_missing_id_refuses(self):
        data_dir = _fresh_repo(self, "PT-3")
        with self.assertRaises(cairn.CairnError) as ctx:
            cairn.allocate_and_create_issue(data_dir, base_fields("x", parent="PT-999"))
        self.assertIn("PT-999", str(ctx.exception))
        self.assertIn("no such issue", str(ctx.exception).lower())


class LsMixedFormOrderTests(unittest.TestCase):
    """Ruling §6 item 8."""

    def test_ls_orders_numbered_and_lettered_ids_together(self):
        data_dir = _fresh_repo(self, "PT-2", "PT-3", "PT-10")
        _write_issue(data_dir, "PT-3a", parent="PT-3")
        _write_issue(data_dir, "PT-3b", parent="PT-3")
        result = run_cairn(["ls", "--data-dir", str(data_dir)])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        lines = [line for line in result.stdout.splitlines() if line.strip()]
        ids_in_order = [line.split("\t", 1)[0] for line in lines]
        self.assertEqual(ids_in_order, ["PT-2", "PT-3", "PT-3a", "PT-3b", "PT-10"])


if __name__ == "__main__":
    unittest.main()
