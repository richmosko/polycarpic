"""POLY-1 acceptance tests: per-agent git author identity in worktrees.

Kickoff decision, docs/project_kickoff.md Section 2.1 -> "Git author
identity": each teammate sets `user.name`/`user.email` per worktree
(requires `extensions.worktreeConfig=true` in the repo, set idempotently
by the SessionStart hook -- same pattern as the existing `core.hooksPath`
line). The shared worktree-protocol block in every `.claude/agents/*.md`
(see test_agent_worktree_protocol_block.py, PT-82 AC2/AC4) must add a
`git config --worktree user.name` / `git config --worktree user.email`
step, placed after `EnterWorktree` and before any commit, with the email
domain `@agents.polycarpic.local`.

This module reuses test_agent_worktree_protocol_block.py's own extractor
(`extract_worktree_protocol_block`) and its byte-identity test is left
untouched here -- this module only ADDS assertions on top of what that
block must now contain, it never re-derives or duplicates the marker
scan.

Because the block is byte-identical across all ten agent files (per the
existing drift test), it cannot literally embed a per-agent name like
"qa-engineer" -- so the identity step must be phrased to reference the
agent's OWN frontmatter `name:` value (e.g. via a placeholder like
"your own `name:`" or "<agent-name>"), not a hardcoded example name. We
assert on that referencing shape, not on any specific literal name.
"""
from __future__ import annotations

import json
import re
import unittest

import workflow_helpers

from test_agent_worktree_protocol_block import (
    AGENT_FILES,
    BLOCK_END,
    BLOCK_START,
    extract_worktree_protocol_block,
)

SETTINGS_PATH = workflow_helpers.REPO_ROOT / ".claude" / "settings.json"

IDENTITY_DOMAIN = "@agents.polycarpic.local"

# Same idempotent shape as the existing hooksPath line:
#   [ -d .githooks ] && git config core.hooksPath .githooks 2>/dev/null; exit 0
# i.e. a `git config <key> <value>` invocation naming this exact key/value,
# guarded so re-running it is a no-op.
WORKTREE_CONFIG_KEY = "extensions.worktreeConfig"
WORKTREE_CONFIG_VALUE = "true"


class SessionStartSetsExtensionsWorktreeConfigTests(unittest.TestCase):
    """AC1: `extensions.worktreeConfig=true` is set idempotently by the
    SessionStart hook, same pattern as `core.hooksPath`."""

    def _session_start_hook_commands(self) -> list:
        self.assertTrue(SETTINGS_PATH.is_file(), f"expected {SETTINGS_PATH} to exist")
        data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        hooks = data.get("hooks", {}).get("SessionStart", [])
        commands = []
        for entry in hooks:
            for hook in entry.get("hooks", []):
                cmd = hook.get("command", "")
                if cmd:
                    commands.append(cmd)
        return commands

    def test_a_session_start_hook_command_sets_extensions_worktree_config_true(self):
        commands = self._session_start_hook_commands()
        self.assertTrue(commands, "expected at least one SessionStart hook command")
        matches = [
            cmd for cmd in commands
            if re.search(
                r"git\s+config\s+" + re.escape(WORKTREE_CONFIG_KEY) + r"\s+" + re.escape(WORKTREE_CONFIG_VALUE),
                cmd,
            )
        ]
        self.assertTrue(
            matches,
            f"expected a SessionStart hook command running "
            f"`git config {WORKTREE_CONFIG_KEY} {WORKTREE_CONFIG_VALUE}` -- got commands: {commands!r}",
        )

    def test_the_extensions_worktree_config_command_is_idempotent_like_hookspath(self):
        # The existing hooksPath line's idempotent shape: guarded by a
        # directory/file existence check, stderr-suppressed, and always
        # exits 0 so a re-run (or a repo lacking the guarded prerequisite)
        # never fails the hook. The new line must follow the same shape:
        # a `2>/dev/null`-suppressed `git config` call ending `exit 0`
        # (directly or via the same `; exit 0` trailer convention already
        # used by every other command in this hooks array).
        commands = self._session_start_hook_commands()
        candidates = [
            cmd for cmd in commands
            if WORKTREE_CONFIG_KEY in cmd and WORKTREE_CONFIG_VALUE in cmd
        ]
        self.assertTrue(
            candidates,
            f"expected a SessionStart hook command mentioning {WORKTREE_CONFIG_KEY}={WORKTREE_CONFIG_VALUE} "
            f"-- got commands: {commands!r}",
        )
        idempotent = [
            cmd for cmd in candidates
            if "2>/dev/null" in cmd and re.search(r"exit\s+0\s*;?\s*$", cmd.strip())
        ]
        self.assertTrue(
            idempotent,
            f"expected the extensions.worktreeConfig command to be idempotent (stderr-suppressed, "
            f"exits 0) matching the existing core.hooksPath line's pattern -- got: {candidates!r}",
        )


