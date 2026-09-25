"""PT-86 failing acceptance tests: the receiver stops itself when the
LAST session on the repo ends, only after the exporter's final flush has
had a grace window to land (process/cairn/issues/PT-86.md, ruling
2026-09-04).

## Seam, agreed with implementation-lead before this file was written
(SendMessage, 2026-09-04) -- if the actual build lands under different
names, only this file's helpers/flag lists need to change, not the
acceptance shape:

CLI (`otel_receiver.py`):
    --ensure-running --session-id ID --session-pid PID
        Registers a live session (in addition to ensure_running's
        existing spawn-if-needed behaviour) and cancels any pending
        grace-shutdown in an already-running daemon. Still exits 0
        always.
    --session-ended ID
        Deregisters a session, reaps any OTHER recorded session whose
        pid has died (the crash backstop -- ruling's "liveness probe...
        run on every decrement"), and pings the daemon to re-evaluate.
        No daemon running -> no-op, exit 0. Same exit-0 discipline as
        --ensure-running (this is the SessionEnd hook's target).
    --grace-period-seconds N (default 10; bare/serve invocation)
        The wait, after the LAST session ends, before flush + exit.
        Threaded through ensure_running's spawn args. Tests always pass
        something short (<1s) -- never the real 10s default.
    --status
        Gains `sessions: N` and one `session <id>: alive|dead` line per
        RECORDED id (sorted), on top of the existing running/port/
        out-file lines. A fresh, non-mutating probe every call --- only
        --session-ended and a flush actually reap stale entries.

Pure, socket-free functions (mirrors the parse_export/fold/flush
seam-discipline this module already follows):
    _sessions_dir(pidfile: Path) -> Path
    register_session(sessions_dir, session_id: str, pid: int) -> None
    deregister_session(sessions_dir, session_id: str) -> None
    reap_dead_sessions(sessions_dir, is_alive=_pid_is_alive) -> List[str]
    live_session_ids(sessions_dir) -> Dict[str, int]

## Why "two fake project roots" again

Same reason as test_otel_receiver_hardening.py's module docstring:
`ensure_running`/`--status`/the bare-invocation `serve()` path all derive
`repo_root` from the SCRIPT's own on-disk location, not cwd or
--repo-root. A throwaway copy of the engine under a scratch tmp dir is
the only way to drive the real hook-invocation code path (spawn, pidfile,
signals, self-stop) against an isolated tracker. `make_fake_engine_root`/
`run_fake_receiver`/`_minimal_env`/`_free_port` below are a deliberate
near-duplicate of that file's versions (same project convention: each
otel_receiver test module carries its own copy rather than sharing
scaffolding across files that must stay independently readable).

## AC2's "provably" -- how

basic.json (already used by test_otel_receiver.py for the one other
socket-touching test in this suite) carries a single measured,
distinctive fingerprint: `cairn.issue: POLY-95`, and its `type: "input"`
datapoint's value is exactly 100. A real HTTP POST of those exact bytes,
sent to the daemon's bound port strictly AFTER the last SessionEnd fires
(i.e. inside the grace window, before the timer's deadline), followed by
reading the flushed line back out of --out-file after the process has
self-stopped, is the only way to prove the datapoint that arrived DURING
grace survived into the FINAL flush rather than being dropped on exit.

## AC4 -- the real committed data file

Module-level `setUpModule`/`tearDownModule` snapshot process/cairn/metrics/
token-usage.jsonl's bytes once before any test in this module runs, and
re-check them unchanged after the very last one -- on top of every
individual test's own --out-file pointing at a fake root's own tree,
never the real one. Deliberately module-level rather than a TestCase's
setUpClass/tearDownClass: unittest loads classes alphabetically by name,
so a class-scoped guard only brackets its own class, not ones that sort
after it.
"""
from __future__ import annotations

import contextlib
import http.client
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Optional

import helpers  # noqa: F401

import otel_receiver

SCRIPT_PATH = helpers.CAIRN_DIR / "otel_receiver.py"
FIXTURES = helpers.FIXTURES_DIR / "otlp"
SETTINGS_PATH = helpers.TESTS_DIR.parent.parent.parent / ".claude" / "settings.json"
GITIGNORE_PATH = helpers.TESTS_DIR.parent.parent.parent / ".gitignore"
REAL_METRICS_DIR = helpers.TESTS_DIR.parent.parent.parent / "process" / "cairn" / "metrics"
REAL_TOKEN_USAGE_PATH = REAL_METRICS_DIR / "token-usage.jsonl"
REAL_RECEIVER_PIDFILE = REAL_METRICS_DIR / ".receiver.pid"
REAL_SESSIONS_DIR = REAL_METRICS_DIR / ".sessions"

ENGINE_FILES = ("otel_receiver.py", "backfill_tokens.py", "cairn.py")

# PT-105 (architect's ruling, PT-105.md @ e66af1e): the grace period an
# IN-WINDOW operation must complete inside, for the two tests whose
# margin assertion measured < 1.0s of headroom at rest. Deliberately
# distinct from the wait-PAST-the-window deadlines (still 0.4s) --
# growing those buys no safety, only wall cost. Documented fallback if
# this file's cost is ever re-litigated: 1.0 (0.5s floor) still holds
# >= 4.6x measured margin -- do not go below that floor.
INSIDE_WINDOW_GRACE = 2.0


# --------------------------------------------------------------------------
# "Two fake project roots" fixture -- see module docstring.
# --------------------------------------------------------------------------

def make_fake_engine_root(testcase, otel_port: Optional[int] = None) -> Path:
    root = helpers.make_empty_tmp_dir(testcase)
    engine_dir = root / "scripts" / "cairn"
    engine_dir.mkdir(parents=True)
    for name in ENGINE_FILES:
        shutil.copy2(helpers.CAIRN_DIR / name, engine_dir / name)
    data_dir = root / "process" / "cairn"
    data_dir.mkdir(parents=True)
    lines = ["prefix: PT", "port: 8766"]
    if otel_port is not None:
        lines.append(f"otel_port: {otel_port}")
    (data_dir / "config.yml").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return root


# POLY-49 gate-1 ruling addendum 1 (architect, POLY-49.md @ 646bdb3):
# "helpers' _base_env sets CLAUDE_CONFIG_DIR=<per-test tmp dir, empty>
# for every receiver subprocess" -- module-level, shared, never written
# into, so POLY-25's resolver never reads the REAL ~/.claude/
# settings.json this machine may hold once the ruling's user-action
# delta lands there.
_HERMETIC_CLAUDE_CONFIG_DIR = tempfile.mkdtemp(prefix="cairn-test-empty-claude-config-")


def _minimal_env(**overrides: str) -> dict:
    """A from-scratch env -- this is itself a live Claude Code session,
    which already has telemetry enabled in ITS OWN environment. Never
    inherit os.environ wholesale (same reasoning as the hardening
    suite's helper of the same name)."""
    base = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "CLAUDE_CONFIG_DIR": _HERMETIC_CLAUDE_CONFIG_DIR}
    if "HOME" in os.environ:
        base["HOME"] = os.environ["HOME"]
    base.update(overrides)
    return base


def run_fake_receiver(fake_root: Path, args: list[str], env: Optional[dict] = None) -> subprocess.CompletedProcess:
    script = fake_root / "scripts" / "cairn" / "otel_receiver.py"
    return subprocess.run(
        [sys.executable, str(script), *args],
        capture_output=True, text=True, cwd=str(fake_root),
        env=env if env is not None else _minimal_env(),
    )


def _pidfile_path(fake_root: Path) -> Path:
    return fake_root / "process" / "cairn" / "metrics" / ".receiver.pid"


def _out_path(fake_root: Path) -> Path:
    return fake_root / "process" / "cairn" / "metrics" / "token-usage.jsonl"


def _log_path(fake_root: Path) -> Path:
    # PT-90: otel_receiver.py's own LOGFILE_REL -- the daemon's stderr,
    # detached onto this file by --ensure-running.
    return fake_root / "process" / "cairn" / "metrics" / "otel_receiver.log"


def _log_lines(fake_root: Path) -> list[str]:
    path = _log_path(fake_root)
    return path.read_text(encoding="utf-8").splitlines() if path.exists() else []


def _stop_fake_receiver(fake_root: Path, env: dict) -> None:
    """Cleanup safety net: a test that fails mid-assertion must never
    leak a detached background process into the rest of the suite run."""
    run_fake_receiver(fake_root, ["--stop"], env=env)
    pidfile = _pidfile_path(fake_root)
    for _ in range(20):
        if not pidfile.exists():
            return
        time.sleep(0.1)
    try:
        pid = int(pidfile.read_text(encoding="utf-8").strip())
        os.kill(pid, 9)
    except (OSError, ValueError):
        pass


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _dead_pid() -> int:
    """A PID guaranteed to have already exited -- run-and-wait a trivial
    child, return its now-dead pid. A (vanishingly unlikely, within a
    single test's lifetime) PID-reuse race is the same trade-off the rest
    of this suite already accepts for `held_unlistening_port`-style
    determinism-over-perfect-purity fixtures."""
    proc = subprocess.Popen([sys.executable, "-c", "pass"])
    proc.wait()
    return proc.pid


