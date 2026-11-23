"""POLY-100 G2 for edge, `rollback` and prod, and S36 (ruling.md section G, 822a05a9): the same unwind in `edge.py`; `rollback` restores BEFORE it quarantines; a manual rollback writes its pointers after the
restore and a failed pointer write is reported, exit 1, with the old release up. S36: a restore needs no write: it renders and judges in memory; when the corrected bytes equal the saved file and its sidecar,
`up` names the saved file and writes nothing; only when they differ is it saved, and if that save fails the saved pair is used when its hash holds and its bytes pass the guard now, else
`rollback-unhealthy`. Written from the ruling, red on the build it was written against."""
import errno
import os
import sys

from base import OPS
from test_deploy_edge import EdgeBase
import test_deploy_unwind as u
from test_deploy_unwind import enospc, release_mod

SDIR = "/var/lib/polycarpic/state/deploy"


def last(r):
    return r.err.splitlines()[-1] if r.err.strip() else ""


def guard_mod():
    release_mod()
    from lib import compose_guard
    return compose_guard


class EdgeUnwind(EdgeBase):
    def patch(self, mod, **names):
        for name, fn in names.items():
            old = getattr(mod, name)
            setattr(mod, name, fn)
            self.addCleanup(setattr, mod, name, old)

    def after_up(self, fn):
        start = len(self.world.up_marks)
        return lambda *a, **k: fn(*a, **k) if len(self.world.up_marks) > start else None

    def two_edges(self):
        x1, _ = self.edge_release(1)
        self.assertEqual(self.edge("edge-1").rc, 0)
        x2, _ = self.edge_release(2)
        self.world.bad_caddy.add(self.last_sibs["caddy"])
        return x1, x2

    def restored(self, r, x1, what):
        self.assertNotEqual(r.rc, 0, "%s: the exit is never 0: %s" % (what, r.err))
        self.assertEqual(self.edge_current()[0], x1, what)
        ups = [c for c in self.world.compose_log if c["cmd"] == "up" and c["project"] == "polycarpic-edge"]
        self.assertEqual(len(ups) % 2, 1 if len(ups) % 2 else 0)
        self.assertIn("render-%s.json" % x1.split(":")[1][:12], " ".join(ups[-1]["argv"]), "%s: the last `up` restores edge's previous release" % what)

    def test_edge_a_full_disk_at_each_record_still_puts_edges_previous_release_back(self):
        rel = release_mod()
        for target in ("quarantine", "log", "alert"):
            self.setUp()
            x1, x2 = self.two_edges()
            self.patch(rel, **{target: self.after_up(enospc)})
            r = self.edge("edge-2")
            self.restored(r, x1, "edge, ENOSPC at %s" % target)

    def test_edge_every_write_failing_from_the_up_onward_still_restores(self):
        rel = release_mod()
        x1, x2 = self.two_edges()
        self.patch(rel, write=self.after_up(enospc), log=self.after_up(enospc), put=self.after_up(enospc), alert=self.after_up(enospc), quarantine=self.after_up(enospc))
        self.patch(guard_mod(), save=self.after_up(enospc))
        r = self.edge("edge-2")
        self.restored(r, x1, "edge, every write")

    def test_manual_rollback_restores_before_it_quarantines(self):
        rel = release_mod()
        x1, _ = self.edge_release(1)
        self.assertEqual(self.edge("edge-1").rc, 0)
        x2, _ = self.edge_release(2)
        self.assertEqual(self.edge("edge-2").rc, 0)
        order = []
        real_q = rel.quarantine
        self.patch(rel, quarantine=lambda *a, **k: (order.append(("quarantine", len([c for c in self.world.compose_log if c["cmd"] == "up"]))), real_q(*a, **k))[1])
        ups_before = len([c for c in self.world.compose_log if c["cmd"] == "up"])
        r = self.deploy("edge", cmd="rollback")
        self.assertEqual(r.rc, 0, r.err)
        self.assertTrue(order)
        self.assertGreater(order[0][1], ups_before, "the quarantine was written before the restore's `up`")

    def test_manual_rollback_with_a_full_disk_at_the_quarantine_still_restores_and_exits_non_zero(self):
        rel = release_mod()
        x1, _ = self.edge_release(1)
        self.assertEqual(self.edge("edge-1").rc, 0)
        x2, _ = self.edge_release(2)
        self.assertEqual(self.edge("edge-2").rc, 0)
        self.patch(rel, quarantine=enospc)
        r = self.deploy("edge", cmd="rollback")
        self.assertNotEqual(r.rc, 0, "a record failed: reported, never exit 0")
        ups = [c for c in self.world.compose_log if c["cmd"] == "up" and c["project"] == "polycarpic-edge"]
        self.assertIn("render-%s.json" % x1.split(":")[1][:12], " ".join(ups[-1]["argv"]), "edge's previous release is up")

    def test_manual_rollback_writes_its_pointers_after_the_restore_and_a_failed_pointer_write_is_exit_1_with_the_old_release_up(self):
        rel = release_mod()
        x1, _ = self.edge_release(1)
        self.assertEqual(self.edge("edge-1").rc, 0)
        x2, _ = self.edge_release(2)
        self.assertEqual(self.edge("edge-2").rc, 0)
        real = rel.save_pointer
        n_up = len([c for c in self.world.compose_log if c["cmd"] == "up"])

        def pointer(ctx, project, name, p):
            self.assertGreater(len([c for c in self.world.compose_log if c["cmd"] == "up"]), n_up, "a pointer was written before the restore")
            enospc()
        self.patch(rel, save_pointer=pointer)
        r = self.deploy("edge", cmd="rollback")
        self.assertEqual(r.rc, 1, r.err)
        ups = [c for c in self.world.compose_log if c["cmd"] == "up" and c["project"] == "polycarpic-edge"]
        self.assertIn("render-%s.json" % x1.split(":")[1][:12], " ".join(ups[-1]["argv"]))


