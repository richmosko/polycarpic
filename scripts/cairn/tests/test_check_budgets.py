"""`cairn check` budgets (PT-94 B6, D13, D14): comment-length and
issue-size WARNINGS (exit code unchanged), and the docs phrase lint on
process/TRACKER.md + process/WORKFLOW.md (an ERROR, fails the check)."""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

import helpers  # noqa: F401

import cairn
from test_check_lint import GOOD_FRONTMATTER, make_tree


def _issue(data_dir: Path, body: str) -> Path:
    p = data_dir / "issues" / "PT-1.md"
    p.write_text("---\n" + GOOD_FRONTMATTER.format(id="PT-1", status="todo", milestone="null", parent="null", priority="null") + "---\n\n" + body, encoding="utf-8")
    return p


def _closed_issue(data_dir: Path, *, stage: str = "execute", extra_fm: str = "") -> Path:
    """A `status: done` issue with a `stage`, plus whatever `actual.*`
    lines the caller supplies via `extra_fm` (raw YAML lines, each
    including its own trailing newline)."""
    p = data_dir / "issues" / "PT-1.md"
    fm = GOOD_FRONTMATTER.format(id="PT-1", status="done", milestone="null", parent="null", priority="null")
    fm = fm + f"stage: {stage}\n" + extra_fm
    p.write_text("---\n" + fm + "---\n\nBody.\n", encoding="utf-8")
    return p


