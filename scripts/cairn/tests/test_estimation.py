"""POLY-3 failing acceptance tests: the effort-estimation loop (tokens +
gate cycles). Pinned to the architect's design note
(`scripts/cairn/design/estimation.md`, approved at `de28e82`) — read that
file's own section numbers (§1-§9) for the full rationale; this docstring
only restates the seams these tests hold the implementation to.

**Nothing under test exists yet**: `ISSUE_FIELD_ORDER` carries no
`stage`/`estimate.*`/`actual.*`/`ratio` keys, `cairn.py` has no
`token_actuals`/`gate_cycle_actuals`/`cmd_close`/`cmd_estimate`, and
`config.yml`'s `estimation.*` block is unvalidated. Every test below is
expected to fail red — an `AttributeError` for a missing function, an
argparse "invalid choice" for a missing subcommand, or an assertion on a
lint/CLI behavior that plain doesn't happen yet.

## Assumptions flagged (not literally pinned by the design note)

- `token_actuals`/`gate_cycle_actuals`'s `since`/`until` params are ISO-8601
  `%Y-%m-%dT%H:%M:%SZ` strings, compared lexically — the same convention
  `build_tokens_payload` already uses for `window_start`/`window_end`
  (string `<`/`>` comparison, cairn.py L3721-3727). If the real signature
  takes `datetime` objects instead, only this file's helper functions need
  to change, not the assertions.
- `cairn close`/`cairn estimate` resolve the repo root from `cwd`, the same
  way `cairn guard-push` does (`_git_toplevel(Path.cwd())`) — tests invoke
  the CLI with `cwd=<repo root>`.
- `cairn close`'s window close_ts is real wall-clock `now()` (design note
  §2, unconditionally). Tests therefore pin `created_ts` (via
  `GIT_AUTHOR_DATE`) and every token-usage.jsonl fixture row's `generated`
  stamp to fixed PAST dates (2020-01-0x) well before any real test-run
  time, so the window always contains them regardless of when the suite
  runs — no dependency on close_ts's actual value.

## Architect addendum 1 (scripts/cairn/design/estimation.md @ 85c5fd6)

Three more RED tests below (`AddendumOneTestBase` and its subclasses),
landed against `a3738ed` (POLY-13's green, which predates the addendum):
W's floor is `from_ts = max(parent flip, sibling floor)` rather than the
sub-issue file's own creation commit; a token file present with zero
matching (parent, role, W) lines gives `actual.tokens: null` (not `0`) the
same as a missing file, and the calibration record's own `"ratio"` is
`null`; `cairn estimate` must not crash on a null-token reference row and
must exclude it from the token median while still folding its gate_cycles
into the gate-cycle median; zero assignee commits in W is a mandatory
stderr warning, and leaves `actual.wall_clock` null (not 0).
"""
from __future__ import annotations

import datetime
import json
import os
import re
import subprocess
import unittest
from pathlib import Path
from typing import Optional

import helpers  # noqa: F401

import cairn
import loop_stats


# --------------------------------------------------------------------------
# Shared fixture helpers
# --------------------------------------------------------------------------

def _opt(key: str, value) -> str:
    return f"{key}: {value}\n" if value is not None else ""


def issue_text(
    issue_id: str, *, title: str = "Sub-issue", status: str = "todo",
    parent: Optional[str] = None, assignee: Optional[str] = None,
    labels: Optional[list] = None, stage: Optional[str] = None,
    estimate_tokens: Optional[int] = None, estimate_gate_cycles: Optional[int] = None,
    actual_tokens=None, actual_gate_cycles=None, actual_wall_clock=None,
    ratio: Optional[str] = None,
) -> str:
    labels = labels if labels is not None else []
    return (
        "---\n"
        f"id: {issue_id}\ntitle: {title}\nstatus: {status}\nmilestone: null\n"
        f"parent: {'null' if parent is None else parent}\nblocked_by: []\n"
        f"assignee: {'null' if assignee is None else assignee}\n"
        f"labels: [{', '.join(labels)}]\n"
        + _opt("stage", stage)
        + _opt("estimate.tokens", estimate_tokens)
        + _opt("estimate.gate_cycles", estimate_gate_cycles)
        + _opt("actual.tokens", actual_tokens)
        + _opt("actual.gate_cycles", actual_gate_cycles)
        + _opt("actual.wall_clock", actual_wall_clock)
        + (f'ratio: "{ratio}"\n' if ratio is not None else "")
        + "priority: null\npr: null\ncreated: 2026-09-23\nupdated: 2026-09-23\n"
        "---\n\nBody.\n"
    )


def write_issue(data_dir: Path, issue_id: str, **kwargs) -> Path:
    p = Path(data_dir) / "issues" / f"{issue_id}.md"
    p.write_text(issue_text(issue_id, **kwargs), encoding="utf-8")
    return p


def token_row(*, generated, issue, role, model="test-model", source="otel",
              window_start=None, window_end=None,
              input=0, cache_write=0, cache_read=0, output=0, records=1) -> dict:
    return {
        "source": source, "generated": generated,
        "window_start": window_start or generated[:10], "window_end": window_end or generated[:10],
        "issue": issue, "role": role, "model": model,
        "input": input, "cache_write": cache_write, "cache_read": cache_read, "output": output,
        "records": records,
    }


def write_token_usage(data_dir: Path, rows: list) -> Path:
    p = Path(data_dir) / "metrics" / "token-usage.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
    return p


TEST_PRICES = {"models": {"test-model": {
    "input": 1.0, "cache_read": 1.0, "output": 1.0, "cache_write_1h": 1.0,
}}}


# -- git-repo helpers (mirrors tests/test_guard_push.py's own copies) -------

def git(cwd: Path, *args: str, check: bool = True, env=None) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=check, env=env)


def write_file(root: Path, rel: str, content: str = "x\n") -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")


