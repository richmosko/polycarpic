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
