"""POLY-56 gate-1 ruling § R2: `cairn check-item <ID> <ordinal> [--uncheck]
[--text <exact>]` -- the built write-back CLI (board write-back stays
re-deferred). Byte-preservation guarantee: read via read_bytes(), locate
the target line's byte offset via a b"\\n" split, flip exactly the one
byte between `[` and `]`. `updated` is never bumped and `apply_patch` is
never called. Line identity is text+ordinal over a fresh read inside the
command, not a cached index.
"""
from __future__ import annotations

import os
import subprocess
import unittest
from pathlib import Path
from unittest import mock

import helpers  # noqa: F401

import cairn


def run_cairn(args: list, input: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [str(helpers.CAIRN_BIN), *args],
        capture_output=True,
        text=True,
        input=input,
    )


ISSUE_TMPL = (
    "---\nid: {id}\ntitle: {title}\nstatus: {status}\nmilestone: null\nparent: null\n"
    "assignee: null\nlabels: []\npriority: null\npr: null\n"
    "created: 2026-01-01\nupdated: 2026-01-01\n---\n\n{body}"
)


def _tree(testcase) -> Path:
    tmp = helpers.make_empty_tmp_dir(testcase)
    data_dir = tmp / "cairn"
    for sub in ("issues", "archive/issues", "milestones", "majors"):
        (data_dir / sub).mkdir(parents=True)
    (data_dir / "config.yml").write_text("prefix: PT\nport: 8766\ndata_dir: process/cairn\n", encoding="utf-8")
    return data_dir


def _write_issue(path: Path, body: str, issue_id: str = "PT-1", status: str = "todo") -> None:
    path.write_text(ISSUE_TMPL.format(id=issue_id, title="Thing", status=status, body=body), encoding="utf-8")


TWO_ITEM_BODY = "Para.\n\n## Acceptance criteria\n\n- [ ] first item\n- [ ] second item\n"
ONE_CHECKED_ITEM_BODY = "Para.\n\n## Acceptance criteria\n\n- [x] already done\n"
NO_AC_BODY = "Just a description, no checklist at all.\n"


class CheckItemHappyPathTests(unittest.TestCase):
    def test_checking_an_item_flips_exactly_one_byte_and_leaves_updated_alone(self):
        data_dir = _tree(self)
        path = data_dir / "issues" / "PT-1.md"
        _write_issue(path, TWO_ITEM_BODY)
        before = path.read_bytes()

        result = run_cairn(["check-item", "PT-1", "1", "--data-dir", str(data_dir)])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PT-1 #1", result.stdout)
        self.assertIn("first item", result.stdout)

        after = path.read_bytes()
        self.assertEqual(len(before), len(after), "check-item must not change the file's length")
        diffs = [i for i in range(len(before)) if before[i] != after[i]]
        self.assertEqual(len(diffs), 1, f"exactly one byte must differ, got {diffs}")
        self.assertEqual(before[diffs[0]:diffs[0] + 1], b" ")
        self.assertEqual(after[diffs[0]:diffs[0] + 1], b"x")

        # Mutation: call apply_patch -- `updated` must stay exactly as written.
        frontmatter, _ = cairn.parse_frontmatter(after.decode("utf-8"))
        self.assertEqual(frontmatter["updated"], "2026-01-01")

    def test_uncheck_flips_x_back_to_a_space(self):
        # Mutation: always write 'x' -- --uncheck must flip the OTHER way.
        data_dir = _tree(self)
        path = data_dir / "issues" / "PT-1.md"
        _write_issue(path, ONE_CHECKED_ITEM_BODY)
        before = path.read_bytes()

        result = run_cairn(["check-item", "PT-1", "1", "--uncheck", "--data-dir", str(data_dir)])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        after = path.read_bytes()
        diffs = [i for i in range(len(before)) if before[i] != after[i]]
        self.assertEqual(len(diffs), 1, f"exactly one byte must differ, got {diffs}")
        self.assertEqual(before[diffs[0]:diffs[0] + 1], b"x")
        self.assertEqual(after[diffs[0]:diffs[0] + 1], b" ")

    def test_second_ordinal_addresses_the_second_item_not_the_first(self):
        data_dir = _tree(self)
        path = data_dir / "issues" / "PT-1.md"
        _write_issue(path, TWO_ITEM_BODY)
        result = run_cairn(["check-item", "PT-1", "2", "--data-dir", str(data_dir)])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("second item", result.stdout)
        after = path.read_bytes().decode("utf-8")
        self.assertIn("- [ ] first item", after)
        self.assertIn("- [x] second item", after)


