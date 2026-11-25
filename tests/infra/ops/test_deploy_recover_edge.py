"""POLY-160 R1.3, R1.5, R1.9 (ruling.md 7613d4e9) on edge and on `rollback` by hand: the old release is restored first, before any `gh` or `git` call and whatever tag is offered; `rollback` with a mark
recovers first and rolls back only when that fails. Red on today's build. Each test names the mutant that turns it red."""
import test_deploy_recover as rc
from test_deploy_edge import EdgeBase, EDGE
from test_deploy_hang import last, SDIR
from test_deploy_recover import render_tag, staging_ups
from test_deploy_standdown import fail_up_of

ESDIR = SDIR + "/edge"


def edge_ups(world):
    return [c for c in world.compose_log if c["cmd"] == "up" and c["project"] == EDGE]


class EdgeRecover(EdgeBase):
    def interrupted_edge(self):
        x1, _ = self.edge_release(1)
        self.assertEqual(self.edge("edge-1").rc, 0)
        x2, _ = self.edge_release(2)
        self.host.write("%s/in-progress" % ESDIR, x2 + "\n")
        return x1, x2

    def watch_network(self):
        """The index of the first edge `up` in the compose log, and how many gh/git calls the run had made by then."""
        w = self.world
        orig = w._compose
        seen = {"net": None}

        def wrapped(argv, stdin=None):
            if "up" in argv and seen["net"] is None and getattr(w, "runner", None) is not None:
                seen["net"] = len([c for c in w.runner.calls if c["argv"] and c["argv"][0] in ("gh", "git")])
            return orig(argv, stdin)
        w._compose = wrapped
        return seen

    def test_the_old_edge_release_is_upped_first_before_any_network_call_for_the_same_lower_or_absent_tag(self):
        """mutant: `recover` placed after the tag rules or `_release`"""
        for label in ("same tag", "lower tag", "absent Release"):
            self.setUp()
            x1, x2 = self.interrupted_edge()
            seen = self.watch_network()
            before = len(edge_ups(self.world))
            if label == "same tag":
                tag = "edge-2"
            elif label == "lower tag":
                self.edge_release(1, tag="edge-1")
                tag = "edge-1"
            else:
                self.world.releases[:] = []
                tag = "edge-2"
            self.edge(tag)
            ups = edge_ups(self.world)[before:]
            self.assertTrue(ups, "%s: something was upped" % label)
            self.assertIn("render-%s.json" % x1.split(":")[1][:12], " ".join(ups[0]["argv"]), "%s: the first `up` is the old release's" % label)
            self.assertEqual(seen["net"], 0, "%s: no gh or git call before the restore" % label)

    def test_a_different_compose_restores_edge_first_then_render_env(self):
        """mutant: the strict Compose check above `recover` in edge._run"""
        x1, x2 = self.interrupted_edge()
        self.world.compose_versions.update({"root": "5.7.0", "render": "5.7.0"})
        before = len(edge_ups(self.world))
        r = self.edge("edge-2")
        ups = edge_ups(self.world)[before:]
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused render-env"), r.err)
        self.assertEqual(len(ups), 1)
        self.assertIn("render-%s.json" % x1.split(":")[1][:12], " ".join(ups[0]["argv"]))
        self.assertNotIn(x2, self.state("edge", "quarantine") or "")

    def test_ctrl_c_in_edge_keeps_the_mark_and_the_next_run_restores(self):
        """mutant: `finally: unlink` put back in edge.py"""
        x1, _ = self.edge_release(1)
        self.assertEqual(self.edge("edge-1").rc, 0)
        x2, _ = self.edge_release(2)
        self.world.bad_caddy.add(self.last_sibs["caddy"])
        self.world.hang_from = len(self.world.up_marks)
        self.world.raise_cmd = {"exec": KeyboardInterrupt(), "ps": KeyboardInterrupt()}
        with self.assertRaises(KeyboardInterrupt):
            self.edge("edge-2")
        self.assertEqual((self.state("edge", "in-progress") or "").strip(), x2, "the mark survives Ctrl-C")
        self.world.raise_cmd = {}
        self.world.hang_from = 10 ** 9
        before = len(edge_ups(self.world))
        self.edge("edge-2")
        ups = edge_ups(self.world)[before:]
        self.assertIn("render-%s.json" % x1.split(":")[1][:12], " ".join(ups[0]["argv"]), "the next run's first `up` is the restore")

    def test_a_failed_restore_stops_the_candidates_caddy_and_keeps_the_mark(self):
        """mutant: `stand_down` not told to cover caddy on edge"""
        x1, x2 = self.interrupted_edge()
        fail_up_of(self.world, x1)
        self.world.set_container(EDGE, "caddy", "ghcr.io/richmosko/polycarpic-caddy@" + self.last_sibs["caddy"])
        self.edge("edge-2")
        self.assertEqual([e[1] for e in self.world.stop_log if e[0] == "stop"], ["cid-%s-caddy-1" % EDGE])
        self.assertEqual((self.state("edge", "in-progress") or "").strip(), x2)

    def test_an_edge_run_that_started_stuck_and_whose_unwind_cannot_stop_ends_not_stopped(self):
        """mutant: edge's `stuck_end` writes `rollback-unhealthy` over `not-stopped`"""
        x1, x2 = self.interrupted_edge()
        fail_up_of(self.world, x1)
        x3, _ = self.edge_release(3)
        self.world.bad_caddy.add(self.last_sibs["caddy"])
        self.world.hang_from = len(self.world.up_marks)
        self.world.stop_fail.add("stop")
        r = self.edge("edge-3")
        self.assertEqual(r.rc, 1, r.err)
        self.assertTrue([c for c in edge_ups(self.world) if "render-%s.json" % x3.split(":")[1][:12] in " ".join(c["argv"])], "edge-3 was deployed: " + r.err)
        self.assertEqual((self.state("edge", "alert") or "x x").split()[1], "not-stopped")
        self.assertIn("rollback-unhealthy", " ".join((self.state("edge", "deploy.log") or "").split()))

    def test_an_edge_rollback_with_a_mark_recovers_first(self):
        """mutant: the `recover` call dropped from edge.rollback"""
        x1, _ = self.edge_release(1)
        self.assertEqual(self.edge("edge-1").rc, 0)
        x2, _ = self.edge_release(2)
        self.assertEqual(self.edge("edge-2").rc, 0)
        self.host.write("%s/in-progress" % ESDIR, x2 + "\n")
        r = self.deploy("edge", cmd="rollback")
        self.assertEqual(r.rc, 1, r.err)
        self.assertIn("recovered; nothing rolled back", r.err)
        self.assertEqual(self.edge_current()[0], x2)
        self.assertNotIn(x2, self.state("edge", "quarantine") or "")


