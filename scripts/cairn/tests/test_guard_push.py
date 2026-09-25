"""POLY-2: `cairn guard-push <ID>` -- the path-ownership push check.

Architect's gate-1 ruling (process/cairn/issues/POLY-2.md, `@architect --
2026-09-23`) fixes every seam these tests hold the implementation to:

1. Branch base = `git merge-base <main-ref> HEAD`, `<main-ref>` = `origin/main`
   if it resolves, else local `main`. Range = `base..HEAD --no-merges`, so
   files that arrive when main is merged in never count.
2. Glob matcher: hand-rolled glob-to-regex, stdlib only. `/`-separated,
   `**` as a whole segment matches zero or more segments, `*` matches
   within one segment, `?` matches one non-`/` char, no `[...]` classes,
   dotfiles not special.
3. Attribution: `git log --no-merges --no-renames --format=%an --name-only
   base..HEAD`, kept only for commits whose author name equals the issue's
   `assignee` exactly. Deletions count as touches; `--no-renames` lists
   both sides of a rename. Cases: no `paths:` -> warn, exit 0; `paths:`
   set + `assignee: null` -> exit 2; `@handle` (human) assignee -> warn,
   exit 0; assignee with zero commits in range -> exit 0. Exit codes: 0
   pass, 1 stray files (every offending path, sorted), 2 usage/config
   error.

`cairn guard-push` does not exist yet -- every test below is expected to
fail red (typically an argparse "invalid choice" exit 2) until
implementation-lead adds the subcommand.
"""
from __future__ import annotations

import os
import subprocess
import unittest
from pathlib import Path

import helpers  # noqa: F401


ISSUE_TEMPLATE = """---
id: {id}
title: {title}
status: in-progress
milestone: null
parent: {parent}
blocked_by: []
assignee: {assignee}
labels: []
priority: null
pr: null
created: 2026-09-23
updated: 2026-09-23
{paths_line}---

Body.
"""


def _paths_line(paths):
    if paths is None:
        return ""
    if not paths:
        return "paths: []\n"
    return "paths: [" + ", ".join(paths) + "]\n"


def write_issue(data_dir: Path, issue_id: str, assignee, paths=None, title="Sub-issue", parent=None):
    (data_dir / "issues" / f"{issue_id}.md").write_text(
        ISSUE_TEMPLATE.format(
            id=issue_id,
            title=title,
            parent="null" if parent is None else parent,
            assignee="null" if assignee is None else assignee,
            paths_line=_paths_line(paths),
        ),
        encoding="utf-8",
    )


def git(cwd: Path, *args: str, check: bool = True, env=None) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=check, env=env)


def write_file(root: Path, rel: str, content: str = "x\n") -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")


def commit_as(root: Path, author: str, message: str, add: bool = True) -> None:
    if add:
        git(root, "add", "-A")
    env = dict(os.environ)
    env.update({
        "GIT_AUTHOR_NAME": author,
        "GIT_AUTHOR_EMAIL": f"{author}@agents.polycarpic.local",
        "GIT_COMMITTER_NAME": author,
        "GIT_COMMITTER_EMAIL": f"{author}@agents.polycarpic.local",
    })
    git(root, "commit", "-q", "-m", message, env=env)


def guard_push(root: Path, data_dir: Path, issue_id: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [str(helpers.CAIRN_BIN), "guard-push", issue_id, "--data-dir", str(data_dir)],
        capture_output=True, text=True, cwd=root,
    )


class GuardPushTestBase(unittest.TestCase):
    """A real git repo, `main` seeded, then a `feature` branch checked out
    -- the exact shape a teammate's worktree push-time check runs against."""

    def setUp(self):
        self.root = helpers.make_empty_tmp_dir(self)
        git(self.root, "init", "-q", "-b", "main")
        git(self.root, "config", "user.email", "seed@example.com")
        git(self.root, "config", "user.name", "seed")
        (self.root / "process").mkdir()
        self.data_dir = helpers.copy_fixture_data_dir(self.root / "process")

    def seed_issue_and_branch(self, issue_id="PT-1", assignee="backend-lead", paths=("src/auth/**",), extra_main_files=None):
        write_issue(self.data_dir, issue_id, assignee, paths=paths)
        if extra_main_files:
            for rel, content in extra_main_files.items():
                write_file(self.root, rel, content)
        commit_as(self.root, "seed", "seed: tracker + fixture main files")
        git(self.root, "checkout", "-q", "-b", "feature")


