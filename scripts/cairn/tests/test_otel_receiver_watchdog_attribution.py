"""POLY-10 gate-1 ruling RED tests: watchdog survival on a swapped/absent
`.sessions` dir, `--status` health reporting, and teammate attribution via
worktree-sibling transcripts.

Pinned to the architect's ruling (`process/reviews/POLY-10/ruling.md`
@ 3d83a20). Each `TestCase` class below is named after, and
carries the number of, that ruling's `## (f) Tests qa writes` list item --
1 through 8, in order. A later change to that list should track a change
here, not diverge from it.

## Judgment calls flagged (mine, not literally named in the ruling)

- **`--registry-absent-recreate-seconds`**: (a).3 names a "test kwarg on
  `serve`" for the recreate bound but no CLI flag literally -- inferred by
  direct analogy to the already-threaded `--grace-period-seconds`/
  `--periodic-reap-seconds` pair. If implementation-lead lands a different
  flag name, only `WatchdogRecreatesAfterAbsentBoundTests` needs to change.
- **Tests 3/4's injection mechanism**: rather than depend on an
  unimplemented "test-only env hook" (the ruling's other named option),
  both generate a throwaway subprocess script that monkeypatches a real,
  already-existing module-level seam -- `os.open` for test 3 (the exact
  call and path the ruling's own (a).4 names), `otel_receiver.
  live_session_ids` for test 4 (any exception the ruling's (a).5 "belt"
  must catch, regardless of site) -- and calls `otel_receiver.serve(...)`
  directly. No new implementation surface required for the injection
  itself.
- **Test 1/2's decisive assertion**: `--status` exit 0 alone does NOT
  distinguish a genuinely alive watchdog from today's exact bug (the
  listener stays up, the pidfile stays put, even after the watchdog thread
  has already died on the ENOENT) -- that blind spot is AC2's whole reason
  to exist, and asserting only on it here would make these two tests
  falsely green against the unfixed code. Both therefore end with the
  ordinary empty-registry self-stop (already pinned, unswapped, by
  `test_otel_receiver_self_stop.py`) as the decisive proof: only a live
  watchdog thread can carry it out.
- **Test 6's role fixture**: a purpose-built minimal header-only transcript
  (`{"type": "agent-setting", "agentSetting": "qa-engineer"}`), not a new
  checked-in fixture file -- matches (d)'s "one fixture transcript for the
  fixture session id" without adding a tracked file the ruling didn't ask
  for.
- **Tests 7/8**: exercise the sibling-scan resolver through the existing
  PURE functions (`otel_receiver.resolve_role`, `otel_receiver.
  _transcript_is_stale`) rather than the ruling's still-unimplemented
  `_transcript_path_for` directly -- same "test the seam that already
  exists, not the private helper" discipline `test_otel_receiver_self_
  stop.py`'s `PureSessionBookkeepingTests` already established.
"""
from __future__ import annotations

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
import urllib.request
from pathlib import Path
from typing import Optional

import helpers  # noqa: F401

import otel_receiver

SCRIPT_PATH = helpers.CAIRN_DIR / "otel_receiver.py"
FIXTURES = helpers.FIXTURES_DIR / "otlp"
REAL_METRICS_DIR = helpers.TESTS_DIR.parent.parent.parent / "process" / "cairn" / "metrics"
REAL_TOKEN_USAGE_PATH = REAL_METRICS_DIR / "token-usage.jsonl"
REAL_RECEIVER_PIDFILE = REAL_METRICS_DIR / ".receiver.pid"
REAL_SESSIONS_DIR = REAL_METRICS_DIR / ".sessions"

ENGINE_FILES = ("otel_receiver.py", "backfill_tokens.py", "cairn.py")

_REAL_STATE_SNAPSHOT = None


def setUpModule():
    # Same whole-module bracket every otel_receiver test module carries
    # (PT-91/PT-100) -- this file never touches the real committed tree
    # (every test below points at a fake root or a tmp dir), but the guard
    # is the proof of that, not an assumption of it.
    global _REAL_STATE_SNAPSHOT
    _REAL_STATE_SNAPSHOT = helpers.snapshot_real_state(
        REAL_TOKEN_USAGE_PATH, REAL_RECEIVER_PIDFILE, REAL_SESSIONS_DIR, REAL_METRICS_DIR.parent,
    )


def tearDownModule():
    helpers.assert_real_state_untouched(_REAL_STATE_SNAPSHOT)


# --------------------------------------------------------------------------
# "Fake engine root" + subprocess helpers -- a deliberate near-duplicate of
# test_otel_receiver_self_stop.py's own copies (project convention: each
# otel_receiver test module carries its own rather than sharing scaffolding
# across files that must stay independently readable).
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


def _metrics_dir(fake_root: Path) -> Path:
    return fake_root / "process" / "cairn" / "metrics"


def _pidfile_path(fake_root: Path) -> Path:
    return _metrics_dir(fake_root) / ".receiver.pid"


def _sessions_dir_path(fake_root: Path) -> Path:
    return _metrics_dir(fake_root) / ".sessions"


def _log_path(fake_root: Path) -> Path:
    return _metrics_dir(fake_root) / "otel_receiver.log"


def _log_lines(fake_root: Path) -> list[str]:
    path = _log_path(fake_root)
    return path.read_text(encoding="utf-8").splitlines() if path.exists() else []


def _stop_fake_receiver(fake_root: Path, env: dict) -> None:
    """Cleanup safety net: a test that fails mid-assertion must never leak
    a detached background process into the rest of the suite run."""
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


def _base_env(port: int) -> dict:
    return _minimal_env(
        CLAUDE_CODE_ENABLE_TELEMETRY="1",
        OTEL_EXPORTER_OTLP_ENDPOINT=f"http://127.0.0.1:{port}",
    )


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


