"""POLY-160 build review B4 (build-review.md @ 6be9067b): the ruled V rows that had no test. Staging unless a test says edge. Each test names the mutant that turns it red.
Rows that cannot be built here are named at the foot of the file."""
import os

import test_deploy_recover as rc
import test_deploy_unwind as u
from test_deploy_edge import EdgeBase, EDGE
from test_deploy_hang import SDIR, last
from test_deploy_recover import render_tag, staging_ups
from test_deploy_standdown import Base, fail_up_of, stops, stopped_services
from test_deploy_token_lock import held, LOCK

ESDIR = SDIR + "/edge"
MISMATCH = {"root": "5.7.0", "render": "5.7.0"}


def edge_ups(world):
    return [c for c in world.compose_log if c["cmd"] == "up" and c["project"] == EDGE]


def first_up_names(ups, digest):
    return bool(ups) and render_tag(digest) in " ".join(ups[0]["argv"])


class Gate(rc.RecoverBase):
    """The checks that used to refuse before the restore, each with the old release's `up` first (R2: half of the Principal's gate)."""

    def test_a_missing_token_restores_first_then_refuses_token(self):
        """mutant: `rel.token` moved above `recover`"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.plant_mark(x2)
        os.unlink(str(self.host.p("/etc/polycarpic/secrets/host/github_read_token")))
        before = len(staging_ups(self.world))
        r = self.deploy("staging")
        ups = staging_ups(self.world)[before:]
        self.assertEqual(r.rc, 4, r.err)
        self.assertTrue(first_up_names(ups, x1), "the old release was upped before the token was read")
        self.assertEqual(len(ups), 1, "no candidate `up`")
        self.assertEqual(self.alert_name("staging"), "token")

    def test_an_unmounted_data_volume_with_a_mark_ups_nothing_and_keeps_the_mark(self):
        """mutant: `recover` above `require_data_mount`"""
        self.first()
        x2 = self.staging_candidate()
        self.plant_mark(x2)
        self.world.unmounted.add("/srv/polycarpic")
        before = len(staging_ups(self.world))
        r = self.deploy("staging")
        self.assertEqual(len(staging_ups(self.world)), before, "zero `up`")
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x2)
        self.assertNotEqual(r.rc, 0)

    def test_an_unreadable_mark_file_is_an_interruption_restored_first_and_kept(self):
        """mutant: an unreadable mark treated as absent (a link in its place)"""
        x1, _ = self.first()
        self.staging_candidate()
        mark = str(self.host.p("%s/staging/in-progress" % SDIR))
        os.symlink("/etc/hostname", mark)
        before = len(staging_ups(self.world))
        r = self.deploy("staging")
        ups = staging_ups(self.world)[before:]
        self.assertTrue(first_up_names(ups, x1), "restored first: " + r.err)
        self.assertTrue(os.path.lexists(mark), "the mark is kept")
        self.assertEqual(r.rc, 1, r.err)

    def test_a_mark_naming_a_current_that_is_now_unhealthy_is_not_settled_and_keeps_the_mark(self):
        """mutant: 3e without the health wait (settled over an unhealthy release, or quarantined)"""
        x1, _ = self.first()
        self.world.bad_apps.add(x1)
        self.plant_mark(x1)
        r = self.deploy("staging")
        self.assertNotEqual(r.rc, 0, r.err)
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x1, "the mark is kept")
        self.assertNotIn(x1, self.state("staging", "quarantine") or "", "the running digest is never banned")
        self.assertEqual(self.state("staging", "current").split()[0], x1)


class Stuck(Base):
    def test_a_stuck_run_with_the_same_digest_offered_ends_rollback_unhealthy_and_ups_nothing_of_it(self):
        """mutant: the stuck check dropped"""
        x1, x2 = self.interrupted_second()
        fail_up_of(self.world, x1)
        before = len(staging_ups(self.world))
        r = self.deploy("staging")
        ups = staging_ups(self.world)[before:]
        self.assertEqual((r.rc, last(r)), (1, "deploy: rollback-unhealthy"), r.err)
        self.assertTrue(all(render_tag(x2) not in " ".join(c["argv"]) for c in ups))
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x2)

    def test_a_stuck_run_lets_a_different_digest_deploy_and_end_healthy_clearing_everything(self):
        """mutant: `_Stop` in 3c (a release whose migration broke the old one could never be fixed forward)"""
        x1, x2 = self.interrupted_second()
        fail_up_of(self.world, x1)
        self.deploy("staging")  # stuck
        x3 = self.staging_candidate()
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(self.state("staging", "current").split()[0], x3)
        self.assertIsNone(self.state("staging", "in-progress"), "a healthy end clears the mark")
        self.assertIsNone(self.state("staging", "alert"), "and the alert")

    def test_another_projects_containers_are_never_stopped(self):
        """mutant: the label filter dropped the project"""
        x1, x2 = self.interrupted_second()
        self.world.set_container("polycarpic-prod", "web", "ghcr.io/richmosko/polycarpic@sha256:" + "ee" * 32)
        fail_up_of(self.world, x1)
        self.deploy("staging")
        self.assertTrue(stops(self.world))
        self.assertTrue(all("prod" not in e[1] for e in stops(self.world)), stops(self.world))


class Interrupts(Base):
    def kill_up_of(self, digest):
        orig = self.world._compose
        tag = render_tag(digest)
        armed = {"on": True}

        def wrapped(argv, stdin=None):
            if armed["on"] and "up" in argv and tag in " ".join(argv):
                armed["on"] = False
                raise KeyboardInterrupt()
            return orig(argv, stdin)
        self.world._compose = wrapped

    def test_ctrl_c_in_the_recoverys_own_up_keeps_the_mark_and_the_next_run_restores(self):
        """mutant: the mark cleared before the restore completes"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.plant_mark(x2)
        self.kill_up_of(x1)
        with self.assertRaises(KeyboardInterrupt):
            self.deploy("staging")
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x2, "kept")
        before = len(staging_ups(self.world))
        self.deploy("staging")
        self.assertTrue(first_up_names(staging_ups(self.world)[before:], x1), "the next run restores")

    def test_ctrl_c_in_the_unwinds_restore_keeps_the_mark(self):
        """mutant: the unwind's `finally` unlinks the mark"""
        x1, x2 = self.bad_second_deploy()
        self.world.hang = {"exec"}
        self.kill_up_of(x1)
        with self.assertRaises(KeyboardInterrupt):
            self.deploy("staging")
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x2)
        self.assertNotIn(x2, self.state("staging", "quarantine") or "", "a restore that never answered does not ban")

    def test_ctrl_c_in_the_candidates_up_keeps_the_mark_and_the_next_run_restores(self):
        """mutant: `finally: unlink` put back"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.kill_up_of(x2)
        with self.assertRaises(KeyboardInterrupt):
            self.deploy("staging")
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x2)
        before = len(staging_ups(self.world))
        self.deploy("staging")
        self.assertTrue(first_up_names(staging_ups(self.world)[before:], x1))


class Compose(rc.RecoverBase):
    """C-d: the render differs, not only the version string."""

    def differing_restart(self):
        self.world.render_hooks[("staging", None)] = lambda doc: doc["services"]["web"].update(restart="always") or doc

    def differing_env(self):
        self.world.render_hooks[("staging", None)] = lambda doc: doc["services"]["web"].setdefault("environment", {}).update(S36_NEW="1") or doc

    def saved(self, x1):
        d = self.host.p("%s/staging" % SDIR)
        return {n: (d / n).read_bytes() for n in os.listdir(str(d)) if n.startswith("render-%s" % x1.split(":")[1][:12])}

    def test_a_mismatched_compose_whose_render_differs_ups_the_saved_pair_unchanged_then_render_env(self):
        """mutants: `keep=True` dropped (the pair is rewritten); the strict check dropped after a recovery"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.plant_mark(x2)
        before_bytes = self.saved(x1)
        self.differing_restart()
        self.world.compose_versions.update(MISMATCH)
        before = len(staging_ups(self.world))
        r = self.deploy("staging")
        ups = staging_ups(self.world)[before:]
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused render-env"), r.err)
        self.assertEqual(len(ups), 1)
        self.assertTrue(first_up_names(ups, x1))
        self.assertEqual(self.saved(x1), before_bytes, "the saved pair is byte-for-byte what it was")

    def test_a_mismatched_compose_whose_environment_differs_never_ups_the_old_value(self):
        """mutant: the environment comparison dropped from the saved-pair path (C-b, C-c)"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.plant_mark(x2)
        before_bytes = self.saved(x1)
        self.differing_env()
        self.world.compose_versions.update(MISMATCH)
        before = len(staging_ups(self.world))
        self.deploy("staging")
        self.assertEqual(len(staging_ups(self.world)), before, "the old value was never upped")
        self.assertEqual(self.saved(x1), before_bytes)
        self.assertEqual(self.alert_name("staging"), "rollback-unhealthy")

    def test_a_changed_environment_under_the_pinned_compose_comes_up_with_the_new_value_and_is_saved(self):
        """mutant: the saved pair used under a pinned Compose (the old value comes up)"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.plant_mark(x2)
        self.differing_env()
        before = len(staging_ups(self.world))
        r = self.deploy("staging")
        ups = staging_ups(self.world)[before:]
        self.assertTrue(first_up_names(ups, x1), "restored first: " + r.err)
        self.assertIn("S36_NEW", self.host.p("%s/staging/render-%s.json" % (SDIR, x1.split(":")[1][:12])).read_text(), "the new value is what runs and what is saved")

    def test_a_tampered_saved_pair_under_a_mismatched_compose_is_not_upped(self):
        """mutant: `_saved_pair`'s hash check dropped"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.plant_mark(x2)
        self.differing_restart()
        self.world.compose_versions.update(MISMATCH)
        f = self.host.p("%s/staging/render-%s.json" % (SDIR, x1.split(":")[1][:12]))
        f.write_bytes(f.read_bytes() + b" ")
        before = len(staging_ups(self.world))
        self.deploy("staging")
        self.assertEqual(len(staging_ups(self.world)), before, "not upped")
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x2)

    def test_a_tampered_tree_of_current_is_not_upped_and_the_mark_is_kept(self):
        """mutant: the tree hash skipped"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.plant_mark(x2)
        rdir = self.host.p("/opt/polycarpic/releases/sha256-%s" % x1.split(":")[1])
        victim = rdir / "infra" / "compose" / "staging.yml"
        victim.write_text(victim.read_text() + "\n# tampered\n")
        before = len(staging_ups(self.world))
        self.deploy("staging")
        self.assertEqual(len(staging_ups(self.world)), before, "not upped")
        self.assertEqual((self.state("staging", "in-progress") or "").strip(), x2)


