"""POLY-160 build review B1, B2, B3 (build-review.md @ 6be9067b): three product faults, red on the build they were written against.
B1: a failed recovery with a malformed mark ends before any candidate is looked up (staging and edge); B2: an interrupt after the commit of a first deploy stops nothing (staging and edge);
B3: `docker stop` is given the short `-t 30` (the fake refuses any other flag). Each test names the mutant that turns it red."""
import test_deploy_recover as rc
import test_deploy_unwind as u
from test_deploy_edge import EdgeBase, EDGE
from test_deploy_hang import SDIR, last
from test_deploy_recover import render_tag, staging_ups
from test_deploy_standdown import Base, fail_up_of, stops, stopped_services

ESDIR = SDIR + "/edge"


def deployer_mod():
    u.release_mod()
    from lib import deployer
    return deployer


def edge_ups(world):
    return [c for c in world.compose_log if c["cmd"] == "up" and c["project"] == EDGE]


class B1Staging(rc.RecoverBase):
    def test_a_malformed_mark_with_a_failing_restore_ends_before_any_candidate_and_keeps_the_mark(self):
        """mutant: `stuck` None lets `_candidate` go on (the release that was cut is tried again)"""
        for junk in ("not a digest\n", ""):
            self.setUp()
            x1, _ = self.first()
            x2 = self.staging_candidate()
            self.host.write("%s/staging/in-progress" % SDIR, junk)
            fail_up_of(self.world, x1)
            before = len(staging_ups(self.world))
            r = self.deploy("staging")
            ups = staging_ups(self.world)[before:]
            self.assertEqual(r.rc, 1, r.err)
            self.assertTrue(all(render_tag(x2) not in " ".join(c["argv"]) for c in ups), "the offered release was not upped: %r" % [c["argv"][-3:] for c in ups])
            self.assertEqual(self.state("staging", "in-progress"), junk, "the mark is kept")
            self.assertEqual(self.alert_name("staging"), "rollback-unhealthy")
            self.assertEqual(last(r), "deploy: rollback-unhealthy", r.err)


class B1Edge(EdgeBase):
    def test_a_malformed_mark_with_a_failing_restore_ends_before_any_candidate_on_edge(self):
        """mutant: edge._run goes on to the candidate when `stuck` has no digest"""
        x1, _ = self.edge_release(1)
        self.assertEqual(self.edge("edge-1").rc, 0)
        x2, _ = self.edge_release(2)
        self.host.write("%s/in-progress" % ESDIR, "not a digest\n")
        fail_up_of(self.world, x1)
        before = len(edge_ups(self.world))
        r = self.edge("edge-2")
        ups = edge_ups(self.world)[before:]
        self.assertEqual(r.rc, 1, r.err)
        self.assertTrue(all("render-%s.json" % x2.split(":")[1][:12] not in " ".join(c["argv"]) for c in ups), "edge-2 was not upped")
        self.assertEqual(self.state("edge", "in-progress"), "not a digest\n")
        self.assertEqual((self.state("edge", "alert") or "x x").split()[1], "rollback-unhealthy")


class B2Staging(Base):
    def test_an_interrupt_inside_settle_of_a_first_deploy_stops_nothing(self):
        """mutant: `on_interrupt` stops when `run[cur]` is None even after the commit"""
        import shutil
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        x = self.staging_candidate()
        self.host.mkdir("%s/staging" % SDIR)
        d = deployer_mod()
        real = d.link_current

        def interrupted(*a, **k):
            raise KeyboardInterrupt()
        d.link_current = interrupted  # the first step of `settle`, after the commit
        self.addCleanup(setattr, d, "link_current", real)
        with self.assertRaises(KeyboardInterrupt):
            self.deploy("staging", cmd="first-deploy")
        self.assertEqual([a for a in self.world.docker_log if a[:2] == ["docker", "stop"]], [], "no `docker stop` was even tried: the healthy release is not stopped")
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x, "the mark is kept for the next run to settle")
        self.assertEqual(self.state("staging", "current").split()[0], x, "current names the new release")


class B2Edge(EdgeBase):
    def test_an_interrupt_inside_settle_of_a_first_edge_deploy_stops_nothing(self):
        """mutant: the same, edge's wrapper"""
        x1, _ = self.edge_release(1)
        d = deployer_mod()
        real = d.link_current

        def interrupted(*a, **k):
            raise KeyboardInterrupt()
        d.link_current = interrupted
        self.addCleanup(setattr, d, "link_current", real)
        with self.assertRaises(KeyboardInterrupt):
            self.edge("edge-1")
        self.assertEqual([a for a in self.world.docker_log if a[:2] == ["docker", "stop"]], [], "no `docker stop` was even tried: the healthy Caddy is not stopped")
        self.assertEqual((self.state("edge", "in-progress") or "").strip(), x1)
        self.assertEqual(self.edge_current()[0], x1)


class B3StopFlag(Base):
    def test_docker_stop_is_given_the_short_t_30_and_no_other_flag(self):
        """mutant: `--time` (deprecated; the fake refuses it, so every stop would fail and the release would run)"""
        x1, x2 = self.interrupted_second()
        fail_up_of(self.world, x1)
        self.deploy("staging")
        self.assertEqual(self.world.stop_unknown_flags, [], "an unknown flag reached `docker stop`")
        argvs = [a for a in self.world.docker_log if a[:2] == ["docker", "stop"]]
        self.assertEqual(len(argvs), 3, argvs)
        for a in argvs:
            self.assertEqual(a[2:4], ["-t", "30"], a)
        self.assertEqual(stopped_services(self.world), ["auth", "web", "worker"], "the stops worked")
