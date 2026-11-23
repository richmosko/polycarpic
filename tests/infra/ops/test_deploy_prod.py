"""POLY-100 G4: prod runs (R6 steps 2-4, R9 edge; T9, T12; S4, S11, S12, S15, A8). Setup goes through the tool's own `first-deploy`."""
import os
import re
import shutil

from deploy_base import DeployTest, digest, utc
from test_deploy_bundle import good_files, images_env_text, make_tar, sibling_digests

PROD = "polycarpic-prod"
GOOD_LINE = "premigration-set 20261123T000000Z dump-17-7711142272324444185-20261123T000000Z.age=%s globals-17-7711142272324444185-20261123T000000Z.age=%s" % ("a1" * 32, "b2" * 32)
CADDY_DIRS = ("/srv/polycarpic/caddy", "/srv/polycarpic/caddy-config")


class ProdBase(DeployTest):
    def setUp(self):
        super().setUp()
        self.staging_auth_file()
        w = self.world
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        self.good, pub = w.keygen("good")
        self.signers(pub)
        self.n = 0
        w.premigration = (0, GOOD_LINE + "\n", "")
        for d in CADDY_DIRS + ("/srv/polycarpic/pg-prod", "/srv/polycarpic/pg-staging"):
            self.host.mkdir(d)
        self.host.write("/etc/polycarpic/host.env", "PUBLIC_ORIGIN=https://app.example.com\nTLS_MODE=real-domain\n")

    def staging_auth_file(self, text=None, mode=0o440):
        """S29/S30: the file the Caddyfile imports as text. The check compares the group with 10010 itself; a unit test cannot own that group, so it patches the module's GID."""
        import sys
        from base import OPS
        if str(OPS) not in sys.path:
            sys.path.insert(0, str(OPS))
        from unittest import mock
        from lib import sauth
        d = self.host.mkdir("/etc/polycarpic/secrets/caddy", 0o750)
        self.host.write("/etc/polycarpic/secrets/caddy/staging_basic_auth", text if text is not None else "staging $2y$10$" + "a1B./" * 10 + "xyz" + "\n", mode)
        patcher = mock.patch.object(sauth, "GID", os.stat(str(d)).st_gid)
        patcher.start()
        self.addCleanup(patcher.stop)

    def release_of(self, version, sibs=None):
        """The next signed prod release: a new commit, an image X with its bundle, three siblings, a Release with the digest line."""
        w = self.world
        self.n += 1
        c = w.commit("p%d" % self.n)
        sibs = sibs or sibling_digests(version)
        x = digest("prod-" + version)
        w.image("polycarpic", x, c, bundle=make_tar(good_files(images_env_text(sibs))))
        w.attested.add((x, c))
        for name, d in sibs.items():
            w.image("polycarpic-" + name, d, c)
            w.attested.add((d, c))
        w.tag(version, c, key=self.good)
        w.releases.insert(0, {"tag_name": version, "draft": False, "prerelease": False, "body": "digest: " + x, "published_at": utc()})
        return x

    def staging_next(self, sibs=None, caddyfile=None):
        w = self.world
        self.n += 1
        c = w.commit("s%d" % self.n)
        sibs = sibs or sibling_digests("s%d" % self.n)
        x = digest("stg%d" % self.n)
        files = good_files(images_env_text(sibs))
        if caddyfile:
            files["infra/caddy/Caddyfile"] = caddyfile
        w.image("polycarpic", x, c, bundle=make_tar(files))
        w.attested.add((x, c))
        for name, d in sibs.items():
            w.image("polycarpic-" + name, d, c)
            w.attested.add((d, c))
        w.staging_run(c, x, run_id=str(2000 + self.n))
        return x

    def first_prod(self, version="v1.0.0", sibs=None, **kw):
        x = self.release_of(version, sibs)
        r = self.deploy("prod", cmd="first-deploy", **kw)
        return x, r

    def hex_dir(self, x):
        return str(self.host.p("/opt/polycarpic/releases/sha256-" + x.split(":")[1]))

    def caddy_images(self):
        return sorted(c["image"] for p, d in self.world.containers.items() for s, c in d.items() if s == "caddy")

    def calls_before_check_config(self, r):
        out = []
        for c in r.world.compose_log:
            if c["cmd"] == "run" and "check-config" in c["rest"]:
                break
            out.append(c)
        return out


