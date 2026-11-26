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

    def test_an_upper_case_commit_is_a_bad_commit_in_the_operators_locale_too(self):
        # under en_US.UTF-8, macOS bash reads `[a-f]` as also holding B to F's lower-case neighbours A to E; test_install_commit's upper-case case
        # then passed or failed with the letters of that run's random commit id
        env = dict(os.environ, **ti.ENV_GIT, PATH="%s:%s" % (self.bin, os.environ["PATH"]), LOG=str(self.log), LANG="en_US.UTF-8")
        env.pop("LC_ALL", None)
        p = subprocess.run(["bash", str(self.repo / "infra" / "ops" / "install.sh"), "polyops@box.example", "--commit", "ABCDE" * 8], cwd=str(self.repo), env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual((p.returncode, p.stderr), (2, "install.sh: bad --commit\n"))
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


class GitFailure(unittest.TestCase):
    """POLY-104: install.sh is sh, so a pipe's status is the last command's: a `git show` or `git archive` that failed was hidden behind ssh's 0, and
    the install reported success after shipping nothing, or part of a tree. Its exit code must be the script's, a line must say what failed, and the box
    command that changes the installed version (the install_box.py run, the second ssh) must never start: the box cannot tell a cut stream that ends
    on a member boundary from a whole one, so the laptop knows git succeeded before it runs it."""

    git = ti.Install.git
    ssh_calls = ti.Install.ssh_calls
    install = ti.Install.install
    CODE = 42  # no tool on this path exits 42 by itself

    def setUp(self):
        ti.Install.setUp(self)

    def fail_git(self, verb, keep):
        """`git <verb>` writes the first `keep` bytes of its real output (all of it when None), then exits CODE; every other git call is real."""
        cut = "cat" if keep is None else "head -c %d" % keep
        (self.bin / "git").write_text(
            '#!/bin/sh\nif [ "$1" = %s ]; then echo "fatal: planted %s failure" >&2; %s "$@" | %s; exit %d; fi\nexec %s "$@"\n'
            % (verb, verb, ti.REAL_GIT, cut, self.CODE, ti.REAL_GIT))

    def check(self, verb, keep):
        self.fail_git(verb, keep)
        rc, out, err = self.install()
        self.assertEqual(rc, self.CODE, "install.sh must exit with git's code; got %d\n%s%s" % (rc, out, err))
        self.assertTrue([l for l in err.splitlines() if l.startswith("install.sh: ") and "git %s" % verb in l], "no install.sh line naming git %s:\n%s" % (verb, err))
        ran = [args[-1] for args, _ in self.ssh_calls() if "/usr/bin/python3" in args[-1]]
        self.assertEqual(ran, [], "install_box.py was run on the box although git %s failed" % verb)

    def test_git_show_that_writes_nothing_and_fails(self):
        self.check("show", 0)

    def test_git_show_that_fails_partway_through_the_file(self):
        self.check("show", 200)

    def test_git_archive_that_writes_nothing_and_fails(self):
        self.check("archive", 0)

    def test_git_archive_that_fails_partway_through_the_tree(self):
        self.check("archive", 10240)  # whole tar records: a valid beginning of the tree

    def test_git_archive_that_fails_after_writing_everything(self):
        self.check("archive", None)

    def test_with_git_working_the_archive_sent_is_git_archives_whole_output(self):  # positive twin
        rc, out, err = self.install()
        self.assertEqual(rc, 0, out + err)
        calls = self.ssh_calls()
        self.assertEqual(len(calls), 2)
        sha = self.git("rev-parse", "HEAD")
        sent = tarfile.open(fileobj=io.BytesIO(calls[1][1]))
        paths = [x for x in ti.BUNDLE_PATHS]
        want = subprocess.run([ti.REAL_GIT, "archive", "--format=tar", sha, "--"] + paths, cwd=str(self.repo), capture_output=True, check=True).stdout
        self.assertEqual(sorted(sent.getnames()), sorted(tarfile.open(fileobj=io.BytesIO(want)).getnames()))


if __name__ == "__main__":
    unittest.main()