def _wait_for_status_running(fake_root: Path, env: dict, timeout: float = 5.0) -> subprocess.CompletedProcess:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = run_fake_receiver(fake_root, ["--status"], env=env)
        if last.returncode == 0:
            return last
        time.sleep(0.1)
    return last


def _wait_for_status_not_running(fake_root: Path, env: dict, timeout: float) -> subprocess.CompletedProcess:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = run_fake_receiver(fake_root, ["--status"], env=env)
        if last.returncode == 1:
            return last
        time.sleep(0.1)
    return last


def _wait_for_pidfile_gone(fake_root: Path, timeout: float = 3.0) -> bool:
    # PT-90 gate-4 verdict delta 2: --status reports not-running from
    # httpd.server_close() onward, while the pidfile survives until
    # _compare_and_delete_pidfile() -- a window the shutdown path never
    # promised was zero-width. Poll instead of asserting instantaneously.
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not _pidfile_path(fake_root).exists():
            return True
        time.sleep(0.05)
    return not _pidfile_path(fake_root).exists()


def _base_env(port: int) -> dict:
    return _minimal_env(
        CLAUDE_CODE_ENABLE_TELEMETRY="1",
        OTEL_EXPORTER_OTLP_ENDPOINT=f"http://127.0.0.1:{port}",
    )


def _make_transcripts_dir(testcase) -> Path:
    return helpers.make_empty_tmp_dir(testcase)


def _write_transcript(transcripts_dir: Path, session_id: str, stale: bool) -> Path:
    """A minimal transcript file for addendum C's two-signal reap: `not
    is_alive(pid) AND the session's transcript mtime older than 30
    minutes`. `stale=True` backdates the mtime past that threshold (31
    min, a safety margin over the 30 min boundary); `stale=False` leaves
    it at "just written" (a live, working session's normal state)."""
    path = transcripts_dir / f"{session_id}.jsonl"
    path.write_text('{"type":"assistant"}\n', encoding="utf-8")
    if stale:
        old = time.time() - (31 * 60)
        os.utime(path, (old, old))
    return path


def _post_basic_payload(port: int) -> int:
    """Sends basic.json's exact bytes to the daemon's /v1/metrics.
    Returns the HTTP status code."""
    body = (FIXTURES / "basic.json").read_bytes()
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    conn.request("POST", "/v1/metrics", body=body, headers={"Content-Type": "application/json"})
    response = conn.getresponse()
    response.read()
    conn.close()
    return response.status


def read_jsonl(path: Path) -> list[dict]:
    lines = []
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            raw = raw.strip()
            if raw:
                lines.append(json.loads(raw))
    return lines


# --------------------------------------------------------------------------
# AC4: the real, committed data file must never move.
# --------------------------------------------------------------------------

_REAL_STATE_SNAPSHOT = None
_GUARD_ARMED = False


def setUpModule():
    # Module-level, not a TestCase's setUpClass/tearDownClass: unittest's
    # own loader walks `dir(module)` (alphabetical by class name, not
    # definition order) to find TestCase classes, so a class-scoped
    # setUpClass/tearDownClass pair only brackets ITS OWN class's tests --
    # any class in this file sorting after it alphabetically could touch
    # the real file AFTER that guard's tearDownClass already passed,
    # which is a silent gap, not a loud failure. setUpModule/
    # tearDownModule are unittest's own guaranteed whole-module brackets
    # and don't have that gap (found and converted during the PT-84
    # receiver-self-stop investigation, 2026-09-04 -- see
    # test_milestone_overhead.py's identical pattern for the sessions
    # registry).
    #
    # PT-100 (architect's re-issued ruling, PT-100.md @ 0487f33): all
    # three real-file guards (token-usage.jsonl, .receiver.pid,
    # .sessions/) now go through ONE shared, self-diagnosing snapshot --
    # raw-line multiset containment for token-usage.jsonl (never an
    # identity-keyed dict, PT-91's original mistake), a live-pid check
    # for the pidfile, additions-only for the sessions registry.
    global _REAL_STATE_SNAPSHOT, _GUARD_ARMED
    _REAL_STATE_SNAPSHOT = helpers.snapshot_real_state(
        REAL_TOKEN_USAGE_PATH, REAL_RECEIVER_PIDFILE, REAL_SESSIONS_DIR, REAL_METRICS_DIR.parent,
    )
    # PT-91 Amendment 3, part 1: a sentinel ZZZGuardCoverageProbeTests
    # (sorts last in this module) checks was actually armed before it
    # ran -- proof that setUpModule really executed ahead of every test,
    # not just a documented claim.
    _GUARD_ARMED = True


def tearDownModule():
    # This is the module-wide backstop against a seam mistake (e.g. a
    # spawned daemon resolving repo_root wrong and writing into the real
    # checkout) -- on top of every individual test already pointing its
    # own --out-file at a fake root.
    #
    # PT-91 architect ruling (Amendment 1): a bare `assert` is stripped
    # entirely under `python -O` (measured) -- a guard whose firing
    # depends on an interpreter flag is not a guard.
    # `assert_real_state_untouched` raises explicitly, classifies a
    # tolerated daemon flush from a real seam defect (PT-100), and
    # never needs this module's own byte-equality checks again.
    helpers.assert_real_state_untouched(_REAL_STATE_SNAPSHOT)


# --------------------------------------------------------------------------
# PT-91, AC1: proof that a class-scoped guard only brackets its own class.
# Architect ruling (PT-91.md @ 5ccfbdd), Amendment 3 -- two parts, both
# required.
# --------------------------------------------------------------------------

# Independently-written (not copied from the production guard above) old
# vs. new guard patterns, each paired with a class deliberately named to
# sort last and write to a FAKE "real" file -- run as their own
# subprocesses by GuardBracketDifferentialTests below. Never touches the
# actual committed file; `sys.argv[1]` is always a scratch path.
_OLD_CLASS_SCOPED_GUARD_TEMPLATE = '''
import sys
import unittest
from pathlib import Path

FAKE_REAL_FILE = Path(sys.argv[1])


class AAAClassScopedGuard(unittest.TestCase):
    _before = None

    @classmethod
    def setUpClass(cls):
        cls._before = FAKE_REAL_FILE.read_bytes() if FAKE_REAL_FILE.exists() else None

    def test_placeholder(self):
        self.assertTrue(True)

    @classmethod
    def tearDownClass(cls):
        after = FAKE_REAL_FILE.read_bytes() if FAKE_REAL_FILE.exists() else None
        if after != cls._before:
            raise AssertionError("guard caught a change")


class ZZZEscapeProbe(unittest.TestCase):
    def test_writes_after_the_class_scoped_guard_already_reported(self):
        with open(FAKE_REAL_FILE, "ab") as f:
            f.write(b"escaped\\n")


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
'''

_NEW_MODULE_SCOPED_GUARD_TEMPLATE = '''
import sys
import unittest
from pathlib import Path

FAKE_REAL_FILE = Path(sys.argv[1])
_before = None


def setUpModule():
    global _before
    _before = FAKE_REAL_FILE.read_bytes() if FAKE_REAL_FILE.exists() else None


def tearDownModule():
    after = FAKE_REAL_FILE.read_bytes() if FAKE_REAL_FILE.exists() else None
    if after != _before:
        raise AssertionError("guard caught a change")


class AAAPlaceholder(unittest.TestCase):
    def test_placeholder(self):
        self.assertTrue(True)


class ZZZEscapeProbe(unittest.TestCase):
    def test_writes_after_the_old_design_would_have_already_reported(self):
        with open(FAKE_REAL_FILE, "ab") as f:
            f.write(b"escaped\\n")


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
'''


class GuardBracketDifferentialTests(unittest.TestCase):
    """Amendment 3, part 2 -- the decisive proof for AC1, and an
    INDEPENDENT second implementation of the guard semantics (not a
    re-read of the production guard above). Generates both guard
    patterns into a scratch directory, each with a class deliberately
    named to sort last and write to a FAKE "real" file, runs each as
    its own subprocess, and asserts on EXIT CODE alone (guard threshold
    (d): text output cannot distinguish "the guard fires" from "the
    guard exists"). Never touches the real, committed file."""

    def _run_pattern(self, template: str, use_dash_o: bool = False):
        fake_root = helpers.make_empty_tmp_dir(self)
        fake_real_file = fake_root / "fake-real-file.jsonl"
        fake_real_file.write_bytes(b'{"seed": true}\n')
        script = fake_root / "guard_probe.py"
        script.write_text(template, encoding="utf-8")
        args = [sys.executable]
        if use_dash_o:
            args.append("-O")
        args += [str(script), str(fake_real_file)]
        result = subprocess.run(args, capture_output=True, text=True)
        return result, fake_real_file

    def test_the_old_class_scoped_pattern_misses_a_write_from_a_later_sorting_class(self):
        result, fake_real_file = self._run_pattern(_OLD_CLASS_SCOPED_GUARD_TEMPLATE)
        self.assertEqual(
            result.returncode, 0,
            f"the old class-scoped guard pattern must (wrongly) exit 0 even though a "
            f"later-sorting class wrote to the guarded file -- got rc={result.returncode} "
            f"stdout={result.stdout!r} stderr={result.stderr!r}",
        )
        self.assertIn(
            b"escaped", fake_real_file.read_bytes(),
            "the fake file must actually have been mutated -- otherwise this isn't proving "
            "an escape, just an untested no-op",
        )

    def test_the_new_module_scoped_pattern_catches_the_same_write(self):
        result, _ = self._run_pattern(_NEW_MODULE_SCOPED_GUARD_TEMPLATE)
        self.assertNotEqual(
            result.returncode, 0,
            f"the module-scoped guard pattern must catch the write and exit non-zero -- "
            f"got rc={result.returncode} stdout={result.stdout!r} stderr={result.stderr!r}",
        )

    def test_the_new_module_scoped_pattern_still_catches_it_under_dash_o(self):
        # Amendment 1: a bare `assert` is stripped at optimisation level
        # 1 -- this template raises AssertionError explicitly, so it
        # must still fire with -O.
        result, _ = self._run_pattern(_NEW_MODULE_SCOPED_GUARD_TEMPLATE, use_dash_o=True)
        self.assertNotEqual(
            result.returncode, 0,
            f"the module-scoped guard must still catch the write under python -O -- got "
            f"rc={result.returncode} stdout={result.stdout!r} stderr={result.stderr!r}",
        )