class EdgeRows(EdgeBase):
    def interrupted_edge(self):
        x1, _ = self.edge_release(1)
        self.assertEqual(self.edge("edge-1").rc, 0)
        x2, _ = self.edge_release(2)
        self.host.write("%s/in-progress" % ESDIR, x2 + "\n")
        return x1, x2

    def test_an_unreadable_edge_env_restores_first_then_refuses(self):
        """mutant: `check_edge_env` moved above `recover`"""
        x1, x2 = self.interrupted_edge()
        os.unlink(str(self.host.p("/etc/polycarpic/edge.env")))
        n = len(self.world.compose_log)
        r = self.edge("edge-2")
        configs = [c for c in self.world.compose_log[n:] if c["cmd"] == "config" and c["project"] == EDGE]
        self.assertTrue(configs, "the restore rendered edge before the env file was judged")
        self.assertEqual(last(r), "deploy: rollback-unhealthy", r.err)  # a restore that needs the file cannot start; the run ends there
        self.assertIn("refused edge-env", r.err)
        self.assertEqual([c for c in r.runner.calls if c["argv"] and c["argv"][0] in ("gh", "git")], [], "no network call")

    def allowlist_changed(self):
        self.world.render_hooks[("edge", None)] = lambda doc: doc["services"]["caddy"]["environment"].update(POLY_DOMAIN="example.org") or doc

    def test_an_allowlist_changed_since_under_the_pinned_compose_comes_up_with_the_new_value(self):
        """mutant: the saved pair used under a pinned Compose (the old value comes up)"""
        x1, x2 = self.interrupted_edge()
        self.allowlist_changed()
        before = len(edge_ups(self.world))
        self.edge("edge-2")
        ups = edge_ups(self.world)[before:]
        self.assertTrue(ups)
        saved = self.host.p("%s/edge/render-%s.json" % (SDIR, x1.split(":")[1][:12])).read_text()
        self.assertIn("example.org", saved, "the restore started the current value")

    def test_an_allowlist_changed_since_under_a_mismatched_compose_never_ups_the_old_value(self):
        """mutant: the environment comparison dropped (edge)"""
        x1, x2 = self.interrupted_edge()
        self.allowlist_changed()
        self.world.compose_versions.update(MISMATCH)
        before = len(edge_ups(self.world))
        self.edge("edge-2")
        self.assertEqual(len(edge_ups(self.world)), before, "the old value was never upped")

    def test_edges_current_caddy_is_kept_when_the_restore_fails(self):
        """mutant: `keep_ref` ignored on edge"""
        x1, x2 = self.interrupted_edge()
        fail_up_of(self.world, x1)
        self.edge("edge-2")
        self.assertEqual([e for e in self.world.stop_log if e[0] == "stop"], [], "current's own Caddy keeps running")


