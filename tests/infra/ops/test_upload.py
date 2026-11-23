"""POLY-99 R5, N1, A5, T15: `polycarpic-ops upload` (root, in-process, fake ctx). The uploader container is faked (it is not the unit under
test here; the runner is). The T15 red-on-fault cases run a mutant COPY of commands/upload.py."""
import datetime as dt
import fcntl
import os
import stat
import unittest

from backup_base import COMPOSE, FIXED_ENV, HB, IMAGES_ENV, INSTANCE, M, NOW, PG_REF, SPOOL, STATE, SYS, TOOLS_REF, TS, BackupBase, iso, nm, sha, wal


class Upload(BackupBase):
    def verified(self, d, name, digest=None):
        digest = digest if digest is not None else sha(self.data[(d, name)])
        return "verified %s %s %s\n" % (d, name, digest)

    def go(self, out, code=0, mutant=None, **kw):
        r = self.runner(on_run=lambda argv: (code, out, ""), **kw)
        res = self.host.go("upload", runner=r, dispatcher=mutant)
        return res, r

    def nightly(self, ts=TS):
        names = [nm(k, ts) for k in ("base", "dump", "globals")]
        for n in names:
            self.spool("dump", n)
        self.write_record([(sha(self.data[("dump", n)]), "dump/" + n) for n in names])
        return names

    # ---- inputs and the call ----
    def test_missing_or_malformed_images_env_exits_3_and_runs_nothing(self):
        for label, body in (("missing", None), ("no tools line", "POLY_POSTGRES_IMAGE=postgres@sha256:%s\n" % ("ab" * 32)),
                            ("a tag not a digest", "POLY_TOOLS_IMAGE=tools:latest\nPOLY_POSTGRES_IMAGE=postgres@sha256:%s\n" % ("ab" * 32)),
                            ("a space in the ref", "POLY_TOOLS_IMAGE=%s extra\nPOLY_POSTGRES_IMAGE=postgres@sha256:%s\n" % (TOOLS_REF, "ab" * 32))):
            with self.subTest(label):
                p = self.host.p(IMAGES_ENV)
                if body is None:
                    os.unlink(str(p))
                else:
                    self.host.write(IMAGES_ENV, body)
                res, r = self.go("")
                self.assertEqual((res.rc, res.err), (3, "upload: /opt/polycarpic/images.env missing or malformed\n"))
                self.assertEqual([a for a in r.argvs() if "run" in a], [])
                self.host.write(IMAGES_ENV, "POLY_TOOLS_IMAGE=%s\nPOLY_POSTGRES_IMAGE=%s\n" % (TOOLS_REF, PG_REF))

    def test_the_uploader_service_is_run_with_the_ruled_argv_and_env(self):
        res, r = self.go("")
        self.assertEqual(res.rc, 0, res.err)
        run = ["docker", "compose", "-p", "polycarpic-prod", "-f", COMPOSE, "--profile", "uploader", "run", "--rm", "--no-deps", "-T", "--name",
               "polycarpic-prod-uploader", "uploader", "/usr/local/bin/upload.sh"]
        calls = [c for c in r.calls if c["argv"] == run]
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["env"], dict(FIXED_ENV, POLY_TOOLS_IMAGE=TOOLS_REF, POLY_POSTGRES_IMAGE=PG_REF))
        self.assertIn(["docker", "rm", "-f", "polycarpic-prod-uploader"], r.argvs())

    def test_a_busy_upload_lock_exits_0_at_once_without_running_anything(self):
        lock = self.host.write("/run/polycarpic/upload.lock", "")
        fd = os.open(str(lock), os.O_RDWR)
        self.addCleanup(os.close, fd)
        fcntl.flock(fd, fcntl.LOCK_EX)
        res, r = self.go("")
        self.assertEqual((res.rc, res.sleeps), (0, []))
        self.assertEqual([a for a in r.argvs() if "run" in a], [])

    # ---- T15: root deletes only what it verified ----
    def test_a_verified_wal_or_dump_file_is_deleted_after_root_recomputes_the_same_sha256(self):
        self.spool("wal", wal("000000010000000000000042"))
        names = self.nightly()
        out = self.verified("wal", wal("000000010000000000000042")) + "".join(self.verified("dump", n) for n in names)
        res, _ = self.go(out)
        self.assertEqual(res.rc, 0, res.err)
        self.assertEqual((self.listing("wal"), self.listing("dump")), ([], []))

    def test_a_wrong_sha_keeps_the_file_fails_the_run_prints_the_reason_and_pings_fail(self):
        n = wal("000000010000000000000042")
        self.spool("wal", n)
        res, r = self.go(self.verified("wal", n, "0" * 64))
        self.assertEqual(res.rc, 1)
        self.assertEqual(self.listing("wal"), [n])
        self.assertIn(n, res.out + res.err)
        self.assertEqual(self.ping_urls(res), [HB + "/fail"])

    def test_a_dump_file_that_differs_from_the_spool_record_is_kept_even_when_the_uploader_hash_matches_the_file(self):
        names = self.nightly()
        self.spool("dump", names[1], b"swapped after the backup finished")  # the uploader hashes what is there and reports it
        res, _ = self.go("".join(self.verified("dump", n) for n in names))
        self.assertEqual(res.rc, 1)
        self.assertIn(names[1], self.listing("dump"))
        self.assertEqual(self.ping_urls(res), [HB + "/fail"])
        self.assertNotIn("last-upload", os.listdir(str(self.host.p(STATE))))

    def test_RED_ON_THE_FAULT_a_mutant_runner_without_the_comparison_deletes_on_a_wrong_sha_and_a_swapped_dump(self):
        """pin 22: the root-side comparison is ONE `if` line carrying the comment `# T15`; the mutant turns its condition into False."""
        import re
        mutant = self.mutant_dispatcher("commands/upload.py", re.compile(r"^(\s*)if .*:\s*# T15\s*$", re.M), r"\1if False:  # T15")
        n = wal("000000010000000000000042")
        self.spool("wal", n)
        res, _ = self.go(self.verified("wal", n, "0" * 64), mutant=mutant)
        self.assertEqual(self.listing("wal"), [])  # the fault: a file whose reported sha is wrong is deleted
        names = self.nightly()
        self.spool("dump", names[1], b"swapped after the backup finished")
        res, _ = self.go("".join(self.verified("dump", x) for x in names), mutant=mutant)
        self.assertNotIn(names[1], self.listing("dump"))  # the swapped dump is deleted too

    # ---- N1 ----
    def test_a_verified_line_is_accepted_only_for_a_known_dir_and_a_name_that_matches_R2_for_it(self):
        good = wal("000000010000000000000042")
        self.spool("wal", good)
        self.spool("dump", nm("dump"))
        bad = {
            "unknown dir": "verified etc passwd %s\n" % ("0" * 64),
            "dot-dot dir": "verified ../etc hosts %s\n" % ("0" * 64),
            "dot-dot name": "verified wal ../../etc/hostname %s\n" % ("0" * 64),
            "name with a slash": "verified wal x/%s %s\n" % (good, "0" * 64),
            "dump name in wal/": "verified wal %s %s\n" % (nm("dump"), "0" * 64),
            "short sha": "verified wal %s abc\n" % good,
            "uppercase sha": "verified wal %s %s\n" % (good, "A" * 64),
        }
        for label, line in bad.items():
            with self.subTest(label):
                res, r = self.go(line)
                self.assertEqual(res.rc, 1)
                self.assertEqual((self.listing("wal"), self.listing("dump")), ([good], [nm("dump")]))
                self.assertEqual(self.ping_urls(res), [HB + "/fail"])

    def test_a_symlink_or_a_directory_named_in_a_verified_line_is_refused_without_following_it(self):
        for kind in ("symlink", "directory"):
            with self.subTest(kind):
                n = wal("000000010000000000000042")
                p = self.host.p("%s/wal/%s" % (SPOOL, n))
                if p.is_symlink() or p.exists():
                    os.unlink(str(p)) if not p.is_dir() or p.is_symlink() else os.rmdir(str(p))
                outside = self.host.write("/etc/outside", "keep me\n")
                os.symlink(str(outside), str(p)) if kind == "symlink" else os.mkdir(str(p))
                res, _ = self.go(self.verified_raw(n, sha(b"keep me\n")))
                self.assertEqual(res.rc, 1)
                self.assertTrue(outside.exists())
                self.assertTrue(os.path.lexists(str(p)))
                os.unlink(str(p)) if kind == "symlink" else os.rmdir(str(p))

    def verified_raw(self, name, digest):
        return "verified wal %s %s\n" % (name, digest)

    def test_one_failing_line_touches_nothing_not_even_the_good_lines_around_it(self):
        a, b = wal("000000010000000000000042"), wal("000000010000000000000043")
        self.spool("wal", a)
        self.spool("wal", b)
        out = self.verified("wal", a) + "verified etc passwd %s\n" % ("0" * 64) + self.verified("wal", b)
        res, _ = self.go(out)
        self.assertEqual(res.rc, 1)
        self.assertEqual(self.listing("wal"), [a, b])

    def test_A5_output_over_1_MiB_or_a_line_over_4_KiB_is_a_fault_and_nothing_is_touched(self):
        n = wal("000000010000000000000042")
        self.spool("wal", n)
        for label, out in (("a long line", "verified wal %s %s%s\n" % (n, sha(self.data[("wal", n)]), "x" * 5000)),
                           ("too much output", self.verified("wal", n) + ("verified wal %s %s\n" % (n, sha(self.data[("wal", n)]))) * 20000)):
            with self.subTest(label):
                res, _ = self.go(out)
                self.assertEqual(res.rc, 1)
                self.assertEqual(self.listing("wal"), [n])

    def test_a_line_that_is_not_verified_is_a_fault_the_run_exits_1_and_pings_fail(self):
        res, _ = self.go("hello from the uploader\n")
        self.assertEqual(res.rc, 1)
        self.assertEqual(self.ping_urls(res), [HB + "/fail"])

    # ---- premigration marker and prune ----
    def test_a_verified_premigration_file_gets_a_root_0644_sha256_sibling_and_stays(self):
        d, g = nm("dump"), nm("globals")
        for n in (d, g):
            self.spool("premigration", n)
        self.write_record([(sha(self.data[("premigration", n)]), "premigration/" + n) for n in (d, g)])
        res, _ = self.go("".join(self.verified("premigration", n) for n in (d, g)))
        self.assertEqual(res.rc, 0, res.err)
        self.assertEqual(self.listing("premigration"), sorted([d, g, d + ".sha256", g + ".sha256"]))
        sib = self.spool_path("premigration", d + ".sha256")
        self.assertEqual(sib.read_text(), "%s  %s\n" % (sha(self.data[("premigration", d)]), d))
        st = os.stat(str(sib))
        self.assertEqual((st.st_uid, stat.S_IMODE(st.st_mode)), (os.getuid(), 0o644))

    def test_a_premigration_set_older_than_7_days_with_siblings_is_deleted_with_them_a_newer_or_un_uploaded_one_is_not(self):
        old = (NOW - dt.timedelta(days=8)).strftime("%Y%m%dT%H%M%SZ")
        new = (NOW - dt.timedelta(days=6)).strftime("%Y%m%dT%H%M%SZ")
        gone = (NOW - dt.timedelta(days=9)).strftime("%Y%m%dT%H%M%SZ")
        entries = []
        for ts, uploaded in ((old, True), (new, True), (gone, False)):
            for k in ("dump", "globals"):
                n = nm(k, ts)
                self.spool("premigration", n)
                entries.append((sha(self.data[("premigration", n)]), "premigration/" + n))
                if uploaded:
                    self.spool("premigration", n + ".sha256", b"x\n")
        self.write_record(entries)
        res, _ = self.go("")
        self.assertEqual(res.rc, 0, res.err)
        left = self.listing("premigration")
        self.assertFalse([n for n in left if old in n], left)
        self.assertEqual(sorted(n for n in left if new in n), sorted([nm("dump", new), nm("globals", new), nm("dump", new) + ".sha256", nm("globals", new) + ".sha256"]))
        self.assertEqual(sorted(n for n in left if gone in n), sorted([nm("dump", gone), nm("globals", gone)]))  # never before its upload
        rec = self.record_lines()
        self.assertFalse([l for l in rec if old in l], rec)  # the record drops lines for files that are gone
        self.assertTrue([l for l in rec if new in l])

    # ---- the set-complete rule, last-upload and the heartbeat ----
    def test_a_complete_nightly_set_rewrites_last_upload_and_pings_the_heartbeat_once(self):
        names = self.nightly()
        res, r = self.go("".join(self.verified("dump", n) for n in names))
        self.assertEqual(res.rc, 0, res.err)
        text = self.state("last-upload")
        self.assertEqual(text.split("\n")[:-1], [iso(NOW)] + ["%s/%s/dump/%s" % (INSTANCE, M, n) for n in names])
        st = os.stat(str(self.host.p(STATE + "/last-upload")))
        self.assertEqual((st.st_uid, stat.S_IMODE(st.st_mode)), (os.getuid(), 0o644))
        self.assertEqual(self.ping_urls(res), [HB])
        self.assert_ping_hygiene(res)
        self.assertEqual([n for n in os.listdir(str(self.host.p(STATE))) if "tmp" in n], [])

    def test_a_wal_only_run_neither_writes_last_upload_nor_pings(self):
        n = wal("000000010000000000000042")
        self.spool("wal", n)
        res, _ = self.go(self.verified("wal", n))
        self.assertEqual(res.rc, 0, res.err)
        self.assertIsNone(self.state("last-upload"))
        self.assertEqual(self.ping_urls(res), [])

    def test_globals_confirmed_but_a_dump_of_the_same_set_still_in_the_spool_is_not_a_complete_set(self):
        names = self.nightly()
        res, _ = self.go(self.verified("dump", names[2]))  # only the globals file was verified this run
        self.assertIsNone(self.state("last-upload"))
        self.assertEqual(self.ping_urls(res), [])

    def test_last_upload_is_left_as_it_was_when_the_set_is_not_complete(self):
        self.host.write("%s/last-upload" % STATE, "2026-11-21T02:20:00Z\nold\n", 0o644)
        names = self.nightly()
        self.go(self.verified("dump", names[2]))
        self.assertEqual(self.state("last-upload"), "2026-11-21T02:20:00Z\nold\n")

    def test_a_refused_uploader_exit_1_or_2_pings_fail_and_exits_1_and_a_failed_ping_does_not_change_that(self):
        for code in (1, 2, 3):
            with self.subTest(code):
                res, _ = self.go("", code=code)
                self.assertEqual(res.rc, 1)
                self.assertEqual(self.ping_urls(res), [HB + "/fail"])
        res, _ = self.go("", code=1, curl_code=22)
        self.assertEqual(res.rc, 1)
        names = self.nightly()
        res, _ = self.go("".join(self.verified("dump", n) for n in names), curl_code=22)
        self.assertEqual(res.rc, 0)  # a failed success ping does not turn a complete upload into a failure

    def test_the_heartbeat_url_never_reaches_argv_env_or_the_terminal_on_any_path(self):
        names = self.nightly()
        for out, code in (("".join(self.verified("dump", n) for n in names), 0), ("", 1)):
            res, _ = self.go(out, code=code)
            self.assert_ping_hygiene(res)
            blob = res.out + res.err + res.term.getvalue()
            self.assertNotIn(HB.split("/")[-1], blob)  # stdin to curl carries it by design; no output, argv or env does

    def test_RED_ON_THE_FAULT_N1_a_mutant_that_joins_the_path_without_the_checks_deletes_a_host_file(self):
        """pin 39: the dir and name validation of a `verified` line is ONE `if` line ending in the comment `# N1`."""
        import re
        mutant = self.mutant_dispatcher("commands/upload.py", re.compile(r"^(\s*)if .*:\s*# N1\s*$", re.M), r"\1if False:  # N1")
        victim = self.host.write("/etc/polycarpic/ops.conf", "B2_BUCKET=polycarpic-hetzner-backups\n")
        res, _ = self.go("verified wal ../../../../etc/polycarpic/ops.conf %s\n" % sha(victim.read_bytes()), mutant=mutant)
        self.assertFalse(victim.exists())  # the fault: the uploader steered root's unlink out of the spool
        victim = self.host.write("/etc/polycarpic/ops.conf", "B2_BUCKET=polycarpic-hetzner-backups\n")
        res, _ = self.go("verified wal ../../../../etc/polycarpic/ops.conf %s\n" % sha(victim.read_bytes()))
        self.assertTrue(victim.exists())
        self.assertEqual(res.rc, 1)


if __name__ == "__main__":
    unittest.main()