class ZZZGuardCoverageProbeTests(unittest.TestCase):
    """Amendment 3, part 1: named to sort LAST, alphabetically, among
    every class in this module -- satisfies AC1's literal wording (a
    deliberately-named last class that would have escaped the old
    guard). Writes nothing; the decisive proof is
    GuardBracketDifferentialTests above. Asserts only that the
    module-level guard's setUpModule had actually armed its sentinel
    before this, the very last test in the module, ran -- would have
    failed outright under the old class-scoped design, which had no
    module-level sentinel at all (NameError/AttributeError on
    `_GUARD_ARMED`)."""

    def test_the_module_level_guard_armed_itself_before_the_last_test_ran(self):
        self.assertTrue(
            _GUARD_ARMED,
            "setUpModule must have armed _GUARD_ARMED before any test ran -- if this is "
            "false (or undefined), either setUpModule never ran or this class ran before "
            "it, either of which would defeat PT-91's whole-module coverage guarantee",
        )


# --------------------------------------------------------------------------
# Pure, socket-free session-bookkeeping functions.
# --------------------------------------------------------------------------

class PureSessionBookkeepingTests(unittest.TestCase):
    """Unit-level, no subprocess, no daemon -- the same test-seam
    discipline test_otel_receiver.py already applies to parse_export/
    fold/flush. Confirms the functions named in this file's module
    docstring exist and behave, independent of the CLI/daemon wiring
    around them."""

    def _sessions_dir(self, testcase) -> Path:
        root = helpers.make_empty_tmp_dir(testcase)
        return root / ".sessions"

    def test_register_session_writes_a_file_containing_the_pid(self):
        self.assertTrue(
            hasattr(otel_receiver, "register_session"),
            "otel_receiver.register_session does not exist yet -- PT-86's session-bookkeeping seam is unimplemented",
        )
        sessions_dir = self._sessions_dir(self)
        otel_receiver.register_session(sessions_dir, "s1", 12345)
        entry = sessions_dir / "s1"
        self.assertTrue(entry.is_file(), "register_session must create a file named for the session id")
        self.assertIn("12345", entry.read_text(encoding="utf-8"), "the registered pid must be recoverable from the file")

    def test_deregister_session_removes_the_file_and_is_a_noop_if_absent(self):
        self.assertTrue(hasattr(otel_receiver, "deregister_session"), "otel_receiver.deregister_session does not exist yet")
        sessions_dir = self._sessions_dir(self)
        otel_receiver.register_session(sessions_dir, "s1", 12345)
        otel_receiver.deregister_session(sessions_dir, "s1")
        self.assertFalse((sessions_dir / "s1").exists(), "deregister_session must remove the file")
        # Must not raise on a session id that was never registered.
        otel_receiver.deregister_session(sessions_dir, "never-registered")

    def test_live_session_ids_reflects_current_directory_state_without_mutating(self):
        self.assertTrue(hasattr(otel_receiver, "live_session_ids"), "otel_receiver.live_session_ids does not exist yet")
        sessions_dir = self._sessions_dir(self)
        otel_receiver.register_session(sessions_dir, "s1", 111)
        otel_receiver.register_session(sessions_dir, "s2", 222)
        ids = otel_receiver.live_session_ids(sessions_dir)
        self.assertEqual(ids, {"s1": 111, "s2": 222}, ids)
        # Calling it again must not have deleted anything.
        self.assertEqual(otel_receiver.live_session_ids(sessions_dir), {"s1": 111, "s2": 222})

    def test_reap_dead_sessions_removes_only_dead_ones_and_returns_their_ids(self):
        # `is_alive` takes (pid, session_id) -- confirmed against the
        # real implementation (not guessed): the two-signal reap
        # (addendum C, pid dead AND transcript stale) is composed into
        # ONE predicate at the call site, so `reap_dead_sessions` itself
        # stays a simple "call the predicate, reap on False" seam. The
        # two-signal LOGIC itself is pinned behaviourally, black-box, by
        # LivenessReapTests -- this test only pins reap_dead_sessions's
        # own mechanics (which entries survive/are removed/are reported).
        self.assertTrue(hasattr(otel_receiver, "reap_dead_sessions"), "otel_receiver.reap_dead_sessions does not exist yet")
        sessions_dir = self._sessions_dir(self)
        otel_receiver.register_session(sessions_dir, "alive", 111)
        otel_receiver.register_session(sessions_dir, "dead", 222)

        removed = otel_receiver.reap_dead_sessions(sessions_dir, is_alive=lambda pid, session_id: pid == 111)

        self.assertEqual(removed, ["dead"], removed)
        self.assertTrue((sessions_dir / "alive").exists(), "a session whose pid is still alive must survive reaping")
        self.assertFalse((sessions_dir / "dead").exists(), "a session whose pid is dead must be removed by reaping")

    def test_sessions_dir_is_a_sibling_of_the_pidfile(self):
        self.assertTrue(hasattr(otel_receiver, "_sessions_dir"), "otel_receiver._sessions_dir does not exist yet")
        pidfile = Path("/tmp/some/root/process/cairn/metrics/.receiver.pid")
        sessions_dir = otel_receiver._sessions_dir(pidfile)
        self.assertEqual(sessions_dir.parent, pidfile.parent, "the sessions dir must live alongside the pidfile, not somewhere unrelated")


# --------------------------------------------------------------------------
# CLI flag presence -- cheap, unambiguous first-to-fail checks.
# --------------------------------------------------------------------------

class CLIFlagPresenceGuardTests(unittest.TestCase):
    """One cheap check per new flag: every other test in this file would
    fail anyway if these are missing, but for the confusing argparse
    'unrecognized arguments' reason rather than this clear one."""

    def _assert_recognised(self, args: list[str]):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        result = run_fake_receiver(fake_root, args, env=_minimal_env())
        combined = result.stdout + result.stderr
        self.assertNotIn(
            "unrecognized arguments", combined,
            f"{args} is not yet recognised -- see PT-86. Got: {combined!r}",
        )

    def test_session_id_and_session_pid_flags_are_recognised(self):
        self._assert_recognised(["--ensure-running", "--session-id", "s1", "--session-pid", "1"])

    def test_session_ended_flag_is_recognised(self):
        self._assert_recognised(["--session-ended", "s1"])

    def test_grace_period_seconds_flag_is_recognised(self):
        self._assert_recognised(["--status", "--grace-period-seconds", "0.3"])


# --------------------------------------------------------------------------
# AC1: two fake project roots, fake session ids.
# --------------------------------------------------------------------------

