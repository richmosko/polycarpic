"""POLY-100 G1 and S37 (ruling.md section G, 822a05a9), unit half: one helper makes every shared directory and sets its mode by `chmod`, never by `makedirs(mode=)` under a 077 umask:
`/opt/polycarpic`, `releases`, each release tree (dirs 0755, files 0644 or 0755), `state/deploy` and each project's, the render home: root, exactly 0755, repaired only when opened without following a
link and root-owned; a link or a non-directory in the way is `render-path` and is never repaired (S37). Before any render, every path the render names (bundle, images.env, env files) has every parent
`o+x` and the file `o+r`; a miss is `render-path` (alert, NO quarantine: a box fault must not ban a digest) and the next poll tries again. The Linux half (the dispatcher's own entry as root under
umask 077, real renders as uid 10020) is tests/infra/render-isolation.test.ts. Written from the ruling, red on the build it was written against."""
import os
import shutil
import stat

from deploy_base import DeployTest
import test_deploy_flow as fl

SHARED = ("/opt/polycarpic", "/opt/polycarpic/releases", "/var/lib/polycarpic/state/deploy", "/var/lib/polycarpic/state/deploy/staging", "/var/lib/polycarpic/state/deploy/render-home")


def last(r):
    return r.err.splitlines()[-1] if r.err.strip() else ""


def mode(path):
    return stat.S_IMODE(os.lstat(path).st_mode)


class Paths(DeployTest):
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

    def p(self, path):
        return str(self.host.p(path))

    def test_under_umask_077_every_shared_directory_and_release_tree_is_0755_and_0644_or_0755(self):
        old = os.umask(0o077)
        try:
            self.first()
            x2 = self.staging_candidate()
            r = self.deploy("staging")
        finally:
            os.umask(old)
        self.assertEqual(r.rc, 0, r.err)
        for d in SHARED:
            self.assertEqual(oct(mode(self.p(d))), "0o755", d)
        tree = self.p("/opt/polycarpic/releases")
        for name in os.listdir(tree):
            if not name.startswith("sha256-"):
                continue
            for base, dirs, files in os.walk(os.path.join(tree, name)):
                self.assertEqual(oct(mode(base)), "0o755", base)
                for f in files:
                    self.assertIn(oct(mode(os.path.join(base, f))), ("0o644", "0o755"), os.path.join(base, f))

    def test_each_directory_made_0700_beforehand_is_repaired_to_0755(self):
        self.first()
        for d in SHARED:
            self.setUp()
            self.first()
            os.chmod(self.p(d), 0o700)
            x = self.staging_candidate()
            r = self.deploy("staging")
            self.assertEqual(oct(mode(self.p(d))), "0o755", "%s was not repaired: %s" % (d, r.err))

    def test_a_symlink_or_a_file_in_place_of_a_shared_directory_is_render_path_and_nothing_is_repaired(self):
        for d in SHARED[1:]:  # /opt/polycarpic itself is the root of the harness's own releases
            self.setUp()
            self.first()
            real = self.p(d)
            parked = real + ".parked"
            os.rename(real, parked)
            elsewhere = self.p("/elsewhere-" + os.path.basename(d))
            os.mkdir(elsewhere, 0o700)
            os.symlink(elsewhere, real)
            self.staging_candidate()
            r = self.deploy("staging")
            self.assertEqual((r.rc, last(r)), (1, "deploy: refused render-path"), "%s as a link: %s" % (d, r.err))
            self.assertEqual(oct(mode(elsewhere)), "0o700", "%s: the link's target was repaired" % d)
            os.unlink(real)
            with open(real, "w") as fh:
                fh.write("not a directory")
            r = self.deploy("staging")
            self.assertEqual((r.rc, last(r)), (1, "deploy: refused render-path"), "%s as a file: %s" % (d, r.err))

    def test_a_0600_env_file_is_render_path_without_a_quarantine_and_the_next_poll_tries_again(self):
        self.first()
        x2 = self.staging_candidate()
        env = self.p("/etc/polycarpic/staging-host.env")
        os.chmod(env, 0o600)
        r = self.deploy("staging")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused render-path"), r.err)
        self.assertEqual(self.alert_name("staging"), "render-path")
        self.assertNotIn(x2, self.state("staging", "quarantine") or "", "a box fault must not ban a digest")
        os.chmod(env, 0o644)
        r2 = self.deploy("staging")
        self.assertEqual(r2.rc, 0, r2.err)
        self.assertEqual(self.state("staging", "current").split()[0], x2)

    def test_a_parent_directory_of_an_env_file_without_o_plus_x_is_render_path(self):
        self.first()
        x2 = self.staging_candidate()
        os.chmod(self.p("/etc/polycarpic"), 0o750)
        r = self.deploy("staging")
        os.chmod(self.p("/etc/polycarpic"), 0o755)
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused render-path"), r.err)
        self.assertNotIn(x2, self.state("staging", "quarantine") or "")
