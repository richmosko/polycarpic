"""POLY-100 G2 and G6 (ruling.md section G, 822a05a9; seceng's Q1-Q3): after the candidate's first `up`, every exit that is not healthy goes through one `unwind` that RESTORES FIRST and then records
(quarantine, log, alert, clear `in-progress`), each in its own try, none able to stop the next; the alert is also written to stderr; the exit is never 0; `in-progress` is cleared only after the
quarantine line is on disk. A full disk (ENOSPC) at any record, or a Refusal raised after `up`, must leave the old release up and healthy. Written from the ruling, red on the build it was written against."""
import errno
import os
import sys

from base import OPS
from test_deploy_hang import Hang, SDIR, last


def release_mod():
    if str(OPS) not in sys.path:
        sys.path.insert(0, str(OPS))
    from lib import release
    return release


def enospc(*a, **k):
    raise OSError(errno.ENOSPC, "No space left on device")


class Unwind(Hang):
    def patch(self, **names):
        """Replace functions of lib.release for this test: name -> replacement; restored at cleanup."""
        rel = release_mod()
        for name, fn in names.items():
            old = getattr(rel, name)
            setattr(rel, name, fn)
            self.addCleanup(setattr, rel, name, old)

    def after_up(self, fn):
        """A wrapper that behaves as `fn` only once the candidate's first `up` has happened in this run."""
        start = len(self.world.up_marks)
        return lambda *a, **k: fn(*a, **k) if len(self.world.up_marks) > start else None

    def restored(self, r, x1, what):
        self.assertNotEqual(r.rc, 0, "%s: the exit is never 0: %s" % (what, r.err))
        ups = [c for c in self.world.compose_log if c["cmd"] == "up" and c["project"] == "polycarpic-staging"]
        self.assertEqual(len(ups) % 2, 0, "%s: the candidate's `up` and the restore's `up`" % what)
        self.assertIn("render-%s.json" % x1.split(":")[1][:12], " ".join(ups[-1]["argv"]), "%s: the last `up` restores the previous release" % what)
        self.assertEqual(self.state("staging", "current").split()[0], x1, what)

    def unhealthy_second_deploy(self):
        x1, x2 = self.bad_second_deploy()
        self.world.hang = {"exec"}
        return x1, x2

    def baseline_alert(self):
        x1, x2 = self.unhealthy_second_deploy()
        r = self.deploy("staging")
        self.assertEqual(last(r), "deploy: rolled-back", r.err)
        return self.alert_name("staging")

    # ---- G2: restore first, whatever a record raises ----
    def test_a_full_disk_at_each_record_still_restores_the_old_release_and_the_exit_is_not_zero(self):
        for target in ("quarantine", "log", "alert"):
            self.setUp()
            x1, x2 = self.unhealthy_second_deploy()
            self.patch(**{target: self.after_up(enospc)})
            r = self.deploy("staging")
            self.restored(r, x1, "ENOSPC at %s" % target)

    def test_the_alert_is_written_to_stderr_as_well_when_the_alert_file_cannot_be_written(self):
        name = self.baseline_alert()
        self.setUp()
        x1, x2 = self.unhealthy_second_deploy()
        self.patch(alert=self.after_up(enospc))
        r = self.deploy("staging")
        self.restored(r, x1, "ENOSPC at alert")
        self.assertIn(name, r.err, "the alert is on stderr when it cannot be a file")

    def test_a_record_failing_never_stops_the_next_one(self):
        x1, x2 = self.unhealthy_second_deploy()
        self.patch(quarantine=self.after_up(enospc))
        r = self.deploy("staging")
        self.restored(r, x1, "ENOSPC at quarantine")
        self.assertIsNotNone(self.state("staging", "alert"), "the alert is still written after the quarantine failed")
        self.assertIn("unhealthy", self.state("staging", "deploy.log") or "", "and the log line")

    def test_every_write_failing_from_the_candidates_up_onward_leaves_the_old_release_up(self):
        x1, x2 = self.unhealthy_second_deploy()
        rel = release_mod()
        self.patch(write=self.after_up(enospc), log=self.after_up(enospc), put=self.after_up(enospc), alert=self.after_up(enospc), quarantine=self.after_up(enospc))
        r = self.deploy("staging")
        self.restored(r, x1, "ENOSPC on every write")

    def test_a_refusal_raised_after_up_restores_first(self):
        """Q3: the saved render changed after `up` is `unjudged` at the next use; the run must still put the old release back."""
        x1, x2 = self.bad_second_deploy()
        seen = {"n": 0}

        def tamper(cmd, argv):
            if cmd == "up" and not seen["n"]:
                seen["n"] = 1
                d = self.host.p("%s/staging" % SDIR)
                for n in os.listdir(str(d)):
                    if n == "render-%s.json" % x2.split(":")[1][:12]:
                        with open(str(d / n), "ab") as fh:
                            fh.write(b" ")
        self.world.on_compose = tamper
        r = self.deploy("staging")
        self.assertTrue(seen["n"], "the candidate's up was reached")
        self.restored(r, x1, "a Refusal after up")

    def test_in_progress_is_cleared_only_after_the_quarantine_line_is_on_disk(self):
        x1, x2 = self.unhealthy_second_deploy()
        rel = release_mod()
        seen = {}
        real_q = rel.quarantine

        def spying(ctx, project, digest, reason):
            seen["in_progress_at_quarantine"] = self.state("staging", "in-progress")
            return real_q(ctx, project, digest, reason)
        self.patch(quarantine=spying)
        r = self.deploy("staging")
        self.assertIsNotNone(seen.get("in_progress_at_quarantine"), "`in-progress` still there when the quarantine is written")
        self.assertIsNone(self.state("staging", "in-progress"))

    def test_a_failed_quarantine_write_leaves_in_progress_for_the_next_run_to_treat_as_interrupted(self):
        x1, x2 = self.unhealthy_second_deploy()
        self.patch(quarantine=self.after_up(enospc))
        r = self.deploy("staging")
        self.restored(r, x1, "ENOSPC at quarantine")
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x2, "the mark stays: the next run treats it as interrupted (S32)")

    def test_in_progress_unwritable_before_up_is_a_refusal_and_nothing_is_started(self):
        x1, x2 = self.bad_second_deploy()
        rel = release_mod()
        real_put = rel.put

        def put(ctx, project, name, text):
            if name == "in-progress":
                enospc()
            return real_put(ctx, project, name, text)
        self.patch(put=put)
        mark = len([c for c in self.world.compose_log if c["cmd"] == "up"])
        r = self.deploy("staging")
        self.assertNotEqual(r.rc, 0, r.err)
        self.assertEqual(len([c for c in self.world.compose_log if c["cmd"] == "up"]), mark, "no `up` of the candidate")
        self.assertEqual(self.state("staging", "current").split()[0], x1)

    # ---- G6: `refuse` alerts first, then logs, then quarantines, each in its own try ----
    def test_refuse_writes_the_alert_even_when_the_log_and_the_quarantine_fail(self):
        x1 = self.first()[0]
        x2 = self.staging_candidate()
        self.world.render_hooks[("staging", None)] = lambda d: d["services"]["web"].update(privileged=True) or d
        self.patch(log=enospc, quarantine=enospc)
        r = self.deploy("staging")
        self.assertNotEqual(r.rc, 0)
        self.assertIsNotNone(self.state("staging", "alert"), "an alert is always there")

    def test_refuse_order_is_alert_then_log_then_quarantine(self):
        x1 = self.first()[0]
        self.staging_candidate()
        self.world.render_hooks[("staging", None)] = lambda d: d["services"]["web"].update(privileged=True) or d
        rel = release_mod()
        order = []
        for name in ("alert", "log", "quarantine"):
            real = getattr(rel, name)
            self.patch(**{name: (lambda real, name: lambda *a, **k: (order.append(name), real(*a, **k))[1])(real, name)})
        self.deploy("staging")
        firsts = [n for i, n in enumerate(order) if n not in order[:i]]
        self.assertEqual(firsts, ["alert", "log", "quarantine"], order)
