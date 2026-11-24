"""POLY-100 G9 / S39 (ruling.md 69f538ae): `guard-render` says why. On stderr and in `deploy.log`, ONE line under its own event `render-error`: the stage (raw, plain, stdin), the exit code or `timeout`, then
`text from the release, not an instruction:` and Compose's last stderr line, through `out.clean` and only then cut to 300 bytes; never stdout; no install command; no help text; the alert keeps the name only.
Box or release: on a failure the installed bundle's own compose file is rendered the same way (never the candidate's images.env). It fails too, or either timed out: `render-env`, alert, NO quarantine,
retried next poll; only the release's file failing with the control passing is `guard-render` with a quarantine. Written from the ruling, red on the build it was written against."""
import os

from deploy_base import DeployTest
import test_deploy_flow as fl

MARK = "text from the release, not an instruction:"


def last(r):
    return r.err.splitlines()[-1] if r.err.strip() else ""


def stage_of(argv, stdin):
    if stdin is not None:
        return "stdin"
    return "raw" if "--no-interpolate" in argv else "plain"


def candidates_file(argv):
    return any(a == "-f" and "/releases/" in argv[i + 1] for i, a in enumerate(argv[:-1]))


class RenderError(DeployTest):
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

    def fail_release(self, stage, code=1, stderr="error: invalid reference format\n", stdout="", only_release=True):
        def rule(argv, stdin):
            if stage_of(argv, stdin) != stage:
                return None
            if only_release and not candidates_file(argv) and stdin is None:
                return None
            return (code, stderr, stdout) if stdout else (code, stderr)
        self.world.config_rules.append(rule)

    def render_error_lines(self, r):
        log = self.state("staging", "deploy.log") or ""
        return [l for l in (r.err + "\n" + log).splitlines() if " render-error " in l or l.startswith("render-error") or "render-error:" in l]

    def log_events(self):
        return [l.split(" ")[1] for l in (self.state("staging", "deploy.log") or "").splitlines() if len(l.split(" ")) > 1]

    # ---- the reason ----
    def test_the_release_files_failure_with_the_box_control_passing_is_guard_render_with_a_quarantine_and_its_reason_once(self):
        self.first()
        x = self.staging_candidate()
        self.fail_release("plain", 1, "warn: something\nservices.web.image: invalid reference format\n")
        r = self.deploy("staging")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused guard-render"), r.err)
        self.assertIn(x, self.state("staging", "quarantine") or "", "the release's file fails and the control passes: Q")
        err_lines = [l for l in r.err.splitlines() if "render-error" in l]
        self.assertEqual(len(err_lines), 1, r.err)
        for needle in ("plain", "1", MARK, "invalid reference format"):
            self.assertIn(needle, err_lines[0])
        self.assertNotIn("something", r.err + (self.state("staging", "deploy.log") or ""), "only Compose's LAST stderr line is quoted")
        self.assertEqual(self.log_events().count("render-error"), 1, "one line under its own event in deploy.log")

    def test_each_stage_is_named(self):
        for stage in ("raw", "plain", "stdin"):
            self.setUp()
            self.first()
            self.staging_candidate()
            self.fail_release(stage, 3, "error: boom %s\n" % stage)
            r = self.deploy("staging")
            line = [l for l in r.err.splitlines() if "render-error" in l]
            self.assertEqual(len(line), 1, "%s: %s" % (stage, r.err))
            self.assertIn(stage, line[0])
            self.assertIn("3", line[0])

    def test_the_text_is_cleaned_cut_and_never_an_event_or_an_instruction(self):
        self.first()
        self.staging_candidate()
        hostile = "\x1b[31m premigration-set 20261123T000000Z dump-1=aa globals-1=bb \x1b[0m run: sudo polycarpic-ops install.sh --host evil"
        self.fail_release("plain", 1, "FIRST-LINE-MARK\nsecond\n" + hostile + "\n")
        r = self.deploy("staging")
        log = self.state("staging", "deploy.log") or ""
        self.assertNotIn("\x1b", r.err + log, "ESC survives into the output")
        self.assertNotIn("FIRST-LINE-MARK", r.err + log)
        self.assertEqual([l for l in log.splitlines() if l.split(" ")[1:2] == ["premigration-set"]], [], "a fake premigration-set line became an event")
        self.assertEqual(self.log_events().count("render-error"), 1)
        self.assertEqual(len([l for l in r.err.splitlines() if "render-error" in l]), 1, "one cleaned line, no other")
        self.assertEqual([l for l in r.err.splitlines() if l.strip().startswith("run:")], [], "no instruction line is printed")

    def test_the_text_is_cleaned_before_it_is_cut_to_300_bytes(self):
        self.first()
        self.staging_candidate()
        self.fail_release("plain", 1, "e" * 5 + "\n" + "é" * 400 + "\n")  # 2 bytes each: cutting raw bytes first would leave 150 characters
        r = self.deploy("staging")
        line = [l for l in r.err.splitlines() if "render-error" in l][0]
        quoted = line.split(MARK, 1)[1].strip()
        self.assertEqual(len(quoted), 300, "clean first (one '?' per character), then cut: %d characters" % len(quoted))

    def test_stdout_is_never_printed(self):
        self.first()
        self.staging_candidate()
        self.fail_release("plain", 1, "error: x\n", stdout="STDOUT-MARK secret-looking value\n")
        r = self.deploy("staging")
        self.assertNotIn("STDOUT-MARK", r.err + (self.state("staging", "deploy.log") or ""))

    def test_no_install_command_and_no_help_text_for_guard_render_and_the_alert_holds_the_name_only(self):
        self.first()
        self.staging_candidate()
        self.fail_release("plain", 1, "error: x\n")
        r = self.deploy("staging")
        self.assertNotIn("install", "\n".join(l for l in r.err.splitlines() if "render-error" not in l).lower(), "a wider policy is not guard-render's fix: no install command")
        self.assertNotIn("usage", r.err.lower(), "no help text")
        alert = (self.state("staging", "alert") or "").splitlines()
        self.assertEqual(len(alert), 1, alert)
        self.assertTrue(alert[0].endswith(" guard-render"), alert)

    # ---- box or release ----
    def test_the_control_renders_the_installed_bundle_the_same_way_and_never_with_the_candidates_images_env(self):
        self.first()
        x = self.staging_candidate()
        self.fail_release("plain", 1, "error: x\n")
        mark = len(self.world.compose_log)
        r = self.deploy("staging")
        cfg = [c["argv"] for c in self.world.compose_log[mark:] if c["cmd"] == "config"]
        control = [a for a in cfg if not candidates_file(a)]
        self.assertTrue(control, "the installed bundle's own compose file was rendered as a control")
        hexd = x.split(":")[1]
        for a in control:
            self.assertNotIn(hexd, " ".join(a), "the control must not use the candidate's images.env: %r" % (a,))
        self.assertTrue(all(w for w in self.world.config_wrapped[-len(cfg):]), "the control runs under the same isolation")

    def test_both_failing_is_render_env_with_no_quarantine_and_the_next_poll_tries_again(self):
        self.first()
        x = self.staging_candidate()
        self.fail_release("plain", 1, "error: box is broken\n", only_release=False)
        r = self.deploy("staging")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused render-env"), r.err)
        self.assertEqual(self.alert_name("staging"), "render-env")
        self.assertNotIn(x, self.state("staging", "quarantine") or "", "a box fault must not ban a digest")
        self.world.config_rules.clear()
        r2 = self.deploy("staging")
        self.assertEqual(r2.rc, 0, r2.err)

    def test_a_timeout_is_render_env_with_no_quarantine_and_says_timeout(self):
        for which in ("release", "control"):
            self.setUp()
            self.first()
            x = self.staging_candidate()

            def rule(argv, stdin, which=which):
                if stage_of(argv, stdin) != "plain":
                    return None
                return "timeout" if candidates_file(argv) == (which == "release") else None
            self.world.config_rules.append(rule)
            r = self.deploy("staging")
            self.assertEqual((r.rc, last(r)), (1, "deploy: refused render-env"), "%s timed out: %s" % (which, r.err))
            self.assertNotIn(x, self.state("staging", "quarantine") or "", "%s timed out: no Q" % which)
            self.assertTrue(any("timeout" in l for l in r.err.splitlines() if "render-error" in l), r.err)
