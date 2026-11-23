"""POLY-100 G4/G2: the order of a run and what it may touch (R4, R6-R8; T7, T10, T11, T12, T14). Setup goes through the tool's own `first-deploy`."""
import os
import shutil

from deploy_base import DeployTest, digest, hexd, utc
from test_deploy_bundle import good_files, images_env_text, make_tar, sibling_digests

STAGING = "polycarpic-staging"
PROD = "polycarpic-prod"
CANARY = "/canary"
PATH_FLAGS = ("-f", "--env-file", "--project-directory")


class Flow(DeployTest):
    project = "staging"

    def setUp(self):
        super().setUp()
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)  # no `current`: the first deploy is the tool's own
        self.n = 0
        self.keys = None

    # --- candidates ---
    def new_commit(self):
        return self.world.commit("c%d" % self.n)

    def staging_candidate(self, script=None):
        """The next run of main: a new commit, a new image X (+ its bundle and three siblings), all attested at that commit."""
        w = self.world
        self.n += 1
        c = self.new_commit()
        x = digest("img%d" % self.n)
        files = good_files(images_env_text(sibling_digests(str(self.n))))
        if script is not None:
            files["infra/backup/backup.sh"] = script
        w.image("polycarpic", x, c, bundle=make_tar(files))
        w.attested.add((x, c))
        for name, d in sibling_digests(str(self.n)).items():
            w.image("polycarpic-" + name, d, c)
            w.attested.add((d, c))
        w.staging_run(c, x, run_id=str(1000 + self.n))
        return x

    def hex_dir(self, x):
        return str(self.host.p("/opt/polycarpic/releases/sha256-" + x.split(":")[1]))

    def first(self, x_script=None):
        x = self.staging_candidate(x_script)
        r = self.deploy("staging", cmd="first-deploy")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(self.state("staging", "current").split()[0], x)
        return x, r

    def upgrade(self, **kw):
        x = self.staging_candidate(kw.pop("script", None))
        return x, self.deploy("staging", **kw)

    def ups(self, r):
        return [c for c in r.world.compose_log if c["cmd"] == "up"]

    def images_of(self, project=STAGING):
        return {s: c["image"] for s, c in self.world.containers.get(project, {}).items()}

    # --- the happy path the others build on ---
    def test_first_deploy_then_upgrade_is_healthy_and_keeps_previous(self):
        x1, r1 = self.first()
        self.assertIn(["systemctl", "enable", "--now", "polycarpic-deploy@staging.timer"], r1.runner.argvs())
        x2, r2 = self.upgrade()
        self.assertEqual(r2.rc, 0, r2.err)
        self.assertEqual(self.state("staging", "current").split()[0], x2)
        self.assertEqual(self.state("staging", "previous").split()[0], x1)
        self.assertIsNone(self.alert_name("staging"))
        self.assertTrue(set(["verified", "up", "healthy"]) <= set(self.log_events("staging")))
        self.assertEqual(set(self.images_of().values()) & {"ghcr.io/richmosko/polycarpic@" + x2}, {"ghcr.io/richmosko/polycarpic@" + x2})

    # --- T14 ---
    def test_t14_every_up_and_run_carries_pull_never_and_no_build_and_only_release_files(self):
        self.first()
        x2, r = self.upgrade()
        cs = [c for c in r.world.compose_log if c["cmd"] in ("up", "run")]
        self.assertTrue(cs)
        for c in cs:
            a = c["argv"]
            self.assertEqual(a[a.index("--pull") + 1], "never", a)
            self.assertIn("--no-build", a)
            for i, tok in enumerate(a):
                if tok in ("-f", "--env-file", "--project-directory"):
                    self.assertIn("/opt/polycarpic/releases/sha256-", a[i + 1])

    # --- T7: the bundle is data; nothing it carries runs or replaces anything ---
    def test_t7_a_deploy_never_rewrites_the_box_and_runs_nothing_from_the_release(self):
        self.first()
        canary = str(self.host.p(CANARY))
        before = self.host.tree()
        x2, r = self.upgrade(script=("#!/bin/sh\ntouch %s\n" % canary).encode())
        self.assertEqual(r.rc, 0, r.err)
        self.assertFalse(os.path.exists(canary), "the bundle's script ran on the host")
        after = self.host.tree()
        allowed = ("opt/polycarpic/releases", "var/lib/polycarpic/state/deploy", "run/polycarpic", "opt/polycarpic/images.env")
        changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k) and not k.startswith(allowed) and k not in ("opt", "var", "run"))
        self.assertEqual(changed, [])
        for c in r.runner.calls:
            a = c["argv"]
            for i, tok in enumerate(a):
                if "/releases/" in tok:
                    self.assertIn(a[i - 1] if i else "", PATH_FLAGS + ("--project-directory",), "an argv element under releases/ outside -f/--env-file/--project-directory: %r" % a)
            self.assertNotIn("/releases/", a[0])
        # the box's own programs: the installed ops bundle is byte-identical
        self.assertEqual({k: v for k, v in before.items() if k.startswith("opt/polycarpic/ops")}, {k: v for k, v in after.items() if k.startswith("opt/polycarpic/ops")})

    # --- T11: migrate failure ---
    def test_t11_a_failing_migrate_never_touches_the_running_containers(self):
        x1, _ = self.first()
        running = self.images_of()
        self.world.run_codes[("migrate", "")] = 1
        x2, r = self.upgrade()
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused migrate-1"))
        self.assertEqual(self.images_of(), running)
        self.assertEqual([c for c in self.ups(r)], [], "no `up` at all in a run whose migrate failed")
        self.assertIn(x2, self.state("staging", "quarantine"))
        self.assertEqual(self.alert_name("staging"), "migrate-1")
        self.assertEqual(self.state("staging", "current").split()[0], x1)

    def test_t11_migrate_exit_2_is_quarantined_and_exit_4_is_not(self):
        self.first()
        for code, quarantined in ((2, True), (4, False)):
            self.world.run_codes[("migrate", "")] = code
            x, r = self.upgrade()
            self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused migrate-%d" % code))
            self.assertEqual(x in (self.state("staging", "quarantine") or ""), quarantined)

    def test_plan_diverged_is_quarantined_and_a_plan_error_is_not(self):
        self.first()
        for code, name, q in ((2, "plan-diverged", True), (1, "plan-error", False)):
            self.world.plan_code = code
            x, r = self.upgrade()
            self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused " + name))
            self.assertEqual(x in (self.state("staging", "quarantine") or ""), q, name)

    def test_check_config_failure_is_refused_and_quarantined_before_migrate(self):
        self.first()
        self.world.run_codes[("web", "check-config")] = 1
        x, r = self.upgrade()
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused check-config"))
        self.assertIn(x, self.state("staging", "quarantine"))
        self.assertEqual([c for c in r.world.compose_log if c["cmd"] == "run" and "migrate" in c["rest"]], [])

    # --- T10: unhealthy -> rollback ---
    def test_t10_unhealthy_rolls_back_from_the_previous_bundle_without_migrating_and_is_quarantined_once(self):
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.world.bad_apps.add(x2)
        r = self.deploy("staging")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: rolled-back"), r.err)
        self.assertEqual(self.alert_name("staging"), "rolled-back")
        self.assertIn(x2, self.state("staging", "quarantine"))
        self.assertEqual(self.state("staging", "current").split()[0], x1)
        ups = self.ups(r)
        self.assertEqual(len(ups), 2, "the candidate's up, then the rollback's")
        first_up, back_up = r.world.up_marks[-2], r.world.up_marks[-1]
        self.assertLessEqual(back_up - first_up, 125, "rollback starts no later than 120 s after up -d")
        self.assertIn(self.hex_dir(x1), " ".join(ups[1]["argv"]), "the rollback runs from the previous release's own bundle")
        self.assertEqual([c for c in r.world.compose_log[r.world.compose_log.index(ups[0]) + 1:] if c["cmd"] == "run"], [], "rollback never migrates")
        self.assertTrue(set(["rolled-back"]) <= set(self.log_events("staging")))
        # the next poll sees the same run: skipped, no new alert line, no new candidate work
        log_before, alert_before = self.state("staging", "deploy.log"), self.state("staging", "alert")
        r2 = self.deploy("staging")
        self.assertEqual(r2.rc, 0, r2.err)
        self.assertEqual(self.state("staging", "alert"), alert_before)
        self.assertEqual([l.split()[1] for l in self.state("staging", "deploy.log")[len(log_before):].splitlines()], ["quarantined"])
        self.assertEqual(self.ups(r2), [])

    def test_t10_a_previous_release_edited_on_disk_is_not_upped(self):
        x1, _ = self.first()
        x2 = self.staging_candidate()
        self.world.bad_apps.add(x2)
        # the first deploy's release is `current`, so it becomes `previous` only after x2 is current: edit it while it is current
        victim = os.path.join(self.hex_dir(x1), "infra", "compose", "staging.yml")
        with open(victim, "ab") as fh:
            fh.write(b"# edited\n")
        r = self.deploy("staging")
        self.assertEqual(r.rc, 1)
        self.assertNotEqual(self.alert_name("staging"), "rolled-back")
        self.assertEqual(len(self.ups(r)), 1, "no rollback up from a bundle whose tree hash no longer matches")

    def test_a_first_deploy_that_is_unhealthy_reports_rollback_unhealthy_and_changes_nothing_else(self):
        x = self.staging_candidate()
        self.world.bad_apps.add(x)
        r = self.deploy("staging", cmd="first-deploy")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: rollback-unhealthy"), r.err)
        self.assertEqual(self.alert_name("staging"), "rollback-unhealthy")
        self.assertIsNone(self.state("staging", "current"))
        self.assertNotIn(["systemctl", "enable", "--now", "polycarpic-deploy@staging.timer"], r.runner.argvs())

    def test_unhealthy_when_the_health_endpoint_is_not_200_even_if_every_container_is_healthy(self):
        x1, _ = self.first()
        x2 = self.staging_candidate()
        orig = self.world._compose

        def exec_503(argv):
            if "exec" in argv:
                return 0, "503\n", ""
            return orig(argv)
        self.world._compose = exec_503
        r = self.deploy("staging")
        self.assertEqual(r.err.splitlines()[-1] if r.err else "", "deploy: rollback-unhealthy")
