"""POLY-100 G5: the token stays in gh's environment (T15, S6) and one deploy at a time (T16, R1)."""
import fcntl
import json
import os
import signal
from contextlib import contextmanager

from deploy_base import DeployTest, digest
from test_deploy_bundle import good_files, make_tar, sibling_digests

LOCK = "/run/polycarpic/deploy.lock"
NOT_GH = ("docker", "git", "ssh-keygen", "systemctl", "polycarpic-ops")


class Candidate(DeployTest):
    def candidate(self):
        w = self.world
        x = digest("x")
        w.image("polycarpic", x, w.commit_b, bundle=make_tar(good_files()))
        w.attested.add((x, w.commit_b))
        for n, d in sibling_digests().items():
            w.image("polycarpic-" + n, d, w.commit_b)
            w.attested.add((d, w.commit_b))
        w.staging_run(w.commit_b, x)
        return x


class Token(Candidate):
    def test_t15_the_token_is_in_gh_s_env_only(self):
        self.candidate()
        r = self.deploy("staging")
        calls = r.runner.calls
        self.assertTrue([c for c in calls if c["argv"][0] == "gh"])
        for c in calls:
            blob = json.dumps(c["argv"]) + json.dumps(c.get("stdin") or "")
            self.assertNotIn(self.token, blob, "the token is in an argv or stdin: %r" % c["argv"][:4])
            self.assertNotIn("--token", c["argv"])
            env = c["env"] or {}
            if c["argv"][0] == "gh" and c["argv"] != ["gh", "--version"]:  # the version question needs no token and gets none (POLY-104 F15)
                self.assertEqual(env.get("GH_TOKEN"), self.token)
            else:
                self.assertNotIn("GH_TOKEN", env, c["argv"][:3])
                self.assertNotIn("GITHUB_TOKEN", env)
                self.assertNotIn(self.token, json.dumps(env), c["argv"][:3])
        for c in calls:
            if c["argv"][0] == "git":
                a = c["argv"]
                if "fetch" in a:
                    self.assertIn("credential.helper=", a)
                    self.assertEqual((c["env"] or {}).get("GIT_TERMINAL_PROMPT"), "0")
                    self.assertTrue(any(x.startswith("https://github.com/richmosko/polycarpic") and "@" not in x for x in a), "a bare URL")

    def test_t15_the_token_reaches_no_file_log_or_state(self):
        self.candidate()
        r = self.deploy("staging")
        self.assertNotIn(self.token, r.out + r.err + r.term.getvalue())
        secret = str(self.host.p("/etc/polycarpic/secrets/host/github_read_token"))
        for base, _, files in os.walk(str(self.tmp)):
            for f in files:
                full = os.path.join(base, f)
                if full != secret and not os.path.islink(full):
                    self.assertNotIn(self.token.encode(), open(full, "rb").read(), "the token is on disk at " + full)
        self.assertNotIn(self.token, self.state("staging", "deploy.log") or "")
        self.assertFalse(self.host.p("/root/.docker/config.json").exists())
        tags = self.host.p("/var/lib/polycarpic/state/deploy/tags.git")
        for base, _, files in os.walk(str(tags)):
            for f in files:
                self.assertNotIn(self.token.encode(), open(os.path.join(base, f), "rb").read(), f)

    def test_t15_gh_s_config_dir_is_an_empty_root_dir_and_left_empty(self):
        self.candidate()
        r = self.deploy("staging")
        dirs = set((c["env"] or {}).get("GH_CONFIG_DIR") for c in r.runner.calls if c["argv"][0] == "gh")
        self.assertEqual(len(dirs), 1)
        d = dirs.pop()
        self.assertTrue(d)
        self.assertTrue(not os.path.exists(d) or os.listdir(d) == [], "gh's config dir must be empty after the run")

    def test_t15_a_gh_outage_is_transient_and_never_quarantines(self):
        x = self.candidate()
        self.world.gh_down = True
        self.deploy("staging")
        self.assertIn("transient", self.log_events("staging"))
        self.assertNotIn(x, self.state("staging", "quarantine") or "")
        self.assertIsNone(self.alert_name("staging"))


@contextmanager
def held(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    fcntl.flock(fd, fcntl.LOCK_EX)
    try:
        yield
    finally:
        os.close(fd)


class Lock(Candidate):
    def setUp(self):
        super().setUp()

        def boom(*a):
            raise AssertionError("the deploy blocked on a held lock (a blocking flock, not -n)")
        signal.signal(signal.SIGALRM, boom)
        signal.alarm(20)
        self.addCleanup(signal.alarm, 0)

    def test_t16_a_busy_timer_run_exits_0_logs_busy_and_touches_nothing(self):
        self.candidate()
        with held(str(self.host.p(LOCK))):
            before = self.host.tree()
            r = self.deploy("staging")
            after = self.host.tree()
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(r.runner.calls, [], "nothing is called while another deploy holds the lock")
        self.assertEqual(self.log_events("staging"), ["busy"])
        skip = ("var/lib/polycarpic/state/deploy/staging/deploy.log",)
        self.assertEqual({k: v for k, v in before.items() if k not in skip}, {k: v for k, v in after.items() if k not in skip})

    def test_t16_the_lock_is_one_for_both_projects(self):
        self.candidate()
        self.seed("prod", digest("pc"), "v1.0.0", self.world.commit_a)
        with held(str(self.host.p(LOCK))):
            r = self.deploy("prod")
        self.assertEqual((r.rc, r.runner.calls), (0, []))

    def test_t16_first_deploy_and_rollback_wait_ten_minutes_then_exit_4(self):
        self.candidate()
        with held(str(self.host.p(LOCK))):
            r = self.deploy("staging", cmd="first-deploy")
        self.assertEqual(r.rc, 4, r.err)
        self.assertGreaterEqual(sum(r.sleeps), 600)
        self.assertLessEqual(sum(r.sleeps), 640)
        self.assertEqual(r.runner.calls, [])

    def test_t16_a_free_lock_does_not_say_busy(self):
        self.candidate()
        r = self.deploy("staging")
        self.assertNotIn("busy", self.log_events("staging"))
