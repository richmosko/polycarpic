"""POLY-100 T14 / F16 (rulings 8a4eae45, 9476666f): every fake refuses an option its subcommand lacks (the lists are the real tools' `--help`, fixtures/flags.json), and every docker, compose and gh
argv the deploy builds uses only real options. The build used `compose run --no-build`, which real Compose rejects: every real check-config and migrate would have failed."""
import unittest

from deploy_base import DeployTest, bad_options
import test_deploy_flow as fl


class Validator(unittest.TestCase):
    def test_the_option_the_build_used_on_run_is_refused_and_the_same_option_on_up_is_not(self):
        run = ["docker", "compose", "-p", "x", "run", "--rm", "--no-deps", "-T", "--pull", "never", "--no-build", "web", "web", "check-config"]
        up = ["docker", "compose", "-p", "x", "up", "-d", "--pull", "never", "--no-build", "web"]
        self.assertEqual(bad_options(run), [("docker compose run", "--no-build")])
        self.assertEqual(bad_options(up), [])

    def test_real_argvs_pass_and_invented_options_fail_for_each_tool(self):
        self.assertEqual(bad_options(["docker", "compose", "-p", "x", "--project-directory", "d", "-f", "a.yml", "--env-file", "e", "--profile", "*", "config", "--no-interpolate", "--no-normalize", "--format", "json"]), [])
        self.assertEqual(bad_options(["docker", "compose", "-p", "x", "exec", "-T", "web", "node", "-e", "x"]), [])
        self.assertEqual(bad_options(["docker", "compose", "-p", "x", "ps", "-a", "--format", "json"]), [])
        self.assertTrue(bad_options(["docker", "compose", "-p", "x", "exec", "--frobnicate", "web"]))
        self.assertTrue(bad_options(["docker", "compose", "--frobnicate", "up"]))
        self.assertTrue(bad_options(["docker", "pull", "--frobnicate", "x"]))
        self.assertEqual(bad_options(["docker", "pull", "x"]), [])
        self.assertEqual(bad_options(["gh", "run", "download", "1", "-R", "o/r", "-n", "n", "-D", "d"]), [])
        self.assertTrue(bad_options(["gh", "run", "download", "1", "--frobnicate"]))
        self.assertTrue(bad_options(["gh", "attestation", "verify", "oci://x", "--no-such-flag", "v"]))
        self.assertEqual(bad_options(["gh", "attestation", "verify", "oci://x", "--repo", "r", "--deny-self-hosted-runners", "--source-digest", "c", "--predicate-type", "p",
                                     "--signer-workflow", "w", "--source-ref", "refs/heads/main"]), [])


class Flows(DeployTest):
    new_commit = fl.Flow.new_commit
    staging_candidate = fl.Flow.staging_candidate
    hex_dir = fl.Flow.hex_dir
    first = fl.Flow.first
    since = fl.Flow.since
    ups = fl.Flow.ups
    mark = 0

    def setUp(self):
        super().setUp()
        import shutil
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        self.n = 0

    def test_every_docker_compose_and_gh_option_the_deploy_builds_is_real(self):
        self.first()
        self.staging_candidate()
        r = self.deploy("staging")
        self.assertEqual(self.world.bad_flags, [], "an option the real subcommand lacks: %r" % (self.world.bad_flags[:3],))
        self.assertEqual(r.rc, 0, r.err)