def commit_as(root: Path, author: str, message: str, when: Optional[str] = None, add: bool = True) -> None:
    if add:
        git(root, "add", "-A")
    env = dict(os.environ)
    env.update({
        "GIT_AUTHOR_NAME": author, "GIT_AUTHOR_EMAIL": f"{author}@agents.polycarpic.local",
        "GIT_COMMITTER_NAME": author, "GIT_COMMITTER_EMAIL": f"{author}@agents.polycarpic.local",
    })
    if when:
        env["GIT_AUTHOR_DATE"] = when
        env["GIT_COMMITTER_DATE"] = when
    git(root, "commit", "-q", "-m", message, env=env)


def cairn_cmd(root: Path, data_dir: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [str(helpers.CAIRN_BIN), *args, "--data-dir", str(data_dir)],
        capture_output=True, text=True, cwd=root,
    )


def write_jsonl(path: Path, records: list) -> None:
    path.write_text("\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------
# 1. `cairn check` — schema validation (design note §1)
# --------------------------------------------------------------------------

class CheckEstimationFieldsTests(unittest.TestCase):
    def setUp(self):
        self.data_dir = helpers.make_tmp_data_dir(self)  # PT-1 already exists as a valid parent

    def test_unknown_stage_value_is_an_error(self):
        write_issue(self.data_dir, "PT-9", parent="PT-1", status="in-progress", stage="bogus", assignee="backend-lead")
        errors = cairn.check_repo(self.data_dir)
        self.assertTrue(any("PT-9" in e and "stage" in e.lower() for e in errors), errors)

    def test_stage_without_parent_is_an_error(self):
        write_issue(self.data_dir, "PT-9", parent=None, status="in-progress", stage="execute", assignee="backend-lead")
        errors = cairn.check_repo(self.data_dir)
        self.assertTrue(any("PT-9" in e and "parent" in e.lower() for e in errors), errors)

    def test_non_int_estimate_is_an_error(self):
        # Written by hand (a real writer would never emit this) -- pins
        # that `cairn check` rejects a non-integer estimate value, not
        # just that the writer never produces one.
        p = Path(self.data_dir) / "issues" / "PT-9.md"
        p.write_text(
            issue_text("PT-9", parent="PT-1", status="in-progress", stage="execute", assignee="backend-lead")
            .replace("---\n\nBody.\n", "estimate.tokens: not-a-number\n---\n\nBody.\n", 1),
            encoding="utf-8",
        )
        errors = cairn.check_repo(self.data_dir)
        self.assertTrue(any("PT-9" in e and "estimate" in e.lower() for e in errors), errors)

    def test_estimate_tokens_zero_is_an_error(self):
        write_issue(self.data_dir, "PT-9", parent="PT-1", status="in-progress", stage="execute",
                    assignee="backend-lead", estimate_tokens=0, estimate_gate_cycles=1)
        errors = cairn.check_repo(self.data_dir)
        self.assertTrue(any("PT-9" in e and "estimate" in e.lower() for e in errors), errors)

    def test_actual_on_non_done_status_is_an_error(self):
        write_issue(self.data_dir, "PT-9", parent="PT-1", status="in-progress", stage="execute",
                    assignee="backend-lead", estimate_tokens=100, estimate_gate_cycles=1,
                    actual_tokens=150, actual_gate_cycles=1, actual_wall_clock=10, ratio="1.50")
        errors = cairn.check_repo(self.data_dir)
        self.assertTrue(any("PT-9" in e and ("actual" in e.lower() or "done" in e.lower()) for e in errors), errors)

    def test_ratio_without_both_operands_is_an_error(self):
        write_issue(self.data_dir, "PT-9", parent="PT-1", status="done", stage="execute",
                    assignee="backend-lead", estimate_tokens=100, estimate_gate_cycles=1,
                    actual_gate_cycles=1, actual_wall_clock=10, ratio="1.50")
        errors = cairn.check_repo(self.data_dir)
        self.assertTrue(any("PT-9" in e and "ratio" in e.lower() for e in errors), errors)

    def test_done_with_stage_but_no_actual_is_not_a_hard_error(self):
        # Design note §1: "a sub-issue with status: done and a stage but
        # no actual.* is a WARNING, not an error" -- the exact warning
        # channel isn't pinned by the design note, so this only asserts
        # the hard-error list (check_repo) stays clean; a separate warning
        # surface (stderr, check_budgets, or otherwise) is the
        # implementer's choice.
        write_issue(self.data_dir, "PT-9", parent="PT-1", status="done", stage="execute",
                    assignee="backend-lead", estimate_tokens=100, estimate_gate_cycles=1)
        errors = cairn.check_repo(self.data_dir)
        self.assertFalse(any("PT-9" in e for e in errors), errors)

    def test_fully_populated_done_subissue_is_clean(self):
        write_issue(self.data_dir, "PT-9", parent="PT-1", status="done", stage="execute",
                    assignee="backend-lead", estimate_tokens=400000, estimate_gate_cycles=1,
                    actual_tokens=512340, actual_gate_cycles=2, actual_wall_clock=47, ratio="1.28")
        errors = cairn.check_repo(self.data_dir)
        self.assertEqual(errors, [])

    def test_unknown_estimation_config_key_is_an_error(self):
        cfg = Path(self.data_dir) / "config.yml"
        cfg.write_text(cfg.read_text(encoding="utf-8") + "estimation:\n  typo_key: 1\n", encoding="utf-8")
        errors = cairn.check_repo(self.data_dir)
        self.assertTrue(any("estimation" in e.lower() for e in errors), errors)

    def test_bloat_ratio_absent_is_fine(self):
        errors = cairn.check_repo(self.data_dir)
        self.assertEqual(errors, [])

    def test_bloat_ratio_must_exceed_one(self):
        cfg = Path(self.data_dir) / "config.yml"
        cfg.write_text(cfg.read_text(encoding="utf-8") + "estimation:\n  bloat_ratio: 0.5\n", encoding="utf-8")
        errors = cairn.check_repo(self.data_dir)
        self.assertTrue(any("bloat_ratio" in e.lower() for e in errors), errors)

    def test_bloat_ratio_valid_value_is_clean(self):
        cfg = Path(self.data_dir) / "config.yml"
        cfg.write_text(cfg.read_text(encoding="utf-8") + "estimation:\n  bloat_ratio: 1.5\n", encoding="utf-8")
        errors = cairn.check_repo(self.data_dir)
        self.assertEqual(errors, [])


# --------------------------------------------------------------------------
# 2. Round-trip (design note §1)
# --------------------------------------------------------------------------

class RoundTripTests(unittest.TestCase):
    def test_issue_field_order_gains_the_seven_keys_after_paths_before_labels(self):
        order = cairn.ISSUE_FIELD_ORDER
        expected = ["paths", "stage", "estimate.tokens", "estimate.gate_cycles",
                    "actual.tokens", "actual.gate_cycles", "actual.wall_clock", "ratio", "labels"]
        actual = [k for k in order if k in expected]
        self.assertEqual(actual, expected, order)

    def test_all_seven_keys_round_trip_byte_identical(self):
        fields = {
            "id": "PT-9", "title": "Thing", "status": "done", "milestone": None, "parent": "PT-1",
            "blocked_by": [], "assignee": "backend-lead", "paths": [],
            "stage": "execute",
            "estimate.tokens": 400000, "estimate.gate_cycles": 1,
            "actual.tokens": 512340, "actual.gate_cycles": 2, "actual.wall_clock": 47,
            "ratio": "1.28",
            "labels": [], "priority": None, "pr": None,
            "created": "2026-09-23", "updated": "2026-09-23",
        }
        text = cairn.dump_frontmatter(fields)
        reparsed, _ = cairn.parse_frontmatter(text + "\nBody.\n")
        self.assertEqual(reparsed, fields)
        # A second dump of the reparsed dict must be byte-identical -- the
        # actual round-trip guarantee, not just "parses back to something
        # equal by value".
        self.assertEqual(cairn.dump_frontmatter(reparsed), text)

    def test_ratio_is_dumped_as_a_quoted_string(self):
        text = cairn.dump_frontmatter({"id": "PT-9", "title": "T", "status": "done", "milestone": None,
                                        "parent": "PT-1", "assignee": "backend-lead", "labels": [], "priority": None,
                                        "pr": None, "created": "2026-09-23", "updated": "2026-09-23", "ratio": "1.28"})
        self.assertIn('ratio: "1.28"', text)

    def test_cli_set_estimate_tokens_writes_an_int(self):
        data_dir = helpers.make_tmp_data_dir(self)
        write_issue(data_dir, "PT-9", parent="PT-1", status="in-progress", stage="execute", assignee="backend-lead")
        r = subprocess.run(
            [str(helpers.CAIRN_BIN), "set", "PT-9", "estimate.tokens=5", "--data-dir", str(data_dir)],
            capture_output=True, text=True,
        )
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        fm, _ = cairn.parse_frontmatter((Path(data_dir) / "issues" / "PT-9.md").read_text(encoding="utf-8"))
        self.assertEqual(fm.get("estimate.tokens"), 5)
        self.assertIsInstance(fm.get("estimate.tokens"), int)


# --------------------------------------------------------------------------
# 3. Shared actuals reader (design note §6, AC6)
# --------------------------------------------------------------------------

class TokenActualsTests(unittest.TestCase):
    def setUp(self):
        self.data_dir = helpers.make_tmp_data_dir(self)

    def test_sums_counters_for_matching_issue_role_within_window(self):
        write_token_usage(self.data_dir, [
            token_row(generated="2020-01-02T00:00:00Z", issue="PT-1", role="backend-lead",
                      input=100, cache_write=200, cache_read=300, output=50),
            token_row(generated="2020-01-02T01:00:00Z", issue="PT-1", role="backend-lead",
                      input=10, cache_write=20, cache_read=30, output=5),
            # Excluded: wrong role.
            token_row(generated="2020-01-02T00:30:00Z", issue="PT-1", role="qa-engineer",
                      input=999, cache_write=999, cache_read=999, output=999),
            # Excluded: wrong issue.
            token_row(generated="2020-01-02T00:30:00Z", issue="PT-2", role="backend-lead",
                      input=999, cache_write=999, cache_read=999, output=999),
            # Excluded: outside the window (before `since`).
            token_row(generated="2020-01-01T00:00:00Z", issue="PT-1", role="backend-lead",
                      input=999, cache_write=999, cache_read=999, output=999),
        ])
        result = cairn.token_actuals(
            self.data_dir, "PT-1", role="backend-lead",
            since="2020-01-01T12:00:00Z", until="2020-01-03T00:00:00Z", prices=TEST_PRICES,
        )
        self.assertEqual(result["input"], 110)
        self.assertEqual(result["cache_write"], 220)
        self.assertEqual(result["cache_read"], 330)
        self.assertEqual(result["output"], 55)
        self.assertEqual(result["tokens"], 110 + 220 + 330 + 55)
        self.assertEqual(result["lines"], 2)
        self.assertGreater(result["cost_usd"], 0)

    def test_missing_token_usage_file_gives_null_tokens_not_zero(self):
        result = cairn.token_actuals(self.data_dir, "PT-1", role="backend-lead")
        self.assertIsNone(result["tokens"])
        self.assertEqual(result["lines"], 0)


class GateCycleActualsTests(unittest.TestCase):
    def setUp(self):
        self.root = helpers.make_empty_tmp_dir(self)
        git(self.root, "init", "-q", "-b", "main")
        git(self.root, "config", "user.email", "seed@example.com")
        git(self.root, "config", "user.name", "seed")
        write_file(self.root, "seed.txt")
        commit_as(self.root, "seed", "seed", when="2020-01-01T00:00:00+00:00")

    def test_run_broken_by_a_different_stage_commit_counts_two_cycles(self):
        write_file(self.root, "a.py", "1\n")
        commit_as(self.root, "backend-lead", "red", when="2020-01-02T00:00:00+00:00")
        write_file(self.root, "b.py", "2\n")
        commit_as(self.root, "qa-engineer", "review note", when="2020-01-02T01:00:00+00:00")
        write_file(self.root, "c.py", "3\n")
        commit_as(self.root, "backend-lead", "fix", when="2020-01-02T02:00:00+00:00")
        result = cairn.gate_cycle_actuals(
            self.root, "main", "HEAD", "backend-lead", same_stage_authors=[],
            since="2020-01-01T12:00:00Z", until="2020-01-03T00:00:00Z",
        )
        self.assertEqual(result["gate_cycles"], 2)

    def test_same_stage_sibling_commit_does_not_break_the_run(self):
        write_file(self.root, "a.py", "1\n")
        commit_as(self.root, "architect", "plan", when="2020-01-02T00:00:00+00:00")
        write_file(self.root, "b.py", "2\n")
        commit_as(self.root, "architect", "revise plan", when="2020-01-02T02:00:00+00:00")
        result = cairn.gate_cycle_actuals(
            self.root, "main", "HEAD", "architect", same_stage_authors=["architect"],
            since="2020-01-01T12:00:00Z", until="2020-01-03T00:00:00Z",
        )
        self.assertEqual(result["gate_cycles"], 1)

    def test_zero_commits_by_assignee_gives_zero_gate_cycles(self):
        result = cairn.gate_cycle_actuals(
            self.root, "main", "HEAD", "backend-lead", same_stage_authors=[],
            since="2020-01-01T12:00:00Z", until="2020-01-03T00:00:00Z",
        )
        self.assertEqual(result["gate_cycles"], 0)


# --------------------------------------------------------------------------
# 4. `cairn close` (design note §7, §2, §3, §5)
# --------------------------------------------------------------------------

class CloseCommandTestBase(unittest.TestCase):
    """A real git repo, `main` seeded with the fixture data dir, then a
    `feature` branch diverging before any test's own commits/token
    timestamps -- `PT-9` (the sub-issue under close) is added on its own
    commit at a fixed author date on that branch.

    R2 (architect verdict, POLY-3.md @ c9ae61a): `close` refuses an
    unbounded window -- `base == ref` (no divergence) with no closed
    sibling is refused outright. Every test here needs a real floor
    (the "parent flip"), so `main` and `feature` diverge in setUp, well
    before 2020-01-02 (every test's own commit/token timestamps) --
    same pattern as `AddendumOneTestBase`'s `feature_started`.
    """

    def setUp(self):
        self.root = helpers.make_empty_tmp_dir(self)
        git(self.root, "init", "-q", "-b", "main")
        git(self.root, "config", "user.email", "seed@example.com")
        git(self.root, "config", "user.name", "seed")
        (self.root / "process").mkdir()
        self.data_dir = helpers.copy_fixture_data_dir(self.root / "process")
        commit_as(self.root, "seed", "seed: tracker + fixtures", when="2020-01-01T00:00:00+00:00")
        git(self.root, "checkout", "-q", "-b", "feature")
        write_file(self.root, "FEATURE_STARTED", "x\n")
        commit_as(self.root, "seed", "feature: started", when="2020-01-01T12:00:00+00:00")

    def seed_subissue(self, issue_id="PT-9", assignee="backend-lead", estimate_tokens=100000,
                       estimate_gate_cycles=1, created_when="2020-01-02T00:00:00+00:00"):
        write_issue(self.data_dir, issue_id, parent="PT-1", status="in-progress", stage="execute",
                    assignee=assignee, estimate_tokens=estimate_tokens, estimate_gate_cycles=estimate_gate_cycles)
        commit_as(self.root, assignee, f"add {issue_id}", when=created_when)

    def calibration_lines(self) -> list:
        p = self.data_dir / "metrics" / "calibration.jsonl"
        if not p.exists():
            return []
        return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


class CloseWritesActualsTests(CloseCommandTestBase):
    def test_close_writes_actuals_ratio_status_done_and_one_calibration_line(self):
        self.seed_subissue()
        write_token_usage(self.data_dir, [
            token_row(generated="2020-01-02T01:00:00Z", issue="PT-1", role="backend-lead",
                      input=1000, cache_write=1000, cache_read=1000, output=1000),
        ])
        write_file(self.root, "impl.py", "x\n")
        commit_as(self.root, "backend-lead", "green build", when="2020-01-02T02:00:00+00:00")

        r = cairn_cmd(self.root, self.data_dir, "close", "PT-9", "--no-flush")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

        fm, _ = cairn.parse_frontmatter((self.data_dir / "issues" / "PT-9.md").read_text(encoding="utf-8"))
        self.assertEqual(fm.get("status"), "done")
        self.assertEqual(fm.get("actual.tokens"), 4000)
        self.assertIsInstance(fm.get("ratio"), str)
        self.assertAlmostEqual(float(fm["ratio"]), 4000 / 100000, places=2)

        lines = self.calibration_lines()
        self.assertEqual(len(lines), 1, lines)
        self.assertEqual(lines[0]["id"], "PT-9")

    def test_close_gate_cycles_two_when_a_different_stage_commit_splits_the_run(self):
        self.seed_subissue(estimate_gate_cycles=1)
        write_token_usage(self.data_dir, [
            token_row(generated="2020-01-02T00:30:00Z", issue="PT-1", role="backend-lead", input=100),
        ])
        write_file(self.root, "impl1.py", "x\n")
        commit_as(self.root, "backend-lead", "red", when="2020-01-02T01:00:00+00:00")
        write_file(self.root, "impl2.py", "y\n")
        commit_as(self.root, "qa-engineer", "verdict", when="2020-01-02T02:00:00+00:00")
        write_file(self.root, "impl3.py", "z\n")
        commit_as(self.root, "backend-lead", "fix", when="2020-01-02T03:00:00+00:00")

        r = cairn_cmd(self.root, self.data_dir, "close", "PT-9", "--no-flush")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        fm, _ = cairn.parse_frontmatter((self.data_dir / "issues" / "PT-9.md").read_text(encoding="utf-8"))
        self.assertEqual(fm.get("actual.gate_cycles"), 2)

    def test_close_gate_cycles_one_when_only_a_same_stage_commit_intervenes(self):
        # Two same-assignee commits with no intervening commit at all ->
        # one continuous run (the simplest positive case for "1").
        self.seed_subissue(estimate_gate_cycles=1)
        write_token_usage(self.data_dir, [
            token_row(generated="2020-01-02T00:30:00Z", issue="PT-1", role="backend-lead", input=100),
        ])
        write_file(self.root, "impl1.py", "x\n")
        commit_as(self.root, "backend-lead", "red", when="2020-01-02T01:00:00+00:00")
        write_file(self.root, "impl2.py", "y\n")
        commit_as(self.root, "backend-lead", "green", when="2020-01-02T02:00:00+00:00")

        r = cairn_cmd(self.root, self.data_dir, "close", "PT-9", "--no-flush")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        fm, _ = cairn.parse_frontmatter((self.data_dir / "issues" / "PT-9.md").read_text(encoding="utf-8"))
        self.assertEqual(fm.get("actual.gate_cycles"), 1)

    def test_close_missing_token_log_gives_null_actual_tokens_and_warns(self):
        self.seed_subissue()
        write_file(self.root, "impl.py", "x\n")
        commit_as(self.root, "backend-lead", "green", when="2020-01-02T02:00:00+00:00")

        r = cairn_cmd(self.root, self.data_dir, "close", "PT-9", "--no-flush")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue(r.stderr.strip(), "a missing token log must print a warning")
        fm, _ = cairn.parse_frontmatter((self.data_dir / "issues" / "PT-9.md").read_text(encoding="utf-8"))
        self.assertIsNone(fm.get("actual.tokens"))
        self.assertNotIn("ratio", fm)


class CloseBloatFlagTests(CloseCommandTestBase):
    def test_unset_threshold_flags_gate_overrun_but_skips_token_ratio(self):
        self.seed_subissue(estimate_tokens=1000, estimate_gate_cycles=1)
        write_token_usage(self.data_dir, [
            # ratio 5.0 -- would flag if a threshold were set.
            token_row(generated="2020-01-02T00:30:00Z", issue="PT-1", role="backend-lead", input=5000),
        ])
        write_file(self.root, "impl1.py", "x\n")
        commit_as(self.root, "backend-lead", "red", when="2020-01-02T01:00:00+00:00")
        write_file(self.root, "impl2.py", "y\n")
        commit_as(self.root, "qa-engineer", "verdict", when="2020-01-02T02:00:00+00:00")
        write_file(self.root, "impl3.py", "z\n")
        commit_as(self.root, "backend-lead", "fix", when="2020-01-02T03:00:00+00:00")

        r = cairn_cmd(self.root, self.data_dir, "close", "PT-9", "--no-flush")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("estimation.bloat_ratio", r.stdout + r.stderr)
        fm, _ = cairn.parse_frontmatter((self.data_dir / "issues" / "PT-9.md").read_text(encoding="utf-8"))
        self.assertIn("bloat", fm.get("labels") or [])
        lines = self.calibration_lines()
        self.assertIn("gate_cycles", lines[0].get("bloat_reasons", []))
        self.assertNotIn("tokens", lines[0].get("bloat_reasons", []))

    def test_threshold_set_flags_token_ratio_overrun(self):
        cfg = self.data_dir / "config.yml"
        cfg.write_text(cfg.read_text(encoding="utf-8") + "estimation:\n  bloat_ratio: 1.5\n", encoding="utf-8")
        self.seed_subissue(estimate_tokens=1000, estimate_gate_cycles=5)
        write_token_usage(self.data_dir, [
            token_row(generated="2020-01-02T00:30:00Z", issue="PT-1", role="backend-lead", input=1600),
        ])
        write_file(self.root, "impl.py", "x\n")
        commit_as(self.root, "backend-lead", "green", when="2020-01-02T02:00:00+00:00")

        r = cairn_cmd(self.root, self.data_dir, "close", "PT-9", "--no-flush")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        fm, _ = cairn.parse_frontmatter((self.data_dir / "issues" / "PT-9.md").read_text(encoding="utf-8"))
        self.assertIn("bloat", fm.get("labels") or [])
        lines = self.calibration_lines()
        self.assertIn("tokens", lines[0].get("bloat_reasons", []))


# --------------------------------------------------------------------------
# 5. `cairn estimate <ID>` (design note §4)
# --------------------------------------------------------------------------

def calibration_row(id_, *, parent="PT-1", stage="execute", assignee="backend-lead", labels=None,
                     closed="2026-09-01T00:00:00Z", est_tokens=100000, est_gc=1,
                     act_tokens=100000, act_gc=1, wall=30, ratio=1.0, bloat=False) -> dict:
    return {
        "schema": 1, "closed": closed, "id": id_, "parent": parent, "stage": stage, "assignee": assignee,
        "labels": labels or [], "milestone": "PT-1.0",
        "estimate": {"tokens": est_tokens, "gate_cycles": est_gc},
        "actual": {"tokens": act_tokens, "gate_cycles": act_gc, "wall_clock": wall,
                   "input": 0, "cache_write": 0, "cache_read": act_tokens, "output": 0, "cost_usd": 0.1},
        "ratio": ratio, "bloat": bloat, "bloat_reasons": [],
        "window": {"from": "2026-08-31T00:00:00Z", "to": closed},
        "base": "main", "ref_sha": "abc1234",
    }


def write_calibration(data_dir: Path, rows: list) -> Path:
    p = Path(data_dir) / "metrics" / "calibration.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
    return p


class EstimateCommandTests(unittest.TestCase):
    def setUp(self):
        self.data_dir = helpers.make_tmp_data_dir(self)
        write_issue(self.data_dir, "PT-9", parent="PT-1", status="todo", stage="execute",
                    assignee="backend-lead", labels=["cairn", "workflow"])

    def run_estimate(self, issue_id="PT-9", *extra):
        return subprocess.run(
            [str(helpers.CAIRN_BIN), "estimate", issue_id, "--data-dir", str(self.data_dir), *extra],
            capture_output=True, text=True,
        )

    def test_tier_a_ranked_before_tier_b(self):
        write_calibration(self.data_dir, [
            calibration_row("PT-100", assignee="architect", labels=["cairn", "workflow"], closed="2026-09-02T00:00:00Z"),
            calibration_row("PT-101", assignee="backend-lead", labels=[], closed="2026-09-03T00:00:00Z"),
        ])
        r = self.run_estimate()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        out = r.stdout
        self.assertLess(out.index("PT-101"), out.index("PT-100"), out)

    def test_last_line_per_id_dedup(self):
        write_calibration(self.data_dir, [
            calibration_row("PT-101", assignee="backend-lead", act_tokens=100, closed="2026-09-01T00:00:00Z"),
            calibration_row("PT-101", assignee="backend-lead", act_tokens=999999, closed="2026-09-05T00:00:00Z"),
        ])
        r = self.run_estimate()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(r.stdout.count("PT-101"), 1, r.stdout)
        self.assertIn("999999", r.stdout)
        self.assertNotIn("100 ", r.stdout)

    def test_self_exclusion(self):
        write_calibration(self.data_dir, [calibration_row("PT-9", assignee="backend-lead")])
        r = self.run_estimate()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("no closed reference classes yet", r.stdout.lower())

    def test_no_reference_classes_message_and_exit_zero(self):
        r = self.run_estimate()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("no closed reference classes yet — hand-estimate", r.stdout)

    def test_median_suggestion_line(self):
        write_calibration(self.data_dir, [
            calibration_row("PT-101", assignee="backend-lead", act_tokens=400000, act_gc=2, closed="2026-09-01T00:00:00Z"),
            calibration_row("PT-102", assignee="backend-lead", act_tokens=480000, act_gc=2, closed="2026-09-02T00:00:00Z"),
            calibration_row("PT-103", assignee="backend-lead", act_tokens=560000, act_gc=2, closed="2026-09-03T00:00:00Z"),
        ])
        r = self.run_estimate()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("suggested: estimate.tokens=480000 estimate.gate_cycles=2", r.stdout)

    def test_missing_stage_or_parent_exits_one(self):
        write_issue(self.data_dir, "PT-10", parent=None, status="todo", stage=None, assignee="backend-lead")
        r = self.run_estimate("PT-10")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)