def _wait_until_listening(port: int, timeout: float = 5.0) -> None:
    deadline = time.time() + timeout
    last_exc = None
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError as e:
            last_exc = e
            time.sleep(0.05)
    raise AssertionError(f"nothing ever started listening on 127.0.0.1:{port} within {timeout}s ({last_exc!r})")


def _kill_if_alive(proc: subprocess.Popen) -> None:
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


def read_jsonl(path: Path) -> list[dict]:
    lines = []
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            raw = raw.strip()
            if raw:
                lines.append(json.loads(raw))
    return lines


# --------------------------------------------------------------------------
# Tests 3/4's injection scripts -- generated into the fake root and run as
# their own subprocess, exactly the pattern test_otel_receiver_self_stop.py
# already uses for GuardBracketDifferentialTests' two guard templates.
# --------------------------------------------------------------------------

# Every path is threaded through as a plain `str(...)!r}` and rewrapped in
# `Path(...)` INSIDE the generated script -- `{path!r}` alone renders a
# `Path` as `PosixPath('...')`, and the generated script never imports
# that name (measured: this was test 3/4's actual first-draft bug --
# `NameError: name 'PosixPath' is not defined`, before `serve()` ever ran,
# which is a different failure than either test is trying to pin).

_ENOENT_INJECTION_SCRIPT = '''
import os
import sys
from pathlib import Path

sys.path.insert(0, {engine_dir!r})
import otel_receiver

_orig_open = os.open
_state = {{"raised": False}}


def _patched_open(path, flags, *a, **kw):
    if not _state["raised"] and str(path).endswith(".closing") and (flags & os.O_CREAT) and (flags & os.O_EXCL):
        _state["raised"] = True
        raise FileNotFoundError(2, "injected ENOENT for POLY-10 test 3")
    return _orig_open(path, flags, *a, **kw)


os.open = _patched_open

otel_receiver.serve(
    port={port}, out_path=Path({out_path!r}), pidfile=Path({pidfile!r}), flush_interval=3600,
    branch_repo_root=Path({repo_root!r}), prefix={prefix!r}, roster=set(),
    transcripts_dir=Path({transcripts_dir!r}), sessions_dir=Path({sessions_dir!r}),
    grace_period_seconds={grace!r},
)
'''

_FATAL_INJECTION_SCRIPT = '''
import sys
from pathlib import Path

sys.path.insert(0, {engine_dir!r})
import otel_receiver

_orig_live_session_ids = otel_receiver.live_session_ids
_state = {{"n": 0}}


def _patched_live_session_ids(sessions_dir):
    _state["n"] += 1
    if _state["n"] > 1:
        raise RuntimeError("injected watchdog fatal for POLY-10 test 4")
    return _orig_live_session_ids(sessions_dir)


otel_receiver.live_session_ids = _patched_live_session_ids

otel_receiver.serve(
    port={port}, out_path=Path({out_path!r}), pidfile=Path({pidfile!r}), flush_interval=3600,
    branch_repo_root=Path({repo_root!r}), prefix={prefix!r}, roster=set(),
    transcripts_dir=Path({transcripts_dir!r}), sessions_dir=Path({sessions_dir!r}),
    grace_period_seconds={grace!r},
)
'''


# --------------------------------------------------------------------------
# (f) test 1
# --------------------------------------------------------------------------