class RollbackWithMark(rc.RecoverBase):
    def two_releases(self):
        x1, _ = self.first()
        self.staging_candidate()
        self.assertEqual(self.deploy("staging").rc, 0)
        x2 = self.state("staging", "current").split()[0]
        return x1, x2

    def test_a_rollback_with_a_mark_recovers_first_and_rolls_nothing_back(self):
        """mutant: the `recover` call dropped from rollback.py (the release that runs is quarantined and replaced)"""
        x1, x2 = self.two_releases()
        self.plant_mark(x2)
        r = self.deploy("staging", cmd="rollback")
        self.assertEqual(r.rc, 1, r.err)
        self.assertIn("recovered; nothing rolled back", r.err)
        self.assertEqual(self.state("staging", "current").split()[0], x2, "nothing rolled back")
        self.assertNotIn(x2, self.state("staging", "quarantine") or "", "nothing quarantined")
        self.assertIsNone(self.state("staging", "in-progress"), "a good recovery clears the mark")

    def test_a_rollback_whose_recovery_fails_rolls_back_to_previous_and_clears_the_mark(self):
        """mutant: the fallback of R1.9 dropped"""
        x1, x2 = self.two_releases()
        self.plant_mark(x2)
        fail_up_of(self.world, x2)
        before = len(staging_ups(self.world))
        r = self.deploy("staging", cmd="rollback")
        self.assertEqual(r.rc, 0, r.err)
        ups = staging_ups(self.world)[before:]
        self.assertIn(render_tag(x1), " ".join(ups[-1]["argv"]), "previous is up")
        self.assertEqual(self.state("staging", "current").split()[0], x1)
        self.assertIsNone(self.state("staging", "in-progress"))