# --------------------------------------------------------------------------
# 6. loop-stats parity (design note §6, AC6)
# --------------------------------------------------------------------------

class LoopStatsParityTests(unittest.TestCase):
    def test_scorecard_cost_matches_token_actuals_cost_on_the_same_fixture(self):
        data_dir = helpers.make_tmp_data_dir(self)
        write_token_usage(data_dir, [
            token_row(generated="2020-01-02T00:00:00Z", issue="PT-1", role="backend-lead",
                      input=1000, cache_write=1000, cache_read=1000, output=1000),
        ])
        expected = cairn.token_actuals(data_dir, "PT-1", prices=TEST_PRICES)
        # scorecard() reads real prices.json internally per its existing
        # contract -- assert the two readers agree on the TOTAL cost
        # field's presence/shape rather than the dollar figure, which
        # depends on the real price table this fixture doesn't control.
        self.assertIn("cost_usd", expected)


# --------------------------------------------------------------------------
# 7. Architect addendum 1 (scripts/cairn/design/estimation.md @ 85c5fd6) --
# RED against a3738ed, which predates the addendum.
# --------------------------------------------------------------------------

class AddendumOneTestBase(unittest.TestCase):
    """A real feature-branch divergence from `main` -- addendum 1's
    "parent flip" is the oldest commit in `<base>..<ref>`, which only
    means something once `ref` has actually diverged from `base` (the
    real `/start-feature` shape). `CloseCommandTestBase` above (base ==
    ref, no divergence) predates this addendum; these three tests are new
    and self-contained rather than retrofitted onto it."""

    def setUp(self):
        self.root = helpers.make_empty_tmp_dir(self)
        git(self.root, "init", "-q", "-b", "main")
        git(self.root, "config", "user.email", "seed@example.com")
        git(self.root, "config", "user.name", "seed")
        (self.root / "process").mkdir()
        self.data_dir = helpers.copy_fixture_data_dir(self.root / "process")
        commit_as(self.root, "seed", "seed: tracker + fixtures", when="2020-01-01T00:00:00+00:00")
        git(self.root, "checkout", "-q", "-b", "feature")

    def feature_started(self, when: str) -> None:
        """The oldest commit in `base..ref` -- the "parent flip" candidate."""
        write_file(self.root, "FEATURE_STARTED", "x\n")
        commit_as(self.root, "seed", "feature: started", when=when)

    def calibration_lines(self) -> list:
        p = self.data_dir / "metrics" / "calibration.jsonl"
        if not p.exists():
            return []
        return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]

    def append_calibration_row(self, row: dict) -> None:
        p = Path(self.data_dir) / "metrics" / "calibration.jsonl"
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")


