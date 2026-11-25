"""POLY-104 F2 (first real box): install.sh run by its path, from a directory in ANOTHER checkout, shipped that other checkout's HEAD. The repository
that counts is the one the script lives in: its HEAD, its dirty check, its --commit and origin/main. Paths the operator types (--ssh-key) still mean
what they mean where the operator stands."""
import io
import os
import shutil
import subprocess
import tarfile
import unittest

import test_install as ti


class ByPath(unittest.TestCase):
    # test_install.py's laptop fixture (self.repo is the verified checkout), borrowed method by method so POLY-98's tests do not run again here
    git = ti.Install.git
    ssh_calls = ti.Install.ssh_calls

    def setUp(self):
        ti.Install.setUp(self)
        # a second checkout of the same layout with its own history: where the operator happens to stand
        self.other = self.t / "other"
        shutil.copytree(str(self.repo), str(self.other), ignore=shutil.ignore_patterns(".git"))
        self.mark(self.other, "from the other checkout")
        self.gitc(self.other, "init", "-q")
        self.gitc(self.other, "add", "-A")
        self.gitc(self.other, "commit", "-q", "-m", "other")
        self.mark(self.repo, "from the verified checkout")
        self.git("commit", "-q", "-am", "verified")
        self.head = self.git("rev-parse", "HEAD")
        # the fake ssh also records the directory it runs in: a relative -i is read from there
        (self.bin / "ssh").write_text((self.bin / "ssh").read_text().replace('cat > "$LOG/ssh-$n.stdin"', 'pwd -P > "$LOG/ssh-$n.pwd"\ncat > "$LOG/ssh-$n.stdin"'))

    def gitc(self, repo, *a):
        return subprocess.run([ti.REAL_GIT] + list(a), cwd=str(repo), env=dict(os.environ, **ti.ENV_GIT), capture_output=True, text=True, check=True).stdout.strip()

    @staticmethod
    def mark(repo, text):
        for rel in ("infra/provision.sh", "infra/ops/install_box.py"):
            p = repo / rel
            p.write_text(p.read_text() + "# %s\n" % text)

    def run_from(self, cwd, *args, script=None):
        env = dict(os.environ, **ti.ENV_GIT, PATH="%s:%s" % (self.bin, os.environ["PATH"]), LOG=str(self.log))
        argv = ["bash", script or str(self.repo / "infra" / "ops" / "install.sh"), "polyops@box.example"] + list(args)
        p = subprocess.run(argv, cwd=str(cwd), env=env, capture_output=True, text=True, timeout=60)
        return p.returncode, p.stdout, p.stderr

    def assert_shipped(self, rc, out, err, sha, text):
        self.assertEqual(rc, 0, out + err)
        calls = self.ssh_calls()
        self.assertEqual(len(calls), 2, out + err)
        self.assertIn("install_box.py git-%s " % sha[:12], calls[1][0][-1], "the id is the verified checkout's commit")
        tar = tarfile.open(fileobj=io.BytesIO(calls[1][1]))
        for body in (calls[0][1].decode(), tar.extractfile("infra/provision.sh").read().decode()):
            self.assertIn("# " + text, body)
            self.assertNotIn("from the other checkout", body)

    def test_run_by_path_from_another_checkout_ships_the_scripts_own_head(self):
        self.assert_shipped(*self.run_from(self.other), self.head, "from the verified checkout")

    def test_run_by_a_relative_path_from_another_checkout_ships_the_scripts_own_head(self):
        self.assert_shipped(*self.run_from(self.other, script="../repo/infra/ops/install.sh"), self.head, "from the verified checkout")

    def test_run_from_a_directory_that_is_no_checkout_ships_the_scripts_own_head(self):
        nowhere = self.t / "nowhere"
        nowhere.mkdir()
        self.assert_shipped(*self.run_from(nowhere), self.head, "from the verified checkout")

    def test_changes_in_the_scripts_checkout_refuse_even_when_the_directory_stood_in_is_clean(self):
        (self.repo / "infra" / "compose" / "prod.yml").write_text("dirty\n")
        rc, out, err = self.run_from(self.other)
        self.assertEqual(rc, 2, out + err)
        self.assertIn("uncommitted changes", err)
        self.assertIn("infra/compose/prod.yml", err)
        self.assertEqual(self.ssh_calls(), [])

    def test_changes_in_the_directory_stood_in_do_not_refuse(self):
        (self.other / "infra" / "compose" / "prod.yml").write_text("dirty\n")
        self.assert_shipped(*self.run_from(self.other), self.head, "from the verified checkout")

    def test_the_dirty_check_holds_when_run_from_a_subdirectory_of_the_scripts_own_checkout(self):
        (self.repo / "infra" / "compose" / "prod.yml").write_text("dirty\n")
        rc, out, err = self.run_from(self.repo / "infra", script="ops/install.sh")
        self.assertEqual(rc, 2, out + err)
        self.assertIn("infra/compose/prod.yml", err)
        self.assertEqual(self.ssh_calls(), [])

    def test_commit_is_read_from_the_scripts_checkout_and_its_origin_main(self):
        self.git("update-ref", "refs/remotes/origin/main", self.head)
        self.assert_shipped(*self.run_from(self.other, "--commit", self.head), self.head, "from the verified checkout")

    def test_a_commit_that_only_the_directory_stood_in_has_is_refused(self):
        theirs = self.gitc(self.other, "rev-parse", "HEAD")
        self.gitc(self.other, "update-ref", "refs/remotes/origin/main", theirs)
        self.git("update-ref", "refs/remotes/origin/main", self.head)
        rc, out, err = self.run_from(self.other, "--commit", theirs)
        self.assertEqual(rc, 2, out + err)
        self.assertIn("is not a commit here", err)
        self.assertEqual(self.ssh_calls(), [])

    def test_a_relative_ssh_key_is_still_the_file_where_the_operator_stands(self):
        (self.other / "keys").mkdir()
        (self.other / "keys" / "k").write_text("key\n")
        rc, out, err = self.run_from(self.other, "--ssh-key", "keys/k")
        self.assertEqual(rc, 0, out + err)
        calls = self.ssh_calls()
        self.assertEqual(len(calls), 2)
        for n, (args, _) in enumerate(calls, 1):
            where = (self.log / ("ssh-%d.pwd" % n)).read_text().strip()
            got = os.path.realpath(os.path.join(where, args[args.index("-i") + 1]))
            self.assertEqual(got, os.path.realpath(str(self.other / "keys" / "k")), "ssh call %d" % n)


if __name__ == "__main__":
    unittest.main()
