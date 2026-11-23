"""POLY-100 F2 (ruling.md; build review F2): a child that times out, dies or prints non-UTF-8 is a failed child, so a health read says "not healthy"; one handler above `_deploy`, `edge.deploy`
and `rollback` turns any other exception into `internal` (before the first `up`: a refusal, no Q) or R8's automatic rollback (after it), always with an alert; before the candidate's first `up` the run
writes `in-progress` and removes it at the end. Written from the ruling, red on the build it was written against."""
import os
import subprocess
import sys
import unittest

from base import OPS
from deploy_base import DeployTest
import test_deploy_flow as fl

SDIR = "/var/lib/polycarpic/state/deploy"


def last(r):
    return r.err.splitlines()[-1] if r.err.strip() else ""


class Hang(DeployTest):
    new_commit = fl.Flow.new_commit
    staging_candidate = fl.Flow.staging_candidate
    hex_dir = fl.Flow.hex_dir
    first = fl.Flow.first
    ups = fl.Flow.ups
    since = fl.Flow.since
    mark = 0

    def setUp(self):
        super().setUp()
        import shutil
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        self.n = 0

    def bad_second_deploy(self):
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.world.hang_from = len(self.world.up_marks)  # the hang starts after this run's first `up`
        return x1, x2

    def assert_rolled_back(self, r, x1, x2, what):
        self.assertEqual(r.rc, 1, "%s: %s" % (what, r.err))
        self.assertEqual(last(r), "deploy: rolled-back", "%s: %s" % (what, r.err))
        self.assertEqual(self.state("staging", "current").split()[0], x1, what)
        self.assertIn(x2, self.state("staging", "quarantine") or "", what)
        self.assertIsNotNone(self.state("staging", "alert"), what)
        self.assertEqual(len([c for c in self.world.compose_log if c["cmd"] == "up" and c["project"] == "polycarpic-staging"]) % 2, 0, "the candidate's `up` and the rollback's")



class F2(Hang):
    def test_each_health_read_hanging_is_not_healthy_and_rolls_back(self):
        for cmd in ("exec", "ps"):
            self.world.hang = {cmd}
            import shutil
            shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
            self.world.containers.clear()
            self.n = 0
            x1, x2 = self.bad_second_deploy()
            self.world.hang_from = len(self.world.up_marks)
            r = self.deploy("staging")
            self.assert_rolled_back(r, x1, x2, "%s hangs" % cmd)
            self.world.hang = set()
            self.world.hang_from = 10 ** 9

    def test_inspect_hanging_after_up_is_not_healthy_and_rolls_back(self):
        self.world.hang = {"inspect"}
        x1, x2 = self.bad_second_deploy()
        r = self.deploy("staging")
        self.assert_rolled_back(r, x1, x2, "inspect hangs")

    def test_any_other_exception_after_up_is_the_automatic_rollback_with_internal_logged(self):
        self.world.raise_cmd = {"exec": RuntimeError("boom")}
        x1, x2 = self.bad_second_deploy()
        r = self.deploy("staging")
        self.assert_rolled_back(r, x1, x2, "a raise from a later call")
        self.assertIn("internal", " ".join((self.state("staging", "deploy.log") or "").split()), "internal is logged")

    def test_an_exception_before_the_first_up_is_the_refusal_internal_without_quarantine(self):
        self.first()
        x2 = self.staging_candidate()
        self.world.raise_cmd = {"run": RuntimeError("boom")}
        self.world.hang_from = len(self.world.up_marks) - 1  # active until this run's first `up`: the first `run` (check-config) is made before it
        # the candidate's first `up` has not happened when the first `run` (check-config) is made
        r = self.deploy("staging")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused internal"), r.err)
        self.assertEqual(self.alert_name("staging"), "internal")
        self.assertNotIn(x2, self.state("staging", "quarantine") or "", "no Q")

    def test_in_progress_is_written_before_the_candidates_first_up_and_removed_at_the_end(self):
        self.first()
        x2 = self.staging_candidate()
        seen = {}

        def probe(cmd, argv):
            if cmd == "up" and "postgres" not in argv and "caddy" not in argv:
                seen["f"] = self.state("staging", "in-progress")
        self.world.on_compose = probe
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        self.assertIsNotNone(seen.get("f"), "in-progress holds the candidate's digest while it comes up")
        self.assertIn(x2, seen["f"])
        self.assertIsNone(self.state("staging", "in-progress"), "removed at the end")

    def test_a_leftover_in_progress_is_interrupted_the_first_time_and_quarantines_the_second(self):
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.host.write("%s/staging/in-progress" % SDIR, x2 + "\n")
        r = self.deploy("staging")
        self.assertIn("interrupted", (self.state("staging", "deploy.log") or "") + (self.state("staging", "alert") or "") + r.err, "alerts interrupted")
        self.assertNotIn(x2, self.state("staging", "quarantine") or "", "the first time it is tried again, not banned")
        self.host.write("%s/staging/in-progress" % SDIR, x2 + "\n")
        self.world.runs.clear()
        self.staging_candidate()
        # the same digest interrupted a second time is banned: plant it again and offer the same digest
        self.world.runs.clear()
        self.world.staging_run(self.world.commit_b, x2, run_id="9999")
        self.host.write("%s/staging/interrupted" % SDIR, x2 + "\n")
        self.host.write("%s/staging/in-progress" % SDIR, x2 + "\n")
        r = self.deploy("staging")
        self.assertIn(x2, self.state("staging", "quarantine") or "", "the second time it is quarantined")
        self.assertIn("interrupted", self.state("staging", "quarantine"))

    def test_a_first_deploy_interrupted_alerts_once(self):
        import shutil
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        x = self.staging_candidate()
        self.host.mkdir("%s/staging" % SDIR)
        self.host.write("%s/staging/in-progress" % SDIR, x + "\n")
        r = self.deploy("staging", cmd="first-deploy")
        self.assertIn("interrupted", (self.state("staging", "deploy.log") or "") + r.err)


    def test_a_health_read_that_still_hangs_during_the_rollback_is_rollback_unhealthy(self):
        self.world.hang = {"exec"}
        self.world.hang_through = True
        x1, x2 = self.bad_second_deploy()
        r = self.deploy("staging")
        self.assertEqual((r.rc, last(r)), (1, "deploy: rollback-unhealthy"), r.err)
        self.assertIn(x2, self.state("staging", "quarantine") or "")
        self.assertIsNotNone(self.state("staging", "alert"))