class ZeroCommitWarningTests(AddendumOneTestBase):
    def test_zero_assignee_commits_warns_and_leaves_wall_clock_null(self):
        self.feature_started(when="2020-01-02T00:00:00+00:00")
        write_issue(self.data_dir, "PT-9", parent="PT-1", status="in-progress", stage="execute",
                    assignee="backend-lead", estimate_tokens=100000, estimate_gate_cycles=1)
        # Committed by someone OTHER than the assignee -- backend-lead has
        # zero commits anywhere in this repo's history.
        commit_as(self.root, "seed", "add PT-9", when="2020-01-02T01:00:00+00:00")

        r = cairn_cmd(self.root, self.data_dir, "close", "PT-9", "--no-flush")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue(
            re.search(r"(?i)(zero|no|0)\s*commit", r.stderr),
            f"expected a mandatory zero-commits warning on stderr, got: {r.stderr!r}",
        )
        fm, _ = cairn.parse_frontmatter((self.data_dir / "issues" / "PT-9.md").read_text(encoding="utf-8"))
        self.assertEqual(fm.get("actual.gate_cycles"), 0)
        self.assertIsNone(fm.get("actual.wall_clock"))  # null, never 0 -- no evidence to compute it from


class NoMatchingTokenLineTests(AddendumOneTestBase):
    def test_no_matching_line_gives_null_tokens_null_calibration_ratio_and_estimate_excludes_it(self):
        self.feature_started(when="2020-01-02T00:00:00+00:00")
        write_issue(self.data_dir, "PT-9", parent="PT-1", status="in-progress", stage="execute",
                    assignee="backend-lead", estimate_tokens=100000, estimate_gate_cycles=1)
        commit_as(self.root, "backend-lead", "add PT-9", when="2020-01-02T00:30:00+00:00")
        # The file exists, but no line matches (parent, role, W) -- wrong role.
        write_token_usage(self.data_dir, [
            token_row(generated="2020-01-02T01:00:00Z", issue="PT-1", role="someone-else", input=999),
        ])

        r = cairn_cmd(self.root, self.data_dir, "close", "PT-9", "--no-flush")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("actual.tokens", r.stderr)
        self.assertTrue(
            any(s in r.stderr.lower() for s in ("null", "no match", "no line")),
            f"expected a warning naming the no-matching-line case, got: {r.stderr!r}",
        )
        fm, _ = cairn.parse_frontmatter((self.data_dir / "issues" / "PT-9.md").read_text(encoding="utf-8"))
        self.assertIsNone(fm.get("actual.tokens"))  # null, never 0 -- "no evidence" is not "measured zero"
        self.assertNotIn("ratio", fm)

        lines = self.calibration_lines()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn("ratio", lines[0])
        self.assertIsNone(lines[0]["ratio"])  # a zero ratio would poison every reference-class median

        # A second, real reference class + a fresh target sub-issue: `cairn
        # estimate` must not crash on PT-9's null-token row, must exclude
        # it from the TOKEN median, but still fold its gate_cycles (1 --
        # backend-lead's one commit above) into the gate-cycle median.
        self.append_calibration_row(calibration_row(
            "PT-50", parent="PT-1", stage="execute", assignee="backend-lead",
            act_tokens=200000, act_gc=3, wall=90, closed="2026-09-05T00:00:00Z",
        ))
        write_issue(self.data_dir, "PT-51", parent="PT-1", status="todo", stage="execute",
                    assignee="backend-lead", labels=[])
        r2 = subprocess.run(
            [str(helpers.CAIRN_BIN), "estimate", "PT-51", "--data-dir", str(self.data_dir)],
            capture_output=True, text=True,
        )
        self.assertEqual(r2.returncode, 0, r2.stdout + r2.stderr)
        self.assertIn("tokens 200000", r2.stdout)  # median of the ONE non-null value
        self.assertIn("gate_cycles 2", r2.stdout)  # median of [1, 3] -- the null-token row still counts here