class CommentAndSizeWarningTests(unittest.TestCase):
    def test_a_comment_over_forty_lines_warns_and_names_it(self):
        """Mutation: count lines of the whole file instead of the comment
        -> a 41-line comment in a short file still warns, but a 20-line
        comment in a long file warns too (second assertion)."""
        data_dir = make_tree(self)
        long_comment = "\n".join(f"line {i}" for i in range(41))
        _issue(data_dir, "Body.\n\n## Comments\n\n### @architect — 2026-09-05\n\n" + long_comment + "\n")
        warnings = cairn.check_budgets(data_dir)
        self.assertEqual(len(warnings), 1)
        self.assertIn("PT-1.md: comment by @architect (2026-09-05) is 41 lines", warnings[0])
        short = "\n".join(f"l{i}" for i in range(20))
        _issue(data_dir, "\n".join(f"body {i}" for i in range(60)) + "\n\n## Comments\n\n### @qa-engineer — 2026-09-05\n\n" + short + "\n")
        self.assertEqual(cairn.check_budgets(data_dir), [])

    def test_an_issue_file_over_the_size_cap_warns(self):
        """Mutation: compare against the cap in bytes of body only."""
        data_dir = make_tree(self)
        p = _issue(data_dir, "x" * (cairn.ISSUE_SIZE_CAP_BYTES + 10) + "\n")
        warnings = cairn.check_budgets(data_dir)
        self.assertEqual(len(warnings), 1)
        self.assertIn("PT-1.md is", warnings[0])
        self.assertIn("KB", warnings[0])
        self.assertTrue(p.exists())

    def test_archived_issues_are_not_budgeted(self):
        data_dir = make_tree(self)
        (data_dir / "archive" / "issues").mkdir(parents=True)
        (data_dir / "archive" / "issues" / "PT-9.md").write_text("---\nid: PT-9\n---\n\n" + "x" * (cairn.ISSUE_SIZE_CAP_BYTES + 10), encoding="utf-8")
        self.assertEqual(cairn.check_budgets(data_dir), [])

    def test_cli_prints_warnings_to_stderr_and_still_exits_zero(self):
        data_dir = make_tree(self)
        _issue(data_dir, "Body.\n\n## Comments\n\n### @architect — 2026-09-05\n\n" + "\n".join(["l"] * 41) + "\n")
        r = subprocess.run([str(helpers.CAIRN_BIN), "check", "--data-dir", str(data_dir)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("warning:", r.stderr)
        self.assertIn("ok", r.stdout)


class ClosedViaCairnSetWarningTests(unittest.TestCase):
    """POLY-33: the warning must key on `actual.gate_cycles is None`, not
    `actual.tokens is None` -- a legitimate `cairn close` writes
    `actual.gate_cycles` always (0 included) but leaves `actual.tokens:
    null` whenever no receiver line matched the window."""

    def test_null_token_but_present_gate_cycles_does_not_warn(self):
        """Mutation: key back on actual.tokens -> this legitimate close
        (gate_cycles: 0, tokens: null) trips the warning again."""
        data_dir = make_tree(self)
        _closed_issue(data_dir, extra_fm="actual.gate_cycles: 0\nactual.tokens: null\n")
        self.assertEqual(cairn.check_budgets(data_dir), [])

    def test_missing_gate_cycles_still_warns(self):
        """The actual `cairn set status=done` case: no actual.* written
        at all -- still a warning."""
        data_dir = make_tree(self)
        _closed_issue(data_dir, extra_fm="")
        warnings = cairn.check_budgets(data_dir)
        self.assertEqual(len(warnings), 1)
        self.assertIn("closed via `cairn set`", warnings[0])


def _lint_issue(data_dir: Path, *, title: str = "Thing", status: str = "todo", body: str = "Body.\n",
                 stage: str | None = None) -> Path:
    p = data_dir / "issues" / "PT-1.md"
    fm = (
        f"id: PT-1\ntitle: {title}\nstatus: {status}\nmilestone: null\nparent: null\n"
        "assignee: null\nlabels: []\npriority: null\npr: null\n"
        "created: 2026-09-01\nupdated: 2026-09-01\n"
    )
    if stage is not None:
        fm += f"stage: {stage}\n"
    p.write_text("---\n" + fm + "---\n\n" + body, encoding="utf-8")
    return p


class TitleAndDescriptionLintTests(unittest.TestCase):
    """POLY-56 gate-1 ruling § R3: `cairn check` warns (never fails) on a
    title over TITLE_CHAR_CAP (70) chars or an empty pre-Comments,
    pre-AC-heading description, scoped to live issues with status not in
    {done, cancelled} and no `stage:` field."""

    def test_open_issue_with_a_long_title_warns(self):
        # Mutation: `>=` instead of `>` -- also covered by the boundary
        # test below, this pins the over-cap case itself.
        data_dir = make_tree(self)
        _lint_issue(data_dir, title="x" * (cairn.TITLE_CHAR_CAP + 1))
        warnings = cairn.check_budgets(data_dir)
        self.assertEqual(len(warnings), 1, warnings)
        self.assertIn("PT-1.md", warnings[0])
        self.assertIn("title is", warnings[0])
        self.assertIn(str(cairn.TITLE_CHAR_CAP), warnings[0])

    def test_open_issue_with_title_exactly_at_the_cap_is_silent(self):
        data_dir = make_tree(self)
        _lint_issue(data_dir, title="x" * cairn.TITLE_CHAR_CAP)
        self.assertEqual(cairn.check_budgets(data_dir), [])

    def test_done_issue_with_a_long_title_does_not_warn(self):
        # Mutation: lint done issues too -- the ruling scopes this to
        # status not in {done, cancelled}.
        data_dir = make_tree(self)
        _lint_issue(data_dir, title="x" * (cairn.TITLE_CHAR_CAP + 1), status="done")
        self.assertEqual(cairn.check_budgets(data_dir), [])

    def test_cancelled_issue_with_a_long_title_does_not_warn(self):
        data_dir = make_tree(self)
        _lint_issue(data_dir, title="x" * (cairn.TITLE_CHAR_CAP + 1), status="cancelled")
        self.assertEqual(cairn.check_budgets(data_dir), [])

    def test_sub_issue_with_a_stage_field_and_a_long_title_does_not_warn(self):
        # Mutation: exempt nothing for stage: -- a per-stage sub-issue is
        # exempt from BOTH lints regardless of its status.
        data_dir = make_tree(self)
        _lint_issue(data_dir, title="x" * (cairn.TITLE_CHAR_CAP + 1), status="todo", stage="execute", body="")
        self.assertEqual(cairn.check_budgets(data_dir), [])

    def test_open_issue_with_an_empty_description_warns(self):
        data_dir = make_tree(self)
        _lint_issue(data_dir, body="\n## Acceptance criteria\n\n- [ ] item\n")
        warnings = cairn.check_budgets(data_dir)
        self.assertEqual(len(warnings), 1, warnings)
        self.assertIn("PT-1.md", warnings[0])
        self.assertIn("empty description", warnings[0])

    def test_open_issue_with_only_whitespace_before_the_heading_warns(self):
        data_dir = make_tree(self)
        _lint_issue(data_dir, body="   \n\n## Acceptance criteria\n\n- [ ] item\n")
        warnings = cairn.check_budgets(data_dir)
        self.assertEqual(len(warnings), 1, warnings)
        self.assertIn("empty description", warnings[0])

    def test_open_issue_with_a_real_paragraph_before_the_heading_is_silent(self):
        data_dir = make_tree(self)
        _lint_issue(data_dir, body="A real paragraph explaining why.\n\n## Acceptance criteria\n\n- [ ] item\n")
        self.assertEqual(cairn.check_budgets(data_dir), [])

    def test_done_issue_with_an_empty_description_does_not_warn(self):
        data_dir = make_tree(self)
        _lint_issue(data_dir, body="\n## Acceptance criteria\n\n- [x] item\n", status="done")
        self.assertEqual(cairn.check_budgets(data_dir), [])

    def test_cli_surfaces_both_lint_warnings_on_stderr_and_still_exits_zero(self):
        data_dir = make_tree(self)
        _lint_issue(data_dir, title="x" * (cairn.TITLE_CHAR_CAP + 1), body="")
        r = subprocess.run([str(helpers.CAIRN_BIN), "check", "--data-dir", str(data_dir)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("title is", r.stderr)
        self.assertIn("empty description", r.stderr)
        self.assertIn("ok", r.stdout)


class DocsPhraseLintTests(unittest.TestCase):
    """The docs live two levels above the data dir (process/cairn ->
    process/). A tree with no process/WORKFLOW.md skips the lint."""

    def _docs(self, data_dir: Path, tracker: str, workflow: str = "Fine.\n") -> None:
        (data_dir.parent / "TRACKER.md").write_text(tracker, encoding="utf-8")
        (data_dir.parent / "WORKFLOW.md").write_text(workflow, encoding="utf-8")

    def test_an_instruction_shaped_phrase_is_an_error(self):
        """Mutation: drop 'not just' from DOC_PHRASES -> no error."""
        data_dir = make_tree(self)
        self._docs(data_dir, "The lint checks shape, not just presence.\n")
        errors = cairn.check_docs(data_dir)
        self.assertEqual(len(errors), 1)
        self.assertIn("TRACKER.md:1", errors[0])
        self.assertIn("not just", errors[0])

    def test_quoted_and_code_span_mentions_are_exempt(self):
        """Mutation: drop the quote/code-span exemption -> two errors."""
        data_dir = make_tree(self)
        self._docs(data_dir, 'Reviewer notes ("say why", `state both`) never ship in docs.\n')
        self.assertEqual(cairn.check_docs(data_dir), [])

    def test_fenced_code_is_exempt(self):
        data_dir = make_tree(self)
        self._docs(data_dir, "```\nsay why here\n```\n")
        self.assertEqual(cairn.check_docs(data_dir), [])

    def test_a_paragraph_over_eight_sentences_is_a_warning_not_an_error(self):
        """Mutation: emit the paragraph warning as an error -> check fails."""
        data_dir = make_tree(self)
        self._docs(data_dir, " ".join(f"Sentence {i}." for i in range(9)) + "\n")
        self.assertEqual(cairn.check_docs(data_dir), [])
        warnings = cairn.check_budgets(data_dir)
        self.assertEqual(len(warnings), 1)
        self.assertIn("TRACKER.md:1: paragraph has 9 sentences", warnings[0])

    def test_missing_docs_skip_the_lint(self):
        data_dir = make_tree(self)
        self.assertEqual(cairn.check_docs(data_dir), [])

    def test_check_repo_includes_the_docs_errors(self):
        data_dir = make_tree(self)
        self._docs(data_dir, "Worth noting that this fails.\n")
        r = subprocess.run([str(helpers.CAIRN_BIN), "check", "--data-dir", str(data_dir)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("worth noting", r.stderr.lower())


class LiveTrackerTitleAndDescriptionLintTests(unittest.TestCase):
    """POLY-60 review checklist row 12: `cairn check`'s title/description
    lint (`TitleAndDescriptionLintTests` above already pins the mechanism
    itself -- a `done` issue is exempt from both checks) must report ZERO
    warnings against the real, live `process/cairn` tracker once the 8
    old-style POLY-48/POLY-49 children (POLY-7, 8, 15, 25, 27, 33, 40, 47)
    are flipped to `status: done` (POLY-60 ruling R3 -- POLY-9 already has
    a body, so it was never linted in the first place). Read-only: this
    never writes to process/cairn/, only reads it. Mutation that must turn
    this red: leaving any one of those 9 children at `backlog`.
    """

    _CHILDREN = ("POLY-7", "POLY-8", "POLY-15", "POLY-25", "POLY-27", "POLY-33", "POLY-40", "POLY-47")

    def _live_data_dir(self) -> Path:
        # helpers.CAIRN_DIR is scripts/cairn/ -- .parent.parent is the repo
        # root, the same derivation helpers.real_metrics_dir() already uses
        # for the main checkout's process/cairn/ tree.
        return helpers.CAIRN_DIR.parent.parent / "process" / "cairn"

    def test_live_tracker_reports_zero_title_or_description_warnings(self):
        data_dir = self._live_data_dir()
        self.assertTrue(data_dir.is_dir(), f"test sanity: {data_dir} must exist")
        warnings = cairn.check_budgets(data_dir)
        offending = [w for w in warnings if any(child in w for child in self._CHILDREN)]
        self.assertEqual(
            offending, [],
            "every POLY-48/POLY-49 child named in POLY-60 ruling R3 must be status: done "
            "(exempting it from the title/description lint), not left at backlog",
        )


if __name__ == "__main__":
    unittest.main()