class WatchdogHoldsOnAbsentSessionsDirTests(unittest.TestCase):
    """Ruling (a).1: an absent `.sessions` dir is *unknown*, never *empty*
    -- the watchdog must hold (no lifecycle change) for as long as the dir
    is gone, then resume normally once it reappears."""

    def test_watchdog_holds_when_sessions_dir_absent(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        self.addCleanup(_stop_fake_receiver, fake_root, env)
        grace = 0.3

        start = run_fake_receiver(
            fake_root,
            ["--ensure-running", "--session-id", "s1", "--session-pid", str(os.getpid()),
             "--grace-period-seconds", str(grace)],
            env=env,
        )
        self.assertEqual(start.returncode, 0, start.stdout + start.stderr)
        running = _wait_for_status_running(fake_root, env)
        self.assertEqual(running.returncode, 0, f"must be running before the swap -- {running.stdout!r} {running.stderr!r}")
        pid_at_start = int(_pidfile_path(fake_root).read_text(encoding="utf-8").strip())

        sessions_dir = _sessions_dir_path(fake_root)
        swapped_aside = _metrics_dir(fake_root) / ".sessions.SWAPPED"
        sessions_dir.rename(swapped_aside)
        try:
            # Far longer than `grace` and WATCHDOG_TICK_SECONDS -- the
            # window a real ensure_metrics_worktree.py swap can hold (M2).
            # The OLD (buggy) code arms the grace deadline against the
            # phantom-empty registry, hits it, and dies on the ENOENT at
            # `.closing` well before this sleep returns -- but keeps
            # `serve_forever()` (and so `--status`) reporting `running:
            # True` regardless, which is why that alone is NOT this test's
            # decisive assertion (see module docstring).
            time.sleep(2.0)
            mid_swap = run_fake_receiver(fake_root, ["--status"], env=env)
            self.assertEqual(mid_swap.returncode, 0, f"the process itself must not have crashed -- {mid_swap.stdout!r} {mid_swap.stderr!r}")
            mid_swap_pid = int(_pidfile_path(fake_root).read_text(encoding="utf-8").strip())
            self.assertEqual(mid_swap_pid, pid_at_start, "the SAME process must still own the pidfile through the swap")
        finally:
            swapped_aside.rename(sessions_dir)

        # Decisive proof the WATCHDOG THREAD specifically survived (not
        # just the listening socket): only a live watchdog can carry out a
        # normal self-stop. s1's own registration file round-tripped
        # through the rename, so ending it now must still drain the
        # registry and trigger the ordinary grace-then-exit lifecycle
        # test_otel_receiver_self_stop.py already pins for the
        # never-swapped case.
        end = run_fake_receiver(fake_root, ["--session-ended", "s1"], env=env)
        self.assertEqual(end.returncode, 0, end.stdout + end.stderr)
        stopped = _wait_for_status_not_running(fake_root, env, timeout=grace + 4.0)
        self.assertEqual(
            stopped.returncode, 1,
            f"the watchdog thread must still be doing its job after surviving the swap -- a normal "
            f"self-stop must still fire once the last session ends -- {stopped.stdout!r} {stopped.stderr!r}",
        )


# --------------------------------------------------------------------------
# (f) test 2
# --------------------------------------------------------------------------

class WatchdogRecreatesAfterAbsentBoundTests(unittest.TestCase):
    """Ruling (a).3 + POLY-49 gate-1 ruling §2 (AC2): absent past
    `REGISTRY_ABSENT_RECREATE_SECONDS` (a test-scale override) recreates
    the dir plus its two startup markers and logs one `recreated` line;
    the watchdog thread stays alive and keeps ticking throughout (proved
    by the ordinary self-stop that must still follow, same discipline as
    test 1). §2: widened poll bounds (real wall-clock racing real
    subprocess/thread-scheduling overhead under an 8-worker full run --
    the 2026-09-25 flake) plus a lower-bound assertion that can only ever
    flake DOWNWARD (a false pass), never upward into a false red: the dir
    must still be ABSENT at `0.3s` after the rmtree, well inside the
    `0.5s` recreate bound, proving the hold isn't instant/accidental."""

    def test_watchdog_recreates_after_absent_bound(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        self.addCleanup(_stop_fake_receiver, fake_root, env)
        recreate_bound = 0.5
        grace = 0.4

        start = run_fake_receiver(
            fake_root,
            ["--ensure-running", "--session-id", "s1", "--session-pid", str(os.getpid()),
             "--registry-absent-recreate-seconds", str(recreate_bound),
             "--grace-period-seconds", str(grace)],
            env=env,
        )
        self.assertEqual(start.returncode, 0, start.stdout + start.stderr)
        running = _wait_for_status_running(fake_root, env)
        self.assertEqual(running.returncode, 0, running.stdout + running.stderr)
        pid_at_start = int(_pidfile_path(fake_root).read_text(encoding="utf-8").strip())

        # A full rmtree (not a rename-aside, unlike test 1) -- s1's own
        # registration does not survive, so the recreated registry is
        # genuinely empty, not just phantom-empty.
        shutil.rmtree(_sessions_dir_path(fake_root))
        sessions_dir = _sessions_dir_path(fake_root)

        # Lower bound: monotonic, cannot flake upward -- a premature
        # recreate (holding logic broken/skipped) would show up here.
        time.sleep(0.3)
        self.assertFalse(
            sessions_dir.is_dir(),
            f"the registry dir must still be held ABSENT at 0.3s, well inside the {recreate_bound}s bound",
        )

        deadline = time.time() + recreate_bound + 15.0
        while time.time() < deadline and not sessions_dir.is_dir():
            time.sleep(0.1)
        self.assertTrue(
            sessions_dir.is_dir(),
            f"the registry dir must be recreated once it has been absent past the {recreate_bound}s bound",
        )
        self.assertTrue(
            (sessions_dir / otel_receiver.NUDGE_CAPABLE_MARKER_NAME).is_file(),
            "the nudge-capable marker must be rewritten on recreation",
        )
        self.assertTrue(
            (sessions_dir / otel_receiver.TRANSCRIPTS_DIR_MARKER_NAME).is_file(),
            "the transcripts-dir marker must be rewritten on recreation",
        )
        log_lines = _log_lines(fake_root)
        self.assertTrue(
            any("recreated" in line for line in log_lines),
            f"expected a stderr line naming the recreation -- got {log_lines!r}",
        )

        still_pid = int(_pidfile_path(fake_root).read_text(encoding="utf-8").strip())
        self.assertEqual(still_pid, pid_at_start, "the SAME process must have survived recreation -- not a crash-and-respawn")

        stopped = _wait_for_status_not_running(fake_root, env, timeout=grace + 15.0)
        self.assertEqual(
            stopped.returncode, 1,
            f"the watchdog thread must still be alive and ticking after recreating the registry dir -- "
            f"the now-genuinely-empty registry must still self-stop through the ordinary grace path -- "
            f"{stopped.stdout!r} {stopped.stderr!r}",
        )


class RegistryParentAbsentHoldsWithoutMkdirTests(unittest.TestCase):
    """POLY-27 (POLY-49 gate-1 ruling §6): the recreate step must never
    use `mkdir(parents=True)` -- doing so can recreate `process/cairn/
    metrics/` ITSELF while `ensure_metrics_worktree.py` has it swapped
    aside mid-`git worktree add`, making the target non-empty and
    failing the add (the original POLY-27 defect). When the registry
    dir's PARENT (not just `.sessions/` itself) is absent past the
    recreate bound, the watchdog must keep holding -- no mkdir at all --
    and log the holding line once per absence episode."""

    def test_parent_absent_past_the_bound_never_recreates_and_logs_holding_once(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        self.addCleanup(_stop_fake_receiver, fake_root, env)
        recreate_bound = 0.5

        start = run_fake_receiver(
            fake_root,
            ["--ensure-running", "--session-id", "s1", "--session-pid", str(os.getpid()),
             "--registry-absent-recreate-seconds", str(recreate_bound)],
            env=env,
        )
        self.assertEqual(start.returncode, 0, start.stdout + start.stderr)
        running = _wait_for_status_running(fake_root, env)
        self.assertEqual(running.returncode, 0, running.stdout + running.stderr)

        metrics_dir = _metrics_dir(fake_root)
        parent_swapped_aside = metrics_dir.parent / "metrics.PARENT-SWAPPED"
        metrics_dir.rename(parent_swapped_aside)
        try:
            # Well past the recreate bound -- if the fix used
            # mkdir(parents=True) instead of holding, this would recreate
            # process/cairn/metrics/ itself (and its .sessions/ child)
            # out from under the "swap".
            time.sleep(recreate_bound + 3.0)
            self.assertFalse(
                metrics_dir.is_dir(),
                f"the parent-absent case must NEVER mkdir -- {metrics_dir} must still not exist",
            )
            mid_swap = run_fake_receiver(fake_root, ["--status"], env=env)
            self.assertEqual(mid_swap.returncode, 0, f"the process itself must not have crashed -- {mid_swap.stdout!r} {mid_swap.stderr!r}")
        finally:
            # Cleanup must survive either outcome: today's (pre-fix) code
            # can still have recreated `metrics_dir` via mkdir(parents=
            # True) despite the assertion above having already failed and
            # recorded that -- never let teardown itself mask the real
            # failure or leak a background receiver.
            if metrics_dir.exists():
                shutil.rmtree(metrics_dir, ignore_errors=True)
            parent_swapped_aside.rename(metrics_dir)

        log_lines = _log_lines(fake_root)
        holding_lines = [l for l in log_lines if "registry parent absent" in l and "holding" in l]
        self.assertTrue(holding_lines, f"expected a 'registry parent absent, holding' line -- got {log_lines!r}")
        self.assertEqual(
            len(holding_lines), 1,
            f"the holding line must log ONCE per absence episode, not once per tick -- got {holding_lines!r}",
        )

        # Decisive proof the watchdog thread itself survived the whole
        # episode: the ordinary self-stop lifecycle must still work once
        # the parent is restored and the last session ends.
        end = run_fake_receiver(fake_root, ["--session-ended", "s1"], env=env)
        self.assertEqual(end.returncode, 0, end.stdout + end.stderr)
        stopped = _wait_for_status_not_running(fake_root, env, timeout=15.0)
        self.assertEqual(
            stopped.returncode, 1,
            f"the watchdog thread must still be doing its job after the parent-absent episode -- {stopped.stdout!r} {stopped.stderr!r}",
        )


# --------------------------------------------------------------------------
# (f) test 3
# --------------------------------------------------------------------------

class ClosingOpenEnoentIsNotFatalTests(unittest.TestCase):
    """Ruling (a).4: the `.closing` `O_EXCL` open must catch `FileNotFound
    Error` alongside `FileExistsError` and `continue` -- a single swallowed
    ENOENT there must never crash the watchdog thread; the daemon must
    still complete a normal self-stop once the retried open succeeds."""

    def test_closing_open_enoent_is_not_fatal(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        engine_dir = fake_root / "scripts" / "cairn"
        metrics_dir = _metrics_dir(fake_root)
        out_path = metrics_dir / "token-usage.jsonl"
        pidfile = metrics_dir / ".receiver.pid"
        sessions_dir = metrics_dir / ".sessions"
        transcripts_dir = helpers.make_empty_tmp_dir(self)
        grace = 0.4

        script_path = fake_root / "inject_enoent.py"
        script_path.write_text(
            _ENOENT_INJECTION_SCRIPT.format(
                engine_dir=str(engine_dir), port=port, out_path=str(out_path), pidfile=str(pidfile),
                repo_root=str(fake_root), prefix="PT", transcripts_dir=str(transcripts_dir),
                sessions_dir=str(sessions_dir), grace=grace,
            ),
            encoding="utf-8",
        )
        proc = subprocess.Popen(
            [sys.executable, str(script_path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            env=_minimal_env(),
        )
        self.addCleanup(_kill_if_alive, proc)
        _wait_until_listening(port)

        otel_receiver.register_session(sessions_dir, "s1", os.getpid())
        # >= 4x WATCHDOG_TICK_SECONDS (0.2s) -- measured against the
        # first-draft version of this test, which deregistered after only
        # 0.1s: registration and deregistration both landed inside the
        # SAME tick, so `ever_nonempty` never flipped True, the
        # shutdown-deadline path never armed, and the `.closing` open this
        # test exists to exercise was never reached at all -- a timeout
        # for the WRONG reason (right symptom, since a truly-dead
        # watchdog also times out, but this failure proved nothing about
        # the injected ENOENT specifically).
        time.sleep(0.8)
        otel_receiver.deregister_session(sessions_dir, "s1")

        try:
            stdout, stderr = proc.communicate(timeout=grace + 6.0)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = proc.communicate()
            self.fail(
                f"the watchdog must survive one injected ENOENT at the .closing marker and still "
                f"self-stop -- the process never exited at all, stdout={stdout!r} stderr={stderr!r}"
            )

        self.assertEqual(proc.returncode, 0, f"expected a clean self-stop despite the injected ENOENT -- stdout={stdout!r} stderr={stderr!r}")
        self.assertIn("self-stop:", stderr, f"expected the normal self-stop log line to still fire -- stderr={stderr!r}")
        self.assertFalse(pidfile.exists(), "the pidfile must be removed on a clean self-stop")


# --------------------------------------------------------------------------
# (f) test 4
# --------------------------------------------------------------------------

class WatchdogFatalExitsReceiverTests(unittest.TestCase):
    """Ruling (a).5, the "belt": any watchdog exception OTHER than the
    known, recoverable ones (absent dir, `.closing` ENOENT race) must exit
    the WHOLE receiver loudly -- code 3, port freed, pidfile gone, a
    `watchdog: fatal` stderr line -- never a silently-dead thread under a
    still-listening socket."""

    def test_watchdog_fatal_exits_receiver(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        engine_dir = fake_root / "scripts" / "cairn"
        metrics_dir = _metrics_dir(fake_root)
        out_path = metrics_dir / "token-usage.jsonl"
        pidfile = metrics_dir / ".receiver.pid"
        sessions_dir = metrics_dir / ".sessions"
        transcripts_dir = helpers.make_empty_tmp_dir(self)
        grace = 10.0  # irrelevant -- the injected raise fires on the very first tick

        script_path = fake_root / "inject_fatal.py"
        script_path.write_text(
            _FATAL_INJECTION_SCRIPT.format(
                engine_dir=str(engine_dir), port=port, out_path=str(out_path), pidfile=str(pidfile),
                repo_root=str(fake_root), prefix="PT", transcripts_dir=str(transcripts_dir),
                sessions_dir=str(sessions_dir), grace=grace,
            ),
            encoding="utf-8",
        )
        proc = subprocess.Popen(
            [sys.executable, str(script_path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            env=_minimal_env(),
        )
        self.addCleanup(_kill_if_alive, proc)
        _wait_until_listening(port)

        try:
            stdout, stderr = proc.communicate(timeout=5.0)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = proc.communicate()
            self.fail(
                f"an unexpected watchdog exception must exit the whole receiver loudly within 5s -- "
                f"the process never exited at all, stdout={stdout!r} stderr={stderr!r}"
            )

        self.assertEqual(proc.returncode, 3, f"expected exit code 3 on a fatal watchdog exception -- stdout={stdout!r} stderr={stderr!r}")
        self.assertIn("watchdog: fatal", stderr, f"stderr must name the fatal watchdog failure -- {stderr!r}")
        self.assertFalse(pidfile.exists(), "the pidfile must be removed on the fatal-exit cleanup path")
        self.assertFalse(otel_receiver._port_is_listening(port), "the port must be freed on the fatal-exit cleanup path")


# --------------------------------------------------------------------------
# (f) test 5
# --------------------------------------------------------------------------

class StatusReportsWatchdogAndLastFlushTests(unittest.TestCase):
    """Ruling (b): `--status` gains `watchdog: alive|stale|absent (last
    beat <iso>)` and `last-flush: <iso> (<n> lines)` / `last-flush: never`,
    plus exit code 2 for the forbidden state -- running, but the watchdog's
    last heartbeat has gone stale."""

    def test_status_reports_watchdog_and_last_flush(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        self.addCleanup(_stop_fake_receiver, fake_root, env)

        start = run_fake_receiver(fake_root, ["--ensure-running", "--session-id", "s1", "--session-pid", str(os.getpid())], env=env)
        self.assertEqual(start.returncode, 0, start.stdout + start.stderr)
        running = _wait_for_status_running(fake_root, env)
        self.assertEqual(running.returncode, 0, running.stdout + running.stderr)
        self.assertRegex(
            running.stdout, r"watchdog: alive \(last beat \S+\)",
            f"expected an 'alive' watchdog line while genuinely running -- got {running.stdout!r}",
        )
        self.assertIn("last-flush: never", running.stdout, f"no flush has happened yet -- {running.stdout!r}")

        flush_now = run_fake_receiver(fake_root, ["--flush-now"], env=env)
        self.assertEqual(flush_now.returncode, 0, flush_now.stdout + flush_now.stderr)

        deadline = time.time() + 5.0
        after_flush = None
        while time.time() < deadline:
            after_flush = run_fake_receiver(fake_root, ["--status"], env=env)
            if "last-flush: never" not in after_flush.stdout:
                break
            time.sleep(0.1)
        self.assertIsNotNone(after_flush)
        self.assertIn(
            "(0 lines)", after_flush.stdout,
            f"a no-op flush must still record its own timestamp, 0 lines -- got {after_flush.stdout!r}",
        )

        # Force the forbidden state: age the heartbeat file well past the
        # 5s alive window WITHOUT stopping the daemon -- it is still
        # genuinely running; only the watchdog's last beat has gone stale.
        sessions_dir = _sessions_dir_path(fake_root)
        heartbeat = sessions_dir / ".watchdog-heartbeat"
        deadline = time.time() + 3.0
        while time.time() < deadline and not heartbeat.is_file():
            time.sleep(0.05)
        self.assertTrue(heartbeat.is_file(), "the watchdog must write a heartbeat file while it runs")
        old = time.time() - 10
        os.utime(heartbeat, (old, old))

        stale = run_fake_receiver(fake_root, ["--status"], env=env)
        self.assertEqual(
            stale.returncode, 2,
            f"running with a stale watchdog heartbeat is the forbidden state -- must exit 2, "
            f"scriptable, not just printed -- got rc={stale.returncode} {stale.stdout!r}",
        )
        self.assertIn("watchdog: stale", stale.stdout, stale.stdout)


# --------------------------------------------------------------------------
# (f) test 6
# --------------------------------------------------------------------------

class SmokeHttpExportLandsOtelLineTests(unittest.TestCase):
    """Ruling (d): the real CLI, an ephemeral port, one real HTTP POST, a
    flush signal, the flushed line read back -- proves AC3's end-to-end
    wiring, not `--ingest`'s socket-free shortcut."""

    def test_smoke_http_export_lands_otel_line(self):
        out_dir = helpers.make_empty_tmp_dir(self)
        out_path = out_dir / "token-usage.jsonl"
        pidfile = out_dir / ".receiver.pid"
        transcripts_dir = helpers.make_empty_tmp_dir(self)
        session_id = "fake-session-abc123"  # basic.json's session.id attribute
        (transcripts_dir / f"{session_id}.jsonl").write_text(
            json.dumps({"type": "agent-setting", "agentSetting": "qa-engineer"}) + "\n",
            encoding="utf-8",
        )
        port = _free_port()

        proc = subprocess.Popen(
            [sys.executable, str(SCRIPT_PATH), "--port", str(port), "--out-file", str(out_path),
             "--pidfile", str(pidfile), "--transcripts-dir", str(transcripts_dir)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            env=_minimal_env(CLAUDE_CODE_ENABLE_TELEMETRY="1"),
        )
        self.addCleanup(_kill_if_alive, proc)
        try:
            _wait_until_listening(port)
            body = (FIXTURES / "basic.json").read_bytes()
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/v1/metrics", data=body,
                headers={"Content-Type": "application/json"}, method="POST",
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                self.assertLess(resp.status, 300, "a well-formed export POST must be accepted")

            os.kill(proc.pid, signal.SIGUSR1)  # --flush-now's target signal

            deadline = time.time() + 5.0
            lines: list[dict] = []
            while time.time() < deadline:
                if out_path.is_file():
                    lines = read_jsonl(out_path)
                    if lines:
                        break
                time.sleep(0.1)
            self.assertTrue(lines, f"the flush must land at least one line in --out-file within 5s -- got nothing at {out_path}")
            otel_lines = [l for l in lines if l.get("source") == "otel"]
            self.assertEqual(len(otel_lines), 1, f"expected exactly one otel line -- got {lines}")
            self.assertEqual(otel_lines[0]["input"], 100, f"expected basic.json's fingerprint input=100 -- got {otel_lines[0]}")
            self.assertEqual(otel_lines[0]["role"], "qa-engineer", f"expected the fixture transcript's agentSetting role -- got {otel_lines[0]}")
        finally:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)

        self.assertEqual(proc.returncode, 0, "the receiver must exit cleanly on SIGTERM")
        self.assertFalse(pidfile.exists(), "the pidfile must be removed on a clean shutdown")


# --------------------------------------------------------------------------
# POLY-49 gate-1 ruling §1 fix #1, "red tests qa writes" item 1: interval
# flush from the watchdog, independent of exports. Today (M9): "interval
# flush lives only in _on_export; no export -> no interval flush" -- a
# daemon that never receives a POST at all must still advance
# `.last-flush` on its own, purely from WATCHDOG_TICK_SECONDS ticking
# past `--flush-interval`.
# --------------------------------------------------------------------------


class IntervalFlushWithNoExportsTests(unittest.TestCase):
    def test_last_flush_advances_within_10s_with_zero_exports(self):
        port = _free_port()
        fake_root = make_fake_engine_root(self, otel_port=port)
        env = _base_env(port)
        self.addCleanup(_stop_fake_receiver, fake_root, env)

        start = run_fake_receiver(
            fake_root,
            ["--ensure-running", "--session-id", "s1", "--session-pid", str(os.getpid()),
             "--flush-interval", "1"],
            env=env,
        )
        self.assertEqual(start.returncode, 0, start.stdout + start.stderr)
        running = _wait_for_status_running(fake_root, env)
        self.assertEqual(running.returncode, 0, running.stdout + running.stderr)
        self.assertIn("last-flush: never", running.stdout, f"precondition: no flush yet -- {running.stdout!r}")

        # No export POST anywhere in this test -- the only thing that can
        # possibly advance last-flush is the watchdog's own interval
        # trigger, ticking against --flush-interval 1.
        deadline = time.time() + 10.0
        advanced = False
        last_status = None
        while time.time() < deadline:
            last_status = run_fake_receiver(fake_root, ["--status"], env=env)
            if "last-flush: never" not in last_status.stdout:
                advanced = True
                break
            time.sleep(0.2)
        self.assertTrue(
            advanced,
            f"last-flush must advance within 10s from the watchdog's own interval trigger alone, "
            f"with zero exports ever POSTed -- last --status: {last_status.stdout if last_status else None!r}",
        )


# --------------------------------------------------------------------------
# POLY-49 gate-1 ruling §1 fix #2, "red tests qa writes" item 2: the
# foreign-session filter. The endpoint is now user-global (M6/M7), so
# every project's live sessions post to the same :4318 -- a datapoint
# whose session_id has no transcript ANYWHERE in this repo's
# transcripts_dir (direct or worktree-sibling) must be dropped before
# fold, never landing a line; a datapoint carrying no session.id at all
# is kept unconditionally (unchanged path).
# --------------------------------------------------------------------------


def _strip_session_id(payload: dict) -> dict:
    payload = json.loads(json.dumps(payload))  # deep copy
    for rm in payload.get("resourceMetrics", []):
        for sm in rm.get("scopeMetrics", []):
            for metric in sm.get("metrics", []):
                for dp in metric.get("sum", {}).get("dataPoints", []):
                    dp["attributes"] = [a for a in dp.get("attributes", []) if a.get("key") != "session.id"]
    return payload


def _post_payload(port: int, payload: dict) -> None:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/metrics", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        assert resp.status < 300, f"export POST rejected: {resp.status}"


class ForeignSessionFilterTests(unittest.TestCase):
    FOREIGN_SESSION_ID = "fake-session-abc123"  # basic.json's session.id

    def _spawn(self, out_path: Path, pidfile: Path, transcripts_dir: Path, port: int) -> subprocess.Popen:
        proc = subprocess.Popen(
            [sys.executable, str(SCRIPT_PATH), "--port", str(port), "--out-file", str(out_path),
             "--pidfile", str(pidfile), "--transcripts-dir", str(transcripts_dir)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            env=_minimal_env(CLAUDE_CODE_ENABLE_TELEMETRY="1"),
        )
        self.addCleanup(_kill_if_alive, proc)
        _wait_until_listening(port)
        return proc

    def _flush_and_read(self, proc: subprocess.Popen, out_path: Path) -> list:
        os.kill(proc.pid, signal.SIGUSR1)
        deadline = time.time() + 5.0
        while time.time() < deadline:
            if out_path.is_file():
                time.sleep(0.3)  # let one flush settle before reading
                return read_jsonl(out_path)
            time.sleep(0.1)
        return read_jsonl(out_path) if out_path.is_file() else []

    def test_foreign_session_with_no_transcript_anywhere_is_dropped(self):
        out_dir = helpers.make_empty_tmp_dir(self)
        out_path = out_dir / "token-usage.jsonl"
        pidfile = out_dir / ".receiver.pid"
        transcripts_dir = helpers.make_empty_tmp_dir(self)  # empty -- no transcript for FOREIGN_SESSION_ID
        port = _free_port()

        proc = self._spawn(out_path, pidfile, transcripts_dir, port)
        _post_payload(port, json.loads((FIXTURES / "basic.json").read_text(encoding="utf-8")))
        lines = self._flush_and_read(proc, out_path)
        otel_lines = [l for l in lines if l.get("source") == "otel"]
        self.assertEqual(
            len(otel_lines), 0,
            f"a session with NO transcript anywhere in this repo must be dropped before fold, "
            f"landing NO otel line -- got {otel_lines!r}",
        )

    def test_own_session_with_a_direct_transcript_is_kept(self):
        out_dir = helpers.make_empty_tmp_dir(self)
        out_path = out_dir / "token-usage.jsonl"
        pidfile = out_dir / ".receiver.pid"
        transcripts_dir = helpers.make_empty_tmp_dir(self)
        (transcripts_dir / f"{self.FOREIGN_SESSION_ID}.jsonl").write_text(
            json.dumps({"type": "agent-setting", "agentSetting": "qa-engineer"}) + "\n", encoding="utf-8",
        )
        port = _free_port()

        proc = self._spawn(out_path, pidfile, transcripts_dir, port)
        _post_payload(port, json.loads((FIXTURES / "basic.json").read_text(encoding="utf-8")))
        lines = self._flush_and_read(proc, out_path)
        otel_lines = [l for l in lines if l.get("source") == "otel"]
        self.assertEqual(len(otel_lines), 1, f"a session with a transcript in this repo must be kept -- got {lines!r}")

    def test_own_session_with_only_a_worktree_sibling_transcript_is_kept(self):
        out_dir = helpers.make_empty_tmp_dir(self)
        out_path = out_dir / "token-usage.jsonl"
        pidfile = out_dir / ".receiver.pid"
        transcripts_dir = helpers.make_empty_tmp_dir(self)
        sibling_dir = transcripts_dir.parent / f"{transcripts_dir.name}--claude-worktrees-x"
        sibling_dir.mkdir()
        (sibling_dir / f"{self.FOREIGN_SESSION_ID}.jsonl").write_text(
            json.dumps({"type": "agent-setting", "agentSetting": "architect"}) + "\n", encoding="utf-8",
        )
        port = _free_port()

        proc = self._spawn(out_path, pidfile, transcripts_dir, port)
        _post_payload(port, json.loads((FIXTURES / "basic.json").read_text(encoding="utf-8")))
        lines = self._flush_and_read(proc, out_path)
        otel_lines = [l for l in lines if l.get("source") == "otel"]
        self.assertEqual(
            len(otel_lines), 1,
            f"a session whose transcript lives ONLY under a worktree-sibling dir must still be kept, "
            f"same resolver as role attribution -- got {lines!r}",
        )

    def test_no_session_id_attribute_at_all_is_kept_unconditionally(self):
        out_dir = helpers.make_empty_tmp_dir(self)
        out_path = out_dir / "token-usage.jsonl"
        pidfile = out_dir / ".receiver.pid"
        transcripts_dir = helpers.make_empty_tmp_dir(self)  # empty -- proves this path never even consults it
        port = _free_port()

        proc = self._spawn(out_path, pidfile, transcripts_dir, port)
        payload = _strip_session_id(json.loads((FIXTURES / "basic.json").read_text(encoding="utf-8")))
        _post_payload(port, payload)
        lines = self._flush_and_read(proc, out_path)
        otel_lines = [l for l in lines if l.get("source") == "otel"]
        self.assertEqual(
            len(otel_lines), 1,
            f"a datapoint with NO session.id attribute at all must be kept unconditionally -- got {lines!r}",
        )

    def test_a_dropped_flush_logs_a_count_only_line_naming_no_session_id(self):
        out_dir = helpers.make_empty_tmp_dir(self)
        out_path = out_dir / "token-usage.jsonl"
        pidfile = out_dir / ".receiver.pid"
        transcripts_dir = helpers.make_empty_tmp_dir(self)
        port = _free_port()

        proc = self._spawn(out_path, pidfile, transcripts_dir, port)
        _post_payload(port, json.loads((FIXTURES / "basic.json").read_text(encoding="utf-8")))
        self._flush_and_read(proc, out_path)
        os.kill(proc.pid, signal.SIGTERM)
        try:
            stdout, stderr = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = proc.communicate(timeout=5)
        # Ruling §1 fix #2's exact wording -- a bare "dropped" substring
        # check would false-positive against the UNRELATED
        # `cairn: warning: milestone_windows dropped colliding milestone
        # window(s)...` line this same daemon already emits.
        self.assertRegex(
            stderr, r"otel_receiver: dropped \d+ datapoint\(s\) from \d+ session\(s\) with no transcript in this repo",
            f"expected the exact drop-count stderr line -- got stderr {stderr!r}",
        )
        self.assertNotIn(
            self.FOREIGN_SESSION_ID, stderr,
            f"the drop-count line must name counts only, never a session id -- got stderr {stderr!r}",
        )


# --------------------------------------------------------------------------
# (f) test 7
# --------------------------------------------------------------------------

class RoleResolvesFromWorktreeSiblingTranscriptTests(unittest.TestCase):
    """Ruling (c): the sibling-scan resolver. A direct match in the main
    slug dir still wins unchanged; a miss there falls through to the FIRST
    matching `<slug>--claude-worktrees-*/<id>.jsonl`; a near-neighbour
    slug (`<slug>-old--claude-worktrees-*`, the anchor invariant's own
    named risk) must never be matched."""

    def _write_header(self, path: Path, agent_setting: Optional[str] = None, agent_name: Optional[str] = None) -> None:
        record: dict = {"type": "agent-setting" if agent_setting else "assistant"}
        if agent_setting:
            record["agentSetting"] = agent_setting
        if agent_name:
            record["agentName"] = agent_name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record) + "\n", encoding="utf-8")

    def test_direct_match_in_the_main_slug_dir_still_resolves_team_lead(self):
        tmp = helpers.make_empty_tmp_dir(self)
        transcripts_dir = tmp / "-Users-fake-slug"
        transcripts_dir.mkdir()
        # No agentSetting/agentName at all -- team-lead, the unchanged
        # direct-lookup path (ruling (c): "used by all three consumers"
        # implies the direct lookup itself stays as-is).
        self._write_header(transcripts_dir / "lead-session.jsonl")
        role = otel_receiver.resolve_role(None, "lead-session", transcripts_dir, roster=set(), cache={})
        self.assertEqual(role, "team-lead", "a direct match in the main slug dir must resolve unchanged")

    def test_a_miss_in_the_main_dir_falls_through_to_the_worktree_sibling(self):
        tmp = helpers.make_empty_tmp_dir(self)
        transcripts_dir = tmp / "-Users-fake-slug"
        transcripts_dir.mkdir()
        sibling_dir = tmp / f"{transcripts_dir.name}--claude-worktrees-x"
        self._write_header(sibling_dir / "teammate-session.jsonl", agent_setting="architect")
        role = otel_receiver.resolve_role(None, "teammate-session", transcripts_dir, roster=set(), cache={})
        self.assertEqual(
            role, "architect",
            f"a session whose transcript lives ONLY under the worktree sibling dir must still resolve -- got {role!r}",
        )

    def test_a_near_neighbour_slug_sibling_is_never_matched(self):
        tmp = helpers.make_empty_tmp_dir(self)
        transcripts_dir = tmp / "-Users-fake-slug"
        transcripts_dir.mkdir()
        # Anchor invariant (ruling (c)): a "<slug>-old"-style neighbour of
        # ANOTHER project must never be picked up by a loosely-anchored glob.
        near_neighbour_dir = tmp / f"{transcripts_dir.name}-old--claude-worktrees-x"
        self._write_header(near_neighbour_dir / "orphan-session.jsonl", agent_setting="architect")
        role = otel_receiver.resolve_role(None, "orphan-session", transcripts_dir, roster=set(), cache={})
        self.assertEqual(
            role, "subagent-unattributed",
            f"a near-neighbour project's sibling dir must never be matched -- got {role!r}",
        )


# --------------------------------------------------------------------------
# (f) test 8
# --------------------------------------------------------------------------

class TranscriptIsStaleFindsWorktreeSiblingTranscriptTests(unittest.TestCase):
    """Ruling (c)'s named latent PT-86 defect: the dead-pid liveness probe
    must ALSO scan the worktree sibling dir. Without this,
    `_transcript_is_stale` never finds a teammate's transcript at all, so a
    dead-pid teammate session is always reap-eligible immediately -- the
    "two independent signals" guarantee collapsing to one signal for every
    teammate."""

    def test_a_fresh_sibling_transcript_protects_a_dead_pid_session(self):
        tmp = helpers.make_empty_tmp_dir(self)
        transcripts_dir = tmp / "-Users-fake-slug"
        transcripts_dir.mkdir()
        sibling_dir = tmp / f"{transcripts_dir.name}--claude-worktrees-x"
        sibling_dir.mkdir()
        transcript = sibling_dir / "dead-pid-session.jsonl"
        transcript.write_text(json.dumps({"type": "agent-setting", "agentSetting": "architect"}) + "\n", encoding="utf-8")
        # Freshly written -- must NOT be reported stale.
        self.assertFalse(
            otel_receiver._transcript_is_stale("dead-pid-session", transcripts_dir),
            "a fresh transcript that exists ONLY under the worktree sibling dir must not be treated as stale",
        )

    def test_a_stale_sibling_transcript_is_reported_stale(self):
        tmp = helpers.make_empty_tmp_dir(self)
        transcripts_dir = tmp / "-Users-fake-slug"
        transcripts_dir.mkdir()
        sibling_dir = tmp / f"{transcripts_dir.name}--claude-worktrees-x"
        sibling_dir.mkdir()
        transcript = sibling_dir / "dead-pid-session.jsonl"
        transcript.write_text(json.dumps({"type": "agent-setting", "agentSetting": "architect"}) + "\n", encoding="utf-8")
        old = time.time() - (31 * 60)
        os.utime(transcript, (old, old))
        self.assertTrue(
            otel_receiver._transcript_is_stale("dead-pid-session", transcripts_dir),
            "a stale sibling transcript must still be found and reported stale (reap-eligible)",
        )


if __name__ == "__main__":
    unittest.main()
