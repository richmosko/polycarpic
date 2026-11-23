"""POLY-100 F15 (ruling.md; build review F15): one-off `compose run` containers are named `polycarpic-<project>-<svc>` and a stale one is removed first; on a timeout the run removes the
container (`docker rm -f`) and `docker inspect` must show it gone before any lock is released, else `oneoff-stuck` (alert, Q, exit 1); `migrate`'s client timeout is 30 min, above the runner's
10 min lock wait, and a timed-out migrate is `migrate-timeout` (Q). Written from the ruling, red on the build it was written against."""
import shutil

from deploy_base import DeployTest
import test_deploy_flow as fl


def last(r):
    return r.err.splitlines()[-1] if r.err.strip() else ""


class F15(DeployTest):
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

    def second(self):
        self.first()
        return self.staging_candidate()

    def test_every_one_off_run_is_named_and_a_stale_one_is_removed_first(self):
        self.second()
        self.world.run_names.clear()
        self.world.docker_log.clear()
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        self.assertTrue(self.world.run_names)
        for svc, name in self.world.run_names:
            self.assertEqual(name, "polycarpic-staging-%s" % svc, "a one-off run without its name")
        runs = [c for c in r.runner.calls if c["argv"][:2] == ["docker", "compose"] and "run" in c["argv"]]
        for c in runs:
            name = c["argv"][c["argv"].index("--name") + 1]
            i = r.runner.calls.index(c)
            before = [x["argv"] for x in r.runner.calls[:i]]
            self.assertIn(["docker", "rm", "-f", name], before, "a stale %s is removed before its run" % name)

    def test_the_migrate_client_timeout_is_thirty_minutes_above_the_runners_ten_minute_lock_wait(self):
        self.second()
        r = self.deploy("staging")
        migrate = [c for c in r.runner.calls if c["argv"][:2] == ["docker", "compose"] and "run" in c["argv"] and c["argv"][-2:] == ["migrate", "migrate"]]
        self.assertEqual(len(migrate), 1, [c["argv"][-4:] for c in r.runner.calls if "run" in c["argv"]])
        self.assertEqual(migrate[0]["timeout"], 30 * 60)

    def test_a_hanging_migrate_is_removed_and_shown_gone_before_the_run_ends_and_is_migrate_timeout_with_q(self):
        x2 = self.second()
        self.world.run_hang = {("migrate", "")}
        r = self.deploy("staging")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused migrate-timeout"), r.err)
        self.assertIn(x2, self.state("staging", "quarantine") or "")
        argvs = r.runner.argvs()
        rm = [i for i, a in enumerate(argvs) if a[:3] == ["docker", "rm", "-f"] and a[3] == "polycarpic-staging-migrate"]
        ins = [i for i, a in enumerate(argvs) if a[:2] == ["docker", "inspect"] and a[2] == "polycarpic-staging-migrate"]
        self.assertTrue(rm and ins, "rm -f then inspect after the timeout")
        self.assertLess(max(rm[-1:]), max(ins[-1:]), "inspect after rm")
        self.assertEqual(self.alert_name("staging"), "migrate-timeout")

    def test_a_one_off_that_is_still_there_after_rm_is_oneoff_stuck_alert_q_exit_1_and_blocks_the_next_run(self):
        x2 = self.second()
        self.world.run_hang = {("migrate", "")}
        self.world.stuck_oneoff = {"polycarpic-staging-migrate"}
        r = self.deploy("staging")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused oneoff-stuck"), r.err)
        self.assertEqual(self.alert_name("staging"), "oneoff-stuck")
        self.assertIn(x2, self.state("staging", "quarantine") or "")
        self.world.run_hang = set()
        x3 = self.staging_candidate()
        mark = len(self.world.compose_log)
        r2 = self.deploy("staging")
        self.assertNotEqual(r2.rc, 0, "a later run refuses while the stuck container exists")
        self.assertEqual([c for c in r2.world.compose_log[mark:] if c["cmd"] == "up"], [])

    def test_the_prod_backup_lock_is_not_released_before_the_one_off_is_gone(self):
        # prod holds backup.lock from step 4 to the end: the removal and the inspect happen inside it
        from test_deploy_prod import ProdBase

        class P(ProdBase):
            def runTest(self):
                pass
        p = P()
        p.setUp()
        try:
            p.first_prod("v1.0.0")
            p.release_of("v1.1.0")
            p.world.run_hang = {("migrate", "")}
            import os
            import fcntl
            state = {}

            def probe(cmd, argv):
                if cmd == "ps" or cmd == "run":
                    fd = os.open(str(p.host.p("/run/polycarpic/backup.lock")), os.O_RDWR | os.O_CREAT, 0o600)
                    try:
                        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        state.setdefault("free_at", []).append((cmd, argv[-3:]))
                    except OSError:
                        pass
                    finally:
                        os.close(fd)
            p.world.on_compose = probe
            r = p.deploy("prod")
            self.assertEqual(last(r), "deploy: refused migrate-timeout", r.err)
            self.assertEqual(state.get("free_at", []), [], "backup.lock was free while a one-off could still be running")
        finally:
            p.tearDown()
