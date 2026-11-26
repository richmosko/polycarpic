"""POLY-104 F15 (seceng's ruling on the gh install): the first real box had no `gh`, and first-deploy said "transient: gh api failed".
`deploy`, `first-deploy` and `edge-deploy` ask `gh --version` before any network call; a missing gh or any version but the pinned one
(`infra/deploy/gh-version` in the ops bundle) is the refusal `gh` (alert, exit 4, no quarantine, never transient). A rollback needs no gh.
gh's stderr can echo URLs, API bodies, headers and escapes, so none of it is logged or printed: a failed call reports its exit code and one
label from a fixed list. Every gh call gets a closed environment."""
import os
import re
import shutil
from unittest import mock

from deploy_base import GH_PINNED, REPO, DeployTest
import test_deploy_flow as fl
from test_deploy_edge import EdgeBase

VERSION = ["gh", "--version"]


def last(r):
    return r.err.splitlines()[-1] if r.err.strip() else ""


def network_calls(r):
    return [c["argv"] for c in r.runner.calls if c["argv"] and c["argv"][0] in ("gh", "git") and c["argv"] != VERSION]


class Base(DeployTest):
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

    def written(self, r):
        """Everything the run printed and every file under the deploy state."""
        texts = [r.err, r.out, r.term.getvalue()]
        for base, _, files in os.walk(str(self.host.p("/var/lib/polycarpic/state/deploy"))):
            if "tags.git" in base:
                continue
            for f in files:
                full = os.path.join(base, f)
                if not os.path.islink(full):
                    with open(full, "rb") as fh:
                        texts.append(fh.read().decode("utf-8", "replace"))
        return "\n".join(texts)


class Pin(Base):
    def test_the_pin_file_is_one_line_n_n_n_not_under_the_floor(self):
        text = (REPO / "infra" / "deploy" / "gh-version").read_text()
        self.assertRegex(text, r"^[0-9]+\.[0-9]+\.[0-9]+\n$")
        # 2.102.0 fixed --signer-workflow matching as a prefix (GHSA-wjmr-j3rp-mh2g), which `attest` relies on
        self.assertGreaterEqual(tuple(int(x) for x in text.strip().split(".")), (2, 102, 0))

    def test_the_hash_file_pins_the_pinned_versions_tarball_and_its_binary(self):
        version = (REPO / "infra" / "deploy" / "gh-version").read_text().strip()
        lines = (REPO / "infra" / "deploy" / "gh-sha256").read_text().splitlines()
        self.assertEqual(len(lines), 2, lines)
        self.assertRegex(lines[0], r"^[0-9a-f]{64}  gh_%s_linux_amd64\.tar\.gz$" % version.replace(".", r"\."))
        self.assertRegex(lines[1], r"^[0-9a-f]{64}  gh_%s_linux_amd64/bin/gh$" % version.replace(".", r"\."))
        self.assertNotEqual(lines[0][:64], lines[1][:64])

    def test_install_sh_ships_both_pin_files(self):
        paths = re.search(r'^PATHS="([^"]+)"$', (REPO / "infra" / "ops" / "install.sh").read_text(), re.M).group(1).split()
        for name in ("infra/deploy/gh-version", "infra/deploy/gh-sha256"):
            self.assertIn(name, paths)


class Refused(Base):
    def assert_refused(self, r, x, label):
        self.assertEqual((r.rc, last(r)), (4, "deploy: refused gh"), "%s: %s" % (label, r.err))
        self.assertEqual(network_calls(r), [], "%s: refused before any network call" % label)
        self.assertEqual(self.alert_name("staging"), "gh", label)
        self.assertNotIn(x, self.state("staging", "quarantine") or "", "%s: a box fault bans no digest" % label)
        self.assertIsNone(self.state("staging", "transient-since"), "%s: never a transient" % label)
        self.assertNotIn("transient", r.err, label)
        self.assertIn("provision --stage host", r.err, "%s: the fix is named" % label)
        self.assertIn(GH_PINNED, r.err, "%s: the pinned version is named" % label)

    def test_a_box_without_gh_is_refused_and_says_none_was_found(self):
        self.first()
        x = self.staging_candidate()
        self.world.gh_version = None
        mark = len(self.world.up_marks)
        r = self.deploy("staging")
        self.assert_refused(r, x, "missing")
        self.assertIn("found none", r.err)
        self.assertEqual(len(self.world.up_marks), mark, "nothing started")

    def test_any_other_version_or_no_usable_answer_is_refused(self):
        self.first()
        x = self.staging_candidate()
        for label, answer in (("under the floor", "2.101.0"), ("one patch off", GH_PINNED + "1"), ("newer is no better", "2.999.0"),
                              ("garbage", (0, "not gh at all\n", "")), ("silent", (0, "", "")), ("failing", (1, "", "boom\n"))):
            with self.subTest(label):
                self.world.gh_version = answer
                self.assert_refused(self.deploy("staging"), x, label)

    def test_the_found_version_is_named(self):
        self.first()
        self.staging_candidate()
        self.world.gh_version = "2.101.0"
        self.assertIn("2.101.0", self.deploy("staging").err)

    def test_first_deploy_is_refused_the_same_way(self):
        x = self.staging_candidate()
        self.world.gh_version = None
        self.assert_refused(self.deploy("staging", cmd="first-deploy"), x, "first-deploy")

    def test_the_pinned_version_is_asked_first_and_goes_on(self):  # positive twin
        self.first()
        self.staging_candidate()
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        gh = [c["argv"] for c in r.runner.calls if c["argv"][0] == "gh"]
        self.assertEqual(gh[0], VERSION)

    def test_a_rollback_needs_no_gh(self):
        self.first()
        self.staging_candidate()
        self.assertEqual(self.deploy("staging").rc, 0)
        self.world.gh_version = None
        r = self.deploy("staging", cmd="rollback")
        self.assertEqual(r.rc, 0, r.err)


