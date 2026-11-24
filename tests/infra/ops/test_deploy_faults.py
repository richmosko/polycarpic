"""POLY-100 build-review faults F8, F10, F12 (ruling.md, table of F1-F15), written from the ruling and red on the build they were written against."""
import datetime as dt
import os
import shutil

from base import NOW
from deploy_base import DeployTest, digest, utc
import test_deploy_flow as fl
from test_deploy_prod import ProdBase

SDIR = "/var/lib/polycarpic/state/deploy"


def last(r):
    return r.err.splitlines()[-1] if r.err.strip() else ""


class F12(DeployTest):
    """`transient-since` holds the first of an unbroken run of transients; older than an hour: alert `transient-stale`; any run that gets past V5 or finds nothing new clears it."""

    def candidate(self):
        w = self.world
        x = digest("x")
        from test_deploy_bundle import good_files, make_tar, sibling_digests
        w.image("polycarpic", x, w.commit_b, bundle=make_tar(good_files()))
        w.attested.add((x, w.commit_b))
        for n, d in sibling_digests().items():
            w.image("polycarpic-" + n, d, w.commit_b)
            w.attested.add((d, w.commit_b))
        w.staging_run(w.commit_b, x)
        return x

    def at(self, minutes):
        return NOW + dt.timedelta(minutes=minutes)

    def test_a_persistent_transient_alerts_after_an_hour_and_success_clears_it(self):
        self.candidate()
        self.world.gh_down = True
        r = self.deploy("staging", now=self.at(0))
        self.assertEqual(r.rc, 0, r.err)
        since = (self.state("staging", "transient-since") or "").strip()
        self.assertEqual(since, utc(self.at(0)), "the first of an unbroken run")
        r = self.deploy("staging", now=self.at(30))
        self.assertEqual((self.state("staging", "transient-since") or "").strip(), utc(self.at(0)), "later transients do not move it")
        r = self.deploy("staging", now=self.at(59))
        self.assertIsNone(self.alert_name("staging"), "59 minutes: nothing yet")
        r = self.deploy("staging", now=self.at(61))
        self.assertEqual(self.alert_name("staging"), "transient-stale")
        self.world.gh_down = False
        r = self.deploy("staging", now=self.at(70))
        self.assertIsNone(self.state("staging", "transient-since"), "a run that gets past V5 clears it")
        self.assertIsNone(self.alert_name("staging"), "and the alert goes with the next healthy run")

    def test_a_run_that_finds_nothing_new_also_clears_it(self):
        x = self.candidate()
        self.world.gh_down = True
        self.deploy("staging", now=self.at(0))
        self.assertIsNotNone(self.state("staging", "transient-since"))
        self.world.gh_down = False
        self.seed("staging", x, "-", self.world.commit_b)  # `current` already runs the newest run
        r = self.deploy("staging", now=self.at(5))
        self.assertEqual(r.rc, 0, r.err)
        self.assertIsNone(self.state("staging", "transient-since"))

    def test_a_malformed_transient_since_is_state(self):
        self.candidate()
        self.host.write("%s/staging/transient-since" % SDIR, "yesterday\n")
        r = self.deploy("staging", now=self.at(1))
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused state"), r.err)


