"""POLY-160 R1.2, R1.3c, R1.3f, R1.4, R1.8 (ruling.md 7613d4e9): a restore that fails, or a first deploy cut short, STOPS the candidate's web, auth and worker with plain Docker
(`ps -q` by compose labels, `inspect`, `stop`); Postgres stays; no `down`, `rm`, `--remove-orphans`; the mark is kept; a failing restore writes no quarantine line per poll.
Red on today's build (nothing is stopped, the mark is cleared). Each test names the mutant that turns it red."""
import os
import signal

from test_deploy_hang import last, SDIR
import test_deploy_recover as rc
from test_deploy_recover import render_tag, staging_ups

PROJECT = "polycarpic-staging"


def fail_up_of(world, digest):
    """Make every `up` that names this digest's saved render fail, as a restore that cannot start."""
    orig = world._compose
    tag = render_tag(digest)

    def wrapped(argv, stdin=None):
        if "up" in argv and tag in " ".join(argv):
            return 1, "", "cannot start"
        return orig(argv, stdin)
    world._compose = wrapped


def stops(world):
    return [e for e in world.stop_log if e[0] == "stop"]


def stopped_services(world):
    return sorted(e[1][len("cid-" + PROJECT + "-"):-len("-1")] for e in stops(world))


def no_removal(test, world):
    for c in world.compose_log:
        test.assertNotIn(c["cmd"], ("down", "rm"), "no `down` or `rm`: %r" % c["argv"])
        test.assertNotIn("--remove-orphans", c["argv"])


class Base(rc.RecoverBase):
    def interrupted_second(self):
        """x1 is current; x2 was upped and the run was cut: x2's containers run, the mark is planted (the run's own mark is R1.1's concern)."""
        x1, x2 = self.bad_second_deploy()
        self.world.raise_cmd = {"exec": KeyboardInterrupt()}
        with self.assertRaises(KeyboardInterrupt):
            self.deploy("staging")
        self.world.raise_cmd = {}
        self.world.hang_from = 10 ** 9
        self.plant_mark(x2)
        self.world.stop_log.clear()
        return x1, x2


class StandDown(Base):
    def test_a_restore_that_fails_stops_the_candidates_three_services_and_keeps_the_mark(self):
        """mutants: `stand_down` skipped; `down`/`rm` used; Postgres stopped"""
        x1, x2 = self.interrupted_second()
        fail_up_of(self.world, x1)
        r = self.deploy("staging")
        self.assertEqual((r.rc, last(r)), (1, "deploy: rollback-unhealthy"), r.err)
        self.assertEqual(stopped_services(self.world), ["auth", "web", "worker"], "the candidate's three, not postgres")
        no_removal(self, self.world)
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x2, "mark kept")
        self.assertEqual(self.alert_name("staging"), "rollback-unhealthy")
        self.assertNotIn(x2, self.state("staging", "quarantine") or "", "no quarantine for a restore that failed")
        self.assertEqual(self.state("staging", "current").split()[0], x1)

    def test_current_s_own_containers_are_not_stopped(self):
        """mutant: `keep_ref` ignored (positive case of the guard; an unhealthy current container is also left)"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.plant_mark(x2)
        fail_up_of(self.world, x1)
        self.deploy("staging")
        self.assertEqual(stops(self.world), [], "x1's containers run and are current's own: nothing to stop")

    def test_a_stop_that_fails_is_not_stopped_red_and_the_mark_is_kept(self):
        """mutant: the stop's answer ignored (read back by a second `ps`, never the exit code)"""
        x1, x2 = self.interrupted_second()
        fail_up_of(self.world, x1)
        self.world.stop_fail.add("stop")
        self.deploy("staging")
        self.assertEqual(self.alert_name("staging"), "not-stopped")
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x2)

    def test_ten_polls_of_a_failing_restore_write_no_quarantine_line_then_it_works(self):
        """mutant: the record moved above the restore"""
        x1, x2 = self.interrupted_second()
        orig = self.world._compose
        fail_up_of(self.world, x1)
        for _ in range(10):
            self.deploy("staging")
            self.assertNotIn(x2, self.state("staging", "quarantine") or "")
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x2)
        self.world._compose = orig
        self.deploy("staging")
        self.assertIsNone(self.state("staging", "in-progress"), "the restore worked: the mark is gone")
        self.assertEqual((self.state("staging", "interrupted") or "").strip().split()[0] if self.state("staging", "interrupted") else x2, x2)
        self.assertNotIn(x2, self.state("staging", "quarantine") or "", "the digest was tried once, not banned")

    def test_a_record_that_is_not_on_disk_keeps_the_mark_and_the_candidate_is_not_upped(self):
        """mutant: unlink regardless (R1.3g)"""
        import test_deploy_unwind as u
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.plant_mark(x2)
        u.Helpers.patch(self, put=u.enospc, quarantine=u.enospc)
        for _ in range(2):
            before = len(staging_ups(self.world))
            self.deploy("staging")
            ups = staging_ups(self.world)[before:]
            self.assertTrue(all(render_tag(x1) in " ".join(c["argv"]) for c in ups), "only the old release is upped")
            self.assertEqual((self.state("staging", "in-progress") or "").strip(), x2)