class InBoundsAndStrayFileTests(GuardPushTestBase):
    def test_in_bounds_commit_passes(self):
        self.seed_issue_and_branch()
        write_file(self.root, "src/auth/login.py")
        commit_as(self.root, "backend-lead", "add login")
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_stray_file_fails_and_names_it(self):
        self.seed_issue_and_branch()
        write_file(self.root, "src/auth/login.py")
        write_file(self.root, "lib/other.py")
        commit_as(self.root, "backend-lead", "add login + stray file")
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("lib/other.py", r.stdout + r.stderr)
        # In-bounds files must not be reported as offenders.
        self.assertNotIn("src/auth/login.py", r.stdout + r.stderr)

    def test_multiple_stray_files_are_all_named_and_sorted(self):
        self.seed_issue_and_branch()
        write_file(self.root, "zeta/z.py")
        write_file(self.root, "alpha/a.py")
        commit_as(self.root, "backend-lead", "two strays")
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        out = r.stdout + r.stderr
        self.assertIn("alpha/a.py", out)
        self.assertIn("zeta/z.py", out)
        self.assertLess(out.index("alpha/a.py"), out.index("zeta/z.py"), "offending paths must be listed sorted")

    def test_deletion_of_an_out_of_bounds_file_counts_as_a_touch(self):
        self.seed_issue_and_branch(extra_main_files={"lib/legacy.py": "old\n"})
        git(self.root, "rm", "-q", "lib/legacy.py")
        commit_as(self.root, "backend-lead", "delete legacy file", add=False)
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("lib/legacy.py", r.stdout + r.stderr)

    def test_rename_out_of_bounds_lists_the_destination_side(self):
        self.seed_issue_and_branch(extra_main_files={"src/auth/a.py": "content\n"})
        (self.root / "lib").mkdir(parents=True, exist_ok=True)  # git mv needs the destination dir to pre-exist
        git(self.root, "mv", "src/auth/a.py", "lib/b.py")
        commit_as(self.root, "backend-lead", "rename out of bounds", add=False)
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("lib/b.py", r.stdout + r.stderr)


class NoPathsDeclaredTests(GuardPushTestBase):
    def test_no_paths_declared_warns_and_passes(self):
        self.seed_issue_and_branch(paths=None)
        write_file(self.root, "lib/anything.py")
        commit_as(self.root, "backend-lead", "touch anything")
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("paths", r.stderr.lower(), "must warn on stderr that no paths: is declared")


class GlobSemanticsTests(GuardPushTestBase):
    """`src/auth/**` -- matches src/auth/a.py and src/auth/x/y.py, does not
    match src/authz/a.py (whole-segment `**`, not a bare substring match)."""

    def test_direct_child_of_double_star_matches(self):
        self.seed_issue_and_branch(paths=("src/auth/**",))
        write_file(self.root, "src/auth/a.py")
        commit_as(self.root, "backend-lead", "direct child")
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_nested_descendant_of_double_star_matches(self):
        self.seed_issue_and_branch(paths=("src/auth/**",))
        write_file(self.root, "src/auth/x/y.py")
        commit_as(self.root, "backend-lead", "nested descendant")
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_sibling_directory_with_shared_prefix_does_not_match(self):
        self.seed_issue_and_branch(paths=("src/auth/**",))
        write_file(self.root, "src/authz/a.py")
        commit_as(self.root, "backend-lead", "sibling prefix, not a real descendant")
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("src/authz/a.py", r.stdout + r.stderr)

    def test_consecutive_double_star_segments_collapse_to_one(self):
        """Architect's gate-4 verdict, defect A (POLY-2.md @ c311ae7):
        `**/**` must match exactly what bare `**` matches -- a root-level
        file and a nested one -- not nothing. `_glob_to_regex("**/**")`
        must collapse consecutive `**` segments before translating.

        The entry is written double-quoted (`paths: ["**/**"]`) rather than
        through `seed_issue_and_branch`'s bare-flow-list helper -- an
        UNQUOTED entry starting with `*` collides with this repo's YAML
        subset parser's anchor/alias rejection (`raw[0] in "&*"`) before
        `_glob_to_regex` is ever reached (confirmed: `*.py` unquoted fails
        the same way). That is a separate, broader latent defect than
        anything this ticket's ruling scopes -- flagged to the lead/
        architect, not fixed here -- so this test isolates defect A alone
        by sidestepping it with an explicit quote, same convention already
        used for numeric-looking milestone values."""
        (self.data_dir / "issues" / "PT-1.md").write_text(
            ISSUE_TEMPLATE.format(id="PT-1", title="Sub-issue", parent="null", assignee="backend-lead", paths_line='paths: ["**/**"]\n'),
            encoding="utf-8",
        )
        commit_as(self.root, "seed", "seed: tracker + fixture main files")
        git(self.root, "checkout", "-q", "-b", "feature")
        write_file(self.root, "x")
        write_file(self.root, "a/b")
        commit_as(self.root, "backend-lead", "root-level and nested, both under **/**")
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