class F10(ProdBase):
    def test_edge_env_missing_a_key_or_unreadable_is_edge_env_before_v1_for_prod_and_edge_deploy(self):
        for label, plant in (("a missing key", lambda: self.host.write("/etc/polycarpic/edge.env", "POLY_BIND_ADDR=0.0.0.0\nPOLY_STAGING_ALLOW=10.0.0.0/8\nPOLY_TLS=internal\n")),
                             ("empty", lambda: self.host.write("/etc/polycarpic/edge.env", "")),
                             ("a directory", lambda: (os.unlink(str(self.host.p("/etc/polycarpic/edge.env"))), self.host.mkdir("/etc/polycarpic/edge.env")))):
            self.host.write("/etc/polycarpic/edge.env", "POLY_DOMAIN=example.com\nPOLY_BIND_ADDR=0.0.0.0\nPOLY_STAGING_ALLOW=10.0.0.0/8\nPOLY_TLS=internal\n")
            self.seed("prod", digest("pc"), "v1.0.0", self.world.commit_a)
            self.release_of("v1.1.0")
            plant()
            r = self.deploy("prod")
            self.assertEqual((r.rc, last(r)), (1, "deploy: refused edge-env"), "%s: %s" % (label, r.err))
            self.assertEqual([c for c in r.runner.calls if c["argv"][:3] == ["gh", "attestation", "verify"]], [], "%s: refused before V1" % label)
            if os.path.isdir(str(self.host.p("/etc/polycarpic/edge.env"))):
                shutil.rmtree(str(self.host.p("/etc/polycarpic/edge.env")))

    def test_edge_deploy_with_an_unreadable_edge_env_is_edge_env_before_v1(self):
        os.unlink(str(self.host.p("/etc/polycarpic/edge.env")))
        self.host.mkdir("/etc/polycarpic/edge.env")
        r = self.deploy("edge-1", cmd="edge-deploy")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused edge-env"), r.err)
        self.assertEqual([c for c in r.runner.calls if c["argv"][:3] == ["gh", "attestation", "verify"]], [])

    def test_a_failing_baseline_does_not_make_the_rollback_require_the_probe(self):
        x1, _ = self.first_prod("v1.0.0")
        x2 = self.release_of("v1.1.0")
        self.world.bad_apps.add(x2)
        self.world.https_always = OSError("connection refused")  # the baseline was not 200
        r = self.deploy("prod")
        self.assertEqual((r.rc, last(r)), (1, "deploy: rolled-back"), "the rollback is judged without the probe: " + r.err)


class F8(DeployTest):
    """Rollback (manual here; auto and edge share the check) refuses a previous release whose files are not root-owned or are writable by others, parents included, before the guard."""

    helpers = ("new_commit", "staging_candidate", "hex_dir", "first", "upgrade", "ups", "since", "deploy")

    def setUp(self):
        super().setUp()
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        self.n = 0
        self.mark = 0

    new_commit = fl.Flow.new_commit
    staging_candidate = fl.Flow.staging_candidate
    hex_dir = fl.Flow.hex_dir
    first = fl.Flow.first
    since = fl.Flow.since
    ups = fl.Flow.ups

    def deploy(self, *a, **kw):
        self.mark = len(self.world.compose_log)
        return super().deploy(*a, **kw)

    def two_releases(self):
        x1, _ = self.first()
        self.staging_candidate()
        self.assertEqual(self.deploy("staging").rc, 0)
        return x1

    def test_each_unsafe_previous_is_refused_and_nothing_is_upped(self):
        x1 = self.two_releases()
        prev = self.hex_dir(x1)
        victim = os.path.join(prev, "infra", "compose", "staging.yml")
        cases = (
            ("a group-writable file", lambda: os.chmod(victim, 0o664), lambda: os.chmod(victim, 0o644), {}),
            ("a world-writable file", lambda: os.chmod(victim, 0o666), lambda: os.chmod(victim, 0o644), {}),
            ("a group-writable directory", lambda: os.chmod(os.path.dirname(victim), 0o775), lambda: os.chmod(os.path.dirname(victim), 0o755), {}),
            ("a world-writable releases/ parent", lambda: os.chmod(os.path.dirname(prev), 0o777), lambda: os.chmod(os.path.dirname(prev), 0o755), {}),  # G1 (8635f525): F8's case stands: refused, mode unchanged
            ("a foreign owner", lambda: None, lambda: None, {"trusted": os.getuid() + 1}),
        )
        for label, brk, fix, kw in cases:
            brk()
            try:
                mark = len(self.world.compose_log)
                r = self.deploy("staging", cmd="rollback", **kw)
                self.assertNotEqual(r.rc, 0, label + ": " + r.err)
                self.assertEqual([c for c in r.world.compose_log[mark:] if c["cmd"] == "up"], [], label)
            finally:
                fix()

    def test_a_clean_previous_rolls_back(self):
        self.two_releases()
        r = self.deploy("staging", cmd="rollback")
        self.assertEqual(r.rc, 0, r.err)
