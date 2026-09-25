"""POLY-57 RED tests (repo-side): gate-1 rulings become audit records
under `process/reviews/<ID>/ruling.md`, moved byte-for-byte out of
cairn's old design-notes directory. Gate-1 ruling
(process/reviews/POLY-57/ruling.md @ ab8063b) §4: this check belongs in
`tests/workflow/`, not `scripts/cairn/tests/`, because its subject spans
the whole repo (TRACKER.md, WORKFLOW.md, every issue file, cairn's own
tree) -- the POLY-6 test boundary puts a repo-layout concern like that
here, never in cairn's own suite.

Two predicates, both taken directly from the ruling (the second's argv is
identical to the ruling's own command; only the Python source is split to
avoid self-matching -- see GREP_PREDICATE_CMD below):

1. Each of the five moved rulings exists at its new path with the exact
   git blob sha1 it held at `f686787` (`git hash-object`) -- a
   byte-identical move, not a re-authored copy.
2. The ruling's own "done" predicate: `git grep` for the moved rulings'
   old basenames (and the old design/ directory) anywhere in the repo,
   excluding `process/reviews/` (the audit records themselves, which are
   frozen and keep their own internal cross-references stale on purpose)
   and `process/cairn/issues/POLY-57*` (this feature's own issue files,
   which narrate the move using the old names as history) -- must return
   nothing.

Nothing under test exists yet -- `process/reviews/<ID>/ruling.md` do not
exist and the old references are still live everywhere, so every
assertion below is expected to fail on an explicit path/content mismatch
or a non-empty `git grep`, never an import error.
"""
from __future__ import annotations

import subprocess
import unittest

import workflow_helpers

REPO_ROOT = workflow_helpers.REPO_ROOT

# The five rulings that moved out of cairn's old design-notes directory,
# and the git blob sha1 each held at f686787 -- the tip this feature
# branched from.
# Computed with `git rev-parse f686787:<old path>` from the main
# checkout; a byte-identical move preserves this hash exactly (git's
# blob hash is content-only, path-independent).
RULING_BLOBS = {
    "POLY-6": "999baf9465b019d138dbdf914f5f8bd621453d52",
    "POLY-10": "5b7e68959436addd54433b204f8b3c37e9256793",
    "POLY-26": "b4e290c419a634931122a747f5b1220b6acd548a",
    "POLY-48": "08152c6e2e2c6b6c005bd78d0db8030094df1ed9",
    "POLY-51": "62fb1aa5b4e5cb757ae670708f6e25c01ce8b546",
}

# The ruling's own §2 "Predicate for done" command, corrected by addendum
# 2 (POLY-57a, issue comment 2026-09-25): needles match FILENAMES only,
# each carrying its `.md` suffix (the directory needle keeps its trailing
# slash) -- otherwise a branch name like `feature/poly-6-test-boundary-ci`
# or a bare topic word would false-positive. Same argv git grep receives
# at runtime, but every needle is built from two literals (never one
# contiguous string in this file's own source text) so this guard's own
# source, which necessarily names its targets, can't match itself.
GREP_PREDICATE_CMD = [
    "git", "grep", "-n",
    "-e", "cairn" + "/design/",
    "-e", "test-boundary-ci" + ".md",
    "-e", "telemetry-attribution" + ".md",
    "-e", "backfill-sibling-scan" + ".md",
    "-e", "sub-issue-letter-ids" + ".md",
    "-e", "estimation-engine-fixes" + ".md",
    "--",
    ":!process/reviews",
    ":!process/cairn/issues/POLY-57*",
]


class RulingArchiveRecordsTests(unittest.TestCase):
    def test_each_ruling_exists_with_its_pinned_blob_sha(self):
        for issue_id, expected_blob in sorted(RULING_BLOBS.items()):
            with self.subTest(issue=issue_id):
                dest = REPO_ROOT / "process" / "reviews" / issue_id / "ruling.md"
                self.assertTrue(
                    dest.is_file(),
                    f"{dest} missing -- {issue_id}'s ruling must move here unchanged",
                )
                if not dest.is_file():
                    continue
                result = subprocess.run(
                    ["git", "hash-object", str(dest)],
                    cwd=str(REPO_ROOT), capture_output=True, text=True,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                actual_blob = result.stdout.strip()
                self.assertEqual(
                    actual_blob, expected_blob,
                    f"{dest} content differs from its blob at f686787 -- "
                    "the move must be byte-identical (git hash-object mismatch)",
                )


class NoStaleRulingPathReferenceTests(unittest.TestCase):
    def test_the_rulings_own_done_predicate_returns_nothing(self):
        result = subprocess.run(
            GREP_PREDICATE_CMD, cwd=str(REPO_ROOT), capture_output=True, text=True,
        )
        if result.returncode not in (0, 1):
            self.fail(f"git grep errored (rc={result.returncode}): {result.stderr}")
        self.assertEqual(
            result.returncode, 1,
            "the ruling's §2 predicate found stale reference(s) -- "
            f"expected no matches, got:\n{result.stdout}",
        )


if __name__ == "__main__":
    unittest.main()
