"""POLY-100 T-help, `install.sh --commit` (S21, R11): the operator installs a reviewed commit C while HEAD is elsewhere; no checkout (a checkout would run C's tracked hooks on the laptop);
C must be an ancestor of origin/main, else exit 2 before any ssh; a bad host or commit is refused before anything is read."""
import io
import os
import tarfile
import unittest

import test_install as ti


class CommitCases(unittest.TestCase):
    # the laptop fixture of test_install.py (a committed bundle checkout, a logging git, a fake ssh), borrowed method by method so POLY-98's own tests are not run again here
    setUp = ti.Install.setUp
    git = ti.Install.git
    install = ti.Install.install
    ssh_calls = ti.Install.ssh_calls

    def on_main(self, commit):
        self.git("update-ref", "refs/remotes/origin/main", commit)

    def commit_change(self, text):
        p = self.repo / "infra" / "provision.sh"
        p.write_text(p.read_text() + "# %s\n" % text)
        self.git("commit", "-q", "-am", text)
        return self.git("rev-parse", "HEAD")

    def tar_of(self):
        return tarfile.open(fileobj=io.BytesIO(self.ssh_calls()[1][1]))

    def test_commit_ships_cs_files_while_head_is_elsewhere(self):
        c = self.commit_change("reviewed")
        self.git("update-ref", "refs/remotes/origin/main", c)
        self.commit_change("not reviewed: HEAD moved on")
        rc, out, err = self.install("polyops@box.example", "--commit", c)
        self.assertEqual(rc, 0, out + err)
        body = self.tar_of().extractfile("infra/provision.sh").read().decode()
        self.assertIn("# reviewed", body)
        self.assertNotIn("not reviewed", body)
        self.assertIn("git-" + c[:12], out + err + " ".join(a for args, _ in self.ssh_calls() for a in args))

    def test_a_commit_off_origin_main_exits_2_with_no_ssh(self):
        base = self.git("rev-parse", "HEAD")
        self.git("update-ref", "refs/remotes/origin/main", base)
        self.git("checkout", "-q", "-b", "side")
        c = self.commit_change("on a side branch")
        rc, out, err = self.install("polyops@box.example", "--commit", c)
        self.assertEqual(rc, 2, out + err)
        self.assertEqual(self.ssh_calls(), [])
        self.assertIn(c, out + err)

    def test_a_commit_not_known_here_exits_2_telling_the_operator_to_fetch(self):
        self.on_main(self.git("rev-parse", "HEAD"))
        rc, out, err = self.install("polyops@box.example", "--commit", "0" * 40)
        self.assertEqual(rc, 2, out + err)
        self.assertIn("git fetch origin", out + err)
        self.assertEqual(self.ssh_calls(), [])

    def test_a_post_checkout_hook_planted_in_c_leaves_no_canary_and_no_checkout_is_run(self):
        hook = self.repo / ".githooks" / "post-checkout"
        hook.parent.mkdir()
        canary = self.t / "canary"
        hook.write_text("#!/bin/sh\ntouch %s\n" % canary)
        os.chmod(str(hook), 0o755)
        self.git("config", "core.hooksPath", ".githooks")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "plant a hook")
        c = self.git("rev-parse", "HEAD")
        self.on_main(c)
        self.commit_change("HEAD moves on")
        rc, out, err = self.install("polyops@box.example", "--commit", c)
        self.assertEqual(rc, 0, out + err)
        self.assertFalse(canary.exists(), "C's tracked hook ran on this machine")
        log = (self.log / "git.log").read_text() if (self.log / "git.log").exists() else ""
        for banned in ("checkout", "switch", "reset", "merge ", "pull", "clone", "worktree"):
            self.assertNotIn(banned, log)

    def test_bad_hosts_and_commits_are_refused_before_anything_is_read(self):
        c = self.git("rev-parse", "HEAD")
        self.on_main(c)
        for args in (("polyops@x;id", "--commit", c), ("-oProxyCommand=x", "--commit", c), ("polyops@box.example", "--commit", c[:12]), ("polyops@box.example", "--commit", c.upper()),
                     ("polyops@box.example", "--commit", c + "0"), ("polyops@box.example", "--commit"), ("polyops@box.example", "--ssh-key", "-oProxyCommand=x")):
            rc, out, err = self.install(*args)
            self.assertEqual(rc, 2, (args, out, err))
            self.assertEqual(self.ssh_calls(), [], args)

    def test_a_commit_with_changes_under_the_bundle_paths_in_the_working_tree_is_not_the_check_that_applies(self):
        # --commit ships a commit, so a dirty working tree is not a reason to refuse it (the dirty check is for HEAD installs)
        c = self.commit_change("reviewed")
        self.on_main(c)
        (self.repo / "infra" / "compose" / "prod.yml").write_text("dirty\n")
        rc, out, err = self.install("polyops@box.example", "--commit", c)
        self.assertEqual(rc, 0, out + err)
        self.assertNotIn(b"dirty", self.tar_of().extractfile("infra/compose/prod.yml").read())
