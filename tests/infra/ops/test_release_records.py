"""POLY-160 R1.10, R1.11, R3 (ruling.md 7613d4e9) at the unit: `rel.write` fsyncs the file, replaces, fsyncs the directory; `rel.quarantine` is idempotent per digest, reason and bundle id; a `held-<name>` line
lifts with another installed bundle like a `guard-` line and never affects another digest. Red on today's build. Each test names the mutant that turns it red."""
import os
import sys
from types import SimpleNamespace

from base import NOW, OPS, OpsTest

STATE = "/var/lib/polycarpic/state/deploy"
D1 = "sha256:" + "11" * 32
D2 = "sha256:" + "22" * 32


class Records(OpsTest):
    def setUp(self):
        super().setUp()
        if str(OPS) not in sys.path:
            sys.path.insert(0, str(OPS))
        from lib import release
        self.rel = release
        self.host.mkdir("%s/staging" % STATE)
        self.host.mkdir("/opt/polycarpic/ops")
        self.ctx = SimpleNamespace(p=lambda path: str(self.host.p(path)), now=lambda: NOW)

    def install_bundle(self, name):
        link = str(self.host.p("/opt/polycarpic/ops/current"))
        if os.path.lexists(link):
            os.unlink(link)
        os.symlink("/opt/polycarpic/ops/" + name, link)

    def test_write_fsyncs_the_file_then_replaces_then_fsyncs_the_directory(self):
        """mutants: either fsync removed; the directory's before the replace"""
        events = []
        real_fsync, real_replace = os.fsync, os.replace

        def fsync(fd):
            kind = "dir" if os.path.isdir("/dev/fd/%d" % fd) or _is_dir(fd) else "file"
            events.append("fsync-" + kind)
            return real_fsync(fd)

        def replace(a, b, *x, **k):
            events.append("replace")
            return real_replace(a, b, *x, **k)
        os.fsync, os.replace = fsync, replace
        self.addCleanup(setattr, os, "fsync", real_fsync)
        self.addCleanup(setattr, os, "replace", real_replace)
        self.rel.write(self.ctx, str(self.host.p("%s/staging/probe" % STATE)), "x\n")
        self.assertEqual(events, ["fsync-file", "replace", "fsync-dir"])

    def test_a_write_that_raises_raises(self):
        """mutant: the error swallowed (a refusal before `up`, R1.10)"""
        real = os.fsync

        def broken(fd):
            raise OSError(5, "I/O error")
        os.fsync = broken
        self.addCleanup(setattr, os, "fsync", real)
        with self.assertRaises(OSError):
            self.rel.write(self.ctx, str(self.host.p("%s/staging/probe" % STATE)), "x\n")

    def test_quarantine_twice_for_the_same_digest_and_reason_is_one_line(self):
        """mutant: idempotence dropped"""
        for _ in range(2):
            self.rel.quarantine(self.ctx, "staging", D1, "unhealthy")
        text = self.rel.read(self.ctx, "staging", "quarantine")
        self.assertEqual(len(text.splitlines()), 1, text)
        self.rel.quarantine(self.ctx, "staging", D1, "interrupted")
        self.assertEqual(len(self.rel.read(self.ctx, "staging", "quarantine").splitlines()), 2, "another reason is another line")

    def test_a_held_line_lifts_with_another_bundle_and_never_touches_another_digest(self):
        """mutant: `held-` not treated as `guard-` (a box fault would ban the digest for good)"""
        self.install_bundle("sha256-aaaaaaaaaaaa")
        self.rel.quarantine(self.ctx, "staging", D1, "held-unjudged")
        self.rel.quarantine(self.ctx, "staging", D2, "unhealthy")
        self.assertEqual(self.rel.quarantined(self.ctx, "staging"), {D1, D2}, "held while the same bundle is installed")
        self.install_bundle("sha256-bbbbbbbbbbbb")
        self.assertEqual(self.rel.quarantined(self.ctx, "staging"), {D2}, "lifted by another bundle; D2's unhealthy line stays")


def _is_dir(fd):
    import stat
    return stat.S_ISDIR(os.fstat(fd).st_mode)
