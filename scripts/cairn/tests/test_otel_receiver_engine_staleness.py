"""POLY-61 gate-1 ruling RED tests: the receiver's engine-fingerprint
self-check (`--status` reporting a stale engine, `--ensure-running`
warning without restarting, and the recreated-registry marker keeping its
BOOT fingerprint rather than laundering itself against edited files on
disk).

Pinned to the architect's ruling (`process/cairn/reviews/POLY-61/ruling.md`
@ 67a9021). Each `TestCase` class below is named after, and carries the
name of, that ruling's "Tests (qa) and pre-registered checklist" table --
T1 through T4, in order. T5 (the SIGCONT cleanup helper) lives in
`test_otel_receiver_watchdog_attribution.py` instead -- it exercises that
module's own cleanup call site, not this ticket's engine-staleness seam.

## Judgment calls flagged (mine, not literally named in the ruling)

- **The marker's literal name**: `ENGINE_FINGERPRINT_MARKER_NAME` (R1)
  does not exist on `otel_receiver` yet, pre-implementation -- this module
  hardcodes the ruling's exact string (`".engine-fingerprint"`) rather
  than importing a not-yet-defined attribute, so a `--status`/marker
  mismatch fails on its own assertion, not on an unrelated
  `AttributeError` that would mask the real red reason.
- **Which file to edit for "staleness"**: T1 and T3 both edit
  `cairnlib/enginesrc.py` (the directory branch, named `cairnlib` in R2's
  basename list); T2 edits `otel_receiver.py` itself (the file branch) --
  covering both branches of `_engine_sources()` across the three tests
  without adding a fifth.
"""
from __future__ import annotations

import os
import shutil
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

REAL_METRICS_DIR = helpers.TESTS_DIR.parent.parent.parent / "process" / "cairn" / "metrics"
REAL_TOKEN_USAGE_PATH = REAL_METRICS_DIR / "token-usage.jsonl"
REAL_RECEIVER_PIDFILE = REAL_METRICS_DIR / ".receiver.pid"
REAL_SESSIONS_DIR = REAL_METRICS_DIR / ".sessions"

# R1: same set m1 measured `sys.modules` actually importing under
# scripts/cairn/ -- `copy_engine` below also carries `cairnlib/` alongside
# these four (POLY-58 helper, unconditional whenever it exists).
ENGINE_FILES = ("otel_receiver.py", "backfill_tokens.py", "cairn.py", "worktree_root.py")

# R1: the ruling's exact literal -- see module docstring's judgment-call
# note on why this is a hardcoded string rather than an
# `otel_receiver.ENGINE_FINGERPRINT_MARKER_NAME` import.
ENGINE_FINGERPRINT_MARKER_NAME = ".engine-fingerprint"

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
# test_otel_receiver_watchdog_attribution.py's own copies (project
# convention: each otel_receiver test module carries its own rather than
# sharing scaffolding across files that must stay independently readable).
# --------------------------------------------------------------------------

def make_fake_engine_root(testcase, otel_port: Optional[int] = None) -> Path:
    root = helpers.make_empty_tmp_dir(testcase)
    engine_dir = root / "scripts" / "cairn"
    engine_dir.mkdir(parents=True)
    helpers.copy_engine(engine_dir, ENGINE_FILES)
    data_dir = root / "process" / "cairn"
    data_dir.mkdir(parents=True)
    lines = ["prefix: PT", "port: 8766"]
    if otel_port is not None:
        lines.append(f"otel_port: {otel_port}")
    (data_dir / "config.yml").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return root


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


def _engine_fingerprint_marker_path(fake_root: Path) -> Path:
    return _sessions_dir_path(fake_root) / ENGINE_FINGERPRINT_MARKER_NAME


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


def _append_comment(path: Path) -> None:
    path.write_text(path.read_text(encoding="utf-8") + "\n# POLY-61 staleness test edit\n", encoding="utf-8")


def _start_fake_daemon(testcase, registry_absent_recreate_seconds: Optional[float] = None) -> tuple[Path, dict]:
    port = _free_port()
    fake_root = make_fake_engine_root(testcase, otel_port=port)
    env = _base_env(port)
    testcase.addCleanup(_stop_fake_receiver, fake_root, env)
    args = ["--ensure-running", "--session-id", "s1", "--session-pid", str(os.getpid())]
    if registry_absent_recreate_seconds is not None:
        args += ["--registry-absent-recreate-seconds", str(registry_absent_recreate_seconds)]
    result = run_fake_receiver(fake_root, args, env=env)
    testcase.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    running = _wait_for_status_running(fake_root, env)
    testcase.assertEqual(running.returncode, 0, f"must be running before the test body -- {running.stdout!r} {running.stderr!r}")
    return fake_root, env


# --------------------------------------------------------------------------
# T1
# --------------------------------------------------------------------------

class StatusEngineCurrentThenStaleOnCairnlibEditTests(unittest.TestCase):
    """Ruling R1/R2, test T1, mutation M1: drop `cairnlib` from
    `_engine_sources()` -- must turn this red (the edited file would never
    be checked at all, so `--status` would keep reporting `current`)."""

    def test_status_engine_current_then_stale_on_cairnlib_edit(self):
        fake_root, env = _start_fake_daemon(self)

        current = run_fake_receiver(fake_root, ["--status"], env=env)
        self.assertEqual(current.returncode, 0, f"engine must be current right after boot -- {current.stdout!r} {current.stderr!r}")
        self.assertIn(
            "engine: current", current.stdout,
            f"expected an 'engine: current' line right after boot -- got {current.stdout!r}",
        )

        _append_comment(fake_root / "scripts" / "cairn" / "cairnlib" / "enginesrc.py")

        stale = run_fake_receiver(fake_root, ["--status"], env=env)
        self.assertEqual(
            stale.returncode, 3,
            f"a running receiver with a healthy watchdog but a stale engine must exit 3 -- got rc={stale.returncode} {stale.stdout!r}",
        )
        self.assertIn(
            "engine: stale (cairnlib)", stale.stdout,
            f"expected the stale line to name 'cairnlib' (R2's basename for the directory branch) -- got {stale.stdout!r}",
        )


