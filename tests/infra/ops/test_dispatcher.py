"""POLY-98 R1, R12 "Dispatcher", K1, K2, A2: preconditions, exit codes, help from the modules, hygiene."""
import ast
import os
import resource
import shutil
import sys
import unittest
from unittest import mock

from base import DISPATCH, FIXED_ENV, ID, OPS, OpsTest, Runner, load_dispatcher, need, stack

CMDS = OPS / "commands"


def modules():
    need(CMDS)
    return sorted(p.stem for p in CMDS.glob("*.py") if p.stem.isidentifier() and not p.stem.startswith("_"))


def help_of(stem):
    for node in ast.parse((CMDS / (stem + ".py")).read_text()).body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "HELP":
            return ast.literal_eval(node.value)
    raise AssertionError("commands/%s.py has no HELP constant" % stem)


class Dispatcher(OpsTest):
    def test_not_root_exits_4_with_the_run_with_sudo_message(self):
        r = self.host.go("help", euid=1000)
        self.assertEqual((r.rc, r.err, r.out), (4, "polycarpic-ops: run with sudo\n", ""))

    def test_root_help_is_allowed(self):
        self.assertEqual(self.host.go("help").rc, 0)

    def test_group_writable_file_in_the_install_exits_4_naming_it(self):
        f = self.host.id_dir / "infra" / "compose" / "prod.yml"
        os.chmod(str(f), 0o664)
        r = self.host.go("help")
        self.assertEqual((r.rc, r.err), (4, "polycarpic-ops: install is not root-owned: %s\n" % f))

    def test_group_writable_id_directory_reached_only_through_current_exits_4_naming_the_real_path(self):
        os.chmod(str(self.host.id_dir), 0o775)  # K1: the walk follows `current`
        r = self.host.go("help")
        self.assertEqual((r.rc, r.err), (4, "polycarpic-ops: install is not root-owned: %s\n" % self.host.id_dir))

    def test_world_writable_parent_directory_exits_4_naming_it(self):
        os.chmod(str(self.host.p("/opt/polycarpic")), 0o757)
        r = self.host.go("help")
        self.assertEqual((r.rc, r.err), (4, "polycarpic-ops: install is not root-owned: %s\n" % self.host.p("/opt/polycarpic")))

    def test_a_file_not_owned_by_root_exits_4(self):
        r = self.host.go("help", trusted=os.getuid() + 1)
        self.assertEqual(r.rc, 4)
        self.assertTrue(r.err.startswith("polycarpic-ops: install is not root-owned: "), r.err)

    def test_unknown_subcommand_exits_2_and_lists_the_subcommands(self):
        r = self.host.go("frobnicate")
        mods = [m.replace("_", "-") for m in modules()]
        self.assertTrue(mods, "infra/ops/commands/ has no modules")
        self.assertEqual((r.rc, r.out, r.err), (2, "", "polycarpic-ops: unknown subcommand: frobnicate; available: %s\n" % ", ".join(sorted(mods))))

    def test_no_arguments_prints_usage_on_stderr_exit_2(self):
        r = self.host.go()
        self.assertEqual((r.rc, r.out), (2, ""))
        self.assertTrue(r.err.startswith("usage: polycarpic-ops "), r.err)

    def test_version_prints_the_install_id_exit_0(self):
        r = self.host.go("--version")
        self.assertEqual((r.rc, r.out, r.err), (0, "polycarpic-ops %s\n" % ID, ""))

    def test_help_lists_exactly_the_modules_present_with_their_one_line_help(self):
        r = self.host.go("help")
        self.assertEqual(r.rc, 0, r.err)
        got = {}
        for line in r.out.splitlines():
            parts = line.split(None, 1)
            if len(parts) == 2:
                got[parts[0]] = parts[1].strip()
        want = {m.replace("_", "-"): help_of(m) for m in modules()}
        self.assertTrue(want)
        self.assertEqual(got, want)

    def test_the_ten_subcommands_exist(self):
        self.assertEqual(sorted(modules()), sorted(["set_secret", "list_secrets", "status", "gate_check", "provision", "provision_check", "restart", "cli", "backup", "upload"]))  # POLY-99 adds backup and upload

    def _copy_tree(self):
        need(OPS)
        dst = self.tmp / "copy" / "infra" / "ops"
        shutil.copytree(str(OPS), str(dst), ignore=shutil.ignore_patterns("__pycache__"))
        return dst

    def test_planted_module_names_that_break_the_pattern_are_ignored_a_valid_one_is_listed(self):
        dst = self._copy_tree()
        body = 'HELP = "planted"\ndef add_arguments(parser):\n    pass\ndef run(args, ctx):\n    ctx.stdout.write("ran\\n")\n    return 0\n'
        for bad in ("evil-name.py", "Evil.py", ".hidden.py", "9x.py", "x.pyc", "x.py.bak"):
            (dst / "commands" / bad).write_text(body)
        (dst / "commands" / "good_one.py").write_text(body)
        d = load_dispatcher(dst / "polycarpic-ops")
        r = self.host.go("help", dispatcher=d)
        names = [l.split()[0] for l in r.out.splitlines() if l.split()]
        self.assertIn("good-one", names)
        for bad in ("evil-name", "Evil", ".hidden", "9x", "x", "x.pyc"):
            self.assertNotIn(bad, names)
        self.assertEqual(self.host.go("good-one", dispatcher=d).out, "ran\n")  # positive twin: a valid planted module runs
        for bad in ("evil-name", "Evil", "evil_name"):
            self.assertEqual(self.host.go(bad, dispatcher=d).rc, 2, bad)

    def test_names_with_a_trailing_newline_are_ignored(self):  # K12(e): fullmatch, not match with $
        dst = self._copy_tree()
        body = 'HELP = "planted"\ndef add_arguments(parser):\n    pass\ndef run(args, ctx):\n    return 0\n'
        (dst / "commands" / "nl_cmd.py\n").write_text(body)
        (dst / "status" / "99_nl.py\n").write_text("def run(ctx):\n    return []\n")
        d = load_dispatcher(dst / "polycarpic-ops")
        names = [l.split()[0] for l in self.host.go("help", dispatcher=d).out.splitlines() if l.split()]
        self.assertNotIn("nl-cmd", names)
        self.assertNotIn("nl_cmd", names)
        self.assertEqual(self.host.go("nl-cmd", dispatcher=d).rc, 2)

    def test_the_production_context_ignores_sudo_uid_and_a_trusted_uid_flag(self):  # K12(b)
        from base import ctx_class
        import importlib
        ctx_class()
        production = importlib.import_module("lib.ctx").production
        with mock.patch.dict(os.environ, {"SUDO_UID": "1000", "SUDO_USER": "polyops"}), mock.patch.object(sys, "argv", ["polycarpic-ops", "--trusted-uid", "1000", "help"]):
            self.assertEqual(production().trusted_uid, 0)
        d = load_dispatcher()
        with mock.patch.dict(os.environ, {"SUDO_UID": "1000"}):
            try:
                rc = d.main(["--trusted-uid", "1000", "help"])
            except SystemExit as e:
                rc = e.code
        self.assertIn(rc, (2, 4))

    def test_invoked_through_a_symlink_it_loads_the_bundles_modules(self):  # K1
        need(DISPATCH)
        link = self.tmp / "sbin-link"
        os.symlink(str(DISPATCH), str(link))
        r = self.host.go("help", dispatcher=load_dispatcher(link))
        self.assertEqual(r.rc, 0, r.err)
        self.assertIn("set-secret", r.out)

    def test_bytecode_is_never_written_into_the_install(self):  # K1
        old = sys.dont_write_bytecode
        sys.dont_write_bytecode = False
        try:
            self.host.go("help")
            self.assertTrue(sys.dont_write_bytecode)
        finally:
            sys.dont_write_bytecode = old

    def test_umask_is_077_and_core_dumps_are_off_after_start(self):  # R1, A2
        soft, hard = resource.getrlimit(resource.RLIMIT_CORE)
        resource.setrlimit(resource.RLIMIT_CORE, (1 << 20 if hard == resource.RLIM_INFINITY else min(1 << 20, hard), hard))
        os.umask(0o022)
        try:
            self.host.go("help")
            self.assertEqual(resource.getrlimit(resource.RLIMIT_CORE)[0], 0)
            self.assertEqual(os.umask(0o077), 0o077)
        finally:
            resource.setrlimit(resource.RLIMIT_CORE, (soft, hard))

    def test_abbreviated_long_options_are_refused(self):  # K2
        for argv in (["set-secret", "--stag", "resend_api_key"], ["list-secrets", "--stag"], ["restart", "--stag", "web"], ["gate-check", "--stag"]):
            r = self.host.go(*argv)
            self.assertEqual(r.rc, 2, argv)
            self.assertEqual(r.runner.calls, [])

    def test_children_get_an_environment_built_from_nothing_even_with_a_poisoned_parent(self):
        poison = {"PATH": "/tmp/evil", "PYTHONPATH": "/tmp/evil", "LD_PRELOAD": "/tmp/evil.so", "DOCKER_HOST": "tcp://evil:1", "HOME": "/tmp/evilhome"}
        runner = Runner(None)
        stack(runner)
        runner.on(("gate-check.sh",), term="gate: pass\n")
        with mock.patch.dict(os.environ, poison):
            r = self.host.go("gate-check", runner=runner)
        self.assertEqual(r.rc, 0)
        self.assertTrue(runner.calls)
        for c in runner.calls:
            self.assertEqual(c["env"], FIXED_ENV, c["argv"])


if __name__ == "__main__":
    unittest.main()
