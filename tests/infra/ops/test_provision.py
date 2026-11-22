"""POLY-98 R3, K2, K3: provision and provision-check wrappers. The scripts themselves are not run here (the container test runs them)."""
import os
import unittest

from base import BUNDLE, FIXED_ENV, OpsTest, Runner


class ProvisionBase(OpsTest):
    def script(self, name):
        return str(self.host.p(BUNDLE + "/infra/" + name))

    def prov(self, *argv, code=0, **kw):
        runner = Runner(None)
        runner.on(("provision.sh",), code=code, term="provision output\n")
        runner.on(("provision-check.sh",), code=code, term="check output\n")
        return self.host.go(*argv, runner=runner, **kw)


class Provision(ProvisionBase):
    BASE = ["provision", "--stage", "host", "--target", "hetzner", "--domain", "polycarpic.com"]

    def test_forwards_exactly_the_flags_given_to_bash_provision_sh_and_passes_output_and_exit_through(self):
        r = self.prov(*self.BASE, "--mail-from", "Polycarpic <noreply@mail.polycarpic.com>", code=0)
        self.assertEqual(r.rc, 0)
        self.assertEqual(r.runner.argvs(), [["/bin/bash", self.script("provision.sh"), "--stage", "host", "--target", "hetzner", "--domain", "polycarpic.com", "--mail-from", "Polycarpic <noreply@mail.polycarpic.com>"]])
        self.assertEqual(r.term.getvalue(), "provision output\n")
        self.assertEqual(r.runner.calls[0]["env"], FIXED_ENV)

    def test_without_stage_nothing_extra_is_forwarded(self):
        r = self.prov("provision", "--target", "hetzner", "--domain", "polycarpic.com")
        self.assertEqual(r.runner.argvs(), [["/bin/bash", self.script("provision.sh"), "--target", "hetzner", "--domain", "polycarpic.com"]])

    def test_the_scripts_exit_code_is_the_exit_code(self):
        for code in (1, 3):
            self.assertEqual(self.prov(*self.BASE, code=code).rc, code)

    def test_target_home_exits_2_with_the_message_and_runs_nothing(self):
        r = self.prov("provision", "--target", "home", "--domain", "polycarpic.com")
        self.assertEqual((r.rc, r.err), (2, "provision: --target home is not available\n"))
        self.assertEqual(r.runner.calls, [])

    def test_domains_that_break_the_pattern_exit_2_and_run_nothing(self):
        for bad in ("-evil.com", "nodot", "UPPER.example", "a b.example", "a.example;rm", "café.example", "a..example", "x" * 64 + ".example", ""):
            r = self.prov("provision", "--target", "hetzner", "--domain", bad)
            self.assertEqual(r.rc, 2, repr(bad))
            self.assertEqual(r.runner.calls, [], repr(bad))
        self.assertEqual(self.prov("provision", "--target", "hetzner", "--domain", "a-b.example.co").rc, 0)  # positive twin

    def test_mail_from_with_a_control_or_non_ascii_character_or_a_leading_dash_exits_2(self):
        for bad in ("a@b.c\x1b[31m", "a@b.c\n", "café@b.c", "-a@b.c", "x" * 255, ""):
            r = self.prov(*self.BASE, "--mail-from", bad)
            self.assertEqual(r.rc, 2, repr(bad))
            self.assertEqual(r.runner.calls, [], repr(bad))
        self.assertEqual(self.prov(*self.BASE, "--mail-from", "Name <a@b.example>").rc, 0)

    def test_mail_from_starting_with_a_dash_exits_2_with_the_exact_message_and_runs_nothing(self):  # B3
        r = self.prov("provision", "--stage", "host", "--target", "hetzner", "--domain", "example.com", "--mail-from", "-x@example.com")
        self.assertEqual((r.rc, r.err, r.runner.calls), (2, "provision: bad --mail-from\n", []))

    def test_unknown_flags_and_abbreviations_exit_2_with_nothing_run(self):  # K2
        for extra in (["--evil"], ["--evil", "x"], ["--dom", "x.example"], ["--stage=host"], ["positional"]):
            r = self.prov("provision", "--target", "hetzner", "--domain", "x.example", *extra)
            self.assertEqual(r.rc, 2, extra)
            self.assertEqual(r.runner.calls, [], extra)

    def test_b2_bucket_is_consumed_writes_ops_conf_once_and_prints_change_only_the_first_time(self):
        conf = self.host.p("/etc/polycarpic/ops.conf")
        r = self.prov(*self.BASE, "--b2-bucket", "polycarpic-hetzner-backups")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(conf.read_text(), "B2_BUCKET=polycarpic-hetzner-backups\n")
        self.assertEqual(oct(os.stat(str(conf)).st_mode & 0o777), "0o644")
        self.assertIn("change: ops.conf B2_BUCKET=polycarpic-hetzner-backups\n", r.out)
        self.assertNotIn("--b2-bucket", " ".join(r.runner.calls[0]["argv"]))
        self.assertNotIn("polycarpic-hetzner-backups", " ".join(r.runner.calls[0]["argv"]))
        again = self.prov(*self.BASE, "--b2-bucket", "polycarpic-hetzner-backups")
        self.assertNotIn("change:", again.out)
        self.assertEqual(conf.read_text(), "B2_BUCKET=polycarpic-hetzner-backups\n")
        third = self.prov(*self.BASE, "--b2-bucket", "polycarpic-other-bucket")
        self.assertIn("change: ops.conf B2_BUCKET=polycarpic-other-bucket\n", third.out)

    def test_b2_bucket_that_breaks_the_pattern_exits_2_and_writes_nothing(self):
        for bad in ("short", "UPPER-bucket-name", "has_underscore1", "x" * 51, "-leading-dash1", "bucket name1"):
            r = self.prov(*self.BASE, "--b2-bucket", bad)
            self.assertEqual(r.rc, 2, bad)
            self.assertFalse(self.host.p("/etc/polycarpic/ops.conf").exists(), bad)
            self.assertEqual(r.runner.calls, [], bad)

    def test_stage_database_forwards_project_and_refuses_anything_else(self):
        for p in ("prod", "staging"):
            r = self.prov("provision", "--stage", "database", "--project", p)
            self.assertEqual(r.runner.argvs(), [["/bin/bash", self.script("provision.sh"), "--stage", "database", "--project", p]])
        for bad in (["--project", "dev"], ["--project", "-x"], []):
            r = self.prov("provision", "--stage", "database", *bad)
            self.assertEqual(r.rc, 2, bad)
            self.assertEqual(r.runner.calls, [], bad)

    def test_stage_other_than_host_or_database_exits_2(self):
        r = self.prov("provision", "--stage", "everything", "--target", "hetzner", "--domain", "x.example")
        self.assertEqual((r.rc, r.runner.calls), (2, []))