class Misc(rc.RecoverBase):
    def test_busy_with_a_log_that_raises_still_exits_0_and_touches_nothing(self):
        """mutant: `rel.log` put back in the `busy` path"""
        self.first()
        self.staging_candidate()
        u.Helpers.patch(self, log=u.enospc)
        with held(str(self.host.p(LOCK))):
            r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(r.runner.calls, [])

    def test_a_current_that_cannot_be_saved_and_a_previous_that_cannot_be_put_back_never_leaves_the_refused_digest_upped(self):
        """mutant: the put-back's failure left `current` naming a digest the unwind refused"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        rel = u.release_mod()
        real = rel.save_pointer

        def flaky(ctx, project, name, ptr, *a, **k):
            if name == "current" and ptr.get("digest") == x2:
                raise OSError(28, "No space left on device")
            if name == "previous" and ptr.get("digest") == x1 and getattr(flaky, "seen_current", False):
                raise OSError(28, "No space left on device")  # the put-back
            if name == "previous" and ptr.get("digest") == x1:
                flaky.seen_current = True
            return real(ctx, project, name, ptr, *a, **k)
        rel.save_pointer = flaky
        self.addCleanup(setattr, rel, "save_pointer", real)
        self.deploy("staging")
        rel.save_pointer = real
        before = len(staging_ups(self.world))
        self.deploy("staging")
        self.assertTrue(all(render_tag(x2) not in " ".join(c["argv"]) for c in staging_ups(self.world)[before:]), "a later run never ups the refused digest")
