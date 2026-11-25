"""POLY-160 R1 (ruling.md 7613d4e9): the recovery is first and its outcomes. Red on today's build; each test names the mutant that turns it red.
Companion of test_deploy_recover.py (the Compose case). Staging only; edge cases are in test_deploy_recover_edge.py."""
import errno
import sys
import tempfile

from test_deploy_hang import last, SDIR
import test_deploy_recover as rc
from test_deploy_recover import render_tag, staging_ups
import test_deploy_unwind as u


class Checks(rc.RecoverBase):
    def test_malformed_previous_or_transient_since_do_not_keep_the_old_release_down(self):
        """mutants: each check (previous, transient-since) moved back above `recover`, one at a time"""
        for name, text in (("previous", "garbage\n"), ("transient-since", "not a time\n")):
            self.setUp()
            x1, _ = self.first()
            x2 = self.staging_candidate()
            self.plant_mark(x2)
            self.host.write("%s/staging/%s" % (SDIR, name), text)
            before = len(staging_ups(self.world))
            self.deploy("staging")
            ups = staging_ups(self.world)[before:]
            self.assertTrue(ups, "%s malformed: the restore happened" % name)
            self.assertIn(render_tag(x1), " ".join(ups[0]["argv"]), name)

    def test_an_empty_truncated_or_junk_mark_is_restored_then_state_and_the_mark_is_kept(self):
        """mutants: `Refusal(state)` before the restore; the mark unlinked on the refusal"""
        for label, text in (("empty", ""), ("truncated", "sha256:abcd\n"), ("junk", "not a digest\n")):
            self.setUp()
            self.first()
            self.staging_candidate()
            self.host.write("%s/staging/in-progress" % SDIR, text)
            before = len(staging_ups(self.world))
            r = self.deploy("staging")
            self.assertEqual((r.rc, last(r)), (1, "deploy: refused state"), "%s: %s" % (label, r.err))
            self.assertEqual(len(staging_ups(self.world)) - before, 1, "%s: the old release was upped, once" % label)
            self.assertEqual(self.state("staging", "in-progress"), text, "%s: the mark is kept" % label)
            self.assertEqual(self.alert_name("staging"), "state", label)

    def test_a_full_disk_at_every_write_still_restores_before_anything_is_written(self):
        """mutant: the alert, log or record moved above the restore"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.plant_mark(x2)
        u.Helpers.patch(self, write=u.enospc, put=u.enospc, log=u.enospc, alert=u.enospc, quarantine=u.enospc)
        before = len(staging_ups(self.world))
        self.deploy("staging")
        ups = staging_ups(self.world)[before:]
        self.assertEqual(len(ups), 1, "the old release's `up` happened")
        self.assertIn(render_tag(x1), " ".join(ups[0]["argv"]))
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x2, "no record on disk: the mark stays")

    def test_no_work_directory_is_made_before_the_restore(self):
        """mutant: tempfile.mkdtemp called before `recover`"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.plant_mark(x2)

        real = tempfile.mkdtemp

        def full(*a, **k):
            if "/infra/ops/lib/" in sys._getframe(1).f_code.co_filename.replace("\\", "/"):  # only the tool's own work directory; the harness keeps its own
                raise OSError(errno.ENOSPC, "No space left on device")
            return real(*a, **k)
        tempfile.mkdtemp = full
        self.addCleanup(setattr, tempfile, "mkdtemp", real)
        before = len(staging_ups(self.world))
        self.deploy("staging")
        ups = staging_ups(self.world)[before:]
        self.assertTrue(ups and render_tag(x1) in " ".join(ups[0]["argv"]), "the old release was upped before a work directory was needed")

    def test_a_mark_that_names_current_is_settled_never_quarantined(self):
        """mutant: R1.3e deleted (the running digest is quarantined, M10)"""
        x1, _ = self.first()
        for _ in range(2):
            self.plant_mark(x1)
            self.deploy("staging")
            self.assertNotIn(x1, self.state("staging", "quarantine") or "", "the running digest is never banned")
            self.assertEqual(self.state("staging", "current").split()[0], x1)
            self.assertIsNone(self.state("staging", "in-progress"), "settled: the mark is cleared")

    def test_current_listed_in_the_quarantine_is_not_upped_and_is_named_red(self):
        """mutant: the quarantine check dropped"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.host.write("%s/staging/quarantine" % SDIR, "%s unhealthy 2026-01-01T00:00:00Z\n" % x1)
        self.plant_mark(x2)
        before = len(staging_ups(self.world))
        self.deploy("staging")
        self.assertEqual(len(staging_ups(self.world)), before, "nothing upped")
        self.assertEqual(self.alert_name("staging"), "current-quarantined")
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x2)

    def test_a_lifted_line_on_current_does_not_stop_the_restore(self):
        """seceng, R1.3b: held by quarantined()'s rule, lift included. mutant: a plain search of the file"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.host.write("%s/staging/quarantine" % SDIR, "%s held-render-env 2026-01-01T00:00:00Z oldbundle0000\n" % x1)
        self.plant_mark(x2)
        before = len(staging_ups(self.world))
        self.deploy("staging")
        ups = staging_ups(self.world)[before:]
        self.assertTrue(ups and render_tag(x1) in " ".join(ups[0]["argv"]), "the first `up` is the restore of current")
        self.assertNotEqual(self.alert_name("staging"), "current-quarantined")

    def test_a_ctrl_c_in_the_health_wait_keeps_the_mark_and_the_next_run_restores(self):
        """mutant: `finally: unlink` put back"""
        x1, x2 = self.bad_second_deploy()
        self.world.raise_cmd = {"exec": KeyboardInterrupt()}
        with self.assertRaises(KeyboardInterrupt):
            self.deploy("staging")
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x2, "the mark survives Ctrl-C")
        self.assertNotIn(x2, self.state("staging", "quarantine") or "")
        self.world.raise_cmd = {}
        self.world.hang_from = 10 ** 9
        before = len(staging_ups(self.world))
        self.deploy("staging")
        ups = staging_ups(self.world)[before:]
        self.assertIn(render_tag(x1), " ".join(ups[0]["argv"]), "the next run's first `up` is the restore")
