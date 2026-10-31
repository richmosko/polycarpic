"""POLY-79a: scripts/serve-docs.py must rebind its port immediately after the
previous instance is stopped (SO_REUSEADDR / allow_reuse_address). Without it the
listening socket's TIME_WAIT leftovers make the second bind fail with
OSError: [Errno 48] Address already in use.

Real subprocesses on a free high port; each is stopped by the PID we started.
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import unittest
import urllib.request

import workflow_helpers

SCRIPT = workflow_helpers.REPO_ROOT / "scripts" / "serve-docs.py"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start(port: int) -> subprocess.Popen:
    env = dict(os.environ, DOCS_PORT=str(port))
    return subprocess.Popen(
        [sys.executable, str(SCRIPT)], env=env, cwd=workflow_helpers.REPO_ROOT,
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
    )


def stop(p: subprocess.Popen) -> None:
    if p.poll() is None:
        p.terminate()
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()


def wait_serving(p: subprocess.Popen, port: int, timeout: float = 10.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if p.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1) as r:
                return r.status == 200
        except OSError:
            time.sleep(0.1)
    return False


def raw_get(port: int) -> None:
    """GET / and read to EOF, so the SERVER closes first (HTTP/1.0). The side
    that closes first holds the TIME_WAIT, which is what blocks a rebind."""
    with socket.create_connection(("127.0.0.1", port), timeout=3) as c:
        c.sendall(b"GET / HTTP/1.0\r\n\r\n")
        while c.recv(65536):
            pass


class DocsServerRestartTests(unittest.TestCase):
    def test_rebinds_immediately_after_stop(self):
        port = free_port()
        procs = []
        try:
            first = start(port)
            procs.append(first)
            self.assertTrue(wait_serving(first, port), "first instance never served")
            raw_get(port)
            stop(first)  # the request above left a TIME_WAIT socket on the port
            second = start(port)
            procs.append(second)
            ok = wait_serving(second, port)
            err = second.stderr.read() if second.poll() is not None else ""
            self.assertTrue(ok, f"second instance failed to bind/serve on {port}: {err[-300:]}")
        finally:
            for p in procs:
                stop(p)
                if p.stderr:
                    p.stderr.close()


if __name__ == "__main__":
    unittest.main()