class MalformedPathsIsAUsageErrorTests(GuardPushTestBase):
    """Architect's gate-4 verdict, defect B (POLY-2.md @ c311ae7): a
    malformed `paths:` must be a usage/config error (exit 2), never
    indistinguishable from a real stray-file failure (exit 1) or an
    uncaught traceback."""

    def _write_issue_raw_paths(self, issue_id: str, assignee: str, paths_literal: str) -> None:
        (self.data_dir / "issues" / f"{issue_id}.md").write_text(
            "---\n"
            f"id: {issue_id}\ntitle: Malformed paths\nstatus: in-progress\nmilestone: null\nparent: null\n"
            f"blocked_by: []\nassignee: {assignee}\nlabels: []\npriority: null\npr: null\n"
            "created: 2026-09-23\nupdated: 2026-09-23\n"
            f"paths: {paths_literal}\n"
            "---\n\nBody.\n",
            encoding="utf-8",
        )

    def test_a_scalar_paths_value_is_a_usage_error_not_every_file_stray(self):
        self._write_issue_raw_paths("PT-1", "backend-lead", "src/auth/**")  # scalar, not a list
        commit_as(self.root, "seed", "seed: tracker + fixture main files")
        git(self.root, "checkout", "-q", "-b", "feature")
        write_file(self.root, "src/auth/a.py")
        commit_as(self.root, "backend-lead", "in-bounds by any reasonable reading")
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)

    def test_a_non_string_paths_entry_is_a_usage_error_not_a_traceback(self):
        self._write_issue_raw_paths("PT-1", "backend-lead", "[src/auth/**, 42]")
        commit_as(self.root, "seed", "seed: tracker + fixture main files")
        git(self.root, "checkout", "-q", "-b", "feature")
        write_file(self.root, "src/auth/a.py")
        commit_as(self.root, "backend-lead", "in-bounds by any reasonable reading")
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertNotIn("Traceback", r.stderr)


class AttributionEdgeCaseTests(GuardPushTestBase):
    def test_paths_set_and_assignee_null_is_a_usage_error(self):
        self.seed_issue_and_branch(assignee=None, paths=("src/auth/**",))
        write_file(self.root, "src/auth/a.py")
        commit_as(self.root, "someone", "a commit")
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn("cannot attribute", (r.stdout + r.stderr).lower())

    def test_human_handle_assignee_warns_and_passes(self):
        self.seed_issue_and_branch(assignee="@mosko", paths=("src/auth/**",))
        write_file(self.root, "lib/anything.py")
        commit_as(self.root, "mosko", "human commit, unrelated to the guard")
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_assignee_with_zero_commits_in_range_passes(self):
        self.seed_issue_and_branch(assignee="backend-lead", paths=("src/auth/**",))
        write_file(self.root, "lib/other.py")
        commit_as(self.root, "other-agent", "someone else entirely")
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_unknown_issue_id_is_a_usage_error(self):
        self.seed_issue_and_branch()
        write_file(self.root, "src/auth/a.py")
        commit_as(self.root, "backend-lead", "a commit")
        r = guard_push(self.root, self.data_dir, "PT-999")
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)