# The two `git config --worktree` invocations the shared block must add.
USER_NAME_CONFIG_RE = re.compile(r"git\s+config\s+--worktree\s+user\.name\b")
USER_EMAIL_CONFIG_RE = re.compile(r"git\s+config\s+--worktree\s+user\.email\b")
EMAIL_DOMAIN_RE = re.compile(re.escape(IDENTITY_DOMAIN))

# The block can't hardcode a literal agent name (it's byte-identical
# across ten files), so it must reference the agent's own `name:`
# frontmatter value somehow -- accept any of the plausible phrasings
# rather than pinning to one exact string.
NAME_REFERENCE_RE = re.compile(
    r"(your\s+own\s+`?name:?`?)|(agent'?s\s+own\s+`?name:?`?)|(<agent-name>)|(\$\{?AGENT_NAME\}?)",
    re.IGNORECASE,
)


class SharedBlockSetsWorktreeGitIdentityTests(unittest.TestCase):
    """AC2: the shared worktree-protocol block sets `user.name` and
    `user.email` with `git config --worktree`, immediately after
    EnterWorktree and before any commit, email domain
    @agents.polycarpic.local."""

    def _get_the_one_block(self) -> str:
        self.assertTrue(AGENT_FILES, "expected agent definitions")
        source = AGENT_FILES[0].read_text(encoding="utf-8")
        return extract_worktree_protocol_block(source, label=str(AGENT_FILES[0]))

    def test_block_sets_worktree_scoped_user_name(self):
        block = self._get_the_one_block()
        self.assertRegex(
            block, USER_NAME_CONFIG_RE,
            f"expected `git config --worktree user.name ...` in the shared block -- got: {block!r}",
        )

    def test_block_sets_worktree_scoped_user_email(self):
        block = self._get_the_one_block()
        self.assertRegex(
            block, USER_EMAIL_CONFIG_RE,
            f"expected `git config --worktree user.email ...` in the shared block -- got: {block!r}",
        )

    def test_block_uses_the_agents_polycarpic_local_email_domain(self):
        block = self._get_the_one_block()
        self.assertRegex(
            block, EMAIL_DOMAIN_RE,
            f"expected the email domain {IDENTITY_DOMAIN!r} in the shared block -- got: {block!r}",
        )

    def test_block_references_the_agents_own_name_not_a_literal_example(self):
        block = self._get_the_one_block()
        self.assertRegex(
            block, NAME_REFERENCE_RE,
            f"the block is byte-identical across all agent files, so it cannot carry a literal "
            f"agent name -- expected it to reference the agent's own frontmatter `name:` value "
            f"(e.g. 'your own `name:`' or '<agent-name>') -- got: {block!r}",
        )

    def test_identity_step_comes_after_enterworktree_and_before_any_commit(self):
        block = self._get_the_one_block()
        enter_idx = block.find("EnterWorktree")
        self.assertNotEqual(enter_idx, -1, f"expected `EnterWorktree` in the block -- got: {block!r}")

        name_match = USER_NAME_CONFIG_RE.search(block)
        email_match = USER_EMAIL_CONFIG_RE.search(block)
        self.assertIsNotNone(name_match, f"expected `git config --worktree user.name` in block -- got: {block!r}")
        self.assertIsNotNone(email_match, f"expected `git config --worktree user.email` in block -- got: {block!r}")

        self.assertGreater(
            name_match.start(), enter_idx,
            "expected `git config --worktree user.name` to appear after `EnterWorktree`",
        )
        self.assertGreater(
            email_match.start(), enter_idx,
            "expected `git config --worktree user.email` to appear after `EnterWorktree`",
        )

        # "Before any commit": find the first mention of a commit action
        # (the block's own "commit by pathspec" instruction, required by
        # PT-82 AC2) and check the identity step precedes it.
        commit_match = re.search(r"commit\s+by\s+pathspec", block, re.IGNORECASE)
        self.assertIsNotNone(
            commit_match, f"expected a 'commit by pathspec' instruction in the block -- got: {block!r}",
        )
        self.assertLess(
            name_match.start(), commit_match.start(),
            "expected `git config --worktree user.name` to appear before the commit instruction",
        )
        self.assertLess(
            email_match.start(), commit_match.start(),
            "expected `git config --worktree user.email` to appear before the commit instruction",
        )

    def test_identity_step_is_present_in_every_agent_file_not_just_the_first(self):
        # The byte-identity test in test_agent_worktree_protocol_block.py
        # already proves every file's block is identical to every other
        # -- this is a direct sanity check on top, so a future change
        # that breaks identity doesn't also silently blind this module
        # (which only reads AGENT_FILES[0] above for speed).
        missing = []
        for path in AGENT_FILES:
            source = path.read_text(encoding="utf-8")
            block = extract_worktree_protocol_block(source, label=str(path))
            if not (USER_NAME_CONFIG_RE.search(block) and USER_EMAIL_CONFIG_RE.search(block)):
                missing.append(str(path))
        self.assertEqual(
            missing, [],
            f"expected every agent file's worktree protocol block to set the worktree git "
            f"identity -- missing from: {missing}",
        )