class LastSessionSelfStopTests(unittest.TestCase):
    """The four scenarios AC1 names verbatim: one start/end exits after
    grace with a flush; two starts/one end stays up; a dead session id is
    reaped; a start inside the grace window cancels the exit."""

    GRACE = 0.4

    def test_one_session_start_end_exits_after_grace_period_with_a_flush(self):
        # PT-105 (architect's ruling, PT-105.md @ e66af1e): local
        # INSIDE_WINDOW_GRACE, NOT self.GRACE -- this is one of the two
        # deadlines the ruling raises; the class's GRACE=0.4 stays as-is
        # for the sibling wait-PAST-the-window tests, where a bigger
        # window buys no safety, only wall cost.
        grace = INSIDE_WINDOW_GRACE
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        self.addCleanup(_stop_fake_receiver, fake_root, env)

        start = run_fake_receiver(
            fake_root,
            ["--ensure-running", "--session-id", "s1", "--session-pid", str(os.getpid()),
             "--grace-period-seconds", str(grace)],
            env=env,
        )
        self.assertEqual(start.returncode, 0, start.stdout + start.stderr)

        status = _wait_for_status_running(fake_root, env)
        self.assertEqual(status.returncode, 0, f"receiver must be running after the only session starts -- {status.stdout!r} {status.stderr!r}")
        self.assertIn("sessions: 1", status.stdout, status.stdout)

        t0 = time.monotonic()
        end = run_fake_receiver(fake_root, ["--session-ended", "s1"], env=env)
        self.assertEqual(end.returncode, 0, end.stdout + end.stderr)

        # Must NOT have exited immediately -- the whole point of the
        # grace period is that the exporter's final batch needs time.
        immediate = run_fake_receiver(fake_root, ["--status"], env=env)
        self.assertEqual(
            immediate.returncode, 0,
            f"the receiver must still be running immediately after the last SessionEnd -- exit happens only "
            f"after the grace period, got {immediate.stdout!r} {immediate.stderr!r}",
        )

        # PT-105 (architect's ruling, PT-105.md @ e66af1e): same margin
        # characterisation as GraceWindowFlushContentTests above -- the
        # in-window `--status` probe must complete with a full second of
        # budget left before `grace` elapses.
        elapsed = time.monotonic() - t0
        remaining = grace - elapsed
        self.assertGreaterEqual(
            remaining, 1.0,
            f"in-window --status margin too tight -- grace={grace}s, elapsed={elapsed:.3f}s, "
            f"remaining={remaining:.3f}s (must be >= 1.0s, measured PT-105.md @ e66af1e)",
        )

        # PT-105 (architect's ruling, item 5, PT-105.md @ e66af1e):
        # measured wait-elapsed in the failure message, so a future
        # timeout names WHICH deadline (this one, scaled by `grace`)
        # expired rather than surfacing as a bare stdout/stderr dump.
        wait_start = time.monotonic()
        stopped = _wait_for_status_not_running(fake_root, env, timeout=grace + 4.0)
        wait_elapsed = time.monotonic() - wait_start
        self.assertEqual(
            stopped.returncode, 1,
            f"the receiver must exit on its own once the grace period elapses after the last session ended -- "
            f"waited {wait_elapsed:.3f}s of a {grace + 4.0}s timeout (grace={grace}s), "
            f"stdout={stopped.stdout!r} stderr={stopped.stderr!r}",
        )
        self.assertTrue(_wait_for_pidfile_gone(fake_root), "the pidfile must be removed on self-stop")

        # PT-90 AC1: the self-stop line at the point of no return, naming
        # the trigger -- measured baseline (architect, gate-1 ruling) was
        # 0 lines here before this feature, so exactly 1 is asserted as
        # equality, not "contains".
        log_lines = _log_lines(fake_root)
        self.assertEqual(
            len(log_lines), 1,
            f"expected exactly one self-stop log line -- got {log_lines!r}",
        )
        self.assertRegex(
            log_lines[0],
            r"^self-stop: registry drained at \S+, grace [\d.]+s elapsed, flushed \d+ lines, exiting$",
        )

    def test_two_starts_one_end_still_running(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        self.addCleanup(_stop_fake_receiver, fake_root, env)

        r1 = run_fake_receiver(
            fake_root,
            ["--ensure-running", "--session-id", "s1", "--session-pid", str(os.getpid()),
             "--grace-period-seconds", str(self.GRACE)],
            env=env,
        )
        self.assertEqual(r1.returncode, 0, r1.stdout + r1.stderr)
        _wait_for_status_running(fake_root, env)

        r2 = run_fake_receiver(fake_root, ["--ensure-running", "--session-id", "s2", "--session-pid", str(os.getpid())], env=env)
        self.assertEqual(r2.returncode, 0, r2.stdout + r2.stderr)

        status = run_fake_receiver(fake_root, ["--status"], env=env)
        self.assertIn("sessions: 2", status.stdout, status.stdout)

        end = run_fake_receiver(fake_root, ["--session-ended", "s1"], env=env)
        self.assertEqual(end.returncode, 0, end.stdout + end.stderr)

        # Wait well past what the grace period would have been if this
        # were the LAST session -- it must never exit while s2 is live.
        time.sleep(self.GRACE + 1.0)
        status = run_fake_receiver(fake_root, ["--status"], env=env)
        self.assertEqual(
            status.returncode, 0,
            f"a second live session must keep the receiver running -- {status.stdout!r} {status.stderr!r}",
        )
        self.assertIn("sessions: 1", status.stdout, status.stdout)

    def test_a_start_during_the_grace_window_cancels_the_exit(self):
        """PT-90 AC2: asserts the cancel line for the ordinary-tick cancel
        site (registry non-empty at the top of a tick) -- the only one of
        the three cancel sites this scenario deterministically triggers.
        The other two (a pre-exit re-probe finding life; a session
        registering during the .closing race) are genuine race windows
        with no deterministic trigger; the ruling has them logged, not
        tested here, and this docstring is that record, not a silent
        gap."""
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        self.addCleanup(_stop_fake_receiver, fake_root, env)
        grace = 1.0

        r1 = run_fake_receiver(
            fake_root,
            ["--ensure-running", "--session-id", "s1", "--session-pid", str(os.getpid()),
             "--grace-period-seconds", str(grace)],
            env=env,
        )
        self.assertEqual(r1.returncode, 0, r1.stdout + r1.stderr)
        _wait_for_status_running(fake_root, env)

        end = run_fake_receiver(fake_root, ["--session-ended", "s1"], env=env)
        self.assertEqual(end.returncode, 0, end.stdout + end.stderr)

        # Well inside the grace window -- a fresh session starts. PT-105
        # (architect's ruling, PT-105.md @ e66af1e): fixed 0.1s, not
        # grace * 0.3 -- shrinking the work is the fix here, not growing
        # the window (grace stays 1.0; margin ~0.4s -> ~4x, wall cost
        # -0.2s). The cancel is proved by the log line, no margin
        # assertion needed.
        time.sleep(0.1)
        r2 = run_fake_receiver(fake_root, ["--ensure-running", "--session-id", "s2", "--session-pid", str(os.getpid())], env=env)
        self.assertEqual(r2.returncode, 0, r2.stdout + r2.stderr)

        # Wait well past the ORIGINAL grace deadline -- if the new
        # session hadn't cancelled the shutdown, this would have exited.
        time.sleep(grace + 1.0)
        status = run_fake_receiver(fake_root, ["--status"], env=env)
        self.assertEqual(
            status.returncode, 0,
            f"a session starting inside the grace window must cancel the pending shutdown -- "
            f"{status.stdout!r} {status.stderr!r}",
        )
        self.assertIn("sessions: 1", status.stdout, status.stdout)

        # PT-90 AC2: the cancel line -- same measured-0-baseline
        # discipline as AC1, equality not "contains".
        log_lines = _log_lines(fake_root)
        self.assertEqual(
            len(log_lines), 1,
            f"expected exactly one grace-window-cancelled log line -- got {log_lines!r}",
        )
        self.assertRegex(
            log_lines[0],
            r"^grace-window cancelled: registry non-empty at \S+, [^,]+, staying up$",
        )


class LivenessReapTests(unittest.TestCase):
    """AC1's crash backstop, per the architect's addendum C: reaping a
    dead session id is a TWO-SIGNAL check, not pid-liveness alone --
    `not is_alive(pid)` AND the session's own transcript mtime older than
    30 minutes. A dead pid whose transcript is still fresh (a live,
    working session momentarily mis-detected -- e.g. a future wrapper
    process interposed between claude and the hook shell) must survive;
    only a dead pid with a STALE transcript may be reaped. Both cases are
    tested here, per the architect's own explicit ask for the companion
    ("dead pid + fresh transcript -> not reaped") -- testing only the
    reap-happens case would pass against an implementation that reaps on
    pid alone, exactly the over-eager reap §0 forbids.

    NEEDS `--transcripts-dir` threaded through `ensure_running`'s spawn
    args (same place `--grace-period-seconds` already is) so the fresh
    daemon these tests spawn consults a transcripts dir THIS test
    controls, never `~/.claude/projects/...`. Flagged to
    implementation-lead as a new plumbing point this addendum's design
    requires; if it lands under a different flag name these two tests
    need updating to match, not the behaviour under test.
    """

    def test_a_dead_pid_with_a_stale_transcript_is_reaped_on_a_sibling_decrement(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        transcripts_dir = _make_transcripts_dir(self)
        self.addCleanup(_stop_fake_receiver, fake_root, env)

        alive_pid = os.getpid()
        gone_pid = _dead_pid()
        _write_transcript(transcripts_dir, "gone", stale=True)

        r1 = run_fake_receiver(
            fake_root,
            ["--ensure-running", "--session-id", "alive", "--session-pid", str(alive_pid), "--transcripts-dir", str(transcripts_dir)],
            env=env,
        )
        self.assertEqual(r1.returncode, 0, r1.stdout + r1.stderr)
        _wait_for_status_running(fake_root, env)

        r2 = run_fake_receiver(fake_root, ["--ensure-running", "--session-id", "gone", "--session-pid", str(gone_pid)], env=env)
        self.assertEqual(r2.returncode, 0, r2.stdout + r2.stderr)

        r3 = run_fake_receiver(fake_root, ["--ensure-running", "--session-id", "throwaway", "--session-pid", str(alive_pid)], env=env)
        self.assertEqual(r3.returncode, 0, r3.stdout + r3.stderr)

        status = run_fake_receiver(fake_root, ["--status"], env=env)
        self.assertIn("sessions: 3", status.stdout, status.stdout)
        self.assertIn("session gone: dead", status.stdout, f"--status must report the dead pid's liveness honestly before it's reaped -- {status.stdout!r}")

        # Decrementing "throwaway" (still leaves "alive" live, so the
        # daemon does not shut down) must trip the liveness probe over
        # every OTHER recorded session too, reaping "gone" -- whose
        # transcript is stale, so BOTH signals agree it's safe.
        end = run_fake_receiver(fake_root, ["--session-ended", "throwaway"], env=env)
        self.assertEqual(end.returncode, 0, end.stdout + end.stderr)

        status = run_fake_receiver(fake_root, ["--status"], env=env)
        self.assertEqual(
            status.returncode, 0,
            f"the receiver must still be running -- 'alive' never ended -- {status.stdout!r} {status.stderr!r}",
        )
        self.assertIn("sessions: 1", status.stdout, f"the dead+stale-transcript 'gone' session must have been reaped -- {status.stdout!r}")
        self.assertNotIn("gone", status.stdout, f"a reaped session id must no longer be listed at all -- {status.stdout!r}")

    def test_a_dead_pid_with_a_fresh_transcript_is_reaped_too(self):
        # INVERTED per POLY-49 gate-1 ruling §4 (architect,
        # process/reviews/POLY-49/ruling.md): "Liveness = pid, every
        # tick... The transcript-staleness second signal (PT-86 addendum
        # C) is WITHDRAWN from the reap predicate -- AC7 requires drop
        # within one beat of pid exit." A dead pid, even with a
        # transcript written SECONDS ago, is no longer protected -- only
        # `pid: null` (no pid captured at all) survives now
        # (PidNullNeverReapedTests, unchanged). Was:
        # test_a_dead_pid_with_a_fresh_transcript_is_not_reaped, asserting
        # the opposite (the now-withdrawn two-signal rule).
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        transcripts_dir = _make_transcripts_dir(self)
        self.addCleanup(_stop_fake_receiver, fake_root, env)

        alive_pid = os.getpid()
        gone_pid = _dead_pid()
        _write_transcript(transcripts_dir, "dead-fresh", stale=False)

        r1 = run_fake_receiver(
            fake_root,
            ["--ensure-running", "--session-id", "alive", "--session-pid", str(alive_pid), "--transcripts-dir", str(transcripts_dir)],
            env=env,
        )
        self.assertEqual(r1.returncode, 0, r1.stdout + r1.stderr)
        _wait_for_status_running(fake_root, env)

        r2 = run_fake_receiver(fake_root, ["--ensure-running", "--session-id", "dead-fresh", "--session-pid", str(gone_pid)], env=env)
        self.assertEqual(r2.returncode, 0, r2.stdout + r2.stderr)

        deadline = time.time() + 10.0
        reaped = False
        status = None
        while time.time() < deadline:
            status = run_fake_receiver(fake_root, ["--status"], env=env)
            if "dead-fresh" not in status.stdout:
                reaped = True
                break
            time.sleep(0.2)
        self.assertTrue(
            reaped,
            f"a dead pid must be dropped regardless of transcript freshness now -- the second signal "
            f"is withdrawn -- last --status: {status.stdout if status else None!r}",
        )
        self.assertIn("session alive: alive", status.stdout, f"'alive' must remain registered -- {status.stdout!r}")


class PidNullNeverReapedTests(unittest.TestCase):
    """§3 + addendum C: no usable pid (`--session-pid` absent or 0) ->
    `pid: null`, reported as `unknown` (§7's third status state), and
    NEVER dropped by the probe -- it leaves the registry only via its own
    `--session-ended`, or not at all."""

    def test_a_session_with_no_pid_is_reported_unknown_and_survives_the_probe(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        self.addCleanup(_stop_fake_receiver, fake_root, env)

        r1 = run_fake_receiver(fake_root, ["--ensure-running", "--session-id", "no-pid-session", "--session-pid", "0"], env=env)
        self.assertEqual(r1.returncode, 0, r1.stdout + r1.stderr)
        _wait_for_status_running(fake_root, env)

        status = run_fake_receiver(fake_root, ["--status"], env=env)
        self.assertIn(
            "session no-pid-session: unknown", status.stdout,
            f"§7 names a THIRD status state, 'unknown', specifically for a null pid -- got: {status.stdout!r}",
        )

        # Trip the probe via a sibling start+end -- a null-pid entry must
        # survive it regardless.
        r2 = run_fake_receiver(fake_root, ["--ensure-running", "--session-id", "throwaway", "--session-pid", str(os.getpid())], env=env)
        self.assertEqual(r2.returncode, 0, r2.stdout + r2.stderr)
        end = run_fake_receiver(fake_root, ["--session-ended", "throwaway"], env=env)
        self.assertEqual(end.returncode, 0, end.stdout + end.stderr)

        status = run_fake_receiver(fake_root, ["--status"], env=env)
        self.assertEqual(status.returncode, 0, "a pid:null session must never be reaped, so the receiver must still be running")
        self.assertIn("no-pid-session", status.stdout, f"the pid:null session must still be listed -- {status.stdout!r}")


# --------------------------------------------------------------------------
# POLY-49 gate-1 ruling §4: "The dead-pending status label can no longer
# arise; builder removes it and any now-unused two-signal helper."
#
# DELETED, listed by name per the ruling's instruction ("existing tests
# asserting the two-signal rule or dead-pending are inverted or
# deleted"):
#   - StatusFourStateTests (asserted the now-withdrawn `dead-pending`
#     token; a dead pid's transcript freshness no longer affects its
#     --status label at all)
#   - TranscriptsDirMarkerPrecedenceTests (its ONLY proof mechanism was
#     distinguishing `dead-pending` vs `dead` by which transcripts_dir
#     --status read -- with the transcript signal withdrawn from
#     labeling entirely, there is no longer any --status-visible way to
#     prove marker precedence this way; transcripts_dir is still
#     consulted by the NEW foreign-session export filter, not by
#     --status, per ruling §1 fix #2 -- bubbled up to team-lead/architect
#     as a coverage gap, not silently dropped)
#   - DeadPidIsMarkedDeadWithoutWaitingForAnyReapTests (lane-1, this
#     file, POLY-49 dispatch item "marked dead within one watchdog
#     beat"): asserted a dead pid renders "dead" on the VERY NEXT
#     --status call with zero wait. Under §4 ("every tick" reaps by pid
#     alone, no nudge needed), that transient label is now exactly the
#     kind of race the ruling's own §2 dropped the "sessions: 2"
#     assertion to avoid -- the entry can already be GONE (reaped) by
#     the time --status runs instead of reading "dead". Retired in
#     favour of DeadPidOnlySessionIsDroppedByOrdinaryWatchdogBeatsAloneTests
#     (below) and LivenessReapTests' inverted fresh-transcript case,
#     both of which poll for the eventual, stable outcome rather than
#     pinning an instant that's no longer guaranteed observable.
#
# `alive` (a genuinely live pid) and `unknown` (`pid: null`, addendum
# C's third state, still never reaped -- PidNullNeverReapedTests,
# unchanged) remain stable, non-racy labels; both are already covered
# above/below. A dead pid's transient "dead" label is not re-pinned here.
# --------------------------------------------------------------------------


# --------------------------------------------------------------------------
# AC2: the final flush provably contains a datapoint received during grace.
# --------------------------------------------------------------------------

class GraceWindowFlushContentTests(unittest.TestCase):
    """basic.json's fingerprint (cairn.issue: POLY-95, an `input`-type
    datapoint of value 100) sent DURING the grace window must survive
    into the flush that happens at self-stop -- proving the daemon keeps
    accepting real exports for the whole grace window, not just idling
    until the timer fires."""

    def test_a_datapoint_posted_during_the_grace_window_lands_in_the_final_flush(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        self.addCleanup(_stop_fake_receiver, fake_root, env)
        grace = INSIDE_WINDOW_GRACE

        start = run_fake_receiver(
            fake_root,
            ["--ensure-running", "--session-id", "s1", "--session-pid", str(os.getpid()),
             "--grace-period-seconds", str(grace)],
            env=env,
        )
        self.assertEqual(start.returncode, 0, start.stdout + start.stderr)
        _wait_for_status_running(fake_root, env)

        # PT-105 (architect's ruling, PT-105.md @ e66af1e): t0 is an upper
        # bound on the daemon's grace-timer start -- just before the spawn
        # that starts it.
        t0 = time.monotonic()
        end = run_fake_receiver(fake_root, ["--session-ended", "s1"], env=env)
        self.assertEqual(end.returncode, 0, end.stdout + end.stderr)

        # Strictly inside the grace window.
        status_code = _post_basic_payload(port)
        self.assertLess(status_code, 300, "a well-formed payload posted during the grace window must be accepted, not refused")

        # PT-105: the characterisation itself -- a margin assertion, not a
        # positive race. Under load, the in-window POST above can land so
        # close to `grace` that a slower or busier machine flips it from
        # "accepted" to "refused as already stopped" with no warning; the
        # remaining budget after it completes must hold a full second.
        elapsed = time.monotonic() - t0
        remaining = grace - elapsed
        self.assertGreaterEqual(
            remaining, 1.0,
            f"in-window POST margin too tight -- grace={grace}s, elapsed={elapsed:.3f}s, "
            f"remaining={remaining:.3f}s (must be >= 1.0s, measured PT-105.md @ e66af1e)",
        )

        # PT-105 (architect's ruling, item 5, PT-105.md @ e66af1e): same
        # measured wait-elapsed as LastSessionSelfStopTests above.
        wait_start = time.monotonic()
        stopped = _wait_for_status_not_running(fake_root, env, timeout=grace + 4.0)
        wait_elapsed = time.monotonic() - wait_start
        self.assertEqual(
            stopped.returncode, 1,
            f"receiver must self-stop after grace -- waited {wait_elapsed:.3f}s of a {grace + 4.0}s "
            f"timeout (grace={grace}s), {stopped.stdout!r} {stopped.stderr!r}",
        )

        out_path = _out_path(fake_root)
        self.assertTrue(out_path.is_file(), "the self-stop flush must have written --out-file")
        lines = read_jsonl(out_path)
        pt95 = [l for l in lines if l.get("issue") == "POLY-95"]
        self.assertTrue(pt95, f"the datapoint posted during grace (cairn.issue POLY-95) must be in the final flush -- got {lines}")
        self.assertEqual(
            sum(l.get("input", 0) for l in pt95), 100,
            f"basic.json's input-type value (100) must be exactly what was flushed, proving THIS datapoint landed -- got {pt95}",
        )


# --------------------------------------------------------------------------
# AC3: the SessionEnd hook line in .claude/settings.json.
# --------------------------------------------------------------------------

class SessionEndHookLineTests(unittest.TestCase):
    """AC3: 'SessionEnd hook line ... same shape and exit-0 discipline as
    the SessionStart line; no stderr redirect.'

    Judgment call, flagged (open question sent to implementation-lead
    2026-09-04, unresolved as of writing this file): the exact
    env-var/stdin field Claude Code hands a SessionEnd hook for the
    ending session's id isn't pinned yet in this codebase. Rather than
    guess a specific variable name and risk a wrong-reason red/green,
    these assertions check only the shape this ticket's ruling actually
    specifies verbatim -- the command exists, invokes --session-ended,
    drops any stderr-to-/dev/null merge, and still unconditionally exits
    0. Whatever the real id-plumbing turns out to be is implementation-
    lead's to land; if it changes the command's shape in a way that
    breaks these greps, that's this test doing its job, not a false
    failure -- update the assertions together with the hook line, not
    around it.
    """

    def _hook_command(self) -> str:
        doc = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        for entry in doc.get("hooks", {}).get("SessionEnd", []):
            for hook in entry.get("hooks", []):
                command = hook.get("command", "")
                if "otel_receiver.py" in command and "--session-ended" in command:
                    return command
        self.fail(f"no SessionEnd hook command mentions otel_receiver.py --session-ended in {SETTINGS_PATH}")

    def test_a_session_end_hook_entry_invoking_session_ended_exists(self):
        # _hook_command's own self.fail is the assertion here -- calling
        # it at all is the test.
        self._hook_command()

    def test_stderr_is_not_redirected_to_dev_null(self):
        command = self._hook_command()
        self.assertNotIn(
            "2>&1", command,
            f"the receiver's stderr must not be merged into a discarded stdout redirect, same as the SessionStart line -- got: {command!r}",
        )

    def test_the_hook_still_unconditionally_exits_zero(self):
        command = self._hook_command()
        self.assertIn(
            "exit 0", command,
            f"a SessionEnd hook must never fail session teardown over telemetry, same discipline as SessionStart -- got: {command!r}",
        )

    def test_guards_on_the_script_existing_same_as_session_start(self):
        command = self._hook_command()
        self.assertIn(
            "otel_receiver.py", command.split("&&")[0] if "&&" in command else command,
            f"same defensive guard pattern as the SessionStart line ('[ -f ... ] || exit 0') -- got: {command!r}",
        )


# --------------------------------------------------------------------------
# Addendum D: the SessionStart hook line gains --session-pid "$PPID".
# --------------------------------------------------------------------------

class SessionStartHookLineTests(unittest.TestCase):
    """Addendum D: 'Hook lines: SessionStart gains --session-pid "$PPID",
    stdin left connected for the id.' $PPID is the hook shell's own
    parent -- measured (addendum C) to be the claude session process
    itself for the real hook-spawn chain. Without this, real sessions
    never register a usable pid and the whole two-signal reap (and the
    ordinary alive/dead liveness report) has nothing to probe."""

    def _hook_command(self) -> str:
        doc = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        for entry in doc.get("hooks", {}).get("SessionStart", []):
            for hook in entry.get("hooks", []):
                command = hook.get("command", "")
                if "otel_receiver.py" in command and "--ensure-running" in command:
                    return command
        self.fail(f"no SessionStart hook command mentions otel_receiver.py --ensure-running in {SETTINGS_PATH}")

    def test_session_pid_ppid_is_passed_on_the_session_start_line(self):
        command = self._hook_command()
        self.assertIn(
            "--session-pid", command,
            f"addendum D: the SessionStart line must pass --session-pid \"$PPID\" -- got: {command!r}",
        )
        self.assertIn(
            "PPID", command,
            f"the pid source must be the hook shell's own $PPID (addendum C's measured ancestor chain) -- got: {command!r}",
        )


# --------------------------------------------------------------------------
# Addendum D: .gitignore must cover the new runtime-state directory.
# --------------------------------------------------------------------------

class GitignoreCoversSessionsDirTests(unittest.TestCase):
    """Addendum D, closing line: '.gitignore must gain
    process/cairn/metrics/.sessions/, beside the existing .lock entry...
    No acceptance criterion covers this -- it will not fail a test, so it
    has to be remembered.' This test is that remembering."""

    def test_gitignore_covers_the_sessions_runtime_state_dir(self):
        text = GITIGNORE_PATH.read_text(encoding="utf-8")
        self.assertIn(
            ".sessions", text,
            f"{GITIGNORE_PATH} must ignore process/cairn/metrics/.sessions/ (or an equivalent pattern) -- "
            f"a committed session file is a defect, per the architect's addendum",
        )


# --------------------------------------------------------------------------
# Addendum B: the .closing sentinel, the file-only point-of-no-return
# protocol that replaces the withdrawn 503 handoff.
# --------------------------------------------------------------------------

class ClosingSentinelStaleCleanupTests(unittest.TestCase):
    """Addendum B: 'A new daemon removes a stale .closing at startup --
    a crash can leave one.' This is the one clause of the .closing
    protocol testable purely with files, without racing the live
    interleaved-start/shutdown window (flagged as a code-review item,
    not a suite gate, for the same reason the withdrawn 503 race was:
    no internal seam to hit it deterministically). A stale sentinel left
    over from a crashed receiver must never permanently block a fresh
    --ensure-running."""

    def test_a_stale_closing_sentinel_does_not_block_a_fresh_start(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        self.addCleanup(_stop_fake_receiver, fake_root, env)

        # Simulate a crash leftover: the sessions dir (and its .closing
        # sentinel) exist even though no receiver is currently running --
        # no pidfile, nothing listening on `port`.
        sessions_dir = fake_root / "process" / "cairn" / "metrics" / ".sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / ".closing").write_text("", encoding="utf-8")

        start = run_fake_receiver(
            fake_root, ["--ensure-running", "--session-id", "s1", "--session-pid", str(os.getpid())], env=env,
        )
        self.assertEqual(start.returncode, 0, start.stdout + start.stderr)

        status = _wait_for_status_running(fake_root, env)
        self.assertEqual(
            status.returncode, 0,
            f"a stale .closing sentinel from a crashed receiver must not block a fresh start -- {status.stdout!r} {status.stderr!r}",
        )
        self.assertIn("sessions: 1", status.stdout, status.stdout)
        self.assertFalse(
            (sessions_dir / ".closing").exists(),
            "a fresh daemon must clear a stale .closing sentinel it inherits at startup",
        )


# --------------------------------------------------------------------------
# Architect's review of 6467cc5, Delta 2: deregistration must be
# unconditional, not gated on a live daemon.
# --------------------------------------------------------------------------

class UnconditionalDeregistrationTests(unittest.TestCase):
    """Delta 2 (review of 6467cc5, should-fix): '--session-ended skips
    deregistration when no daemon is running. The `if pid is None or not
    _pid_is_alive(pid): return 0` guard sits ABOVE deregister_session, so
    a session ending while the receiver is down -- or mid-shutdown, after
    its pidfile was compare-and-deleted -- leaves its registry file
    behind. The next daemon inherits a phantom live session and, because
    that phantom's transcript is fresh, is pinned by it for up to 30
    minutes. Deregistration is a local file operation and should be
    unconditional; only the nudge needs a live daemon.'

    Both named cases: (a) no daemon has ever run at all (empty pidfile
    path -- the plain 'receiver isn't up' case), and (b) a stale pidfile
    naming a pid that is provably dead (the 'mid-shutdown, pidfile
    already gone/stale' case the review calls out by name)."""

    def test_session_ended_deregisters_even_when_no_daemon_has_ever_run(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)

        sessions_dir = fake_root / "process" / "cairn" / "metrics" / ".sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "phantom").write_text(str(os.getpid()), encoding="utf-8")
        # No pidfile at all -- nothing has ever ensure_running'd here.
        self.assertFalse(_pidfile_path(fake_root).exists())

        end = run_fake_receiver(fake_root, ["--session-ended", "--session-id", "phantom"], env=env)
        self.assertEqual(end.returncode, 0, f"§10: non-fatal even with no daemon up -- {end.stdout!r} {end.stderr!r}")

        self.assertFalse(
            (sessions_dir / "phantom").exists(),
            "deregistration is a local file operation and must happen even when no daemon is running "
            "(Delta 2) -- otherwise the NEXT daemon inherits a phantom session, fresh-transcript-pinned "
            "for up to 30 minutes",
        )

    def test_session_ended_deregisters_even_with_a_stale_pidfile_naming_a_dead_pid(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)

        sessions_dir = fake_root / "process" / "cairn" / "metrics" / ".sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "phantom").write_text(str(os.getpid()), encoding="utf-8")
        # A pidfile left behind naming a pid that is provably dead --
        # exactly Delta 2's "mid-shutdown, pidfile already gone/stale"
        # scenario (simulated here as a stale-but-present file, since a
        # compare-and-delete race is not deterministically reproducible
        # from outside the process).
        _pidfile_path(fake_root).write_text(str(_dead_pid()), encoding="utf-8")

        end = run_fake_receiver(fake_root, ["--session-ended", "--session-id", "phantom"], env=env)
        self.assertEqual(end.returncode, 0, f"§10: non-fatal with a stale/dead pidfile -- {end.stdout!r} {end.stderr!r}")

        self.assertFalse(
            (sessions_dir / "phantom").exists(),
            "deregistration must not be gated on the pidfile naming a LIVE process (Delta 2)",
        )


# --------------------------------------------------------------------------
# Architect's Delta 6 (PT-86 comment at 40e9658): the nudge must be
# self-gating on a capability marker, or a pre-PT-86 daemon (no SIGUSR2
# handler) is killed by its first --session-ended with no final flush.
# --------------------------------------------------------------------------

class CapabilityMarkerNudgeGateTests(unittest.TestCase):
    """Delta 6, recommendation 2 (the one adopted): 'The new daemon
    writes a marker beside its pidfile at startup; _nudge_daemon sends
    SIGUSR2 only when the marker is present, and otherwise stays silent
    (the watchdog's own tick still does the work, at up to 0.25s
    latency).' Measured by the architect: a Python process with no
    SIGUSR2 handler is terminated by it (exit -31) -- so the untested
    branch here (marker absent -> stay silent) is the one that actually
    protects a live pre-PT-86 receiver from being killed with no flush.

    Both branches use an INJECTABLE kill -- no real signal is ever sent
    to a real process by this test (team-lead's instruction). Location
    assumption, flagged: the marker lives inside `_sessions_dir(pidfile)`
    (matching the architect's stated preference, since that directory is
    already gitignored end-to-end and `live_session_ids`'s existing
    dotfile filter already skips anything starting with "."). If
    implementation-lead instead writes it beside the pidfile as its own
    file, this test's setup needs to move with that choice -- and
    GitignoreCoversSessionsDirTests' existing `.sessions/` coverage would
    no longer be enough on its own; a new explicit .gitignore line would
    be needed too (raised directly, not guessed around)."""

    def _fake_pidfile_naming_a_live_pid(self, testcase) -> Path:
        root = helpers.make_empty_tmp_dir(testcase)
        pidfile = root / "process" / "cairn" / "metrics" / ".receiver.pid"
        pidfile.parent.mkdir(parents=True)
        pidfile.write_text(str(os.getpid()), encoding="utf-8")  # this test process -- genuinely alive
        return pidfile

    def test_nudge_sends_sigusr2_when_the_capability_marker_is_present(self):
        self.assertTrue(hasattr(otel_receiver, "_nudge_daemon"), "otel_receiver._nudge_daemon does not exist")
        pidfile = self._fake_pidfile_naming_a_live_pid(self)
        sessions_dir = otel_receiver._sessions_dir(pidfile)
        sessions_dir.mkdir(parents=True, exist_ok=True)
        marker_name = getattr(otel_receiver, "NUDGE_CAPABLE_MARKER_NAME", ".nudge-capable")
        (sessions_dir / marker_name).write_text("", encoding="utf-8")

        calls: list[tuple[int, int]] = []
        otel_receiver._nudge_daemon(pidfile, kill=lambda pid, sig: calls.append((pid, sig)))

        self.assertEqual(
            calls, [(os.getpid(), signal.SIGUSR2)],
            f"marker present -> the nudge must send exactly one SIGUSR2 to the pidfile's own pid -- got {calls}",
        )

    def test_nudge_sends_nothing_when_the_capability_marker_is_absent(self):
        # No sessions dir, no marker at all -- simulates a pre-PT-86
        # daemon: it never wrote a marker because it predates the
        # concept, and it has no SIGUSR2 handler, so receiving one would
        # kill it with no final flush (Delta 6's whole point).
        self.assertTrue(hasattr(otel_receiver, "_nudge_daemon"), "otel_receiver._nudge_daemon does not exist")
        pidfile = self._fake_pidfile_naming_a_live_pid(self)

        calls: list[tuple[int, int]] = []
        otel_receiver._nudge_daemon(pidfile, kill=lambda pid, sig: calls.append((pid, sig)))

        self.assertEqual(
            calls, [],
            f"no capability marker -> the nudge must stay completely silent -- a pre-PT-86 receiver has no "
            f"SIGUSR2 handler and is killed by one, with no final flush -- got {calls}",
        )


# --------------------------------------------------------------------------
# 12afe1d's new slow periodic reap sweep (beyond what Delta 1 asked for):
# a third, unconditional, time-based reap trigger for the all-sessions-
# crashed case, since neither an `end` event nor a flush ever fires when
# every registered session has crashed.
# --------------------------------------------------------------------------

# --------------------------------------------------------------------------
# POLY-49 (carried, no separate sub-issue): three findings from the
# POLY-48 loop, session-registry group. No ruling needed -- each is
# testable directly against the documented `--ensure-running`/`--status`
# CLI seam (module docstring above).
# --------------------------------------------------------------------------


class EnsureRunningAgainstAnAlreadyRunningReceiverRegistersTheCallerTests(unittest.TestCase):
    """2026-09-25 finding: with the receiver already up from an earlier
    session, `.sessions/` kept only that earlier session's id -- a new
    session's own SessionStart hook call never appeared. The REAL hook
    command (`.claude/settings.json`) never passes `--session-id`
    explicitly -- only `--session-pid "$PPID"` -- and relies entirely on
    `_session_id_from_stdin()` reading the hook's own JSON payload
    (`{"session_id": ...}`) off stdin. This reproduces that exact
    invocation shape, piped stdin included, against a receiver already
    started by an EARLIER `--ensure-running` call -- not a fresh spawn."""

    def test_a_second_sessions_hook_stdin_payload_registers_against_the_running_receiver(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        self.addCleanup(_stop_fake_receiver, fake_root, env)

        first = run_fake_receiver(
            fake_root, ["--ensure-running", "--session-id", "s1", "--session-pid", str(os.getpid())], env=env,
        )
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        _wait_for_status_running(fake_root, env)

        script = fake_root / "scripts" / "cairn" / "otel_receiver.py"
        payload = json.dumps({"session_id": "s2", "hook_event_name": "SessionStart"})
        second = subprocess.run(
            [sys.executable, str(script), "--ensure-running", "--session-pid", str(os.getpid())],
            input=payload, capture_output=True, text=True, cwd=str(fake_root), env=env,
        )
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)

        status = run_fake_receiver(fake_root, ["--status"], env=env)
        self.assertEqual(status.returncode, 0, status.stdout + status.stderr)
        self.assertIn(
            "sessions: 2", status.stdout,
            f"the SECOND session's hook call (stdin-sourced id, exactly the real hook's shape) "
            f"must register against the ALREADY-RUNNING receiver, not be silently dropped -- "
            f"got {status.stdout!r}",
        )
        self.assertIn("session s2", status.stdout, f"the stdin-sourced session id must be listed by name -- {status.stdout!r}")


class RegisterBeforeH1GateTests(unittest.TestCase):
    """POLY-49 gate-1 ruling §1/§4: Claude Code >= 2.1.282 strips
    `CLAUDE_CODE_ENABLE_TELEMETRY` from hook env (M7/M8) -- with H1
    gating BEFORE registration (today's order), that silently drops
    every session's registration whenever telemetry is off in-process,
    exactly the "missing sessions" root cause M8 measured. Ruled fix:
    `register_session` moves ABOVE the H1 gate; H1 still gates only the
    SPAWN, and its decline now prints one exact stderr line."""

    DECLINE_MESSAGE = (
        "otel_receiver: not starting -- CLAUDE_CODE_ENABLE_TELEMETRY is not set in this "
        "process; Claude Code >= 2.1.282 reads telemetry vars from ~/.claude/settings.json, "
        "not project settings"
    )

    def test_telemetry_off_still_writes_the_registration_file_no_spawn(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _minimal_env()  # no CLAUDE_CODE_ENABLE_TELEMETRY at all
        self.addCleanup(_stop_fake_receiver, fake_root, env)

        result = run_fake_receiver(
            fake_root, ["--ensure-running", "--session-id", "s1", "--session-pid", str(os.getpid())], env=env,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(
            result.stderr.strip(), self.DECLINE_MESSAGE,
            f"expected the exact H1-decline stderr line -- got {result.stderr!r}",
        )
        self.assertFalse(_log_path(fake_root).exists(), "telemetry off must spawn nothing at all")
        self.assertFalse(_pidfile_path(fake_root).exists(), "no daemon means no pidfile")

        sessions_dir = fake_root / "process" / "cairn" / "metrics" / ".sessions"
        registration = sessions_dir / "s1"
        self.assertTrue(
            registration.is_file(),
            f"the registration file must still be written even though nothing spawned -- "
            f"expected {registration} to exist",
        )
        self.assertEqual(registration.read_text(encoding="utf-8").strip(), str(os.getpid()))

    def test_telemetry_off_still_registers_against_an_already_running_receiver(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        running_env = _base_env(port)
        self.addCleanup(_stop_fake_receiver, fake_root, running_env)

        first = run_fake_receiver(
            fake_root, ["--ensure-running", "--session-id", "s1", "--session-pid", str(os.getpid())], env=running_env,
        )
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        _wait_for_status_running(fake_root, running_env)

        # SECOND call has telemetry OFF -- H1 would decline (irrelevant,
        # a receiver is already up) -- registration must still happen.
        off_env = _minimal_env()
        second = run_fake_receiver(
            fake_root, ["--ensure-running", "--session-id", "s2", "--session-pid", str(os.getpid())], env=off_env,
        )
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)

        status = run_fake_receiver(fake_root, ["--status"], env=running_env)
        self.assertEqual(status.returncode, 0, status.stdout + status.stderr)
        self.assertIn(
            "session s2", status.stdout,
            f"a telemetry-off caller must still register against an ALREADY-RUNNING receiver -- got {status.stdout!r}",
        )


class StatusListsEverySessionWhoseHookRanTests(unittest.TestCase):
    """POLY-49 AC: "`--status` lists every session whose hook ran since
    the receiver started." Four registrations via the documented
    `--session-id`/`--session-pid` flags (the explicit-id path, isolating
    this from the stdin-fallback finding above), one plain re-spawn call
    with none at all (back-compat, must add nothing) -- all four original
    ids must still be listed, by name, after all five calls."""

    def test_every_registered_session_is_listed_by_name(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        self.addCleanup(_stop_fake_receiver, fake_root, env)

        pid = os.getpid()
        for session_id in ("s1", "s2", "s3", "s4"):
            r = run_fake_receiver(
                fake_root, ["--ensure-running", "--session-id", session_id, "--session-pid", str(pid)], env=env,
            )
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        _wait_for_status_running(fake_root, env)

        # A bare re-spawn call, no session id at all -- must add nothing.
        bare = run_fake_receiver(fake_root, ["--ensure-running"], env=env)
        self.assertEqual(bare.returncode, 0, bare.stdout + bare.stderr)

        status = run_fake_receiver(fake_root, ["--status"], env=env)
        self.assertEqual(status.returncode, 0, status.stdout + status.stderr)
        self.assertIn("sessions: 4", status.stdout, status.stdout)
        for session_id in ("s1", "s2", "s3", "s4"):
            self.assertIn(f"session {session_id}", status.stdout, f"missing {session_id!r} -- {status.stdout!r}")


class DeadPidOnlySessionIsDroppedByOrdinaryWatchdogBeatsAloneTests(unittest.TestCase):
    """POLY-49 AC: "a registered session whose pid is gone is dropped by
    the next watchdog beat." The grace/self-stop arming check (`if
    live_session_ids(sessions_dir): ... return True`, `_tick` in
    otel_receiver.py) reads the RAW REGISTRY FILE LIST, not pid
    liveness (`live_session_ids`'s own docstring: "deliberately does not
    probe liveness itself") -- a dead-but-not-yet-REAPED entry still
    counts as non-empty and blocks self-stop arming. Reaping only
    happens `if nudged or due_for_periodic_reap` -- an ORDINARY tick,
    with no nudge and no periodic-reap window elapsed, reaps nothing at
    all. So a session whose pid dies without a clean `--session-ended`
    (killed abruptly -- exactly a teammate process being killed) is
    never dropped by ordinary watchdog beats alone; it silently pins the
    receiver up for however long until an UNRELATED nudge or the full
    periodic-reap window happens to fire -- one plausible contributor to
    the carried "session registry stale" / "under-capture" findings."""

    def test_the_only_session_having_a_dead_pid_is_dropped_within_a_few_ordinary_beats(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        self.addCleanup(_stop_fake_receiver, fake_root, env)

        gone_pid = _dead_pid()
        grace = 0.3
        # periodic_reap_seconds set far past this test's wait window --
        # only the ORDINARY WATCHDOG_TICK_SECONDS (0.2s) cadence is
        # exercised, and nothing here ever calls --session-ended to nudge
        # a reap either.
        start = run_fake_receiver(
            fake_root,
            ["--ensure-running", "--session-id", "gone", "--session-pid", str(gone_pid),
             "--grace-period-seconds", str(grace), "--periodic-reap-seconds", "300"],
            env=env,
        )
        self.assertEqual(start.returncode, 0, start.stdout + start.stderr)
        _wait_for_status_running(fake_root, env)

        deadline = time.time() + grace + 3.0
        stopped = False
        last_status = None
        while time.time() < deadline:
            last_status = run_fake_receiver(fake_root, ["--status"], env=env)
            if last_status.returncode == 1:
                stopped = True
                break
            time.sleep(0.2)
        self.assertTrue(
            stopped,
            f"the only registered session (dead pid, no --session-ended anywhere in this test, "
            f"periodic-reap-seconds far off) must be DROPPED by ordinary watchdog beats alone so "
            f"the empty-live-set self-stop can arm -- instead the dead entry silently pinned the "
            f"receiver up -- last --status: {last_status.stdout if last_status else None!r}",
        )


class PeriodicReapSweepTests(unittest.TestCase):
    """REWRITTEN per POLY-49 gate-1 ruling §2 (AC5): "the periodic sweep
    disappears under §4 (reap every tick)." `--periodic-reap-seconds`
    stays accepted on argv for back-compat but has no effect now --
    reaping runs unconditionally on every WATCHDOG_TICK_SECONDS beat, by
    pid liveness alone. Dropped: the transient `sessions: 2` assertion
    (the race itself -- the 2026-09-25 PR #16 CI flake this exact
    ruling section traces to). INVERTED: the fresh-transcript case
    (dead pid, FRESH transcript) is no longer protected -- it must be
    dropped within the poll too, same as a stale one, per §4's
    withdrawn second signal. Both tests keep a SECOND session ("alive",
    a genuinely live pid) registered throughout, so the registry never
    goes empty and the grace/shutdown machinery never engages."""

    def _start(self, fake_root: Path, env: dict, transcripts_dir: Path) -> None:
        alive = run_fake_receiver(
            fake_root,
            ["--ensure-running", "--session-id", "alive", "--session-pid", str(os.getpid()),
             "--transcripts-dir", str(transcripts_dir)],
            env=env,
        )
        self.assertEqual(alive.returncode, 0, alive.stdout + alive.stderr)
        _wait_for_status_running(fake_root, env)

    def test_a_dead_pid_with_a_stale_transcript_is_dropped_within_a_10s_poll(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        transcripts_dir = _make_transcripts_dir(self)
        self.addCleanup(_stop_fake_receiver, fake_root, env)

        self._start(fake_root, env, transcripts_dir)
        _write_transcript(transcripts_dir, "gone", stale=True)
        gone = run_fake_receiver(fake_root, ["--ensure-running", "--session-id", "gone", "--session-pid", str(_dead_pid())], env=env)
        self.assertEqual(gone.returncode, 0, gone.stdout + gone.stderr)

        # No transient pre-drop snapshot asserted (the dropped
        # "sessions: 2" race) -- poll straight for the eventual,
        # stable outcome.
        deadline = time.time() + 10.0
        reaped = False
        status = None
        while time.time() < deadline:
            status = run_fake_receiver(fake_root, ["--status"], env=env)
            if "sessions: 1" in status.stdout:
                reaped = True
                break
            time.sleep(0.2)
        self.assertTrue(
            reaped,
            f"a dead pid with a STALE transcript must be dropped within a 10s poll -- last status: {status.stdout if status else None!r}",
        )
        self.assertNotIn("gone", status.stdout, f"the reaped session id must no longer be listed -- {status.stdout!r}")

    def test_a_dead_pid_with_a_fresh_transcript_is_dropped_too_within_a_10s_poll(self):
        # INVERTED: was test_a_dead_pid_with_a_fresh_transcript_survives_
        # the_periodic_sweep, asserting the opposite (now-withdrawn
        # two-signal rule). No canary/sentinel needed any more -- reaping
        # is no longer a rare periodic event to detect indirectly, it is
        # the SAME unconditional per-tick check the stale case above
        # already polls for.
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        transcripts_dir = _make_transcripts_dir(self)
        self.addCleanup(_stop_fake_receiver, fake_root, env)

        self._start(fake_root, env, transcripts_dir)
        _write_transcript(transcripts_dir, "dead-fresh", stale=False)
        gone = run_fake_receiver(fake_root, ["--ensure-running", "--session-id", "dead-fresh", "--session-pid", str(_dead_pid())], env=env)
        self.assertEqual(gone.returncode, 0, gone.stdout + gone.stderr)

        deadline = time.time() + 10.0
        reaped = False
        status = None
        while time.time() < deadline:
            status = run_fake_receiver(fake_root, ["--status"], env=env)
            if "dead-fresh" not in status.stdout:
                reaped = True
                break
            time.sleep(0.2)
        self.assertTrue(
            reaped,
            f"a dead pid must be dropped regardless of transcript freshness now -- last status: {status.stdout if status else None!r}",
        )
        self.assertIn("session alive: alive", status.stdout, f"'alive' must remain registered -- {status.stdout!r}")


if __name__ == "__main__":
    unittest.main()