class SameAssigneeSiblingSubIssueScopeTests(GuardPushTestBase):
    """POLY-48 (carried AC): one agent holding two sibling sub-issues
    under the same parent, on the same branch, must not have the SECOND
    sub-issue's `guard-push` trip on files that legitimately belong to
    the FIRST sub-issue's own declared `paths:`. Both sub-issues here
    share `parent: PT-0` and `assignee: backend-lead` but declare
    disjoint path globs."""

    def test_second_sub_issues_guard_push_ignores_first_siblings_paths(self):
        write_issue(self.data_dir, "PT-1", "backend-lead", paths=("src/auth/**",), parent="PT-0")
        write_issue(self.data_dir, "PT-2", "backend-lead", paths=("src/billing/**",), parent="PT-0")
        commit_as(self.root, "seed", "seed: tracker + fixture main files")
        git(self.root, "checkout", "-q", "-b", "feature")
        write_file(self.root, "src/auth/a.py")
        commit_as(self.root, "backend-lead", "PT-1: auth work")
        write_file(self.root, "src/billing/b.py")
        commit_as(self.root, "backend-lead", "PT-2: billing work")
        r = guard_push(self.root, self.data_dir, "PT-2")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertNotIn("src/auth/a.py", r.stdout + r.stderr)

    def test_a_genuine_stray_outside_every_siblings_paths_still_fails(self):
        """The scope widening must not become a blanket pass -- a file
        outside BOTH siblings' declared paths is still a real stray."""
        write_issue(self.data_dir, "PT-1", "backend-lead", paths=("src/auth/**",), parent="PT-0")
        write_issue(self.data_dir, "PT-2", "backend-lead", paths=("src/billing/**",), parent="PT-0")
        commit_as(self.root, "seed", "seed: tracker + fixture main files")
        git(self.root, "checkout", "-q", "-b", "feature")
        write_file(self.root, "src/auth/a.py")
        commit_as(self.root, "backend-lead", "PT-1: auth work")
        write_file(self.root, "src/billing/b.py")
        write_file(self.root, "lib/unrelated.py")
        commit_as(self.root, "backend-lead", "PT-2: billing work + a genuine stray")
        r = guard_push(self.root, self.data_dir, "PT-2")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("lib/unrelated.py", r.stdout + r.stderr)
        self.assertNotIn("src/auth/a.py", r.stdout + r.stderr)

    def test_a_different_assignees_sibling_paths_are_not_admitted(self):
        """Ruling (design/estimation-engine-fixes.md §1(c)): the union is
        scoped to siblings with the SAME assignee -- a same-parent sibling
        held by someone else must not widen this assignee's allowed
        globs."""
        write_issue(self.data_dir, "PT-1", "backend-lead", paths=("src/auth/**",), parent="PT-0")
        write_issue(self.data_dir, "PT-2", "frontend-lead", paths=("src/ui/**",), parent="PT-0")
        commit_as(self.root, "seed", "seed: tracker + fixture main files")
        git(self.root, "checkout", "-q", "-b", "feature")
        write_file(self.root, "src/auth/a.py")
        write_file(self.root, "src/ui/b.py")
        commit_as(self.root, "backend-lead", "PT-1 work plus a file only PT-2 (someone else's) declares")
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("src/ui/b.py", r.stdout + r.stderr)

    def test_a_siblings_malformed_paths_is_a_usage_error_naming_the_sibling(self):
        """Ruling: a sibling's malformed `paths:` exits 2 naming the
        sibling -- the union-building scan must surface a config error on
        the SIBLING record it read, not silently skip it or crash."""
        write_issue(self.data_dir, "PT-1", "backend-lead", paths=("src/auth/**",), parent="PT-0")
        (self.data_dir / "issues" / "PT-2.md").write_text(
            "---\nid: PT-2\ntitle: Malformed sibling\nstatus: in-progress\nmilestone: null\nparent: PT-0\n"
            "blocked_by: []\nassignee: backend-lead\nlabels: []\npriority: null\npr: null\n"
            "created: 2026-09-23\nupdated: 2026-09-23\npaths: src/billing/**\n"  # scalar, not a list
            "---\n\nBody.\n",
            encoding="utf-8",
        )
        commit_as(self.root, "seed", "seed: tracker + fixture main files")
        git(self.root, "checkout", "-q", "-b", "feature")
        write_file(self.root, "src/auth/a.py")
        commit_as(self.root, "backend-lead", "in-bounds by PT-1's own paths")
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn("PT-2", r.stdout + r.stderr)


class BranchBaseTests(GuardPushTestBase):
    def test_files_merged_in_from_main_are_excluded_from_the_range(self):
        """The base is the CURRENT merge-base of main and HEAD, not the
        original fork-point commit captured once. A `backend-lead`-authored
        main commit that lands in `feature` only via a later merge must
        never be re-surfaced as a stray file on THIS push."""
        self.seed_issue_and_branch(assignee="backend-lead", paths=("src/auth/**",))
        git(self.root, "checkout", "-q", "main")
        write_file(self.root, "legacy/old.py")
        commit_as(self.root, "backend-lead", "an earlier landed feature, touches an out-of-bounds path")
        git(self.root, "checkout", "-q", "feature")
        git(self.root, "merge", "-q", "--ff-only", "main")
        write_file(self.root, "src/auth/new.py")
        commit_as(self.root, "backend-lead", "genuinely new, in-bounds work")
        r = guard_push(self.root, self.data_dir, "PT-1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertNotIn("legacy/old.py", r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