FAIL_CLOSED_PHRASE_RE = re.compile(r"fail closed", re.IGNORECASE)
SET_NO_IDENTITY_RE = re.compile(r"set no identity", re.IGNORECASE)
MAKE_NO_COMMIT_RE = re.compile(r"make no commit", re.IGNORECASE)


class FailClosedClauseTests(unittest.TestCase):
    """POLY-5 gate-1 ruling (architect, process/cairn/issues/POLY-5.md @
    be1d195, item (d)): the block's new fail-closed clause contains `set
    no identity` and `make no commit`, and comes BEFORE the `git config
    --worktree user.name` identity step and before the `commit by
    pathspec` instruction -- identity only happens on success, so the
    fail-closed instruction must be read first."""

    def _get_the_one_block(self) -> str:
        self.assertTrue(AGENT_FILES, "expected agent definitions")
        source = AGENT_FILES[0].read_text(encoding="utf-8")
        return extract_worktree_protocol_block(source, label=str(AGENT_FILES[0]))

    def test_fail_closed_clause_contains_set_no_identity_and_make_no_commit(self):
        block = self._get_the_one_block()
        self.assertRegex(
            block, SET_NO_IDENTITY_RE,
            f"expected 'set no identity' in the fail-closed clause -- got: {block!r}",
        )
        self.assertRegex(
            block, MAKE_NO_COMMIT_RE,
            f"expected 'make no commit' in the fail-closed clause -- got: {block!r}",
        )

    def test_fail_closed_clause_starts_before_the_identity_step_and_the_commit_instruction(self):
        block = self._get_the_one_block()
        fail_closed_match = FAIL_CLOSED_PHRASE_RE.search(block)
        self.assertIsNotNone(
            fail_closed_match, f"expected a 'fail closed' clause in the block -- got: {block!r}",
        )
        name_match = USER_NAME_CONFIG_RE.search(block)
        self.assertIsNotNone(
            name_match, f"expected `git config --worktree user.name` in block -- got: {block!r}",
        )
        commit_match = re.search(r"commit\s+by\s+pathspec", block, re.IGNORECASE)
        self.assertIsNotNone(
            commit_match, f"expected a 'commit by pathspec' instruction in block -- got: {block!r}",
        )
        self.assertLess(
            fail_closed_match.start(), name_match.start(),
            "expected the fail-closed clause to start before `git config --worktree user.name` "
            "(identity only happens on success)",
        )
        self.assertLess(
            fail_closed_match.start(), commit_match.start(),
            "expected the fail-closed clause to start before the 'commit by pathspec' instruction",
        )

    def test_fail_closed_clause_is_present_in_every_agent_file(self):
        missing = []
        for path in AGENT_FILES:
            source = path.read_text(encoding="utf-8")
            block = extract_worktree_protocol_block(source, label=str(path))
            if not (
                FAIL_CLOSED_PHRASE_RE.search(block)
                and SET_NO_IDENTITY_RE.search(block)
                and MAKE_NO_COMMIT_RE.search(block)
            ):
                missing.append(str(path))
        self.assertEqual(
            missing, [],
            f"expected every agent file's block to carry the fail-closed clause ('fail closed', "
            f"'set no identity', 'make no commit') -- missing from: {missing}",
        )


class ExistingByteIdenticalDriftGuardStillAppliesTests(unittest.TestCase):
    """Guard against accidentally weakening the pre-existing byte-identical
    drift test while adding the identity step -- the marker delimiters
    themselves must be unchanged (PT-82 AC4's contract)."""

    def test_marker_delimiters_are_unchanged(self):
        self.assertEqual(BLOCK_START, "<!-- WORKTREE PROTOCOL (shared, do not edit per-file) -->")
        self.assertEqual(BLOCK_END, "<!-- END WORKTREE PROTOCOL -->")


if __name__ == "__main__":
    unittest.main()