# --------------------------------------------------------------------------
# T2
# --------------------------------------------------------------------------

class RecreatedRegistryKeepsBootFingerprintTests(unittest.TestCase):
    """Ruling R1, test T2, mutation M2: recompute the fingerprint at the
    registry-recreate site instead of rewriting the SAME held boot dict --
    must turn this red (the recreated marker would launder the edit made
    below, reporting `current` again)."""

    def test_recreated_registry_keeps_boot_fingerprint(self):
        recreate_bound = 0.5
        fake_root, env = _start_fake_daemon(self, registry_absent_recreate_seconds=recreate_bound)

        _append_comment(fake_root / "scripts" / "cairn" / "otel_receiver.py")

        marker_before = _engine_fingerprint_marker_path(fake_root)
        self.assertTrue(marker_before.is_file(), "the engine-fingerprint marker must exist right after boot")

        shutil.rmtree(_sessions_dir_path(fake_root))
        sessions_dir = _sessions_dir_path(fake_root)

        deadline = time.time() + recreate_bound + 15.0
        while time.time() < deadline and not sessions_dir.is_dir():
            time.sleep(0.1)
        self.assertTrue(sessions_dir.is_dir(), "the registry dir must be recreated past the recreate bound")
        marker_after = _engine_fingerprint_marker_path(fake_root)
        deadline = time.time() + 5.0
        while time.time() < deadline and not marker_after.is_file():
            time.sleep(0.1)
        self.assertTrue(marker_after.is_file(), "the engine-fingerprint marker must be rewritten on recreation")

        stale = run_fake_receiver(fake_root, ["--status"], env=env)
        self.assertEqual(
            stale.returncode, 3,
            f"the recreated marker must still hold the BOOT fingerprint (pre-edit), so the edited "
            f"otel_receiver.py must still read stale -- got rc={stale.returncode} {stale.stdout!r}",
        )
        self.assertIn(
            "engine: stale (otel_receiver.py)", stale.stdout,
            f"expected the stale line to name 'otel_receiver.py' -- got {stale.stdout!r}",
        )


# --------------------------------------------------------------------------
# T3
# --------------------------------------------------------------------------

class EnsureRunningWarnsOnStaleEngineWithoutRestartTests(unittest.TestCase):
    """Ruling R4, test T3, mutation M3: delete the stderr print on the
    already-live path -- must turn this red (no warning line at all, but
    the rest of the assertions -- rc 0, unchanged pid -- would still pass,
    which is exactly why the ruling calls this a report-only, never-
    restart seam)."""

    def test_ensure_running_warns_on_stale_engine_without_restart(self):
        fake_root, env = _start_fake_daemon(self)
        pid_before = int(_pidfile_path(fake_root).read_text(encoding="utf-8").strip())

        _append_comment(fake_root / "scripts" / "cairn" / "cairnlib" / "enginesrc.py")

        result = run_fake_receiver(
            fake_root,
            ["--ensure-running", "--session-id", "s1", "--session-pid", str(os.getpid())],
            env=env,
        )
        self.assertEqual(result.returncode, 0, f"--ensure-running must never fail a session over a stale engine -- {result.stdout!r} {result.stderr!r}")
        self.assertIn(
            "otel_receiver: running receiver's engine is stale (cairnlib); restart it: --stop, then --ensure-running",
            result.stderr,
            f"expected R4's exact warning line on stderr -- got {result.stderr!r}",
        )

        pid_after = int(_pidfile_path(fake_root).read_text(encoding="utf-8").strip())
        self.assertEqual(pid_after, pid_before, "a stale-engine --ensure-running must never restart the daemon -- the pid must be unchanged")


# --------------------------------------------------------------------------
# T4
# --------------------------------------------------------------------------

class StatusUnknownWhenMarkerAbsentTests(unittest.TestCase):
    """Ruling R2, test T4, mutation M4: treat a missing marker as stale --
    must turn this red (a pre-POLY-61 daemon with no marker at all, or a
    marker deleted out from under a live one, would wrongly report
    `engine: stale` instead of the honest `unknown`, and would wrongly
    flip the exit code too since R3 says `unknown` never changes it)."""

    def test_status_unknown_when_marker_absent(self):
        fake_root, env = _start_fake_daemon(self)

        marker = _engine_fingerprint_marker_path(fake_root)
        self.assertTrue(marker.is_file(), "precondition: the marker must exist right after boot")
        marker.unlink()

        result = run_fake_receiver(fake_root, ["--status"], env=env)
        self.assertEqual(
            result.returncode, 0,
            f"a missing fingerprint marker must never change the exit code (R3: 'unknown' never changes rc) -- got rc={result.returncode} {result.stdout!r}",
        )
        self.assertIn(
            "engine: unknown (no fingerprint)", result.stdout,
            f"expected the 'unknown (no fingerprint)' line when the marker is absent -- got {result.stdout!r}",
        )


if __name__ == "__main__":
    unittest.main()
