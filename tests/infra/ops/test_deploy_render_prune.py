"""A17 (ruling F4 row): prune removes the saved renders of pruned releases and of no other: render-<12 hex of digest>.json goes with its release directory."""
import os
import shutil

from deploy_base import DeployTest
import test_deploy_flow as fl

STATE = "/var/lib/polycarpic/state/deploy/staging"


class Prune(DeployTest):
    new_commit = fl.Flow.new_commit
    staging_candidate = fl.Flow.staging_candidate
    hex_dir = fl.Flow.hex_dir
    first = fl.Flow.first
    ups = fl.Flow.ups
    since = fl.Flow.since
    mark = 0

    def setUp(self):
        super().setUp()
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        self.n = 0

    def renders(self):
        d = self.host.p(STATE)
        return sorted(n for n in os.listdir(str(d)) if n.startswith("render-")) if d.exists() else []

    def test_the_render_of_a_pruned_release_is_removed_and_the_kept_ones_stay(self):
        x1, _ = self.first()
        out = []
        for _ in range(2):
            x = self.staging_candidate()
            self.assertEqual(self.deploy("staging").rc, 0)
            out.append(x)
        x2, x3 = out
        # current = x3, previous = x2; x1 was pruned
        self.assertFalse(os.path.isdir(self.hex_dir(x1)), "x1's release directory is pruned")
        names = self.renders()
        tag = lambda x: "render-%s.json" % x.split(":")[1][:12]
        self.assertNotIn(tag(x1), names, "the pruned release's saved render goes with it")
        self.assertIn(tag(x3), names)
        self.assertIn(tag(x2), names)

    def test_a_render_with_no_release_directory_that_is_not_named_by_a_pointer_is_removed_and_a_pointed_one_never(self):
        x1, _ = self.first()
        stray = self.host.p("%s/render-%s.json" % (STATE, "f" * 12))
        stray.write_text("{}")
        x2 = self.staging_candidate()
        self.assertEqual(self.deploy("staging").rc, 0)
        self.assertFalse(stray.exists(), "a render of no kept release is removed")
        self.assertIn("render-%s.json" % x2.split(":")[1][:12], self.renders())
