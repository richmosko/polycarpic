"""POLY-98 R12 "Dispatcher" lint, R1 hygiene, K1, K2: static checks over everything under infra/ops/."""
import ast
import unittest

from base import DISPATCH, OPS, need

SPAWN = {"run", "Popen", "call", "check_call", "check_output", "getoutput", "getstatusoutput"}


def sources():
    need(OPS)
    files = [p for p in OPS.rglob("*") if p.is_file() and (p.suffix == ".py" or p == DISPATCH)]
    if not files:
        raise AssertionError("infra/ops/ holds no Python files")
    return files


def stringish(node):
    if isinstance(node, (ast.JoinedStr, ast.BinOp)):
        return True
    if isinstance(node, ast.Constant):
        return isinstance(node.value, str)
    return isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ("format", "join", "split") and isinstance(node.func.value, ast.Constant)


class Lint(unittest.TestCase):
    def calls(self):
        for f in sources():
            for node in ast.walk(ast.parse(f.read_text(), str(f))):
                if isinstance(node, ast.Call):
                    yield f, node

    def test_no_shell_true_os_system_os_popen_or_string_argv(self):
        bad = []
        for f, node in self.calls():
            fn = node.func
            name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", "")
            base = getattr(getattr(fn, "value", None), "id", "")
            for kw in node.keywords:
                if kw.arg == "shell" and not (isinstance(kw.value, ast.Constant) and kw.value.value is False):
                    bad.append("%s:%d shell=" % (f, node.lineno))
            if base == "os" and name in ("system", "popen"):
                bad.append("%s:%d os.%s" % (f, node.lineno, name))
            if (base == "subprocess" and name in SPAWN) or (base == "ctx" and name in ("run", "run_inherit")):
                if node.args and stringish(node.args[0]):
                    bad.append("%s:%d string argv" % (f, node.lineno))
        self.assertEqual(bad, [])

    def test_every_argument_parser_disables_abbreviations(self):  # K2
        seen = 0
        for f, node in self.calls():
            if (getattr(node.func, "attr", "") or getattr(node.func, "id", "")) == "ArgumentParser":
                seen += 1
                self.assertTrue(any(k.arg == "allow_abbrev" and isinstance(k.value, ast.Constant) and k.value.value is False for k in node.keywords), "%s:%d" % (f, node.lineno))
        self.assertGreater(seen, 0, "no ArgumentParser found under infra/ops/")

    def test_dispatcher_shebang_bytecode_core_limit_and_real_path(self):  # R1, K1, A2
        need(DISPATCH)
        text = DISPATCH.read_text()
        self.assertEqual(text.splitlines()[0], "#!/usr/bin/python3 -IS")
        for needle in ("dont_write_bytecode", "RLIMIT_CORE", "realpath"):
            self.assertIn(needle, text)

    def test_no_module_runs_a_call_at_import_time(self):
        for f in sources():
            for node in ast.parse(f.read_text(), str(f)).body:
                if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and not isinstance(node.value.func, ast.Attribute):
                    self.fail("%s:%d runs %s at import" % (f, node.lineno, getattr(node.value.func, "id", "?")))

    def test_trusted_uid_is_never_set_or_derived_from_the_caller(self):  # K12(a)
        for f, node in self.calls():
            if (getattr(node.func, "attr", "") or getattr(node.func, "id", "")) == "Ctx":
                for k in node.keywords:
                    if k.arg == "trusted_uid":
                        self.assertTrue(isinstance(k.value, ast.Constant) and k.value.value == 0, "%s:%d" % (f, node.lineno))
        for f in sources():
            text = f.read_text()
            for needle in ("SUDO_UID", "SUDO_USER", "trusted-uid", "trusted_uid=os"):
                self.assertNotIn(needle, text, str(f))

    def test_names_are_matched_with_fullmatch(self):  # K12(e)
        for f in sources():
            for node in ast.walk(ast.parse(f.read_text(), str(f))):
                if isinstance(node, ast.Call) and getattr(node.func, "attr", "") in ("match", "search") and getattr(getattr(node.func, "value", None), "id", "") == "re":
                    if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str) and node.args[0].value.endswith("$") and "\\n" not in node.args[0].value:
                        self.fail("%s:%d re.%s with a $-anchored pattern; use fullmatch" % (f, node.lineno, node.func.attr))

    def test_no_test_hook_names_a_root_in_argv_or_the_environment(self):  # R1: root and fakes come from the constructor only
        for f in sources():
            text = f.read_text()
            for needle in ("POLYCARPIC_ROOT", "OPS_ROOT", "--root"):
                self.assertNotIn(needle, text, str(f))


if __name__ == "__main__":
    unittest.main()
