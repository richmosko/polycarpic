"""POLY-160 S36 condition (ruling-review.md da1e6d6c, "After the delta read"): wherever a failed save of a render falls back to the saved pair (recovery, unwind, `rollback`), every service's `environment` in
the pair must equal the fresh corrected render's, key and value; else the restore is not ok. With the disk full and an environment value changed since, the old release is NOT upped from the saved pair; with
only a non-environment difference it is, as today. Red on today's build. Mutant: the comparison dropped from this path only.

The existing assertion `test_a_restore_that_must_save_and_cannot_uses_the_saved_pair_when_its_hash_holds_and_its_bytes_pass_the_guard` (test_deploy_unwind_more.py) changes under this condition (it changes an
environment value and expects the saved pair to serve): it is listed for seceng-160 and left untouched here."""
import test_deploy_unwind as u
import test_deploy_unwind_more as um
from test_deploy_hang import last
from test_deploy_recover import render_tag, staging_ups


class S36Env(u.Helpers):
    def full_disk_for_saves(self):
        guard = um.guard_mod()
        self.addCleanup(setattr, guard, "save", guard.save)
        guard.save = self.after_up(u.enospc)

    def test_a_changed_environment_value_since_is_not_upped_from_the_saved_pair(self):
        """mutant: the environment comparison dropped from the failed-save path"""
        x1, x2 = self.unhealthy_second_deploy()
        self.world.render_hooks[("staging", None)] = lambda doc: doc["services"]["web"].setdefault("environment", {}).update(S36_NEW="1") or doc
        self.full_disk_for_saves()
        before = len(staging_ups(self.world))
        r = self.deploy("staging")
        ups = staging_ups(self.world)[before:]
        self.assertEqual(last(r), "deploy: rollback-unhealthy", r.err)
        self.assertEqual(len(ups), 1, "only the candidate's `up`: the old release was not started with the old values")
        self.assertNotIn(render_tag(x1), " ".join(" ".join(c["argv"]) for c in ups))

    def test_a_difference_outside_the_environment_still_uses_the_saved_pair(self):
        """positive case; mutant: any difference refuses"""
        x1, x2 = self.unhealthy_second_deploy()
        self.world.render_hooks[("staging", None)] = lambda doc: doc["services"]["web"].setdefault("labels", {}).update(s36="1") or doc
        self.full_disk_for_saves()
        r = self.deploy("staging")
        self.restored(r, x1, "ENOSPC at the save, environments equal")
