"""POLY-160 R3 and R4 (ruling.md 7613d4e9): after the candidate's first `up` every unhealthy uncommitted exit writes a quarantine line (a box fault: `held-<name>` with the bundle id, which lifts with another
installed bundle); `check-config` has a client timeout that is not a quarantine, an exit code is (124 included); a `rel.log` that raises in the transient or busy paths, or after the first `up`, stops nothing.
Red on today's build (M9, M11, M12). Each test names the mutant that turns it red."""
import test_deploy_recover as rc
import test_deploy_unwind as u
from test_deploy_hang import last, SDIR
from test_deploy_recover import render_tag, staging_ups


class Held(rc.RecoverBase):
    def alter_render_after_up(self, x2):
        """After the candidate's first `up` the saved render's bytes change: the next judgement of it is `unjudged`."""
        orig = self.world._compose
        done = {"n": 0}
        tag = render_tag(x2)

        def wrapped(argv, stdin=None):
            out = orig(argv, stdin)
            if "up" in argv and tag in " ".join(argv) and not done["n"]:
                done["n"] = 1
                for f in self.sdir("staging").glob(tag):
                    f.write_text(f.read_text() + " ")
            return out
        self.world._compose = wrapped

    def test_unjudged_after_up_is_held_not_retried_every_poll(self):
        """mutant: held only when a flag is set (the lift by another bundle is a unit case of `quarantined`, still to write)"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.alter_render_after_up(x2)
        self.deploy("staging")
        q = self.state("staging", "quarantine") or ""
        self.assertIn(x2, q, "a line for the candidate")
        self.assertIn("held-", q)
        marks = len(staging_ups(self.world))
        for _ in range(2):
            self.deploy("staging")
        self.assertEqual(len(staging_ups(self.world)), marks, "polls two and three upped nothing")
        self.assertIsNotNone(self.state("staging", "alert"), "the alert stays RED")


class Logging(rc.RecoverBase):
    def test_a_log_that_raises_in_a_transient_run_stops_nothing(self):
        """mutant: `rel.log` put back in the Transient handler"""
        self.first()
        self.staging_candidate()
        self.world.gh_down = True
        u.Helpers.patch(self, log=u.enospc)
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        self.assertIsNotNone(self.state("staging", "transient-since"), "the transient is still marked")
        self.assertTrue(r.err.strip(), "one stderr line says the log failed")


class CheckConfig(rc.RecoverBase):
    def check_config_result(self, outcome):
        orig = self.world._compose

        def wrapped(argv, stdin=None):
            if "run" in argv and "check-config" in argv:
                if outcome == "timeout":
                    raise TimeoutError("check-config")
                return outcome, "", ""
            return orig(argv, stdin)
        self.world._compose = wrapped

    def test_a_client_timeout_is_not_a_quarantine_but_an_exit_code_is_even_124(self):
        """mutant: told apart by the code"""
        for label, outcome, banned in (("timeout", "timeout", False), ("exit 124", 124, True), ("exit 1", 1, True)):
            self.setUp()
            self.first()
            x2 = self.staging_candidate()
            self.check_config_result(outcome)
            r = self.deploy("staging")
            self.assertEqual(r.rc, 1, "%s: %s" % (label, r.err))
            self.assertEqual(x2 in (self.state("staging", "quarantine") or ""), banned, label)
            self.assertEqual(self.alert_name("staging"), "check-config" if banned else "check-config-timeout", label)