class NonUtf8(unittest.TestCase):
    """The real child runner: a child printing bytes that are not UTF-8 is a failed child's output, decoded with replacement, never an exception."""

    def test_real_run_decodes_with_replacement(self):
        if str(OPS) not in sys.path:
            sys.path.insert(0, str(OPS))
        from lib import ctx
        code, out, err = ctx._real_run([sys.executable, "-I", "-c", "import sys; sys.stdout.buffer.write(b'ok\\xff\\xfe'); sys.stderr.buffer.write(b'\\xc3(')"])
        self.assertEqual(code, 0)
        self.assertTrue(out.startswith("ok"))
        self.assertIsInstance(err, str)

    def test_real_run_bytes_and_inherit_do_not_raise_on_a_dead_child(self):
        if str(OPS) not in sys.path:
            sys.path.insert(0, str(OPS))
        from lib import ctx
        code, out, err = ctx._real_run(["/nonexistent/binary"])
        self.assertEqual(code, 127)


class S33(Hang):
    """S33 (ruling 121609fe): the `interrupted` file's read rule and what clears it."""
    new_commit = fl.Flow.new_commit
    staging_candidate = fl.Flow.staging_candidate
    hex_dir = fl.Flow.hex_dir
    first = fl.Flow.first
    ups = fl.Flow.ups
    since = fl.Flow.since
    mark = 0

    def test_an_unreadable_interrupted_file_is_state(self):
        self.first()
        self.staging_candidate()
        p = self.host.p("%s/staging/interrupted" % SDIR)
        p.mkdir()
        r = self.deploy("staging")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused state"), r.err)

    def test_another_digest_between_two_interruptions_is_not_banned(self):
        self.first()
        x2 = self.staging_candidate()
        self.host.write("%s/staging/interrupted" % SDIR, x2 + "\n")  # x2 was interrupted once
        x3 = self.staging_candidate()  # main moved on: another digest is tried (and becomes healthy)
        self.assertEqual(self.deploy("staging").rc, 0)
        self.assertEqual(self.state("staging", "current").split()[0], x3)
        self.assertIsNone(self.state("staging", "interrupted"), "removed when another digest is tried / becomes healthy")
        # x2 comes back interrupted again: this is its FIRST interruption again, not its second
        self.host.write("%s/staging/in-progress" % SDIR, x2 + "\n")
        self.assertNotIn(x2, self.state("staging", "quarantine") or "")