class CheckItemIdempotencyTests(unittest.TestCase):
    def test_checking_an_already_checked_item_writes_nothing(self):
        # Mutation: always rewrite (the mtime changes) -- an already-
        # checked item must produce a byte-identical file and an
        # unchanged mtime, not merely "no visible diff".
        data_dir = _tree(self)
        path = data_dir / "issues" / "PT-1.md"
        _write_issue(path, ONE_CHECKED_ITEM_BODY)
        before_bytes = path.read_bytes()
        before_mtime = path.stat().st_mtime_ns

        result = run_cairn(["check-item", "PT-1", "1", "--data-dir", str(data_dir)])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("already done", result.stdout)

        self.assertEqual(path.read_bytes(), before_bytes)
        self.assertEqual(path.stat().st_mtime_ns, before_mtime, "an idempotent no-op must not touch mtime")


class CheckItemTextGuardTests(unittest.TestCase):
    def test_text_mismatch_is_refused_with_no_write(self):
        # Mutation: ignore --text -- a caller-supplied anchor that doesn't
        # match the stripped item text must refuse, not silently proceed.
        data_dir = _tree(self)
        path = data_dir / "issues" / "PT-1.md"
        _write_issue(path, TWO_ITEM_BODY)
        before = path.read_bytes()

        result = run_cairn(["check-item", "PT-1", "1", "--text", "not the real text", "--data-dir", str(data_dir)])
        self.assertEqual(result.returncode, 1)
        self.assertEqual(path.read_bytes(), before)

    def test_matching_text_succeeds(self):
        data_dir = _tree(self)
        path = data_dir / "issues" / "PT-1.md"
        _write_issue(path, TWO_ITEM_BODY)
        result = run_cairn(["check-item", "PT-1", "1", "--text", "first item", "--data-dir", str(data_dir)])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("- [x] first item", path.read_bytes().decode("utf-8"))


class CheckItemErrorTests(unittest.TestCase):
    def test_unknown_id_is_refused(self):
        data_dir = _tree(self)
        result = run_cairn(["check-item", "PT-999", "1", "--data-dir", str(data_dir)])
        self.assertEqual(result.returncode, 1)

    def test_no_acceptance_criteria_section_is_refused_with_no_write(self):
        data_dir = _tree(self)
        path = data_dir / "issues" / "PT-1.md"
        _write_issue(path, NO_AC_BODY)
        before = path.read_bytes()
        result = run_cairn(["check-item", "PT-1", "1", "--data-dir", str(data_dir)])
        self.assertEqual(result.returncode, 1)
        self.assertEqual(path.read_bytes(), before)

    def test_ordinal_zero_is_refused_with_no_write(self):
        data_dir = _tree(self)
        path = data_dir / "issues" / "PT-1.md"
        _write_issue(path, TWO_ITEM_BODY)
        before = path.read_bytes()
        result = run_cairn(["check-item", "PT-1", "0", "--data-dir", str(data_dir)])
        self.assertEqual(result.returncode, 1)
        self.assertEqual(path.read_bytes(), before)

    def test_ordinal_past_the_last_item_is_refused_with_no_write(self):
        # Mutation: clamp the ordinal -- a caller asking for item 3 of 2
        # must be refused, not silently mapped onto the last real item.
        data_dir = _tree(self)
        path = data_dir / "issues" / "PT-1.md"
        _write_issue(path, TWO_ITEM_BODY)
        before = path.read_bytes()
        result = run_cairn(["check-item", "PT-1", "3", "--data-dir", str(data_dir)])
        self.assertEqual(result.returncode, 1)
        self.assertEqual(path.read_bytes(), before)

    def test_archived_issue_is_refused_with_no_write(self):
        # Mutation: resolve archive paths as writable -- an archived
        # issue is read-only on the board and must stay read-only here.
        data_dir = _tree(self)
        path = data_dir / "archive" / "issues" / "PT-1.md"
        _write_issue(path, TWO_ITEM_BODY)
        before = path.read_bytes()
        result = run_cairn(["check-item", "PT-1", "1", "--data-dir", str(data_dir)])
        self.assertEqual(result.returncode, 1)
        self.assertEqual(path.read_bytes(), before)


