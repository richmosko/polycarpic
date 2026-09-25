"""Tests for POLY-51's `cairn check` widening: sub-issue letter ids.

Contract: process/reviews/POLY-51/ruling.md (ruling §1, §3),
ruling §6 item 7. A separate file from test_sub_issue_ids.py because it
reuses test_check_lint.py's `make_tree`/`write_issue` scaffolding (the
established cross-test-file import pattern, e.g.
test_dashboard_repo_name.py importing from test_dashboard.py) rather than
the fixture-copy/`_fresh_repo` scaffolding the allocator tests use.
"""
from __future__ import annotations

import unittest

import helpers  # noqa: F401

import cairn
from test_check_lint import make_tree, write_issue


class CheckRepoSuffixedIdTests(unittest.TestCase):
    def test_mixed_numbered_and_suffixed_children_pass(self):
        # PT-3 (top-level) has both a lettered child (PT-3a, POLY-51) and a
        # legacy numbered child (PT-5, pre-POLY-51 shape) -- both forms must
        # coexist cleanly under the same parent.
        data_dir = make_tree(self)
        write_issue(data_dir, "PT-3.md", id="PT-3")
        write_issue(data_dir, "PT-3a.md", id="PT-3a", parent="PT-3")
        write_issue(data_dir, "PT-5.md", id="PT-5", parent="PT-3")
        errors = cairn.check_repo(data_dir)
        self.assertEqual(errors, [], errors)

    def test_uppercase_suffix_is_a_shape_error(self):
        # Ruling §1: lowercase only -- an uppercase suffix must not be
        # silently admitted by the widened _issue_id_re.
        data_dir = make_tree(self)
        write_issue(data_dir, "PT-3.md", id="PT-3")
        write_issue(data_dir, "PT-3A.md", id="PT-3A", parent="PT-3")
        errors = cairn.check_repo(data_dir)
        self.assertTrue(any("PT-3A" in e for e in errors), errors)

    def test_suffixed_id_parent_disagreement_is_an_error(self):
        # Ruling §3 new rule: a stem matching <P>-(\\d+)([a-z])$ must have
        # parent == <P>-\\1. PT-3a's parent here is PT-4, not PT-3 -- a lie
        # the shape alone can't catch, only the new agreement check.
        data_dir = make_tree(self)
        write_issue(data_dir, "PT-3.md", id="PT-3")
        write_issue(data_dir, "PT-4.md", id="PT-4")
        write_issue(data_dir, "PT-3a.md", id="PT-3a", parent="PT-4")
        errors = cairn.check_repo(data_dir)
        matching = [e for e in errors if e.startswith("PT-3a:")]
        self.assertTrue(matching, errors)
        self.assertTrue(any("implies parent" in e.lower() and "PT-3" in e for e in matching), matching)


if __name__ == "__main__":
    unittest.main()