class FirstDeployCut(Base):
    def cut_first_deploy(self, how):
        import shutil
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        x = self.staging_candidate()
        self.host.mkdir("%s/staging" % SDIR)
        self._base = len(self.world.up_marks)
        self.world.hang_from = self._base + 1  # Postgres's own `up` is the first of the run; the cut is after the app `up`
        self.world.raise_cmd = {"exec": how}
        return x

    def test_ctrl_c_in_a_first_deploy_stops_the_candidate_and_the_rerun_ends_healthy(self):
        """mutants: `stand_down` missing in the wrapper; the mark kept in 3f"""
        x = self.cut_first_deploy(KeyboardInterrupt())
        with self.assertRaises(KeyboardInterrupt):
            self.deploy("staging", cmd="first-deploy")
        self.assertEqual(stopped_services(self.world), ["auth", "web", "worker"], "postgres stays")
        no_removal(self, self.world)
        self.assertEqual(self.alert_name("staging"), "interrupted")
        self.world.raise_cmd = {}
        self.world.hang_from = 10 ** 9
        r = self.deploy("staging", cmd="first-deploy")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(self.state("staging", "current").split()[0], x)

    def test_a_first_deploy_that_ends_unhealthy_without_a_cut_is_stopped_too(self):
        """mutant: stand-down only on a signal"""
        import shutil
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        self.staging_candidate()
        self.host.mkdir("%s/staging" % SDIR)
        self.world.hang = {"exec"}
        self.world.hang_from = len(self.world.up_marks) + 1  # after Postgres's `up`
        self.deploy("staging", cmd="first-deploy")
        self.assertEqual(stopped_services(self.world), ["auth", "web", "worker"])

    def test_sighup_and_sigterm_take_ctrl_cs_path_and_the_handlers_are_put_back(self):
        """mutants: the SIGHUP handler removed; the SIGTERM handler removed; not put back"""
        for sig in (signal.SIGHUP, signal.SIGTERM):
            self.setUp()
            def untouched(n, f):  # a build that installs no handler would let the signal kill this process: fail the test instead
                raise AssertionError("no handler: the signal reached the default action")
            olds = (signal.signal(signal.SIGHUP, untouched), signal.signal(signal.SIGTERM, untouched))
            self.addCleanup(signal.signal, signal.SIGHUP, olds[0])
            self.addCleanup(signal.signal, signal.SIGTERM, olds[1])
            before = (untouched, untouched)
            self.cut_first_deploy(None)
            self.world.raise_cmd = {}
            orig = self.world._compose

            def kill(argv, stdin=None, sig=sig):
                if "ps" in argv and len(self.world.up_marks) >= self._base + 2 and not getattr(self, "_sent", False):  # after the app `up`, not Postgres's health wait
                    self._sent = True
                    os.kill(os.getpid(), sig)
                return orig(argv, stdin)
            self._sent = False
            self.world._compose = kill
            try:
                self.deploy("staging", cmd="first-deploy")
            except AssertionError:
                pass
            except BaseException:
                pass
            self.assertEqual((signal.getsignal(signal.SIGHUP), signal.getsignal(signal.SIGTERM)), before, "%s: handlers put back" % sig.name)
            self.assertEqual(stopped_services(self.world), ["auth", "web", "worker"], "%s: stopped" % sig.name)
            self.assertEqual(self.alert_name("staging"), "interrupted", sig.name)


class FinalAlert(Base):
    """ruling.md 26945e68 R1.4: the final alert order is `not-stopped`, else `current-quarantined`, else `rollback-unhealthy`; deploy.log always carries `rollback-unhealthy`."""

    def log_text(self):
        return " ".join((self.state("staging", "deploy.log") or "").split())

    def test_a_failed_stop_inside_an_unwind_later_in_the_run_ends_not_stopped(self):
        """mutant: the unwind's alert is written after the stop's, or the stand-down's answer ignored in the unwind"""
        x1, x2 = self.bad_second_deploy()
        self.world.hang = {"exec"}
        fail_up_of(self.world, x1)
        self.world.stop_fail.add("stop")
        r = self.deploy("staging")
        self.assertEqual(r.rc, 1, r.err)
        self.assertEqual(self.alert_name("staging"), "not-stopped")
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x2, "the mark is kept")
        self.assertIn("rollback-unhealthy", self.log_text(), "the log still carries it")

    def test_a_run_that_started_stuck_and_whose_unwind_cannot_stop_ends_not_stopped(self):
        """mutant: `stuck_end` writes `rollback-unhealthy` over `not-stopped` (the run began stuck; a different digest then failed and its stop failed)"""
        x1, x2 = self.interrupted_second()
        fail_up_of(self.world, x1)
        x3 = self.staging_candidate()  # x3, a different digest from the mark's
        self.world.hang = {"exec"}
        self.world.hang_from = len(self.world.up_marks)
        self.world.stop_fail.add("stop")
        r = self.deploy("staging")
        self.assertEqual(r.rc, 1, r.err)
        self.assertTrue([c for c in staging_ups(self.world) if render_tag(x3) in " ".join(c["argv"])], "the different digest was deployed: " + r.err)
        self.assertEqual(self.alert_name("staging"), "not-stopped")
        self.assertIn("rollback-unhealthy", self.log_text())

    def test_a_stuck_run_does_not_overwrite_current_quarantined(self):
        """mutant: `stuck_end` writes `rollback-unhealthy` over `current-quarantined`"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.host.write("%s/staging/quarantine" % SDIR, "%s 2026-01-01T00:00:00Z unhealthy\n" % x1)
        self.plant_mark(x2)
        self.deploy("staging")
        self.assertEqual(self.alert_name("staging"), "current-quarantined")
        self.assertIn("rollback-unhealthy", self.log_text(), "the log always carries rollback-unhealthy")