class Prod(ProdBase):
    # ---- first deploy ----
    def test_first_deploy_prod_takes_no_backup_and_enables_the_three_timers(self):
        x, r = self.first_prod()
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(r.world.premigration_calls, [], "the project has never had a release: nothing to back up")
        self.assertEqual(self.state("prod", "current").split()[0], x)
        enabled = [a for a in r.world.systemctl_log if "enable" in a]
        for unit in ("polycarpic-deploy@prod.timer", "polycarpic-backup.timer", "polycarpic-uploader.timer"):
            self.assertTrue(any(unit in a for a in enabled), unit)
        self.assertTrue(self.host.p("/opt/polycarpic/images.env").exists())

    def test_a8_first_deploy_on_a_non_empty_data_dir_exits_4_unless_existing_data_which_makes_the_backup_required(self):
        self.host.write("/srv/polycarpic/pg-prod/PG_VERSION", "17\n")
        x = self.release_of("v1.0.0")
        r = self.deploy("prod", cmd="first-deploy")
        self.assertEqual(r.rc, 4, r.err)
        self.assertIn("existing-data", r.err.splitlines()[-1])
        self.assertEqual([c for c in r.world.compose_log if c["cmd"] in ("up", "run")], [])
        self.assertIsNone(self.state("prod", "current"))
        r2 = self.deploy("prod", "--existing-data", cmd="first-deploy")
        self.assertEqual(r2.rc, 0, r2.err)
        self.assertEqual(len(r2.world.premigration_calls), 1)

    def test_a_timer_run_with_no_current_exits_4_not_first_deployed(self):
        self.release_of("v1.0.0")
        r = self.deploy("prod")
        self.assertEqual(r.rc, 4, r.err)
        self.assertIn("not-first-deployed", r.err.splitlines()[-1])
        self.assertEqual([c for c in r.world.compose_log if c["cmd"] in ("up", "run")], [])

    # ---- T12: the backup comes first, from current's images ----
    def test_t12_premigration_precedes_every_compose_run_and_its_line_is_logged_verbatim(self):
        x1, _ = self.first_prod()
        x2 = self.release_of("v1.1.0")
        r = self.deploy("prod")
        self.assertEqual(r.rc, 0, r.err)
        calls = r.runner.calls
        i_backup = [i for i, c in enumerate(calls) if c["argv"][-2:] == ["backup", "premigration"]]
        self.assertEqual(len(i_backup), 1)
        runs = [i for i, c in enumerate(calls) if c["argv"][:2] == ["docker", "compose"] and "run" in c["argv"]]
        self.assertTrue(runs and i_backup[0] < runs[0], "premigration before the first compose run")
        self.assertTrue([l for l in self.state("prod", "deploy.log").splitlines() if l.endswith(GOOD_LINE) and l.split()[1] == "premigration-set"], "the line verbatim in deploy.log")
        self.assertIn("premigration-set", self.log_events("prod"))

    def test_t12_every_compose_call_before_check_config_names_currents_release_and_none_the_candidates(self):
        x1, _ = self.first_prod()
        x2 = self.release_of("v1.1.0")
        r = self.deploy("prod")
        cur, cand = self.hex_dir(x1), self.hex_dir(x2)
        before = [c for c in self.calls_before_check_config(r) if c["cmd"] in ("up", "run", "exec", "create", "start", "restart")]
        for c in before:
            joined = " ".join(c["argv"])
            self.assertIn(cur, joined, c["argv"])
            self.assertNotIn(cand, joined, c["argv"])
        # the candidate's tree is judged only by `config` renders until step 5
        self.assertTrue(any(c["cmd"] == "config" and cand in " ".join(c["argv"]) for c in r.world.compose_log))

    def test_t12_postgres_down_is_started_from_currents_bundle_and_refs(self):
        x1, _ = self.first_prod()
        x2 = self.release_of("v1.1.0")
        del self.world.containers[PROD]["postgres"]
        r = self.deploy("prod")
        ups = [c for c in self.calls_before_check_config(r) if c["cmd"] == "up"]
        self.assertEqual(len(ups), 1)
        a = ups[0]["argv"]
        self.assertIn("postgres", a)
        self.assertIn(self.hex_dir(x1), " ".join(a))
        self.assertNotIn(self.hex_dir(x2), " ".join(a))
        env_files = [a[i + 1] for a in [ups[0]["argv"]] for i, t in enumerate(a) if t == "--env-file"]
        self.assertEqual(env_files, [os.path.join(self.hex_dir(x1), "images.env")], "postgres comes up on current's refs, not the candidate's")

    def test_t12_a_failed_or_malformed_premigration_stops_before_check_config_and_migrate(self):
        self.first_prod()
        cases = [((1, "", "boom\n"), "premigration-1"), ((3, GOOD_LINE + "\n", ""), "premigration-3"), ((4, "", ""), "premigration-4"),
                 ((0, "", ""), "premigration-malformed"), ((0, "all done\n", ""), "premigration-malformed"),
                 ((0, GOOD_LINE.replace("20261123T000000Z dump", "2026-11-23 dump", 1) + "\n", ""), "premigration-malformed"),
                 ((0, GOOD_LINE[:-3] + "\n", ""), "premigration-malformed"),
                 ((0, GOOD_LINE.split(" globals")[0] + "\n", ""), "premigration-malformed"),
                 ((0, GOOD_LINE + " extra\n", ""), "premigration-malformed")]
        for result, name in cases:
            mark = len(self.world.compose_log)
            self.world.premigration = result
            x = self.release_of("v1.%d.0" % (self.n + 1))
            r = self.deploy("prod")
            self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused " + name), result)
            self.assertEqual(self.alert_name("prod"), name)
            self.assertEqual([c for c in r.world.compose_log[mark:] if c["cmd"] == "run" and ("check-config" in c["rest"] or "migrate" in c["rest"])], [], result)
            self.assertNotIn(x, self.state("prod", "quarantine") or "", "a backup failure is retried at the next poll, not quarantined")
            self.assertNotIn(GOOD_LINE, self.state("prod", "deploy.log") if result[0] else "")

    def test_t12_the_backup_lock_is_held_to_the_end_of_the_run(self):
        self.first_prod()
        self.release_of("v1.1.0")
        seen = []
        w = self.world

        def probe(cmd, argv):
            if cmd in ("run", "up"):
                import fcntl
                fd = os.open(str(self.host.p("/run/polycarpic/backup.lock")), os.O_RDWR | os.O_CREAT, 0o600)
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    seen.append((cmd, "free"))
                    fcntl.flock(fd, fcntl.LOCK_UN)
                except OSError:
                    seen.append((cmd, "held"))
                finally:
                    os.close(fd)
        w.on_compose = probe
        r = self.deploy("prod")
        self.assertEqual(r.rc, 0, r.err)
        after_check = seen[[i for i, (c, _) in enumerate(seen) if c == "run"][0]:]
        self.assertTrue(after_check)
        self.assertEqual(set(s for _, s in after_check), {"held"}, "no nightly can start during migrate or recreate")

    # ---- T9: the edge ----
    def test_t9_staging_never_touches_edge_once_prod_exists(self):
        self.first_prod()
        self.staging_next()
        r0 = self.deploy("staging", cmd="first-deploy")
        self.assertEqual(r0.rc, 0, r0.err)
        caddy_before = self.caddy_images()
        self.staging_next(caddyfile=b"# changed by a main merge\n:80 { respond 418 }\n")
        mark = len(self.world.compose_log)
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(self.caddy_images(), caddy_before)
        for c in r.world.compose_log[mark:]:
            self.assertNotIn("edge.yml", " ".join(c["argv"]), c["argv"])
            self.assertNotIn("caddy", [a for a in c["rest"] if not a.startswith("-")], c["argv"])
            self.assertNotIn("polycarpic-edge", " ".join(c["argv"]))
        self.assertFalse([s for s in r.world.stopped if "caddy" in s[2]])



