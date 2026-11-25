"""POLY-160 R2 (ruling.md 7613d4e9): one commit point. After `commit` (previous saved, current saved) nothing unwinds: a later failure is alert `records`, exit 1, the new release stays up, the mark is kept
and the next run settles. A save of `current` that raises is judged by a re-read. `rollback` onto the digest that is current is exit 4. Red on today's build (M7, M8).
Each test names the mutant that turns it red."""
import os

from test_deploy_hang import last, SDIR
import test_deploy_recover as rc
import test_deploy_unwind as u
from test_deploy_recover import render_tag, staging_ups


def deployer_mod():
    u.release_mod()
    from lib import deployer
    return deployer


class Commit(rc.RecoverBase):
    def second_ready(self):
        x1, _ = self.first()
        x2 = self.staging_candidate()
        return x1, x2

    def test_link_current_failing_after_the_commit_keeps_the_new_release_up_and_the_next_run_settles(self):
        """mutants: `committed` not set; settle clearing the mark on a failure"""
        x1, x2 = self.second_ready()
        d = deployer_mod()
        real = d.link_current

        def broken(*a, **k):
            raise OSError(5, "I/O error")
        d.link_current = broken
        self.addCleanup(setattr, d, "link_current", real)
        before = len(staging_ups(self.world))
        r = self.deploy("staging")
        ups = staging_ups(self.world)[before:]
        self.assertEqual(r.rc, 1, r.err)
        self.assertEqual(len(ups), 1, "the candidate's `up` only: no restore of the old release")
        self.assertIn(render_tag(x2), " ".join(ups[0]["argv"]))
        self.assertEqual(self.state("staging", "current").split()[0], x2, "current names the release that runs")
        self.assertNotIn(x2, self.state("staging", "quarantine") or "", "a healthy release is not banned")
        self.assertEqual(self.alert_name("staging"), "records")
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x2, "the mark is kept until settled")
        d.link_current = real
        before = len(staging_ups(self.world))
        self.deploy("staging")
        self.assertIsNone(self.state("staging", "in-progress"), "the next run settles and clears the mark")
        self.assertIsNone(self.state("staging", "alert"), "and the alert")
        self.assertNotIn(x2, self.state("staging", "quarantine") or "")

    def test_a_save_of_current_that_raises_before_writing_restores_the_old_release_and_puts_previous_back(self):
        """mutants: the re-read removed; `previous` not put back"""
        self.save_of_current(raises_after_write=False)

    def test_a_save_of_current_that_raises_after_writing_is_a_commit(self):
        """mutant: the re-read removed (the unwind would restore the old release over a current that names the new one)"""
        x1, x2 = self.save_of_current(raises_after_write=True)

    def save_of_current(self, raises_after_write):
        x1, x2 = self.second_ready()
        rel = u.release_mod()
        real = rel.save_pointer

        def flaky(ctx, project, name, ptr, *a, **k):
            if name == "current" and ptr.get("digest") == x2:
                if raises_after_write:
                    real(ctx, project, name, ptr, *a, **k)
                raise OSError(28, "No space left on device")
            return real(ctx, project, name, ptr, *a, **k)
        rel.save_pointer = flaky
        self.addCleanup(setattr, rel, "save_pointer", real)
        before = len(staging_ups(self.world))
        r = self.deploy("staging")
        ups = staging_ups(self.world)[before:]
        self.assertEqual(r.rc, 1, r.err)
        cur = self.state("staging", "current").split()[0]
        if raises_after_write:
            self.assertEqual(cur, x2, "the re-read names the new digest: committed")
            self.assertEqual(len(ups), 1, "nothing restored over a committed release")
            self.assertEqual(self.alert_name("staging"), "records")
            self.assertNotIn(x2, self.state("staging", "quarantine") or "")
        else:
            self.assertEqual(cur, x1, "not committed: the old release is current")
            self.assertEqual(len(ups), 2, "candidate, then the restore")
            self.assertIn(render_tag(x1), " ".join(ups[-1]["argv"]))
            self.assertNotEqual((self.state("staging", "previous") or "x").split()[0], x1, "previous is put back to what it was, not the release that is current")
        return x1, x2

    def test_an_unreadable_interrupted_after_the_commit_does_not_unwind(self):
        """mutant: the Refusal handler's `committed` check dropped"""
        x1, x2 = self.second_ready()
        rel = u.release_mod()
        real = rel.read
        armed = {"on": False}

        def read(ctx, project, name, *a, **k):
            if name == "interrupted" and armed["on"]:
                raise rel.Refusal("state")
            return real(ctx, project, name, *a, **k)
        rel.read = read
        self.addCleanup(setattr, rel, "read", real)
        d = deployer_mod()
        link = d.link_current

        def arm(*a, **k):
            armed["on"] = True  # the commit is done once the link is made
            return link(*a, **k)
        d.link_current = arm
        self.addCleanup(setattr, d, "link_current", link)
        before = len(staging_ups(self.world))
        r = self.deploy("staging")
        ups = staging_ups(self.world)[before:]
        self.assertEqual(len(ups), 1, "no restore after the commit")
        self.assertEqual(self.state("staging", "current").split()[0], x2)
        self.assertNotIn(x2, self.state("staging", "quarantine") or "")
        self.assertNotEqual(r.rc, 0)


class RollbackGuards(rc.RecoverBase):
    def same_previous(self):
        self.first()
        cur = self.state("staging", "current")
        self.host.write("%s/staging/previous" % SDIR, cur)

    def test_previous_naming_current_is_no_previous_release_exit_4_and_no_up(self):
        """mutant: the check dropped"""
        self.same_previous()
        before = len(staging_ups(self.world))
        r = self.deploy("staging", cmd="rollback")
        self.assertEqual(r.rc, 4, r.err)
        self.assertEqual(len(staging_ups(self.world)), before, "nothing upped")
        self.assertIn("no previous release", r.err)

    def test_a_pointer_write_that_fails_in_a_rollback_raises_the_alert_rollback_pointers(self):
        """mutant: the alert dropped"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.deploy("staging")
        rel = u.release_mod()
        real = rel.save_pointer

        def broken(*a, **k):
            raise OSError(28, "No space left on device")
        rel.save_pointer = broken
        self.addCleanup(setattr, rel, "save_pointer", real)
        r = self.deploy("staging", cmd="rollback")
        self.assertEqual(r.rc, 1, r.err)
        self.assertEqual(self.alert_name("staging"), "rollback-pointers")
        self.assertIn("free space", r.err)
        self.assertIn("rollback", r.err.split("free space")[-1], "and says to run rollback again")
