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


def listish(node):
    """POLY-100: `["gh"] + argv` is list concatenation, not a string argv."""
    return isinstance(node, ast.List) or (isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add) and (listish(node.left) or listish(node.right)))


def stringish(node):
    if isinstance(node, ast.BinOp) and listish(node):
        return False
    if isinstance(node, (ast.JoinedStr, ast.BinOp)):
        return True
    if isinstance(node, ast.Constant):
        return isinstance(node.value, str)
    return isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ("format", "join", "split") and isinstance(node.func.value, ast.Constant)


class Lint(unittest.TestCase):
    def test_the_string_argv_rule_still_fires_on_string_building_and_not_on_list_concatenation(self):
        parse = lambda src: ast.parse(src, mode="eval").body
        for bad in ('"docker " + x', 'f"docker {x}"', '"a %s" % x', '"a" + x + "b"'):
            self.assertTrue(stringish(parse(bad)), bad)
        for ok in ('["gh"] + argv', 'base(r) + ["exec"]', '["a"] + b + ["c"]'):
            self.assertFalse(stringish(parse(ok)), ok)

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

    def test_trusted_uid_is_not_assigned_and_no_kwargs_splat_into_ctx(self):  # K12(a), seceng
        for f in sources():
            tree = ast.parse(f.read_text(), str(f))
            init_nodes = set()
            if f.name == "ctx.py" and f.parent.name == "lib":
                for fn in ast.walk(tree):
                    if isinstance(fn, ast.FunctionDef) and fn.name == "__init__":
                        init_nodes |= set(id(n) for n in ast.walk(fn))
            for node in ast.walk(tree):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, (ast.AugAssign, ast.AnnAssign)) else []
                for t in targets:
                    if isinstance(t, ast.Attribute) and t.attr == "trusted_uid" and id(node) not in init_nodes:
                        self.fail("%s:%d assigns trusted_uid outside Ctx.__init__" % (f, node.lineno))
                if isinstance(node, ast.Call) and (getattr(node.func, "attr", "") or getattr(node.func, "id", "")) == "Ctx":
                    self.assertFalse([k for k in node.keywords if k.arg is None], "%s:%d Ctx(**kw)" % (f, node.lineno))
                    self.assertFalse([a for a in node.args if isinstance(a, ast.Starred)], "%s:%d Ctx(*args)" % (f, node.lineno))

    def test_no_pattern_string_ends_in_a_dollar_anchor(self):  # K12(e), seceng: re.compile(r"^..$") then PAT.match is the likely shape
        for f in sources():
            for node in ast.walk(ast.parse(f.read_text(), str(f))):
                if isinstance(node, ast.Call) and getattr(node.func, "attr", "") in ("compile", "match", "search", "fullmatch", "sub", "findall"):
                    for a in node.args[:1]:
                        if isinstance(a, ast.Constant) and isinstance(a.value, str) and a.value.endswith("$"):
                            self.fail("%s:%d pattern %r ends in $; use re.fullmatch without an anchor" % (f, node.lineno, a.value))

    def test_no_test_hook_names_a_root_in_argv_or_the_environment(self):  # R1: root and fakes come from the constructor only
        for f in sources():
            text = f.read_text()
            for needle in ("POLYCARPIC_ROOT", "OPS_ROOT", "--root"):
                self.assertNotIn(needle, text, str(f))


if __name__ == "__main__":
    unittest.main()
