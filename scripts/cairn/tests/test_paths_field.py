"""POLY-2 AC1: the optional `paths:` frontmatter field on issues.

Architect's gate-1 ruling (process/cairn/issues/POLY-2.md, `@architect --
2026-09-23`), item 4: `paths:` is an optional `list[string]`. An absent
key means undeclared -- not the same as `[]` ("may touch nothing").
`cairn check` validates SHAPE ONLY, never existence: each entry must be a
non-empty string, no leading `/`, no `..` segment, no `\\`, and no `**`
fused to other characters (`a**b`). `paths` joins `LIST_FIELDS` so
`cairn new --paths a,b` and `cairn set <ID> paths=a,b` share `_split_csv`.

None of this exists yet -- `check_repo` doesn't know the key, `cairn new`
has no `--paths` flag, and `paths` isn't in `cmd_set`'s field order. Every
negative-shape test here is expected to fail red (no error reported)
until implementation-lead adds the validation; the CLI-write tests are
expected to fail red at the argparse / "unknown field" layer.
"""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

import helpers  # noqa: F401

import cairn


def run_cairn(args, cwd=None):
    return subprocess.run([str(helpers.CAIRN_BIN), *args], capture_output=True, text=True, cwd=cwd)


def _write_issue_with_paths_line(data_dir: Path, issue_id: str, paths_literal: str) -> None:
    """`paths_literal` is dropped in verbatim as the YAML value (e.g.
    `[src/auth/**]`, `"not-a-list"`, `[/leading-slash]`) so each test
    controls the exact malformed shape under lint."""
    (data_dir / "issues" / f"{issue_id}.md").write_text(
        "---\n"
        f"id: {issue_id}\ntitle: Paths field case\nstatus: todo\nmilestone: null\nparent: null\n"
        "blocked_by: []\nassignee: backend-lead\nlabels: []\npriority: null\npr: null\n"
        "created: 2026-09-23\nupdated: 2026-09-23\n"
        f"paths: {paths_literal}\n"
        "---\n\nBody.\n",
        encoding="utf-8",
    )


def _errors_mentioning(data_dir: Path, issue_id: str):
    errors = cairn.check_repo(data_dir)
    return [e for e in errors if issue_id in e and "path" in e.lower()]


class ValidPathsShapesLintClean(unittest.TestCase):
    def test_a_list_of_plain_globs_reports_no_paths_error(self):
        data_dir = helpers.make_tmp_data_dir(self)
        _write_issue_with_paths_line(data_dir, "PT-1", "[src/auth/**, scripts/cairn/tests/**, a/b/c.py]")
        self.assertEqual(_errors_mentioning(data_dir, "PT-1"), [])

    def test_an_explicit_empty_list_is_valid_and_distinct_from_absent(self):
        data_dir = helpers.make_tmp_data_dir(self)
        _write_issue_with_paths_line(data_dir, "PT-1", "[]")
        self.assertEqual(_errors_mentioning(data_dir, "PT-1"), [])

    def test_a_glob_naming_a_path_that_does_not_exist_on_disk_is_not_an_error(self):
        """Shape only, never existence -- a feature creates its own files."""
        data_dir = helpers.make_tmp_data_dir(self)
        _write_issue_with_paths_line(data_dir, "PT-1", "[brand/new/feature/**]")
        self.assertEqual(_errors_mentioning(data_dir, "PT-1"), [])


class InvalidPathsShapesAreLintErrors(unittest.TestCase):
    def test_paths_must_be_a_list_not_a_scalar_string(self):
        data_dir = helpers.make_tmp_data_dir(self)
        _write_issue_with_paths_line(data_dir, "PT-1", "src/auth/**")
        self.assertNotEqual(_errors_mentioning(data_dir, "PT-1"), [])

    def test_an_entry_with_a_leading_slash_is_an_error(self):
        data_dir = helpers.make_tmp_data_dir(self)
        _write_issue_with_paths_line(data_dir, "PT-1", "[/src/auth/**]")
        self.assertNotEqual(_errors_mentioning(data_dir, "PT-1"), [])

    def test_an_entry_with_a_dotdot_segment_is_an_error(self):
        data_dir = helpers.make_tmp_data_dir(self)
        _write_issue_with_paths_line(data_dir, "PT-1", "[src/../auth/**]")
        self.assertNotEqual(_errors_mentioning(data_dir, "PT-1"), [])

    def test_an_entry_with_a_backslash_is_an_error(self):
        data_dir = helpers.make_tmp_data_dir(self)
        _write_issue_with_paths_line(data_dir, "PT-1", r"[src\auth\**]")
        self.assertNotEqual(_errors_mentioning(data_dir, "PT-1"), [])

    def test_an_entry_with_double_star_fused_to_other_characters_is_an_error(self):
        data_dir = helpers.make_tmp_data_dir(self)
        _write_issue_with_paths_line(data_dir, "PT-1", "[a**b]")
        self.assertNotEqual(_errors_mentioning(data_dir, "PT-1"), [])

    def test_an_empty_string_entry_is_an_error(self):
        data_dir = helpers.make_tmp_data_dir(self)
        _write_issue_with_paths_line(data_dir, "PT-1", "[src/auth/**, ]")
        self.assertNotEqual(_errors_mentioning(data_dir, "PT-1"), [])


class CliWritesThePathsField(unittest.TestCase):
    def test_cairn_new_accepts_a_paths_flag(self):
        data_dir = helpers.make_tmp_data_dir(self)
        r = run_cairn(["new", "Sub-issue with paths", "--paths", "src/auth/**,scripts/cairn/tests/**", "--data-dir", str(data_dir)])
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        new_id = r.stdout.strip()
        fm, _ = cairn.parse_frontmatter((data_dir / "issues" / f"{new_id}.md").read_text(encoding="utf-8"))
        self.assertEqual(fm.get("paths"), ["src/auth/**", "scripts/cairn/tests/**"])

    def test_cairn_new_without_paths_leaves_the_field_absent(self):
        data_dir = helpers.make_tmp_data_dir(self)
        r = run_cairn(["new", "Sub-issue without paths", "--data-dir", str(data_dir)])
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        new_id = r.stdout.strip()
        fm, _ = cairn.parse_frontmatter((data_dir / "issues" / f"{new_id}.md").read_text(encoding="utf-8"))
        self.assertNotIn("paths", fm, "an undeclared paths: must stay ABSENT, not default to []")

    def test_cairn_set_writes_paths_via_csv(self):
        data_dir = helpers.make_tmp_data_dir(self)
        r = run_cairn(["set", "PT-1", "paths=src/auth/**,a/b/c.py", "--data-dir", str(data_dir)])
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        fm, _ = cairn.parse_frontmatter((data_dir / "issues" / "PT-1.md").read_text(encoding="utf-8"))
        self.assertEqual(fm.get("paths"), ["src/auth/**", "a/b/c.py"])


if __name__ == "__main__":
    unittest.main()
