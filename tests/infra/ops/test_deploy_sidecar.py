"""POLY-100 G5 (ruling.md section G, 822a05a9): the render is judged and passes the fixed point IN MEMORY (stdin); only then is it saved, beside `render-<12 hex>.sha256`; `backup`, `upload`, `cli`,
`up` and `run` compare the file with its hash before use, a miss is `state`. A failed re-judge of `current` leaves the old file and hash. Written from the ruling, red on the build it was written against."""
import hashlib
import os
import re

from base import Runner
from test_deploy_prod import ProdBase

STATE = "/var/lib/polycarpic/state/deploy"


def last(r):
    return r.err.splitlines()[-1] if r.err.strip() else ""


class Sidecar(ProdBase):
    def pair(self, project="prod"):
        d = self.host.p("%s/%s" % (STATE, project))
        names = sorted(os.listdir(str(d)))
        js = [n for n in names if re.fullmatch(r"render-[0-9a-f]{12}\.json", n)]
        return d, js

    def runner(self):
        r = Runner(None)
        r.on(lambda a: True, out="")
        return r

    def test_every_saved_render_has_a_sha256_sidecar_with_the_hash_of_its_bytes(self):
        self.first_prod()
        d, js = self.pair()
        self.assertTrue(js)
        for j in js:
            side = d / (j[:-len(".json")] + ".sha256")
            self.assertTrue(side.exists(), "no sidecar beside %s" % j)
            self.assertRegex(side.read_text(), r"^" + hashlib.sha256((d / j).read_bytes()).hexdigest())
            self.assertEqual(oct(os.stat(str(side)).st_mode & 0o777), "0o600")

    def test_a_render_that_fails_the_fixed_point_is_never_saved(self):
        """Saved only after the in-memory fixed point: a failed re-render leaves no file and no hash for that digest."""
        self.first_prod()
        d, before = self.pair()
        x2 = self.release_of("v1.1.0")
        self.world.rerender_hook = lambda doc: doc["services"]["web"].update(privileged=True) or doc
        r = self.deploy("prod")
        self.assertNotEqual(r.rc, 0)
        d, after = self.pair()
        self.assertEqual(after, before, "a failed fixed point saved a file")
        self.assertEqual(sorted(n for n in os.listdir(str(d)) if n.endswith(".sha256")), sorted(j[:-5] + ".sha256" for j in before))

    def test_a_failed_rejudge_of_current_leaves_its_old_file_and_hash(self):
        x1, _ = self.first_prod()
        d, js = self.pair()
        saved = {n: (d / n).read_bytes() for n in os.listdir(str(d)) if n.startswith("render-")}
        self.release_of("v1.1.0")
        del self.world.containers["polycarpic-prod"]["postgres"]  # current's Postgres must be started from a fresh judgement of current's bundle
        self.world.rerender_hook = lambda doc: doc["services"]["web"].update(privileged=True) or doc
        self.deploy("prod")
        for n, b in saved.items():
            self.assertEqual((d / n).read_bytes(), b, "%s was rewritten by a failed re-judge" % n)

    def test_each_reader_refuses_a_render_whose_bytes_are_not_the_hash(self):
        self.first_prod()
        d, js = self.pair()
        with open(str(d / js[0]), "ab") as fh:
            fh.write(b" ")
        for args in (("backup", "nightly"), ("backup", "premigration"), ("upload",), ("cli", "user", "invite", "ops@example.com")):
            r = self.host.go(*args, runner=self.runner(), ctx_extra={"owner_of": self.world.owner_of})
            self.assertNotEqual(r.rc, 0, "%s used a render that is not its hash: %s" % (args, r.out))
            self.assertEqual([c for c in r.runner.calls if "compose" in c["argv"][:3] and "-f" in c["argv"]], [], "%s called compose with it" % (args,))

    def test_each_reader_refuses_a_render_with_no_sidecar_existence_alone_is_not_a_check(self):
        self.first_prod()
        d, js = self.pair()
        os.unlink(str(d / (js[0][:-5] + ".sha256")))
        for args in (("backup", "nightly"), ("upload",), ("cli", "user", "invite", "ops@example.com")):
            r = self.host.go(*args, runner=self.runner(), ctx_extra={"owner_of": self.world.owner_of})
            self.assertNotEqual(r.rc, 0, "%s: %s" % (args, r.out))
            self.assertEqual([c for c in r.runner.calls if "compose" in c["argv"][:3] and "-f" in c["argv"]], [], "%s called compose without a hash" % (args,))
