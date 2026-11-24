"""POLY-100 S33's F4 half (ruling 121609fe): `backup`, `upload` and `cli` (and `restart`'s compose calls) take their compose file from the project's saved judged render, never from a bundle's
compose file. With a `current` and no saved render they refuse; they never fall back to `releases/prod-current` or the ops bundle's compose file (the mutant that falls back is the point)."""
import os

from base import Runner
from test_deploy_prod import ProdBase

STATE = "/var/lib/polycarpic/state/deploy"


def last(r):
    return r.err.splitlines()[-1] if r.err.strip() else ""


class NoRender(ProdBase):
    def deployed_without_a_render(self):
        self.first_prod("v1.0.0")
        d = self.host.p("%s/prod" % STATE)
        for n in os.listdir(str(d)):
            if n.startswith("render-"):
                os.unlink(str(d / n))

    def recording_runner(self):
        r = Runner(None)
        r.on(lambda a: True, out="")
        return r

    def compose_files(self, r):
        files = []
        for c in r.runner.calls:
            a = c["argv"]
            if a[:2] == ["docker", "compose"] or "compose" in a[:4]:
                files += [a[i + 1] for i, t in enumerate(a) if t == "-f"]
        return files

    def test_backup_upload_and_cli_refuse_with_a_current_and_no_render_and_never_name_a_bundle_compose_file(self):
        self.deployed_without_a_render()
        for label, args in (("backup nightly", ("backup", "nightly")), ("backup premigration", ("backup", "premigration")), ("upload", ("upload",)),
                            ("cli", ("cli", "user", "invite", "ops@example.com"))):
            r = self.host.go(*args, runner=self.recording_runner(), ctx_extra={"owner_of": self.world.owner_of})
            files = self.compose_files(r)
            for f in files:
                self.assertRegex(f, r"/state/deploy/prod/render-[0-9a-f]{12}\.json$", "%s falls back to a bundle's compose file: %r" % (label, f))
            self.assertNotEqual(r.rc, 0, "%s: %s%s" % (label, r.out, r.err))
            self.assertNotIn("/opt/polycarpic/ops/", " ".join(" ".join(c["argv"]) for c in r.runner.calls), label)
            self.assertNotIn("/releases/", " ".join(" ".join(c["argv"]) for c in r.runner.calls), label)

    def test_with_no_current_and_no_render_the_installed_bundle_is_still_what_backup_uses(self):
        # before any release exists (the --existing-data case), backup renders the ops bundle's prod.yml: the only fallback there is
        r = self.host.go("backup", "list-premigration", runner=self.recording_runner())
        self.assertEqual([f for f in self.compose_files(r) if "/state/deploy/" in f], [])
