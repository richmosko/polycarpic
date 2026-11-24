"""POLY-100 F3 (ruling.md; seceng's two probes): releases are shared by digest, so one project's refusal or failure never deletes a directory another project's `current` or `previous` names,
and an existing directory is reused only when it is root-owned (F8's check) and its tree hash equals the incoming one: else `release-tree`, never rewritten."""
import os
import shutil

from base import REPO  # noqa: F401
from test_deploy_prod import ProdBase

SDIR = "/var/lib/polycarpic/state/deploy"


def last(r):
    return r.err.splitlines()[-1] if r.err.strip() else ""


class F3(ProdBase):
    def staging_runs_the_prods_digest(self):
        """staging's `current` is X; prod's release v1.0.0 is the same image X (the normal case: prod's digest is the one staging already runs)."""
        x = self.release_of("v1.0.0")
        c = self.world.git("rev-parse", "v1.0.0^{commit}")
        self.world.staging_run(c, x, run_id="3001")
        r = self.deploy("staging", cmd="first-deploy")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(self.state("staging", "current").split()[0], x)
        rdir = self.hex_dir(x)
        self.assertTrue(os.path.isdir(rdir))
        return x, rdir

    def snapshot(self, rdir):
        out = {}
        for base, dirs, files in os.walk(rdir):
            for n in files:
                p = os.path.join(base, n)
                out[os.path.relpath(p, rdir)] = open(p, "rb").read()
        return out

    def test_a_guard_refusal_of_prods_run_leaves_stagings_release_directory_alone(self):
        x, rdir = self.staging_runs_the_prods_digest()
        before = self.snapshot(rdir)
        self.world.render_hooks[("prod", None)] = lambda d: d["services"]["web"].update(privileged=True) or d
        r = self.deploy("prod", cmd="first-deploy")
        self.assertEqual(last(r), "deploy: refused guard-key", r.err)
        self.assertTrue(os.path.isdir(rdir), "staging's live release directory was deleted by prod's refusal")
        self.assertEqual(self.snapshot(rdir), before)
        self.assertEqual(self.state("staging", "current").split()[0], x)

    def test_a_sibling_pull_failing_in_prods_run_leaves_stagings_release_directory_alone(self):
        x, rdir = self.staging_runs_the_prods_digest()
        before = self.snapshot(rdir)
        sib = [k for k in self.world.registry if "polycarpic-caddy@" in k][0]
        del self.world.registry[sib]  # the pull of a sibling fails now
        r = self.deploy("prod", cmd="first-deploy")
        self.assertNotEqual(r.rc, 0, r.err)
        self.assertTrue(os.path.isdir(rdir), "staging's live release directory was deleted by a failed sibling pull")
        self.assertEqual(self.snapshot(rdir), before)

    def test_an_existing_directory_whose_tree_differs_is_release_tree_and_is_never_rewritten(self):
        x, rdir = self.staging_runs_the_prods_digest()
        victim = os.path.join(rdir, "infra", "compose", "staging.yml")
        os.chmod(victim, 0o644)
        with open(victim, "ab") as fh:
            fh.write(b"# tampered\n")
        before = self.snapshot(rdir)
        r = self.deploy("prod", cmd="first-deploy")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused release-tree"), r.err)
        self.assertEqual(self.alert_name("prod"), "release-tree")
        self.assertEqual((self.state("prod", "quarantine") or "").strip(), "", "no Q")
        self.assertEqual(self.snapshot(rdir), before, "never rewritten")

    def test_an_existing_directory_with_the_same_tree_is_reused_and_prods_first_deploy_succeeds(self):
        x, rdir = self.staging_runs_the_prods_digest()
        before = self.snapshot(rdir)
        r = self.deploy("prod", cmd="first-deploy")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(self.state("prod", "current").split()[0], x)
        self.assertEqual(self.snapshot(rdir)[os.path.join("infra", "compose", "staging.yml")], before[os.path.join("infra", "compose", "staging.yml")])

    def test_leftover_incoming_directories_are_removed_at_the_start_of_a_run(self):
        self.host.mkdir("/opt/polycarpic/releases/.incoming-deadbeef0000")
        self.host.write("/opt/polycarpic/releases/.incoming-deadbeef0000/x", "leftover")
        self.release_of("v1.0.0")
        self.deploy("prod", cmd="first-deploy")
        self.assertFalse(self.host.p("/opt/polycarpic/releases/.incoming-deadbeef0000").exists())

    def test_prune_removes_nothing_when_a_pointer_is_unreadable(self):
        import sys
        from base import OPS
        if str(OPS) not in sys.path:
            sys.path.insert(0, str(OPS))
        from lib import deployer
        from lib.ctx import Ctx
        for n in ("a", "b", "c"):
            self.host.mkdir("/opt/polycarpic/releases/sha256-" + n * 64)
        shutil.rmtree(str(self.sdir("prod")), ignore_errors=True)
        self.host.mkdir("%s/prod/current" % SDIR)  # present, and not a file: unreadable
        ctx = Ctx(root=str(self.host.root), trusted_uid=os.getuid())
        try:
            deployer._prune(ctx)
        except Exception:
            pass  # a refusal is fine; deleting is not
        left = sorted(os.listdir(str(self.host.p("/opt/polycarpic/releases"))))
        for n in ("a", "b", "c"):
            self.assertIn("sha256-" + n * 64, left, "an unreadable pointer counts as naming every release")