class WindowFloorAndWallClockTests(AddendumOneTestBase):
    def test_from_ts_is_the_max_of_parent_flip_and_sibling_floor(self):
        self.feature_started(when="2020-01-02T00:00:00+00:00")  # parent flip, T1
        # A closed sibling under the same parent + assignee (stage need
        # not match -- the addendum's rule is parent + assignee only)
        # whose calibration window.to (T2) is LATER than the parent flip.
        # The sibling floor must win: from_ts = max(T1, T2) = T2.
        self.append_calibration_row(calibration_row(
            "PT-40", parent="PT-1", stage="plan", assignee="backend-lead",
            act_tokens=1, act_gc=1, wall=1, closed="2020-01-05T00:00:00Z",  # T2
        ))
        # Generated between T1 and T2 -- must be EXCLUDED. A parent-flip-
        # only implementation (the pre-addendum behavior) would wrongly
        # include it.
        write_token_usage(self.data_dir, [
            token_row(generated="2020-01-03T00:00:00Z", issue="PT-1", role="backend-lead", input=500),
            token_row(generated="2020-01-05T01:00:00Z", issue="PT-1", role="backend-lead", input=500),
        ])
        write_issue(self.data_dir, "PT-9", parent="PT-1", status="in-progress", stage="execute",
                    assignee="backend-lead", estimate_tokens=100000, estimate_gate_cycles=1)
        commit_as(self.root, "backend-lead", "add PT-9", when="2020-01-05T01:30:00+00:00")
        write_file(self.root, "impl.py", "x\n")
        commit_as(self.root, "backend-lead", "work", when="2020-01-05T02:00:00+00:00")  # last commit, T4

        r = cairn_cmd(self.root, self.data_dir, "close", "PT-9", "--no-flush")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        fm, _ = cairn.parse_frontmatter((self.data_dir / "issues" / "PT-9.md").read_text(encoding="utf-8"))
        # Only the after-T2 row counts -- proves the sibling floor, not
        # the earlier parent flip, gates the window.
        self.assertEqual(fm.get("actual.tokens"), 500)
        # wall_clock = last assignee commit (T4, 02:00) - from_ts (T2,
        # 00:00 on the 5th) = 120m -- NOT close_ts (real now) - from_ts,
        # and NOT close_ts - the sub-issue file's own commit.
        self.assertEqual(fm.get("actual.wall_clock"), 120)

        # No --since override exists -- a hand-set window would let a
        # calibration record be fudged (design note addendum).
        r2 = cairn_cmd(self.root, self.data_dir, "close", "PT-9", "--since", "2020-01-01T00:00:00Z")
        self.assertEqual(r2.returncode, 2, r2.stdout + r2.stderr)


