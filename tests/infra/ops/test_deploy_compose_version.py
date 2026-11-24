"""POLY-100 G10 / S40 (ruling.md f5a62e3c, f887180d): the box runs exactly one Compose, the version in `infra/deploy/compose-version` (installed ops bundle, one line `N.N.N`). At deploy time `deploy`,
`first-deploy` and `edge-deploy` compare BOTH answers of `docker compose version --short`, root's and the render user's, with the file before any network call: different, unreadable or failing -> `render-env`
(alert, no quarantine, exit 1), both versions on stderr, the fix named (`provision --stage host`). A rollback warns and goes on (the guard still judges what it renders). The guard's bind rule stays strict.
Written from the ruling, red on the build it was written against."""
import os

from deploy_base import DeployTest
import test_deploy_flow as fl
from test_deploy_edge import EdgeBase

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def last(r):
    return r.err.splitlines()[-1] if r.err.strip() else ""


def network_calls(r):
    return [c["argv"] for c in r.runner.calls if c["argv"] and c["argv"][0] in ("gh", "git")]


class Version(DeployTest):
    new_commit = fl.Flow.new_commit
    staging_candidate = fl.Flow.staging_candidate
    hex_dir = fl.Flow.hex_dir
    first = fl.Flow.first
    ups = fl.Flow.ups
    since = fl.Flow.since
    mark = 0

    def setUp(self):
        super().setUp()
        import shutil
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        self.n = 0

    def test_the_file_is_one_line_n_n_n(self):
        text = open(os.path.join(REPO, "infra", "deploy", "compose-version")).read()
        self.assertRegex(text, r"^[0-9]+\.[0-9]+\.[0-9]+\n$")

    def test_a_version_other_than_the_files_is_render_env_before_any_network_call_with_no_quarantine(self):
        self.first()
        x = self.staging_candidate()
        for label, answers in (("2.40.3 for both", {"root": "2.40.3", "render": "2.40.3"}), ("5.8.0 (newer is no better: equal)", {"root": "5.8.0", "render": "5.8.0"}),
                               ("5.7.0 (one patch off)", {"root": "5.7.0", "render": "5.7.0"}), ("garbage", {"root": "not-a-version", "render": "not-a-version"}),
                               ("a failing command", {"root": None, "render": None}), ("empty", {"root": "", "render": ""})):
            self.world.compose_versions.update(answers)
            mark = len(self.world.up_marks)
            r = self.deploy("staging")
            self.assertEqual((r.rc, last(r)), (1, "deploy: refused render-env"), "%s: %s" % (label, r.err))
            self.assertEqual(network_calls(r), [], "%s: refused before any network call" % label)
            self.assertNotIn(x, self.state("staging", "quarantine") or "", "%s: a box fault bans no digest" % label)
            self.assertEqual(self.alert_name("staging"), "render-env", label)
            self.assertIn("provision --stage host", r.err, "%s: the fix is named" % label)
            self.assertEqual(len(self.world.up_marks), mark, "%s: nothing started" % label)

    def test_the_two_versions_are_on_stderr(self):
        self.first()
        self.staging_candidate()
        self.world.compose_versions.update({"root": "5.7.1", "render": "2.40.3"})
        r = self.deploy("staging")
        self.assertIn("5.7.1", r.err)
        self.assertIn("2.40.3", r.err)

    def test_the_render_user_is_asked_too_and_a_difference_alone_is_refused(self):
        """mutant: asking root only"""
        self.first()
        self.staging_candidate()
        self.world.compose_versions.update({"root": "5.7.1", "render": "5.8.0"})
        r = self.deploy("staging")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused render-env"), r.err)
        self.assertIn("render", set(self.world.version_asks), "the render user was never asked")
        self.assertIn("root", set(self.world.version_asks))

    def test_the_right_version_for_both_goes_on(self):
        self.first()
        self.staging_candidate()
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        self.assertTrue({"root", "render"} <= set(self.world.version_asks))

    def test_the_version_is_asked_before_the_pull_not_after(self):
        """mutant: checking after the pull"""
        self.first()
        self.staging_candidate()
        self.world.compose_versions.update({"root": "2.40.3", "render": "2.40.3"})
        r = self.deploy("staging")
        calls = [c["argv"] for c in r.runner.calls]
        self.assertEqual([a for a in calls if a[:2] == ["docker", "pull"]], [], "nothing was pulled")

    def test_first_deploy_is_refused_the_same_way(self):
        self.staging_candidate()
        self.world.compose_versions.update({"root": "2.40.3", "render": "2.40.3"})
        r = self.deploy("staging", cmd="first-deploy")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused render-env"), r.err)

    def test_a_rollback_warns_and_goes_on_the_way_back_is_never_taken_away(self):
        """mutant: refusing a rollback"""
        self.first()
        self.staging_candidate()
        self.assertEqual(self.deploy("staging").rc, 0)
        self.world.compose_versions.update({"root": "5.8.0", "render": "5.8.0"})
        r = self.deploy("staging", cmd="rollback")
        self.assertEqual(r.rc, 0, r.err)
        self.assertIn("5.8.0", r.err, "a warning names the version it found")


class EdgeVersion(EdgeBase):
    def test_edge_deploy_is_refused_the_same_way(self):
        self.edge_release(1)
        self.world.compose_versions.update({"root": "2.40.3", "render": "2.40.3"})
        r = self.edge("edge-1")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused render-env"), r.err)
        self.assertEqual(network_calls(r), [])
