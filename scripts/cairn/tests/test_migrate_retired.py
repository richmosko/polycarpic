"""POLY-6 gate-red (qa-engineer), pinned to the architect's gate-1 ruling
(scripts/cairn/design/test-boundary-ci.md @ 615b94e, section (b) AC4 --
"Three migrations: delete ... Token backfill: not retired").

Guards the cairn.py CLI surface after implementation-lead (POLY-30)
deletes migrate-prefix-ids / migrate-lifecycle-status / migrate-archive-
issues, their `cmd_migrate_*`/`migrate_*` functions, and their three test
files (~77 tests) -- while leaving `backfill_tokens` untouched (the
ruling's explicitly struck item: it is not one-shot, `otel_receiver.py`
and `cairn.py` both still call into it, and POLY-26 builds on its scan).

D11 (PT-94): no real-suite spawn -- `cairn --help`/`cairn migrate ...` are
each a single cheap subprocess call.
"""
from __future__ import annotations

import subprocess
import unittest

import helpers  # noqa: F401

import cairn


def run_cairn(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [str(helpers.CAIRN_BIN), *args],
        capture_output=True, text=True,
    )


class MigrateSubcommandRemovedFromCliTests(unittest.TestCase):
    """The `migrate` subparser and its three sub-subcommands are gone
    from the CLI surface: `--help` no longer mentions it, and invoking
    any of the three exits non-zero (argparse's own unrecognised-
    subcommand behaviour once the subparser is deleted)."""

    def test_help_omits_migrate(self):
        result = run_cairn("--help")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn(
            "migrate", result.stdout,
            "cairn --help must no longer mention the retired migrate subcommand",
        )

    def test_migrate_prefix_ids_exits_nonzero(self):
        result = run_cairn("migrate", "prefix-ids")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_migrate_lifecycle_status_exits_nonzero(self):
        result = run_cairn("migrate", "lifecycle-status")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_migrate_archive_issues_exits_nonzero(self):
        result = run_cairn("migrate", "archive-issues")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)


class MigrateFunctionsDeletedFromModuleTests(unittest.TestCase):
    """The three migration functions (and their `cmd_` wrappers) are gone
    from cairn.py's own module namespace -- not merely unreachable from
    argparse."""

    def test_migrate_prefix_ids_function_is_gone(self):
        self.assertFalse(hasattr(cairn, "migrate_prefix_ids"))
        self.assertFalse(hasattr(cairn, "cmd_migrate_prefix_ids"))

    def test_migrate_lifecycle_status_function_is_gone(self):
        self.assertFalse(hasattr(cairn, "migrate_lifecycle_status"))
        self.assertFalse(hasattr(cairn, "cmd_migrate_lifecycle_status"))

    def test_migrate_archive_issues_function_is_gone(self):
        self.assertFalse(hasattr(cairn, "migrate_archive_issues"))
        self.assertFalse(hasattr(cairn, "cmd_migrate_archive_issues"))


class MigrateTestFilesRemovedTests(unittest.TestCase):
    """The three retired migrations' own test files (~77 tests) are
    deleted, not left behind as dead weight."""

    RETIRED_TEST_BASENAMES = (
        "test_migrate_prefix_ids.py",
        "test_migrate_lifecycle_status.py",
        "test_migrate_archive_issues.py",
    )

    def test_no_retired_migration_test_file_remains(self):
        for name in self.RETIRED_TEST_BASENAMES:
            with self.subTest(name=name):
                self.assertFalse((helpers.TESTS_DIR / name).exists(), f"{name} must be deleted")

    def test_no_test_migrate_star_file_remains_at_all(self):
        # Excludes this file's own name -- it is itself a
        # "test_migrate_*.py" match by construction, but it is the guard,
        # not a retired migration's test file.
        remaining = sorted(
            p.name for p in helpers.TESTS_DIR.glob("test_migrate_*.py")
            if p.name != "test_migrate_retired.py"
        )
        self.assertEqual(remaining, [], f"dead migration test files remain: {remaining!r}")


class TokenBackfillNotRetiredTests(unittest.TestCase):
    """The struck item: token backfill stays exactly as-is -- a guard
    against the natural over-application mistake of deleting
    `backfill_tokens.main` alongside the other three."""

    def test_backfill_tokens_main_still_exists(self):
        import backfill_tokens
        self.assertTrue(callable(getattr(backfill_tokens, "main", None)))

    def test_backfill_tokens_test_file_still_exists(self):
        self.assertTrue((helpers.TESTS_DIR / "test_backfill_tokens.py").exists())


if __name__ == "__main__":
    unittest.main()
