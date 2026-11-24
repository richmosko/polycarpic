"""POLY-100 T-sauth, deploy side (S29, S30): every path that ups Caddy or reads the staging basic-auth file refuses when the file is not exactly right, and passes when it is.
The ownership read is the ctx.owner_of seam (ruling c52458c8): the fake answers root:10010 unless world.owners says otherwise for a path."""
import os
import stat

from deploy_base import utc
from test_deploy_edge import EdgeBase

FILE = "/etc/polycarpic/secrets/caddy/staging_basic_auth"
DIR = "/etc/polycarpic/secrets/caddy"
GOOD = "staging $2y$10$" + "a1B./" * 10 + "xyz" + "\n"
ME = os.getuid()


def breakers(host):
    """(label, apply(world)) for every way the file or its directory can be wrong."""
    def chmod(path, mode):
        return lambda w: os.chmod(str(host.p(path)), mode)

    def text(t):
        def f(w):
            os.unlink(str(host.p(FILE)))
            host.write(FILE, t, 0o440)
        return f

    def link(w):
        os.unlink(str(host.p(FILE)))
        if host.p("/etc/polycarpic/secrets/caddy/other").exists():
            os.unlink(str(host.p("/etc/polycarpic/secrets/caddy/other")))
        host.write("/etc/polycarpic/secrets/caddy/other", GOOD, 0o440)
        os.symlink("other", str(host.p(FILE)))

    def gone(w):
        os.unlink(str(host.p(FILE)))
    return [
        ("file missing", gone),
        ("file group-writable", chmod(FILE, 0o460)),
        ("file world-readable", chmod(FILE, 0o444)),
        ("a symlink", link),
        ("a second line", text(GOOD + 'respond "x"\n')),
        ("two trailing newlines", text(GOOD + "\n")),
        ("crlf", text(GOOD[:-1] + "\r\n")),
        ("129 bytes", text("staging $2y$10$" + "a" * 114 + "\n")),
        ("the directory group-writable", chmod(DIR, 0o770)),
        ("the file owned by another uid", lambda w: w.owners.__setitem__(FILE, (ME + 1, 10010))),
        ("the file in another group", lambda w: w.owners.__setitem__(FILE, (ME, 4242))),
        ("the directory in another group", lambda w: w.owners.__setitem__(DIR, (ME, 4242))),
        ("the directory owned by another uid", lambda w: w.owners.__setitem__(DIR, (ME + 1, 10010))),
    ]


class Gate(EdgeBase):
    def setUp(self):
        super().setUp()
        self.broken = None

    # each path: a setup that leaves the world one command away from upping Caddy, then that command. A refused command changes nothing, so the
    # setup is made once and every broken file is tried against the same last call.
    def paths(self):
        def edge_deploy():
            self.edge_release(1)
            return lambda: self.edge("edge-1")

        def prod_deploy():
            self.first_prod("v1.0.0")
            self.release_of("v1.1.0")
            return lambda: self.deploy("prod")

        def rollback_edge():
            self.edge_release(1)
            self.assertEqual(self.edge("edge-1").rc, 0)
            self.edge_release(2)
            self.assertEqual(self.edge("edge-2").rc, 0)
            return lambda: self.deploy("edge", cmd="rollback")

        def rollback_prod():
            self.first_prod("v1.0.0")
            self.release_of("v1.1.0")
            self.assertEqual(self.deploy("prod").rc, 0)
            return lambda: self.deploy("prod", cmd="rollback")
        return [("prod deploy", prod_deploy), ("edge-deploy", edge_deploy), ("rollback prod", rollback_prod), ("rollback edge", rollback_edge)]

    def test_every_deploy_path_refuses_a_bad_file_and_ups_nothing(self):
        for name, setup in self.paths():
            self.reset_world()
            last = setup()
            for label, apply in breakers(self.host):
                apply(self.world)
                mark = len(self.world.compose_log)
                r = last()
                self.assertNotEqual(r.rc, 0, "%s with %s" % (name, label))
                self.assertEqual([c for c in r.world.compose_log[mark:] if c["cmd"] in ("up", "restart")], [], "%s with %s: nothing is upped" % (name, label))
                if not name.startswith("rollback"):  # a rollback that cannot restore says so; nothing is upped either way
                    blob = r.err + self.state_of(r)
                    self.assertIn("staging-auth", blob, "%s with %s" % (name, label))
                self.world.owners.clear()
                self.staging_auth_file()

    def test_a_good_file_passes_each_path(self):
        for name, setup in self.paths():
            self.reset_world()
            r = setup()()
            self.assertEqual(r.rc, 0, "%s: %s" % (name, r.err))

    def test_restart_caddy_refuses_a_bad_file(self):
        for label, apply in breakers(self.host):
            self.reset_world()
            self.first_prod("v1.0.0")
            apply(self.world)
            r = self.host.go("restart", "caddy", runner=self._runner_restart(), ctx_extra={"owner_of": self.world.owner_of})
            self.assertNotEqual(r.rc, 0, label)
            self.assertEqual([c for c in r.runner.calls if "restart" in c["argv"]], [], label)

    def test_restart_caddy_with_a_good_file_restarts_it(self):
        self.first_prod("v1.0.0")
        r = self.host.go("restart", "caddy", runner=self._runner_restart(), ctx_extra={"owner_of": self.world.owner_of})
        self.assertEqual(r.rc, 0, r.err)
        self.assertTrue([c for c in r.runner.calls if "restart" in c["argv"]])

    # ---- plumbing: run a scenario, breaking the file just before its last deploy-type call ----
    def _runner_restart(self):
        from base import Runner
        from deploy_base import World
        r = Runner(None)
        self.world.handler(r)
        self.world.runner = r
        return r

    def reset_world(self):
        import shutil
        for d in ("prod", "staging", "edge"):
            shutil.rmtree(str(self.sdir(d)), ignore_errors=True)
        shutil.rmtree(str(self.host.p("/opt/polycarpic/releases")), ignore_errors=True)
        shutil.rmtree(str(self.host.p("/var/lib/polycarpic/state/deploy/tags.git")), ignore_errors=True)
        w = self.world
        w.containers.clear(), w.by_name.clear(), w.compose_log.clear(), w.owners.clear(), w.registry.clear(), w.attested.clear(), w.releases.clear(), w.runs.clear()
        w.docker_log.clear(), w.pulled.clear()
        self.staging_auth_file()
        self.n = 0

    def count_calls(self, runner):
        self.reset_world()
        seen = []
        orig = self.deploy

        def counting(*a, **kw):
            seen.append(1)
            return orig(*a, **kw)
        self.deploy = counting
        try:
            r = runner()
        finally:
            self.deploy = orig
        self.assertEqual(r.rc, 0, r.err)
        return len(seen)

    def run_with_break(self, runner, n, apply):
        seen = []
        orig = self.deploy

        def breaking(*a, **kw):
            seen.append(1)
            if len(seen) == n:
                apply(self.world)
            self._mark = len(self.world.compose_log)
            return orig(*a, **kw)
        self.deploy = breaking
        try:
            return runner()
        finally:
            self.deploy = orig

    def ups_in(self, r):
        return [c for c in r.world.compose_log[self._mark:] if c["cmd"] in ("up", "restart") and c["project"] in ("polycarpic-edge",)] + \
               [c for c in r.world.compose_log[self._mark:] if c["cmd"] == "up" and "caddy" in c["rest"]]

    def state_of(self, r):
        out = ""
        for d in ("prod", "edge"):
            out += (self.state(d, "alert") or "") + (self.state(d, "deploy.log") or "")
        return out