class FirstAttempt(ProdBase):
    """S19 (ruling ad00423d): a first-deploy that stopped at roles-missing may be rerun with no flag, but only on an empty database."""

    DATA = "/srv/polycarpic/pg-prod"

    def setUp(self):
        super().setUp()

        def init_data(cmd, argv):  # starting Postgres initialises its data directory
            if cmd == "up" and "postgres" in argv:
                self.host.write(self.DATA + "/PG_VERSION", "17\n")
        self.world.on_compose = init_data
        self.release_of("v1.0.0")

    def roles_missing(self):
        self.world.plan_code, self.world.plan_out = 2, "refused (roles-missing): poly_migrator is not provisioned\n"
        r = self.deploy("prod", cmd="first-deploy")
        self.assertEqual(r.rc, 4, r.err)
        self.assertIn("run: sudo polycarpic-ops provision --stage database --project prod", r.err)
        self.assertIsNone(self.state("prod", "current"))
        self.assertIsNotNone(self.state("prod", "first-attempt"), "the attempt is recorded before Postgres starts")
        self.world.plan_code, self.world.plan_out = 3, ""
        return r

    def test_a_rerun_after_roles_missing_succeeds_with_no_flag_and_no_backup_on_an_empty_database(self):
        self.roles_missing()
        r = self.deploy("prod", cmd="first-deploy")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(self.world.premigration_calls, [])
        self.assertIsNone(self.state("prod", "first-attempt"), "removed when healthy")
        self.assertIsNotNone(self.state("prod", "current"))

    def test_the_same_rerun_with_the_first_attempt_file_gone_exits_4(self):
        self.roles_missing()
        os.unlink(str(self.sdir("prod") / "first-attempt"))
        r = self.deploy("prod", cmd="first-deploy")
        self.assertEqual(r.rc, 4, r.err)
        self.assertIn("existing-data", r.err.splitlines()[-1])
        self.assertEqual(self.world.premigration_calls, [])

    def test_a_rerun_with_one_user_table_requires_the_backup(self):
        self.roles_missing()
        self.world.psql_result = (0, "1\n", "")
        r = self.deploy("prod", cmd="first-deploy")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(len(self.world.premigration_calls), 1)

    def test_a_rerun_whose_table_read_fails_or_is_unparsable_requires_the_backup(self):
        for result in ((1, "", "psql: error\n"), (0, "", ""), (0, "ok\n", ""), (0, "0 tables\n", "")):
            self.world.premigration_calls.clear()
            shutil.rmtree(str(self.sdir("prod")), ignore_errors=True)
            self.world.containers.clear()
            self.host.write(self.DATA + "/PG_VERSION", "")
            os.unlink(str(self.host.p(self.DATA + "/PG_VERSION")))
            self.roles_missing()
            self.world.psql_result = result
            r = self.deploy("prod", cmd="first-deploy")
            self.assertEqual(len(self.world.premigration_calls), 1, result)

    def test_a_failing_backup_on_a_rerun_refuses_and_prints_the_provision_command(self):
        self.roles_missing()
        self.world.psql_result = (0, "2\n", "")
        self.world.premigration = (1, "", "no poly_backup\n")
        r = self.deploy("prod", cmd="first-deploy")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused premigration-1"))
        self.assertIn("run: sudo polycarpic-ops provision --stage database --project prod", r.err)

    def test_a_leftover_first_attempt_beside_current_has_no_effect_and_is_removed(self):
        r = self.deploy("prod", cmd="first-deploy")
        self.assertEqual(r.rc, 0, r.err)
        self.host.write("/var/lib/polycarpic/state/deploy/prod/first-attempt", utc() + "\n")
        self.release_of("v1.1.0")
        r = self.deploy("prod")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(len(self.world.premigration_calls), 1, "an ordinary deploy takes its backup whatever the file says")
        self.assertIsNone(self.state("prod", "first-attempt"))

    def test_the_file_is_not_written_when_the_data_directory_is_already_non_empty(self):
        self.host.write(self.DATA + "/PG_VERSION", "17\n")
        r = self.deploy("prod", cmd="first-deploy")
        self.assertEqual(r.rc, 4, r.err)
        self.assertIsNone(self.state("prod", "first-attempt"))

    def test_existing_data_on_a_non_empty_directory_never_writes_the_first_attempt_file(self):
        self.host.write(self.DATA + "/PG_VERSION", "17\n")
        self.world.plan_code = 1  # the run stops after Postgres is started, so only a file written up front would still be there
        r = self.deploy("prod", "--existing-data", cmd="first-deploy")
        self.assertEqual(r.rc, 1, r.err)
        self.assertEqual(len(self.world.premigration_calls), 1)
        self.assertIsNone(self.state("prod", "first-attempt"), "a non-empty directory is never this project's own earlier attempt")
