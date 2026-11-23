"""POLY-98 R9: restart, then poll health for up to 120 s (fake clock)."""
import os
import unittest

from base import FIXED_ENV, OpsTest, Runner, ps_json


class Restart(OpsTest):
    def setUp(self):
        super().setUp()
        # POLY-100 S30: `restart caddy` reads the staging basic-auth file first; a good one in its 0750 directory, owned root:10010 as far as the ctx.owner_of seam says
        self.host.mkdir("/etc/polycarpic/secrets/caddy", 0o750)
        self.host.write("/etc/polycarpic/secrets/caddy/staging_basic_auth", "staging $2y$10$" + "a1B./" * 10 + "xyz" + "\n", 0o440)

    def go(self, argv, ps_after, project="prod"):
        runner = Runner(None)
        state = {"restarted": False}
        runner.on(("restart",), fn=lambda argv, stdin: (state.__setitem__("restarted", True) or (0, "", "")))
        runner.on(lambda a: "ps" in a, fn=lambda argv, stdin: (0, ps_json(ps_after), ""))
        return self.host.go("restart", *argv, runner=runner, ctx_extra={"owner_of": lambda fd, path: (os.getuid(), 10010)})

    def test_unknown_service_exits_2_listing_the_valid_names_and_runs_nothing(self):
        r = self.go(["frobnicate"], {})
        self.assertEqual((r.rc, r.err, r.runner.calls), (2, "restart: unknown service frobnicate; available: auth, caddy, postgres, web, worker\n", []))

    def test_profiled_and_staging_only_names_are_unknown(self):
        for argv in (["operator"], ["migrate"], ["--staging", "caddy"], ["-x"]):
            r = self.go(argv, {})
            self.assertEqual((r.rc, r.runner.calls), (2, []), argv)

    def test_healthy_exit_0_and_the_exact_compose_call(self):
        r = self.go(["web"], {"web": ("running", "healthy")})
        self.assertEqual((r.rc, r.out), (0, "web: healthy\n"))
        restarts = [c for c in r.runner.calls if "restart" in c["argv"]]
        self.assertEqual([c["argv"] for c in restarts], [["docker", "compose", "-p", "polycarpic-prod", "restart", "web"]])
        for c in r.runner.calls:
            self.assertEqual(c["env"], FIXED_ENV)

    def test_a_service_without_a_health_check_prints_running(self):
        r = self.go(["worker"], {"worker": ("running", "")})
        self.assertEqual((r.rc, r.out), (0, "worker: running\n"))

    def test_caddy_is_the_edge_project(self):
        r = self.go(["caddy"], {"caddy": ("running", "healthy")})
        self.assertEqual(r.rc, 0)
        self.assertIn(["docker", "compose", "-p", "polycarpic-edge", "restart", "caddy"], r.runner.argvs())

    def test_staging_uses_the_staging_project(self):
        r = self.go(["--staging", "auth"], {"auth": ("running", "healthy")})
        self.assertIn(["docker", "compose", "-p", "polycarpic-staging", "restart", "auth"], r.runner.argvs())

    def test_several_services_restart_in_the_order_given_and_all_must_be_healthy(self):
        r = self.go(["auth", "worker"], {"auth": ("running", "healthy"), "worker": ("running", "healthy")})
        self.assertEqual((r.rc, r.out), (0, "auth: healthy\nworker: healthy\n"))
        order = [a[-1] for a in r.runner.argvs() if "restart" in a]
        self.assertEqual(order, ["auth", "worker"])

    def test_never_healthy_times_out_after_120_s_on_the_fake_clock_exit_1(self):
        r = self.go(["web"], {"web": ("running", "starting")})
        self.assertEqual((r.rc, r.out), (1, "web: not healthy after 120 s (starting)\n"))
        waited = (r.clock - r.clock.__class__(2026, 11, 22, 18, 40, tzinfo=r.clock.tzinfo)).total_seconds()
        self.assertGreaterEqual(waited, 120)
        self.assertLess(waited, 135)

    def test_one_unhealthy_service_makes_the_exit_1_but_the_healthy_one_is_still_reported(self):
        r = self.go(["auth", "web"], {"auth": ("running", "healthy"), "web": ("exited", "")})
        self.assertEqual(r.rc, 1)
        self.assertIn("auth: healthy\n", r.out)
        self.assertIn("web: not healthy after 120 s (exited)\n", r.out)


if __name__ == "__main__":
    unittest.main()