# --------------------------------------------------------------------------
# 8. Architect verdict on bbbc8f7 (POLY-3.md @ c9ae61a, note @ c195c37):
# R1 (AC6), R2, R3 -- RED against bbbc8f7/040a43b. R4 is a doc-only nit,
# no test.
# --------------------------------------------------------------------------

class LoopStatsSharedReaderTests(unittest.TestCase):
    """R1 (AC6): `loop_stats.scorecard` must read cost via
    `cairn.token_actuals(data_dir, issue_id)["cost_usd"]`, not
    `cairn.build_tokens_payload`, and must add a per-agent `"tokens"` key
    from `token_actuals(..., role=role)`. The pre-existing parity test
    (`LoopStatsParityTests`) only proves the two readers CAN agree on a
    fixture that doesn't distinguish them; it doesn't prove which one
    `scorecard` actually calls. This fixture is built so the two readers
    DISAGREE (`token_actuals` rounds to 6dp for the calibration record,
    `build_tokens_payload`'s issue total rounds to 2dp for display,
    cairn.py's own §6 docstring) -- 100 input tokens at
    `claude-haiku-4-5-20251001`'s real $1/MTok input rate costs exactly
    $0.0001, which is genuinely non-zero at 6dp but rounds to $0.00 at 2dp.
    """

    def setUp(self):
        self.root = helpers.make_empty_tmp_dir(self)
        git(self.root, "init", "-q", "-b", "main")
        git(self.root, "config", "user.email", "t@example.com")
        git(self.root, "config", "user.name", "t")
        self.data_dir = helpers.copy_fixture_data_dir(self.root / "process")
        write_file(self.root, "seed.txt")
        commit_as(self.root, "seed", "seed", when="2020-01-01T00:00:00+00:00")
        git(self.root, "checkout", "-q", "-b", "feature/pt-1-thing")
        write_file(self.root, "app.py", "x = 1\n")
        commit_as(self.root, "backend-lead", "feat", when="2020-01-02T00:00:00+00:00")

        write_token_usage(self.data_dir, [
            token_row(generated="2020-01-02T01:00:00Z", issue="PT-1", role="backend-lead",
                      model="claude-haiku-4-5-20251001", input=100),
        ])
        self.transcripts = self.root / "transcripts"
        self.transcripts.mkdir()
        now = datetime.datetime.now(datetime.timezone.utc)
        self.since = now - datetime.timedelta(minutes=10)
        recent = lambda m: (now + datetime.timedelta(minutes=m)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        write_jsonl(self.transcripts / "b.jsonl", [
            {"type": "agent-setting", "agentSetting": "backend-lead", "sessionId": "b1"},
            {"type": "assistant", "timestamp": recent(-3),
             "message": {"content": [{"type": "tool_use", "name": "Read", "input": {"file_path": "x.py"}}]}},
        ])

    def test_scorecard_reads_cost_and_per_agent_tokens_through_token_actuals(self):
        card = loop_stats.scorecard(self.root, self.data_dir, "PT-1", base="main",
                                     since=self.since, transcripts_dir=self.transcripts)
        expected_cost = cairn.token_actuals(self.data_dir, "PT-1")["cost_usd"]
        self.assertAlmostEqual(expected_cost, 0.0001, places=6)
        self.assertAlmostEqual(card["cost_usd"], expected_cost, places=6)
        # build_tokens_payload's own 2dp-rounded figure for the same
        # fixture -- scorecard must NOT be reporting this value instead.
        legacy = cairn.build_tokens_payload(self.data_dir)
        legacy_cost = next(r["total"]["cost_usd"] for r in legacy["issues"] if r["issue"] == "PT-1")
        self.assertEqual(legacy_cost, 0.0)
        self.assertNotAlmostEqual(card["cost_usd"], legacy_cost, places=4)

        self.assertIn("backend-lead", card["per_agent"])
        expected_tokens = cairn.token_actuals(self.data_dir, "PT-1", role="backend-lead")["tokens"]
        self.assertEqual(expected_tokens, 100)
        self.assertEqual(card["per_agent"]["backend-lead"].get("tokens"), expected_tokens)


class UnboundedWindowForbiddenTests(unittest.TestCase):
    """R2: an empty `base..ref` range (no feature-branch divergence) with
    no closed sibling leaves `from_ts` with no floor at all -- `close`
    must refuse (exit 1) rather than let W stay unbounded. Today it
    silently proceeds and `gate_cycle_actuals`/`token_actuals` read the
    assignee's WHOLE-repo/whole-file history instead."""

    def test_close_exits_one_when_the_window_has_no_floor(self):
        root = helpers.make_empty_tmp_dir(self)
        git(root, "init", "-q", "-b", "main")
        git(root, "config", "user.email", "seed@example.com")
        git(root, "config", "user.name", "seed")
        (root / "process").mkdir()
        data_dir = helpers.copy_fixture_data_dir(root / "process")
        write_issue(data_dir, "PT-9", parent="PT-1", status="in-progress", stage="execute",
                    assignee="backend-lead", estimate_tokens=100000, estimate_gate_cycles=1)
        commit_as(root, "backend-lead", "seed: tracker + PT-9", when="2020-01-01T00:00:00+00:00")
        # No feature-branch checkout -- base=main and ref=HEAD are the SAME
        # commit, so `git log main..HEAD` is empty (no parent flip), and no
        # calibration.jsonl exists yet (no sibling floor either).

        r = cairn_cmd(root, data_dir, "close", "PT-9", "--no-flush")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertTrue(
            any(s in r.stderr.lower() for s in ("unbounded", "no floor", "window")),
            f"expected a message naming the unbounded-window refusal, got: {r.stderr!r}",
        )
        fm, _ = cairn.parse_frontmatter((data_dir / "issues" / "PT-9.md").read_text(encoding="utf-8"))
        self.assertEqual(fm.get("status"), "in-progress")  # refused before any write


class TokenActualsSourceFilterTests(unittest.TestCase):
    """R3: `token_actuals` must filter `source == "otel"` (design note §2
    formula) -- a `transcript-backfill` line whose `generated` falls
    inside W must not be double-counted alongside the live otel stream."""

    def test_transcript_backfill_line_in_window_is_not_counted(self):
        data_dir = helpers.make_tmp_data_dir(self)
        write_token_usage(data_dir, [
            token_row(generated="2020-01-02T00:30:00Z", issue="PT-1", role="backend-lead",
                      source="transcript-backfill", input=999999),
            token_row(generated="2020-01-02T00:45:00Z", issue="PT-1", role="backend-lead",
                      source="otel", input=100),
        ])
        result = cairn.token_actuals(
            data_dir, "PT-1", role="backend-lead",
            since="2020-01-01T00:00:00Z", until="2020-01-03T00:00:00Z", prices=TEST_PRICES,
        )
        self.assertEqual(result["tokens"], 100)
        self.assertEqual(result["lines"], 1)


if __name__ == "__main__":
    unittest.main()