class ProvisionCheck(ProvisionBase):
    CAPS = "/infra/operator/b2-capabilities.json"

    def argv(self, bucket, *more):
        return ["/bin/bash", self.script("provision-check.sh"), "--b2-capabilities", str(self.host.p(BUNDLE + self.CAPS)), "--b2-bucket", bucket] + list(more)

    def test_bucket_from_ops_conf_exact_argv_output_passed_through(self):
        self.host.write("/etc/polycarpic/ops.conf", "B2_BUCKET=polycarpic-hetzner-backups\n")
        r = self.prov("provision-check")
        self.assertEqual(r.rc, 0)
        self.assertEqual(r.runner.argvs(), [self.argv("polycarpic-hetzner-backups")])
        self.assertEqual(r.term.getvalue(), "check output\n")
        self.assertEqual(r.runner.calls[0]["env"], FIXED_ENV)

    def test_the_flag_beats_ops_conf_and_prod_is_forwarded(self):
        self.host.write("/etc/polycarpic/ops.conf", "B2_BUCKET=polycarpic-hetzner-backups\n")
        r = self.prov("provision-check", "--prod", "--b2-bucket", "polycarpic-flag-bucket")
        self.assertEqual(r.runner.argvs(), [self.argv("polycarpic-flag-bucket", "--prod")])

    def test_no_bucket_anywhere_exits_2_with_the_hint_and_runs_nothing(self):
        r = self.prov("provision-check")
        self.assertEqual((r.rc, r.err, r.runner.calls), (2, "no bucket: run provision --b2-bucket <name> once, or pass --b2-bucket\n", []))

    def test_exit_codes_0_1_3_pass_through(self):
        self.host.write("/etc/polycarpic/ops.conf", "B2_BUCKET=polycarpic-hetzner-backups\n")
        for code in (0, 1, 3):
            self.assertEqual(self.prov("provision-check", code=code).rc, code)

    def test_unknown_flags_and_bad_buckets_exit_2_with_nothing_run(self):  # K2
        for extra in (["--evil"], ["--b2-bucket", "Bad"], ["--pro"], ["--b2-bucket", "-bucket-name-1"]):
            r = self.prov("provision-check", *extra)
            self.assertEqual((r.rc, r.runner.calls), (2, []), extra)


if __name__ == "__main__":
    unittest.main()