class CheckItemStaleMtimeTests(unittest.TestCase):
    def test_a_stale_mtime_between_read_and_write_is_refused(self):
        # Mutation: skip the re-stat -- cmd_check_item calls path.stat()
        # exactly twice on the happy write path (st_before, then st_now
        # just before the byte flip). This wrapper bumps the target
        # file's real mtime (a real os.utime, not a faked stat result --
        # the command re-reads real bytes off disk too) on that SECOND
        # call only, simulating another process having touched the file
        # in between. In-process (cairn.main) so the patch is visible
        # inside the same call.
        data_dir = _tree(self)
        path = data_dir / "issues" / "PT-1.md"
        _write_issue(path, TWO_ITEM_BODY)
        before = path.read_bytes()

        import contextlib
        import io
        import pathlib
        import time

        target_str = str(path)
        original_stat = pathlib.Path.stat
        calls = {"n": 0}

        def counting_stat(self, *a, **kw):
            if str(self) == target_str:
                calls["n"] += 1
                if calls["n"] == 2:
                    future = time.time() + 3600
                    os.utime(self, (future, future))
            return original_stat(self, *a, **kw)

        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(pathlib.Path, "stat", counting_stat), \
             contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = cairn.main(["check-item", "PT-1", "1", "--data-dir", str(data_dir)])

        self.assertEqual(rc, 1, out.getvalue() + err.getvalue())
        self.assertEqual(path.read_bytes(), before, "a stale-mtime refusal must not write anything")
        self.assertGreaterEqual(calls["n"], 2, "test sanity: path.stat() must have been called at least twice")


class CheckItemCRLFByteRoundTripTests(unittest.TestCase):
    def test_crlf_and_trailing_whitespace_survive_byte_for_byte_except_the_one_flipped_byte(self):
        data_dir = _tree(self)
        path = data_dir / "issues" / "PT-1.md"
        frontmatter_text = (
            "id: PT-1\ntitle: Thing\nstatus: todo\nmilestone: null\nparent: null\n"
            "assignee: null\nlabels: []\npriority: null\npr: null\n"
            "created: 2026-01-01\nupdated: 2026-01-01\n"
        )
        # CRLF line endings throughout the body, plus trailing whitespace
        # on the intro paragraph and the target checklist line itself --
        # exactly the fixture shape M4's measurement flagged apply_patch
        # as corrupting (CRLF -> LF, trailing spaces gone). check-item
        # must not go anywhere near that path (no apply_patch, no
        # text-mode _atomic_write).
        body = (
            "Para with trailing space.  \r\n"
            "\r\n"
            "## Acceptance criteria\r\n"
            "\r\n"
            "- [ ] first item \r\n"
            "- [ ] second item\t\r\n"
        )
        path.write_bytes(("---\n" + frontmatter_text + "---\n" + "\n" + body).encode("utf-8"))
        before = path.read_bytes()

        result = run_cairn(["check-item", "PT-1", "1", "--data-dir", str(data_dir)])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        after = path.read_bytes()
        self.assertEqual(len(before), len(after), "check-item must not change the file's length")
        diffs = [i for i in range(len(before)) if before[i] != after[i]]
        self.assertEqual(len(diffs), 1, f"exactly one byte must differ, got {diffs}")
        self.assertEqual(before[diffs[0]:diffs[0] + 1], b" ")
        self.assertEqual(after[diffs[0]:diffs[0] + 1], b"x")

        frontmatter, _ = cairn.parse_frontmatter(after.decode("utf-8"))
        self.assertEqual(frontmatter["updated"], "2026-01-01")


if __name__ == "__main__":
    unittest.main()