class RestoreNeedsNoWrite(u.Helpers):
    """S36 on a project (staging): the restore after an unhealthy candidate."""

    def full_disk_for_saves(self):
        guard = guard_mod()
        self.addCleanup(setattr, guard, "save", guard.save)
        guard.save = self.after_up(enospc)

    def test_a_restore_whose_render_equals_the_saved_file_writes_nothing_and_ups_the_saved_file(self):
        x1, x2 = self.unhealthy_second_deploy()
        d = self.host.p("%s/staging" % SDIR)
        saved = {n: (d / n).read_bytes() for n in os.listdir(str(d)) if n.startswith("render-%s" % x1.split(":")[1][:12])}
        self.assertTrue(saved)
        self.full_disk_for_saves()
        r = self.deploy("staging")
        self.restored(r, x1, "ENOSPC at the render save")
        for n, b in saved.items():
            self.assertEqual((d / n).read_bytes(), b, "%s was rewritten by a restore that needed no write" % n)

    def test_a_restore_that_must_save_and_cannot_uses_the_saved_pair_when_its_hash_holds_and_its_bytes_pass_the_guard(self):
        x1, x2 = self.unhealthy_second_deploy()
        # the fresh render of previous's bundle differs from what was saved (an env value changed since): a save is needed, and the disk is full
        self.world.render_hooks[("staging", None)] = lambda doc: doc["services"]["web"].setdefault("environment", {}).update(S36_NEW="1") or doc
        self.full_disk_for_saves()
        r = self.deploy("staging")
        self.restored(r, x1, "the saved pair is used")

    def test_a_restore_that_must_save_and_cannot_with_a_saved_pair_that_fails_its_hash_is_rollback_unhealthy(self):
        x1, x2 = self.unhealthy_second_deploy()
        d = self.host.p("%s/staging" % SDIR)
        with open(str(d / ("render-%s.json" % x1.split(":")[1][:12])), "ab") as fh:
            fh.write(b" ")
        self.world.render_hooks[("staging", None)] = lambda doc: doc["services"]["web"].setdefault("environment", {}).update(S36_NEW="1") or doc
        self.full_disk_for_saves()
        r = self.deploy("staging")
        self.assertEqual(last(r), "deploy: rollback-unhealthy", r.err)
