"""POLY-100 G11 (ruling.md 3b62bbe6, seceng agreed): the caller's directory decides nothing. Compose reads `.env` of the caller's directory on stdin and turns profiles on from it (measured, v5.7.0). Three layers:
(1) every child of the tool runs with cwd `/` (the three runners of ctx); (2) every compose call the code builds names `--project-directory` (the render home for stdin, for a judged file and for calls with no file;
a bundle file's own directory for a render or the no-release fallback); (3) every such call names `--env-file`, `/dev/null` where none is ruled. The render home is empty root 0755 (S37); a `.env` in it is refused
(`render-path`). The real-Compose half (a hostile `.env` in the caller's directory changes neither values nor profiles; an unreadable starting directory) is tests/infra/render-cwd.test.ts and T-real.
Written from the ruling, red on the build it was written against."""
import os
import sys
import tempfile
import unittest

from base import OPS, Runner
from deploy_base import DeployTest
from test_deploy_prod import ProdBase
import test_deploy_flow as fl

HOME = "/var/lib/polycarpic/state/deploy/render-home"


def ctx_mod():
    if str(OPS) not in sys.path:
        sys.path.insert(0, str(OPS))
    from lib import ctx
    return ctx


class Layer1(unittest.TestCase):
    """Every child the tool starts runs with cwd `/`, whatever the caller's directory is."""

    def setUp(self):
        self.old = os.getcwd()
        self.tmp = tempfile.mkdtemp(prefix="poly100-cwd-")
        self.addCleanup(os.chdir, self.old)
        self.addCleanup(__import__("shutil").rmtree, self.tmp, True)
        os.chdir(self.tmp)

    PWD = [sys.executable, "-I", "-c", "import os, sys; sys.stdout.write(os.getcwd())"]

    def test_run_starts_the_child_in_the_root_directory(self):
        code, out, _ = ctx_mod()._real_run(self.PWD)
        self.assertEqual((code, out), (0, "/"))

    def test_run_bytes_starts_the_child_in_the_root_directory(self):
        res = ctx_mod()._real_run_bytes(self.PWD)
        out = res[1] if isinstance(res, tuple) else res
        self.assertEqual(bytes(out).decode(), "/")

    def test_run_inherit_starts_the_child_in_the_root_directory(self):
        marker = os.path.join(self.tmp, "cwd.out")
        argv = [sys.executable, "-I", "-c", "import os, sys; open(sys.argv[1], 'w').write(os.getcwd())", marker]
        ctx_mod()._real_run_inherit(argv)
        self.assertEqual(open(marker).read(), "/")


def project_dir(argv):
    return argv[argv.index("--project-directory") + 1] if "--project-directory" in argv else None


def env_files(argv):
    return [argv[i + 1] for i, a in enumerate(argv) if a == "--env-file"]


def compose_argvs(calls):
    out = []
    for a in calls:
        if a[:2] == ["docker", "compose"] and not ("version" in a and "--short" in a):
            out.append(a)
        elif "docker" in a and "compose" in a and a.index("docker") + 1 == a.index("compose"):  # unshare/setpriv ... docker compose ...
            out.append(a[a.index("docker"):])
    return out


class Layers23(DeployTest):
    new_commit = fl.Flow.new_commit
    staging_candidate = fl.Flow.staging_candidate
    hex_dir = fl.Flow.hex_dir
    first = fl.Flow.first
    ups = fl.Flow.ups
    since = fl.Flow.since
    mark = 0

    def setUp(self):
        super().setUp()
        import shutil
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        self.n = 0

    def test_every_compose_argv_of_a_deploy_names_a_project_directory_and_an_env_file(self):
        self.first()
        self.staging_candidate()
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        argvs = compose_argvs([c["argv_full"] for c in r.runner.calls])
        self.assertGreater(len(argvs), 8)
        for a in argvs:
            self.assertIn("--project-directory", a, "a compose call that lets the caller's directory decide: %r" % (a,))
            self.assertTrue(env_files(a), "a compose call without --env-file (/dev/null where none is ruled): %r" % (a,))

    def test_the_project_directory_is_the_render_home_for_stdin_a_judged_file_and_calls_with_no_file(self):
        self.first()
        self.staging_candidate()
        r = self.deploy("staging")
        home = str(self.host.p(HOME))
        for a in compose_argvs([c["argv_full"] for c in r.runner.calls]):
            f = [a[i + 1] for i, t in enumerate(a) if t == "-f"]
            if f == ["-"] or (f and f[0].endswith(".json")) or not f:
                self.assertEqual(project_dir(a), home, "the render home, not the caller's directory: %r" % (a,))
                if f and f[0].endswith(".json") or not f:
                    self.assertEqual(env_files(a), ["/dev/null"], "no env file is ruled here: /dev/null: %r" % (a,))
            else:  # a bundle file's render: the bundle file's own directory
                self.assertEqual(project_dir(a), os.path.dirname(f[0]), a)

    def test_a_dot_env_in_the_render_home_is_refused_as_render_path(self):
        self.first()
        self.staging_candidate()
        home = self.host.p(HOME)
        home.mkdir(parents=True, exist_ok=True)
        os.chmod(str(home), 0o755)
        (home / ".env").write_text("COMPOSE_PROFILES=migrate,operator\n")
        r = self.deploy("staging")
        self.assertEqual((r.rc, (r.err.strip().splitlines() or [""])[-1]), (1, "deploy: refused render-path"), r.err)

    def test_a_non_empty_render_home_is_refused_as_render_path(self):
        self.first()
        self.staging_candidate()
        home = self.host.p(HOME)
        home.mkdir(parents=True, exist_ok=True)
        os.chmod(str(home), 0o755)
        (home / "stray").write_text("x\n")
        r = self.deploy("staging")
        self.assertEqual((r.rc, (r.err.strip().splitlines() or [""])[-1]), (1, "deploy: refused render-path"), r.err)


class ReadersAndOthers(ProdBase):
    def recording(self):
        r = Runner(None)
        r.on(lambda a: True, out="")
        return r

    def test_backup_upload_cli_restart_and_status_name_both_options_on_every_compose_call(self):
        self.first_prod("v1.0.0")
        for args in (("backup", "nightly"), ("backup", "premigration"), ("upload",), ("cli", "user", "invite", "ops@example.com"), ("restart", "web"), ("status",)):
            r = self.host.go(*args, runner=self.recording(), ctx_extra={"owner_of": self.world.owner_of})
            for a in compose_argvs([c["argv_full"] for c in r.runner.calls]):
                self.assertIn("--project-directory", a, "%s: %r" % (args, a))
                self.assertTrue(env_files(a), "%s: %r" % (args, a))
