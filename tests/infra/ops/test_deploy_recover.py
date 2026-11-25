"""POLY-160 R1 (ruling.md f76708696): a mark (`in-progress`) is recovered FIRST, before any check that can refuse: the old release is upped from its saved pair, then the ordinary checks run.
Red on today's build (M1: `refused render-env`, no `up`, mark kept). Each test names the mutant that turns it red. Assert all five: the last `up`'s render, the mark, `current`, the quarantine line, the alert."""
from test_deploy_hang import Hang, SDIR, last


def render_tag(digest):
    return "render-%s.json" % digest.split(":")[1][:12]


def staging_ups(world):
    return [c for c in world.compose_log if c["cmd"] == "up" and c["project"] == "polycarpic-staging"]


class RecoverFirst(Hang):
    def plant_mark(self, digest):
        self.host.write("%s/staging/in-progress" % SDIR, digest + "\n")

    def test_a_mark_with_a_different_compose_restores_the_old_release_before_render_env(self):
        """mutant: the strict Compose check moved back above `recover`"""
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.plant_mark(x2)
        self.world.compose_versions.update({"root": "5.7.0", "render": "5.7.0"})
        before = len(staging_ups(self.world))
        r = self.deploy("staging")
        ups = staging_ups(self.world)[before:]
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused render-env"), r.err)
        self.assertEqual(len(ups), 1, "exactly the restore's `up`, no candidate `up`: %r" % [u["argv"] for u in ups])
        self.assertIn(render_tag(x1), " ".join(ups[0]["argv"]), "the old release is what was upped")
        self.assertEqual(self.state("staging", "current").split()[0], x1)
        self.assertNotIn(x2, self.state("staging", "quarantine") or "", "a box fault bans no digest")
        self.assertEqual(self.alert_name("staging"), "render-env")
