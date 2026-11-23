"""POLY-100 T10q (ruling d0cd9969, S18): a guard quarantine lifts only when the installed ops bundle id changes, and the digest is then judged in full;
an `unhealthy` digest stays skipped. Quarantine lines: `<digest> <UTC> <reason>`; a guard line carries the installed bundle id as a fourth field."""
import os
import shutil

from deploy_base import DeployTest, digest, utc
from test_deploy_bundle import good_files, make_tar, sibling_digests
from test_deploy_guard import both, svc

OPS_ROOT = "/opt/polycarpic/ops"
ID_A = "git-aaaaaaaaaaaa"
ID_B = "git-bbbbbbbbbbbb"


class Lift(DeployTest):
    def candidate(self, hooks=None):
        w = self.world
        x = digest("x")
        w.image("polycarpic", x, w.commit_b, bundle=make_tar(good_files()))
        w.attested.add((x, w.commit_b))
        for n, d in sibling_digests().items():
            w.image("polycarpic-" + n, d, w.commit_b)
            w.attested.add((d, w.commit_b))
        w.staging_run(w.commit_b, x)
        w.render_hooks.clear()
        w.render_hooks.update(hooks or {})
        return x

    def install_id(self, new):
        """The operator re-installs: a new ops bundle directory, `current` pointing at it."""
        old = os.readlink(str(self.host.p(OPS_ROOT + "/current")))
        if new != old:
            if self.host.p(OPS_ROOT + "/" + new).exists():
                shutil.rmtree(str(self.host.p(OPS_ROOT + "/" + new)))
            shutil.copytree(str(self.host.p(OPS_ROOT + "/" + old)), str(self.host.p(OPS_ROOT + "/" + new)), symlinks=True)
            link = str(self.host.p(OPS_ROOT + "/current"))
            os.unlink(link)
            os.symlink(new, link)

    def quarantine(self):
        return self.state("staging", "quarantine") or ""

    def refuse_once(self, x):
        r = self.deploy("staging")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused guard-key"), r.err)
        line = [l for l in self.quarantine().splitlines() if l.startswith(x)][-1].split()
        self.assertEqual((line[2], line[3]), ("guard-key", ID_A), "the guard line carries the installed bundle id as its fourth field")
        return r

    def test_a_guard_quarantine_is_skipped_while_the_bundle_id_is_unchanged(self):
        x = self.candidate(both(svc("web", privileged=True)))
        self.refuse_once(x)
        before = list(self.world.pulled)
        alert = self.state("staging", "alert")
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        self.assertIn("quarantined", self.log_events("staging"))
        self.assertEqual(self.world.pulled, before, "a skipped digest is not pulled again")
        self.assertEqual(self.state("staging", "alert"), alert)

    def test_after_the_id_changes_the_digest_is_judged_in_full_and_deploys_if_it_now_passes(self):
        x = self.candidate(both(svc("web", privileged=True)))
        self.refuse_once(x)
        self.install_id(ID_B)
        self.world.render_hooks.clear()  # the installed policy now allows what it refused
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(self.state("staging", "current").split()[0], x)
        self.assertIn("verified", self.log_events("staging")[-8:], "judged again from V1, not waved through")
        self.assertTrue([v for v in r.runner.calls if v["argv"][:3] == ["gh", "attestation", "verify"]], "V1 runs again after the lift")

    def test_after_the_id_changes_a_digest_that_still_fails_is_refused_again_with_the_new_id(self):
        x = self.candidate(both(svc("web", privileged=True)))
        self.refuse_once(x)
        self.install_id(ID_B)
        r = self.deploy("staging")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused guard-key"))
        last = [l for l in self.quarantine().splitlines() if l.startswith(x)][-1].split()
        self.assertEqual((last[2], last[3]), ("guard-key", ID_B))

    def test_the_lift_is_not_a_bypass_of_v1(self):
        x = self.candidate(both(svc("web", privileged=True)))
        self.refuse_once(x)
        self.install_id(ID_B)
        self.world.render_hooks.clear()
        self.world.attested.clear()  # nothing attests the image any more
        before = list(self.world.pulled)
        r = self.deploy("staging")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused attestation"))
        self.assertEqual(self.world.pulled, before, "V1 comes before any pull")

    # ---- reasons that never lift (S18) ----
    def stays_skipped(self, lines, change_to=ID_B):
        x = self.candidate()
        self.host.write("/var/lib/polycarpic/state/deploy/staging/quarantine", "".join(l.replace("@X", x) for l in lines))
        if change_to:
            self.install_id(change_to)
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        self.assertIn("quarantined", self.log_events("staging"))
        self.assertEqual(self.world.pulled, [])
        self.assertEqual(self.state("staging", "current").split()[0], self.current_digest)

    def test_an_unhealthy_digest_stays_skipped_after_the_id_changes(self):
        self.stays_skipped(["@X %s unhealthy\n" % utc()])

    def test_both_reasons_on_one_digest_keep_it_quarantined_in_either_order(self):
        g, u = "@X %s guard-key %s\n" % (utc(), ID_A), "@X %s unhealthy\n" % utc()
        for lines in ([g, u], [u, g]):
            self.setUp_clear()
            self.stays_skipped(lines)

    def test_a_guard_line_with_no_stored_id_keeps_it_quarantined(self):
        self.stays_skipped(["@X %s guard-key\n" % utc()])

    def test_a_guard_line_with_a_malformed_stored_id_keeps_it_quarantined(self):
        for bad in ("not-an-id", "git-AAAAAAAAAAAA", "git-aaaaaaaaaaa", "git-aaaaaaaaaaaaa", "../x", "git-aaaaaaaaaaaa;x"):
            self.setUp_clear()
            self.stays_skipped(["@X %s guard-key %s\n" % (utc(), bad)])

    def test_a_malformed_installed_id_keeps_it_quarantined(self):
        x = self.candidate()
        self.host.write("/var/lib/polycarpic/state/deploy/staging/quarantine", "%s %s guard-key %s\n" % (x, utc(), ID_A))
        self.install_id("weird-id")
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        self.assertIn("quarantined", self.log_events("staging"))
        self.assertEqual(self.world.pulled, [])

    def setUp_clear(self):
        w = self.world
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        shutil.rmtree(str(self.host.p("/opt/polycarpic/releases")), ignore_errors=True)
        self.seed("staging", self.current_digest, "-", w.commit_a)
        w.registry.clear(), w.attested.clear(), w.runs.clear(), w.artifacts.clear(), w.pulled.clear(), w.docker_log.clear()
        self.install_id(ID_A)
