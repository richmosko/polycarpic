"""T13 (acceptance criterion 5, the runbook's inputs): the `premigration-set` line a prod deploy writes to deploy.log is the set `restore.sh --premigration --from-box` lists and
accepts. The grammar is restore's own (read from infra/backup/restore-lib.sh), not a copy; the 60-minute timing is POLY-116's."""
import hashlib
import re

from base import REPO
from test_deploy_prod import ProdBase


def restore_re(name):
    text = (REPO / "infra" / "backup" / "restore-lib.sh").read_text()
    return re.compile(re.search(r"^%s='([^']+)'" % name, text, re.M).group(1))


class T13(ProdBase):
    def test_the_logged_set_is_what_list_premigration_would_offer_restore(self):
        ts = "20261123T031500Z"
        files = {"dump-17-7711142272324444185-%s.age" % ts: b"age-encryption.org/v1\ndump", "globals-17-7711142272324444185-%s.age" % ts: b"age-encryption.org/v1\nglobals"}
        sha = {n: hashlib.sha256(b).hexdigest() for n, b in files.items()}
        d, g = sorted(files)
        # what `backup premigration` prints (POLY-99's own test pins this exact shape) and what `backup list-premigration` prints for the same set
        printed = "premigration-set %s %s=%s %s=%s" % (ts, d, sha[d], g, sha[g])
        listed = "%s %s %s %s %s uploaded" % (ts, d, sha[d], g, sha[g])
        self.first_prod()
        self.release_of("v1.1.0")
        self.world.premigration = (0, "docker output noise\n" + printed + "\n", "")
        r = self.deploy("prod")
        self.assertEqual(r.rc, 0, r.err)
        logged = [l for l in self.state("prod", "deploy.log").splitlines() if l.split()[1] == "premigration-set"]
        self.assertEqual(len(logged), 1)
        fields = logged[0].split(" ", 2)[2].split()
        self.assertEqual(len(fields), 3)
        got_ts, (n1, h1), (n2, h2) = fields[0], fields[1].split("="), fields[2].split("=")
        self.assertRegex(got_ts, restore_re("TS_RE"))
        for n in (n1, n2):
            self.assertRegex(n, restore_re("R2_PREM"))
        for h in (h1, h2):
            self.assertRegex(h, restore_re("SHA_RE"))
        self.assertEqual("%s %s %s %s %s uploaded" % (got_ts, n1, h1, n2, h2), listed)
        self.assertEqual((n1.split("-")[0], n2.split("-")[0]), ("dump", "globals"))
        self.assertTrue(n1.endswith(got_ts + ".age") and n2.endswith(got_ts + ".age"), "the set's time is the one in both names")

    def test_a_line_restore_would_refuse_is_never_logged_as_a_set(self):
        ts = "20261123T031500Z"
        bad = "premigration-set %s ../../etc/passwd=%s dump-17-1-%s.age=%s" % (ts, "a" * 64, ts, "b" * 64)
        self.first_prod()
        self.release_of("v1.1.0")
        self.world.premigration = (0, bad + "\n", "")
        r = self.deploy("prod")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused premigration-malformed"))
        self.assertNotIn("premigration-set", self.log_events("prod")[-5:])


from backup_base import BackupBase, TS, nm  # noqa: E402
from base import Runner  # noqa: E402
from test_backup import published  # noqa: E402


class T13Chain(ProdBase, BackupBase):
    """The real chain, minus ssh and the scratch restore (those are POLY-99's restore tests on this same grammar): POLY-99's real `backup premigration` makes the set and prints its line,
    POLY-99's real `backup list-premigration` lists it (what `restore.sh --from-box` reads over ssh), a prod deploy takes that same premigration backup and logs the line, and the
    logged set equals the listed one, field for field. Both ends are real code; nothing here builds the expected line by hand."""

    def test_the_set_a_deploy_logs_is_the_set_list_premigration_offers(self):
        # 1. the real backup (before any release exists, so it runs from the installed bundle's compose file as POLY-99's tests do): the fake container makes the two files and prints its published line; backup.py hashes, records and prints premigration-set
        names = [nm("dump", TS), nm("globals", TS)]

        def on_run(argv):
            for n in names:
                self.spool("premigration", n)
            return (0, published("premigration", *names, ts=TS), "")
        res = self.host.go("backup", "premigration", runner=self.runner(on_run=on_run))
        self.assertEqual(res.rc, 0, res.err)
        printed = res.out.rstrip("\n").split("\n")[-1]
        self.assertRegex(printed, r"^premigration-set \d{8}T\d{6}Z ")
        # 2. what restore.sh reads: the real list-premigration
        lst = self.host.go("backup", "list-premigration", runner=Runner(None))
        self.assertEqual(lst.rc, 0, lst.err)
        listed = [l for l in lst.out.splitlines() if l.strip()]
        self.assertEqual(len(listed), 1, lst.out)
        # 3. a prod deploy whose backup step prints exactly that line
        self.first_prod()
        self.release_of("v1.1.0")
        self.world.premigration = (0, res.out, "")
        r = self.deploy("prod")
        self.assertEqual(r.rc, 0, r.err)
        logged = [l for l in self.state("prod", "deploy.log").splitlines() if l.split()[1] == "premigration-set"]
        self.assertEqual(len(logged), 1)
        # 4. the same set, field for field, and every field is valid for restore
        fields = logged[0].split(" ", 2)[2].split()
        ts, (n1, h1), (n2, h2) = fields[0], fields[1].split("="), fields[2].split("=")
        f1, f2, f3, f4, f5, f6 = listed[0].split(" ")
        self.assertEqual((ts, n1, h1, n2, h2), (f1, f2, f3, f4, f5))
        self.assertIn(f6, ("uploaded", "pending"))
        for rx, v in (("TS_RE", ts), ("R2_PREM", n1), ("R2_PREM", n2), ("SHA_RE", h1), ("SHA_RE", h2)):
            self.assertRegex(v, restore_re(rx))
