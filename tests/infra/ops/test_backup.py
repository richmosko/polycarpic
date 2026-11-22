"""POLY-99 R5, R6, N1, C4, C10: `polycarpic-ops backup nightly|premigration|list-premigration|fetch-premigration` (root, in-process, fake ctx)."""
import fcntl
import os
import stat
import unittest

from backup_base import COMPOSE, FIXED_ENV, HB, INSTANCE, M, NOW, PG_REF, SPOOL, STATE, SYS, TS, BackupBase, iso, nm, sha


def published(d, *names, ts=TS):
    return "published %s %s %s %s\n" % (d, ts, SYS, " ".join(names))


class Backup(BackupBase):
    def container(self, d, kinds, out=None, code=0, ts=TS, skip=()):
        """the fake container: makes the files, prints the published line (R1)"""
        names = [nm(k, ts) for k in kinds]

        def on_run(argv):
            for n in names:
                if n not in skip:
                    self.spool(d, n)
            return (code, out if out is not None else published(d, *names, ts=ts), "")
        return on_run, names

    def run_nightly(self, mode="nightly", **kw):
        d = "dump" if mode == "nightly" else "premigration"
        kinds = ["base", "dump", "globals"] if mode == "nightly" else ["dump", "globals"]
        on_run, names = self.container(d, kinds, **{k: kw.pop(k) for k in list(kw) if k in ("out", "code", "ts", "skip")})
        r = self.runner(on_run=on_run, **kw)
        return self.host.go("backup", mode, runner=r), names, r

    # ---- the container call (R5) ----
    def test_nightly_runs_exactly_the_ruled_docker_calls_in_order_with_the_ruled_env_and_timeout(self):
        res, names, r = self.run_nightly()
        self.assertEqual(res.rc, 0, res.err)
        argvs = r.argvs()
        rm = ["docker", "rm", "-f", "polycarpic-prod-backup"]
        run = ["docker", "compose", "-p", "polycarpic-prod", "-f", COMPOSE, "--profile", "backup", "run", "--rm", "--no-deps", "-T", "--name",
               "polycarpic-prod-backup", "backup", "/usr/local/bin/backup.sh", "nightly"]
        self.assertIn(rm, argvs)
        self.assertIn(run, argvs)
        self.assertLess(argvs.index(rm), argvs.index(run))
        call = [c for c in r.calls if c["argv"] == run][0]
        self.assertEqual(call["env"], dict(FIXED_ENV, POLY_POSTGRES_IMAGE=PG_REF))
        self.assertEqual(call["timeout"], 3 * 3600)

    def test_premigration_uses_the_premigration_mode_and_a_30_minute_timeout(self):
        res, names, r = self.run_nightly("premigration")
        self.assertEqual(res.rc, 0, res.err)
        call = [c for c in r.calls if c["argv"][-2:] == ["/usr/local/bin/backup.sh", "premigration"]]
        self.assertEqual(len(call), 1)
        self.assertEqual(call[0]["timeout"], 30 * 60)

    def test_no_running_postgres_exits_3_runs_no_container_and_writes_no_window(self):
        res, _, r = self.run_nightly(project_running=False)
        self.assertEqual((res.rc, res.err), (3, "backup: prod postgres is not running\n"))
        self.assertEqual([a for a in r.argvs() if "run" in a], [])
        self.assertEqual(self.jobs(), [])

    # ---- the windows (R5, R9): root writes them, after the container is gone ----
    def test_ok_appends_one_window_line_root_owned_0644_with_t0_before_t1(self):
        res, _, _ = self.run_nightly()
        lines = self.jobs()
        self.assertEqual(len(lines), 1)
        t0, t1, job, outcome = lines[0].split(" ")
        self.assertEqual((job, outcome), ("backup-nightly", "ok"))
        self.assertLessEqual(t0, t1)
        self.assertRegex(t0, r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        st = os.stat(str(self.host.p(STATE + "/jobs.log")))
        self.assertEqual((st.st_uid, stat.S_IMODE(st.st_mode)), (os.getuid(), 0o644))

    def test_a_failed_container_is_a_failed_window_a_fail_ping_exit_1_and_no_uploader_start(self):
        res, _, r = self.run_nightly(code=1, out="")
        self.assertEqual(res.rc, 1)
        self.assertEqual(self.jobs()[0].split(" ")[2:], ["backup-nightly", "failed"])
        self.assertEqual(self.ping_urls(res), [HB + "/fail"])
        self.assert_ping_hygiene(res)
        self.assertEqual(r.with_tokens("systemctl", "start"), [])
        self.assertEqual(self.record_lines(), [])

    def test_a_timeout_removes_the_named_container_first_and_only_then_writes_the_window(self):
        seen = {}
        on_rm = lambda argv: seen.__setitem__("jobs_at_rm", self.state("jobs.log")) if "run" in seen else None

        def on_run(argv):
            seen["run"] = True
            raise TimeoutError("docker")
        r = self.runner(on_run=on_run, on_rm=on_rm)
        res = self.host.go("backup", "nightly", runner=r)
        self.assertEqual(res.rc, 1)
        rms = [a for a in r.argvs() if a == ["docker", "rm", "-f", "polycarpic-prod-backup"]]
        self.assertEqual(len(rms), 2)  # the stale-container rm, then the one after the timeout
        self.assertIn(seen.get("jobs_at_rm"), (None, ""))  # the window is not written while the container may still run
        self.assertEqual(self.jobs()[0].split(" ")[2:], ["backup-nightly", "failed"])
        self.assertEqual(self.ping_urls(res), [HB + "/fail"])

    # ---- the lock ----
    def test_a_held_lock_is_waited_for_30_minutes_of_fake_time_then_exit_4_and_nothing_runs(self):
        lock = self.host.write("/run/polycarpic/backup.lock", "")
        fd = os.open(str(lock), os.O_RDWR)
        self.addCleanup(os.close, fd)
        fcntl.flock(fd, fcntl.LOCK_EX)
        res, _, r = self.run_nightly()
        self.assertEqual((res.rc, res.err), (4, "backup: the backup lock was not got in 30 minutes\n"))
        self.assertGreaterEqual(sum(res.sleeps), 1800)
        self.assertLess(sum(res.sleeps), 1800 + 120)
        self.assertEqual([a for a in r.argvs() if "run" in a], [])
        self.assertEqual(self.jobs(), [])

    def test_the_lock_is_free_after_a_run(self):
        res, _, _ = self.run_nightly()
        self.assertEqual(res.rc, 0, res.err)
        fd = os.open(str(self.host.p("/run/polycarpic/backup.lock")), os.O_RDWR)
        self.addCleanup(os.close, fd)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)

    # ---- the spool record (C4, R5) ----
    def test_on_success_root_records_its_own_sha256_of_each_published_file_in_a_root_0644_file(self):
        res, names, _ = self.run_nightly()
        self.assertEqual(res.rc, 0, res.err)
        want = sorted("%s dump/%s" % (sha(self.data[("dump", n)]), n) for n in names)
        self.assertEqual(sorted(self.record_lines()), want)
        st = os.stat(str(self.host.p(STATE + "/spool.sha256")))
        self.assertEqual((st.st_uid, stat.S_IMODE(st.st_mode)), (os.getuid(), 0o644))

    def test_a_named_file_that_is_missing_fails_the_run_and_records_nothing(self):
        res, _, r = self.run_nightly(skip=(nm("globals"),))
        self.assertEqual(res.rc, 1)
        self.assertEqual(self.record_lines(), [])
        self.assertEqual(self.jobs()[0].split(" ")[2:], ["backup-nightly", "failed"])
        self.assertEqual(self.ping_urls(res), [HB + "/fail"])
        self.assertEqual(r.with_tokens("systemctl", "start"), [])

    def test_success_starts_the_uploader_without_blocking_after_the_window_is_written(self):
        order = []

        def on_start(argv, stdin):
            order.append(("start", self.state("jobs.log")))
            return (0, "", "")
        on_run, _ = self.container("dump", ["base", "dump", "globals"])
        r = self.runner(on_run=on_run, extra=[(("systemctl",), dict(fn=on_start))])
        res = self.host.go("backup", "nightly", runner=r)
        self.assertEqual(res.rc, 0, res.err)
        self.assertEqual(r.with_tokens("systemctl", "start", "--no-block", "polycarpic-uploader.service") and 1, 1)
        self.assertIn("backup-nightly ok", order[0][1])
        self.assertEqual(self.ping_urls(res), [])  # the heartbeat is the upload run's, after a complete set

    # ---- N1 on the published line ----
    def test_a_published_line_is_accepted_only_for_a_known_dir_and_an_R2_name_that_is_a_regular_file(self):
        bad = {
            "dir wal": ("wal", [nm("dump")]),
            "dir with a dot-dot": ("../etc", [nm("dump")]),
            "an absolute dir": ("/spool/dump", [nm("dump")]),
            "base in premigration": ("premigration", [nm("base")]),
            "a name with a slash": ("dump", ["../" + nm("dump")]),
            "a name outside R2": ("dump", ["dump-17-%s-%s.sql" % (SYS, TS)]),
            "an 8-digit major": ("dump", ["dump-12345678-%s-%s.age" % (SYS, TS)]),
        }
        for label, (d, names) in bad.items():
            with self.subTest(label):
                self.setUp_clean()
                on_run = lambda argv: (0, published(d, *names), "")
                self.spool("dump", nm("dump"))
                res = self.host.go("backup", "nightly", runner=self.runner(on_run=on_run))
                self.assertEqual(res.rc, 1)
                self.assertEqual(self.record_lines(), [])
                self.assertEqual(self.jobs()[-1].split(" ")[2:], ["backup-nightly", "failed"])
                self.assertEqual(self.ping_urls(res), [HB + "/fail"])

    def test_a_named_symlink_or_a_directory_is_refused_and_never_hashed(self):
        for kind in ("symlink", "directory"):
            with self.subTest(kind):
                self.setUp_clean()
                target = self.host.write("/etc/secret-target", "do not hash me\n")
                p = self.host.p("%s/dump/%s" % (SPOOL, nm("dump")))
                os.symlink(str(target), str(p)) if kind == "symlink" else os.mkdir(str(p))
                res = self.host.go("backup", "nightly", runner=self.runner(on_run=lambda a: (0, published("dump", nm("dump")), "")))
                self.assertEqual(res.rc, 1)
                self.assertEqual(self.record_lines(), [])
                self.assertEqual(self.ping_urls(res), [HB + "/fail"])

    def test_stdout_text_other_than_the_one_published_line_is_not_trusted(self):
        on_run, names = self.container("dump", ["base", "dump", "globals"], out="noise\n" + published("dump", *[nm(k) for k in ("base", "dump", "globals")]))
        res = self.host.go("backup", "nightly", runner=self.runner(on_run=on_run))
        self.assertEqual(res.rc, 1)
        self.assertEqual(self.record_lines(), [])

    def setUp_clean(self):
        for d in ("dump", "premigration"):
            for n in self.listing(d):
                p = self.host.p("%s/%s/%s" % (SPOOL, d, n))
                os.rmdir(str(p)) if p.is_dir() and not p.is_symlink() else os.unlink(str(p))
        for n in ("jobs.log", "spool.sha256"):
            p = self.host.p("%s/%s" % (STATE, n))
            if p.exists():
                os.unlink(str(p))

    # ---- R6: the premigration contract ----
    def test_premigration_success_prints_the_ruled_last_line_with_a_sha256_per_file_and_records_them(self):
        res, names, r = self.run_nightly("premigration")
        self.assertEqual(res.rc, 0, res.err)
        d, g = nm("dump"), nm("globals")
        want = "premigration-set %s %s=%s %s=%s" % (TS, d, sha(self.data[("premigration", d)]), g, sha(self.data[("premigration", g)]))
        self.assertEqual(res.out.rstrip("\n").split("\n")[-1], want)
        self.assertEqual(sorted(self.record_lines()), sorted("%s premigration/%s" % (sha(self.data[("premigration", n)]), n) for n in (d, g)))
        self.assertEqual(self.jobs()[0].split(" ")[2:], ["backup-premigration", "ok"])
        self.assertEqual(len(r.with_tokens("systemctl", "start", "--no-block", "polycarpic-uploader.service")), 1)

    def test_premigration_failure_exits_1_and_prints_no_premigration_set_line(self):
        res, _, _ = self.run_nightly("premigration", code=1, out="")
        self.assertEqual(res.rc, 1)
        self.assertNotIn("premigration-set", res.out)

    def test_premigration_waits_for_a_nightly_run_for_up_to_30_minutes_then_exits_4(self):
        lock = self.host.write("/run/polycarpic/backup.lock", "")
        fd = os.open(str(lock), os.O_RDWR)
        self.addCleanup(os.close, fd)
        fcntl.flock(fd, fcntl.LOCK_EX)
        res, _, _ = self.run_nightly("premigration")
        self.assertEqual(res.rc, 4)

    def test_premigration_with_no_running_postgres_exits_3(self):
        res, _, _ = self.run_nightly("premigration", project_running=False)
        self.assertEqual(res.rc, 3)

    # ---- list-premigration (R6, C5, C10) ----
    def plant_set(self, ts, uploaded=False, record=True, only=None):
        d, g = nm("dump", ts), nm("globals", ts)
        entries = []
        for n in (d, g):
            if only and n != only:
                continue
            self.spool("premigration", n)
            entries.append((sha(self.data[("premigration", n)]), "premigration/" + n))
            if uploaded:
                self.spool("premigration", n + ".sha256", b"x\n")
        return entries

    def test_list_prints_one_line_per_complete_set_oldest_first_with_root_record_hashes_and_the_upload_state(self):
        e1 = self.plant_set("20261120T021500Z", uploaded=True)
        e2 = self.plant_set("20261122T021500Z")
        self.write_record(e1 + e2)
        res = self.host.go("backup", "list-premigration", runner=self.runner())
        self.assertEqual(res.rc, 0, res.err)
        d1, g1, d2, g2 = nm("dump", "20261120T021500Z"), nm("globals", "20261120T021500Z"), nm("dump"), nm("globals")
        self.assertEqual(res.out.split("\n")[:-1], [
            "20261120T021500Z %s %s %s %s uploaded" % (d1, e1[0][0], g1, e1[1][0]),
            "%s %s %s %s %s pending" % (TS, d2, e2[0][0], g2, e2[1][0]),
        ])

    def test_an_incomplete_set_is_not_listed_and_a_name_outside_R2_prints_a_stray_line_with_a_count(self):
        e = self.plant_set(TS, only=nm("dump"))
        self.spool("premigration", "not-a-backup.txt")
        self.write_record(e)
        res = self.host.go("backup", "list-premigration", runner=self.runner())
        self.assertEqual(res.rc, 0, res.err)
        self.assertEqual(res.out.split("\n")[:-1], ["stray 1"])

    def test_list_refuses_a_spool_record_that_is_not_root_owned_0644(self):
        e = self.plant_set(TS)
        self.write_record(e)
        for mode in (0o664, 0o646, 0o666):  # group or other write (a non-root owner is proven against real root in the container suite)
            os.chmod(str(self.host.p(STATE + "/spool.sha256")), mode)
            res = self.host.go("backup", "list-premigration", runner=self.runner())
            self.assertEqual((res.rc, res.out, res.err), (1, "", "backup: spool.sha256 is not root-owned 0644\n"), oct(mode))
        os.chmod(str(self.host.p(STATE + "/spool.sha256")), 0o644)
        self.assertEqual(self.host.go("backup", "list-premigration", runner=self.runner()).rc, 0)  # the positive twin

    def test_list_with_no_record_for_a_file_leaves_that_set_out(self):
        self.plant_set(TS)
        self.write_record([])
        res = self.host.go("backup", "list-premigration", runner=self.runner())
        self.assertEqual((res.rc, res.out), (0, ""))

    # ---- fetch-premigration (R6, C4) ----
    def fetch(self, name, **kw):
        return self.host.go("backup", "fetch-premigration", name, runner=self.runner(), **kw)

    def test_fetch_writes_the_files_bytes_to_stdout_after_checking_them_against_the_record(self):
        e = self.plant_set(TS)
        self.write_record(e)
        res = self.fetch(nm("dump"))
        self.assertEqual(res.rc, 0, res.err)
        self.assertEqual(res.stdout_bytes.getvalue(), self.data[("premigration", nm("dump"))])

    def test_fetch_refuses_with_nothing_written_on_a_hash_mismatch_a_missing_record_a_bad_name_a_symlink_and_a_non_regular_file(self):
        e = self.plant_set(TS)
        n = nm("dump")
        cases = {}
        # mismatch: the file changed after the record
        self.write_record(e)
        self.host.write("%s/premigration/%s" % (SPOOL, n), b"tampered", 0o644)
        cases["hash mismatch"] = (self.fetch(n), 1, "backup: %s does not match the spool record\n" % n)
        # missing record line
        self.write_record([])
        cases["missing record"] = (self.fetch(n), 1, "backup: no spool record for %s\n" % n)
        self.write_record(e)
        for label, bad in (("a slash", "../" + n), ("not R2", "dump.sql"), ("a base file", nm("base")), ("empty", ""), ("a dot-dot", "..")):
            cases["bad name: " + label] = (self.fetch(bad), 2, "backup: bad name\n")
        target = self.host.write("/etc/target", "x")
        link = nm("globals")
        os.unlink(str(self.host.p("%s/premigration/%s" % (SPOOL, link))))
        os.symlink(str(target), str(self.host.p("%s/premigration/%s" % (SPOOL, link))))
        cases["symlink"] = (self.fetch(link), 1, "backup: %s is not a regular file\n" % link)
        os.unlink(str(self.host.p("%s/premigration/%s" % (SPOOL, link))))
        os.mkdir(str(self.host.p("%s/premigration/%s" % (SPOOL, link))))
        cases["directory"] = (self.fetch(link), 1, "backup: %s is not a regular file\n" % link)
        for label, (res, rc, err) in cases.items():
            with self.subTest(label):
                self.assertEqual((res.rc, res.err, res.stdout_bytes.getvalue(), res.out), (rc, err, b"", ""))


if __name__ == "__main__":
    unittest.main()