class EdgeRefused(EdgeBase):
    def test_edge_deploy_is_refused_the_same_way(self):
        self.edge_release(1)
        self.world.gh_version = None
        r = self.edge("edge-1")
        self.assertEqual((r.rc, last(r)), (4, "deploy: refused gh"), r.err)
        self.assertEqual(network_calls(r), [])


# what an unfriendly gh might print: a URL carrying a token, a header, a terminal escape
MARK = "SEKRETMARK https://api.github.com/x?access_token=github_pat_LEAK \x1b[2J Authorization: token LEAKED"
CALLS = ("api", "api -i", "run download", "attestation verify")


class Redaction(Base):
    def assert_clean(self, text, key):
        for banned in ("SEKRETMARK", "LEAK", "Authorization", "access_token", "\x1b"):
            self.assertFalse(banned in text, "%s: gh's stderr reached the output or a state file (%r)" % (key, banned))

    def test_no_failed_gh_call_puts_its_stderr_anywhere(self):
        self.first()
        self.staging_candidate()
        for key in CALLS:
            with self.subTest(key):
                self.world.gh_fails = {key: (1, "HTTP 401: Bad credentials\n" + MARK + "\n")}
                r = self.deploy("staging")
                self.assert_clean(self.written(r), key)

    def test_a_failed_call_reports_its_exit_code_and_one_fixed_label(self):
        self.first()
        self.staging_candidate()
        cases = (("HTTP 401: Bad credentials", "http-401"), ("HTTP 403: Resource not accessible by personal access token", "http-403"),
                 ("HTTP 404: Not Found", "http-404"), ("API rate limit exceeded for user", "rate-limit"), ("no attestations found for subject", "no-attestations"),
                 ("verification failed", "verify-failed"), ("error connecting to api.github.com", "network"), ("something nobody has seen " + MARK, "other"))
        for key in ("api", "run download", "attestation verify"):
            for text, label in cases:
                with self.subTest(key=key, label=label):
                    # an attestation failure may quarantine the digest: each case starts from an unbanned one
                    if (self.sdir("staging") / "quarantine").exists():
                        os.unlink(str(self.sdir("staging") / "quarantine"))
                    self.world.gh_fails = {key: (7, text + "\n")}
                    before = self.state("staging", "deploy.log") or ""
                    r = self.deploy("staging")
                    said = r.err + r.out + (self.state("staging", "deploy.log") or "")[len(before):]
                    want = "gh: exit 7 (%s)" % label
                    self.assertTrue(want in said, "no %r:\n%s" % (want, said))
                    self.assert_clean(self.written(r), key)

    def test_gh_gets_a_closed_environment_on_every_call(self):
        self.first()
        self.staging_candidate()
        with mock.patch.dict(os.environ, {"GH_DEBUG": "api", "DEBUG": "1", "GH_HOST": "evil.example", "GH_TOKEN": "ambient"}):
            r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        calls = [c for c in r.runner.calls if c["argv"][0] == "gh"]
        self.assertGreaterEqual(len(calls), 4)
        for c in calls:
            env, what = c["env"] or {}, " ".join(c["argv"][:3])
            for name in ("GH_DEBUG", "DEBUG", "GH_HOST"):
                self.assertNotIn(name, env, what)
            self.assertEqual((env.get("GH_NO_UPDATE_NOTIFIER"), env.get("GH_PROMPT_DISABLED")), ("1", "1"), what)
            self.assertTrue(env.get("GH_CONFIG_DIR", "").startswith(str(self.host.root)), what)
            self.assertNotEqual(env.get("GH_TOKEN"), "ambient", what)


if __name__ == "__main__":
    import unittest
    unittest.main()
