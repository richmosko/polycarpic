"""POLY-98 R2, A1 and seceng's note: infra/ops/install.sh on the laptop side, against a throwaway git checkout with a fake ssh and a logging git.

The box side (install_box.py: modes, ownership, atomic swap, retention, hostile members) needs real root and runs in tests/infra/provision/ops.test.ts.
"""
import io
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

from base import OPS, REPO, need

BUNDLE_PATHS = ["infra/ops", "infra/provision.sh", "infra/provision-check.sh", "infra/postgres/gate-check.sh", "infra/postgres/gate-check.sql",
                "infra/operator/b2-capabilities.json", "infra/compose/prod.yml", "infra/compose/staging.yml", "infra/compose/edge.yml", "packages/db/sql/roles.sql", "infra/backup", "infra/postgres/archive-wal.sh", "infra/deploy/compose-allow.json", "infra/deploy/compose-version", "infra/deploy/systemd", "infra/postgres/pg_hba.prod.conf", "infra/postgres/pg_hba.staging.conf"]  # POLY-99: the runner and the scripts it starts
REAL_GIT = shutil.which("git")
ENV_GIT = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null"}


class Install(unittest.TestCase):
    def setUp(self):
        need(OPS / "install.sh")
        need(OPS / "install_box.py")
        self._t = tempfile.TemporaryDirectory()
        self.t = Path(self._t.name)
        self.addCleanup(self._t.cleanup)
        self.repo, self.bin, self.log = self.t / "repo", self.t / "bin", self.t / "log"
        for d in (self.repo, self.bin, self.log):
            d.mkdir()
        for rel in BUNDLE_PATHS:
            src = REPO / rel
            dst = self.repo / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(str(src), str(dst), ignore=shutil.ignore_patterns("__pycache__")) if src.is_dir() else shutil.copy2(str(src), str(dst))
        (self.repo / "README.md").write_text("readme\n")
        (self.repo / ".gitignore").write_text("*.ignored\n")
        self.git("init", "-q")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "x")
        (self.bin / "ssh").write_text('#!/bin/sh\nn=$(ls "$LOG" | grep -c "^ssh-.*\\.args$"); n=$((n+1))\nprintf "%s\\n" "$@" > "$LOG/ssh-$n.args"\ncat > "$LOG/ssh-$n.stdin"\nexit 0\n')
        (self.bin / "git").write_text('#!/bin/sh\nprintf "%%s\\n" "$*" >> "$LOG/git.log"\nexec %s "$@"\n' % REAL_GIT)
        for f in ("ssh", "git"):
            os.chmod(str(self.bin / f), 0o755)

    def git(self, *a):
        return subprocess.run([REAL_GIT] + list(a), cwd=str(self.repo), env=dict(os.environ, **ENV_GIT), capture_output=True, text=True, check=True).stdout.strip()

    def install(self, *args):
        env = dict(os.environ, **ENV_GIT, PATH="%s:%s" % (self.bin, os.environ["PATH"]), LOG=str(self.log))
        p = subprocess.run(["bash", "infra/ops/install.sh"] + (list(args) or ["polyops@box.example"]), cwd=str(self.repo), env=env, capture_output=True, text=True, timeout=60)
        return p.returncode, p.stdout, p.stderr

    def ssh_calls(self):
        out = []
        for n in range(1, 5):
            a = self.log / ("ssh-%d.args" % n)
            if a.exists():
                out.append((a.read_text().splitlines(), (self.log / ("ssh-%d.stdin" % n)).read_bytes()))
        return out

    def test_a_modified_tracked_bundle_file_exits_2_listing_it_and_calls_no_ssh(self):
        (self.repo / "infra" / "compose" / "prod.yml").write_text("changed\n")
        rc, out, err = self.install()
        self.assertEqual(rc, 2, err)
        self.assertIn("infra/compose/prod.yml", out + err)
        self.assertEqual(self.ssh_calls(), [])

    def test_an_untracked_file_under_the_bundle_paths_exits_2_listing_it(self):
        (self.repo / "infra" / "ops" / "lib" / "scratch.py").write_text("x = 1\n")
        rc, out, err = self.install()
        self.assertEqual(rc, 2, err)
        self.assertIn("infra/ops/lib/scratch.py", out + err)
        self.assertEqual(self.ssh_calls(), [])

    def test_a_clean_checkout_makes_exactly_two_ssh_calls_to_the_given_host(self):
        rc, out, err = self.install()
        self.assertEqual(rc, 0, out + err)
        calls = self.ssh_calls()
        self.assertEqual(len(calls), 2)
        for args, _ in calls:
            self.assertIn("polyops@box.example", args)
            self.assertNotIn("StrictHostKeyChecking=no", " ".join(args))

    def test_ssh_key_flag_becomes_dash_i(self):
        rc, out, err = self.install("polyops@box.example", "--ssh-key", "/tmp/k")
        self.assertEqual(rc, 0, err)
        for args, _ in self.ssh_calls():
            self.assertEqual(args[args.index("-i") + 1], "/tmp/k")

    def test_a_working_tree_only_change_does_not_reach_the_box(self):
        (self.repo / "infra" / "ops" / "lib" / "cache.ignored").write_text("ignored file\n")  # git-ignored: not dirty, not committed
        (self.repo / "README.md").write_text("changed outside the bundle\n")  # outside the bundle paths: not refused, not shipped
        rc, out, err = self.install()
        self.assertEqual(rc, 0, out + err)
        tar = tarfile.open(fileobj=io.BytesIO(self.ssh_calls()[1][1]))
        names = tar.getnames()
        self.assertFalse([n for n in names if n.endswith("cache.ignored")])
        self.assertNotIn("README.md", names)

    def test_the_archive_holds_only_committed_bundle_paths_and_all_of_them(self):
        rc, out, err = self.install()
        self.assertEqual(rc, 0, err)
        names = tarfile.open(fileobj=io.BytesIO(self.ssh_calls()[1][1])).getnames()
        for n in names:
            self.assertTrue(any(n == p or n.startswith(p + "/") for p in BUNDLE_PATHS) or n in ("infra", "infra/postgres", "infra/operator", "infra/compose", "infra/deploy", "packages", "packages/db", "packages/db/sql"), n)
        for must in ("infra/ops/polycarpic-ops", "infra/ops/install_box.py", "infra/provision.sh", "infra/provision-check.sh", "infra/postgres/gate-check.sh", "infra/postgres/gate-check.sql",
                     "infra/operator/b2-capabilities.json", "infra/compose/prod.yml", "infra/compose/staging.yml", "infra/compose/edge.yml", "packages/db/sql/roles.sql"):
            self.assertIn(must, names)

    def test_the_remote_commands_are_fixed_strings_with_only_the_id_substituted(self):  # R2, A1
        rc, out, err = self.install()
        self.assertEqual(rc, 0, err)
        sha = self.git("rev-parse", "HEAD")
        (a1, in1), (a2, in2) = self.ssh_calls()
        self.assertIn("sudo install -d -m 0700 /opt/polycarpic/.incoming", a1[-1])
        self.assertIn("sudo tee /opt/polycarpic/.incoming/install_box.py", a1[-1])
        self.assertEqual(a2[-1], "sudo /usr/bin/python3 -I /opt/polycarpic/.incoming/install_box.py git-%s polyops@box.example" % sha[:12])  # S21: the box prints the operator's own ssh target in guard help
        self.assertEqual(in1, (self.repo / "infra" / "ops" / "install_box.py").read_bytes())

    def test_head_is_resolved_once_and_the_same_sha_goes_to_git_show_and_git_archive(self):  # seceng's note
        rc, out, err = self.install()
        self.assertEqual(rc, 0, err)
        sha = self.git("rev-parse", "HEAD")
        log = (self.log / "git.log").read_text().splitlines()
        show = [l for l in log if l.startswith("show ")]
        archive = [l for l in log if l.startswith("archive ")]
        self.assertEqual(len(show), 1)
        self.assertEqual(len(archive), 1)
        self.assertIn(sha, show[0])
        self.assertIn(sha, archive[0])
        self.assertNotRegex(show[0] + archive[0], r"\bHEAD\b")
        self.assertIn("--format=tar", archive[0])

    def test_no_host_argument_is_a_usage_error(self):
        env = dict(os.environ, PATH="%s:%s" % (self.bin, os.environ["PATH"]), LOG=str(self.log))
        p = subprocess.run(["bash", "infra/ops/install.sh"], cwd=str(self.repo), env=env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 2)
        self.assertEqual(self.ssh_calls(), [])


if __name__ == "__main__":
    unittest.main()
