"""POLY-98 R8, K3, K7: the cli pass-through. One verb, run --rm -T, deployed images only, inherited stdout."""
import unittest

from base import APP_REF, BUNDLE, FIXED_ENV, OpsTest, PG_REF, Runner, stack

LINK = "https://app.example.com/accept?t=" + "q" * 8  # an obviously fake invite link


class Cli(OpsTest):
    def go(self, argv, project="prod", services=None, refs=None, code=0):
        runner = Runner(None)
        stack(runner, project, services, refs)
        runner.on(("run", "--rm"), code=code, term=LINK + "\n")
        r = self.host.go("cli", *argv, runner=runner)
        r.runs = [c for c in runner.calls if "run" in c["argv"]]
        return r

    def argv(self, project, email, *tail):
        return ["docker", "compose", "-f", str(self.host.p(BUNDLE + "/infra/compose/%s.yml" % project)), "-p", "polycarpic-" + project, "--profile", "operator",
                "run", "--rm", "-T", "--pull", "never", "--no-deps", "operator", "user", "invite", email] + list(tail)

    def test_exact_argv_and_image_env_stdout_inherited(self):
        r = self.go(["user", "invite", "owner@example.com"])
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual([c["argv"] for c in r.runs], [self.argv("prod", "owner@example.com")])
        self.assertEqual(r.runs[0]["kind"], "inherit")
        self.assertEqual(r.runs[0]["env"], dict(FIXED_ENV, POLY_APP_IMAGE=APP_REF, POLY_POSTGRES_IMAGE=PG_REF))
        self.assertEqual(r.term.getvalue(), LINK + "\n")

    def test_the_link_never_passes_through_the_wrapper(self):
        r = self.go(["user", "invite", "owner@example.com"])
        self.assertNotIn("q" * 8, r.out + r.err)
        for c in r.runner.calls:
            if c["kind"] == "run":
                self.assertNotIn(LINK, repr(c))
        self.assertEqual([c for c in r.runner.calls if c["kind"] == "run" and "invite" in c["argv"]], [])

    def test_bootstrap_goes_after_the_email_and_staging_uses_its_own_project(self):
        r = self.go(["--staging", "user", "invite", "owner@example.com", "--bootstrap"], project="staging")
        self.assertEqual([c["argv"] for c in r.runs], [self.argv("staging", "owner@example.com", "--bootstrap")])

    def test_the_apps_exit_code_is_passed_through(self):
        for code in (0, 1, 2):
            self.assertEqual(self.go(["user", "invite", "owner@example.com"], code=code).rc, code)

    def test_refused_verbs_exit_2_with_the_message_and_run_nothing(self):
        for verb in (["user", "reset-mfa", "a@example.com"], ["membership", "remove-owner", "x"], ["entity", "set-founder", "x"], ["secrets", "rotate"], ["secrets", "init"]):
            r = self.host.go("cli", *verb, runner=Runner(None))
            self.assertEqual((r.rc, r.err, r.runner.calls), (2, "refused: cli %s is not enabled in polycarpic-ops: it needs its own security review first\n" % " ".join(verb[:2]), []), verb)

    def test_unknown_verbs_and_extra_arguments_exit_2(self):
        r = self.host.go("cli", "frobnicate", "x", runner=Runner(None))
        self.assertEqual((r.rc, r.err, r.runner.calls), (2, "refused: unknown cli command; available: user invite\n", []))
        for argv in (["user", "invite"], ["user", "invite", "a@example.com", "--evil"], ["user", "invite", "a@example.com", "b@example.com"], ["user", "invite", "a@example.com", "--boot"]):
            r = self.host.go("cli", *argv, runner=Runner(None))
            self.assertEqual((r.rc, r.runner.calls), (2, []), argv)

    def test_emails_that_break_the_pattern_exit_2_and_run_nothing(self):  # R8, K3
        bad = ["-a@example.com", "a b@example.com", "a@example", "nodomain", "a@example.com\x1b[31m", "a\x1b@example.com", "a\u0085@example.com",
               "café@example.com", "a@@example.com", "x" * 250 + "@a.co", "a@b.c\n", "@example.com", "ab"]
        for e in bad:
            r = self.host.go("cli", "user", "invite", e, runner=Runner(None))
            self.assertEqual((r.rc, r.runner.calls), (2, []), repr(e))

    def test_positive_twins_plus_address_and_the_254_limit(self):
        for e in ("a+tag@example.com", "o.brien@sub.example.co", "a" * (254 - len("@bc.example")) + "@bc.example"):
            r = self.go(["user", "invite", e])
            self.assertEqual(r.rc, 0, repr(e))

    def test_a_tag_only_image_exits_1_and_nothing_runs(self):  # K7
        for refs, who in (({"web": "ghcr.io/richmosko/polycarpic:latest"}, "web"), ({"postgres": "postgres:16"}, "postgres")):
            r = self.go(["user", "invite", "owner@example.com"], refs=refs)
            self.assertEqual((r.rc, r.err), (1, "running %s image is not pinned by digest\n" % who), refs)
            self.assertEqual(r.runs, [])

    def test_a_malformed_digest_is_not_pinned(self):  # K7: regex, not substring
        r = self.go(["user", "invite", "owner@example.com"], refs={"web": "ghcr.io/x/y@sha256:" + "z" * 64})
        self.assertEqual((r.rc, r.runs), (1, []))
        r = self.go(["user", "invite", "owner@example.com"], refs={"web": "ghcr.io/x/y@sha256:" + "a" * 63})
        self.assertEqual((r.rc, r.runs), (1, []))

    def test_postgres_or_web_not_running_exits_1_with_the_message(self):
        for services in ({"web": ("running", "healthy")}, {"postgres": ("running", "healthy")}, {"postgres": ("running", "healthy"), "web": ("exited", "")}):
            r = self.go(["user", "invite", "owner@example.com"], services=services)
            self.assertEqual((r.rc, r.err, r.runs), (1, "polycarpic-prod is not running: deploy it first\n", []), services)


if __name__ == "__main__":
    unittest.main()
