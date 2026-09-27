"""POLY-58 gate-2 red test: pins the architect's gate-1 ruling
(`process/reviews/POLY-58/ruling.md` @ b156d14) §2 module/step order and
§3 facade contract, §4 engine-staleness dir mode, and §6(a)-(f) checks.

Nothing under test exists yet at the base commit: `scripts/cairn/cairnlib/`
does not exist, `cairn.py` is still the 7,998-line monolith, and
`engine_fingerprint`/`engine_is_stale` only accept a file. Every check
below is red for that reason and turns green as each step's extraction
commit lands, in the ruled order -- (a) one method per module as its own
module is created; (d) only once step 21 leaves `cairn.py` a pure facade;
(f) only once step 0's directory-mode seam lands. (b), (c), (e) iterate
over whatever `cairnlib` modules exist, so they are vacuously green at
the base (no modules exist yet) -- the ruling calls this out explicitly.

This file does not pin the full 237-name list (`process/reviews/POLY-58/
owners.txt`); the verdict gate's matrix check does that once, against the
finished tree. This file pins only: the step order, each module's §2
anchor name, and the four structural invariants that must hold once
`cairnlib` exists.
"""
from __future__ import annotations

import ast
import builtins as _builtins_mod
import importlib
import inspect
import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path

import helpers  # noqa: F401

import cairn

CAIRNLIB_DIR = helpers.CAIRN_DIR / "cairnlib"

# Ruling §2: step order, each module, and its pinned anchor name. Order
# matters for the layering check (c) below -- an earlier index is an
# earlier step, and every intra-cairnlib import must point strictly
# backward in this list.
STEPS = [
    (1, "constants", "DEFAULT_PORT"),
    (2, "errors", "CairnError"),
    (3, "yamlsub", "parse_yaml_subset"),
    (4, "records", "parse_frontmatter"),
    (5, "config", "load_config"),
    (6, "store", "allocate_and_create_issue"),
    (7, "guards", "check_budgets"),
    (8, "lint", "check_repo"),
    (9, "snapshot", "build_snapshot_markdown"),
    (10, "roster", "_read_agent_identities"),
    (11, "attribution", "milestone_windows"),
    (12, "flow", "build_flow_payload"),
    (13, "tokens", "build_tokens_payload"),
    (14, "actuals", "token_actuals"),
    (15, "payloads", "build_board_payload"),
    (16, "multiroot", "resolve_roots"),
    (17, "watch", "DataDirWatcher"),
    (18, "server", "make_server"),
    (19, "archive", "archive_milestone"),
    (20, "estimate", "cmd_close"),
    (21, "cli", "build_arg_parser"),
]
MODULE_STEP_INDEX = {module: step for step, module, _ in STEPS}


def _import_cairnlib_module(name: str):
    return importlib.import_module(f"cairnlib.{name}")


def _existing_cairnlib_modules():
    """Every `cairnlib/*.py` module that exists on disk right now, minus
    `__init__`. Vacuously empty at the base commit -- (b), (c), (e) below
    iterate over this and are therefore vacuously green until step 1
    lands, exactly as the ruling calls for."""
    if not CAIRNLIB_DIR.is_dir():
        return []
    return sorted(p.stem for p in CAIRNLIB_DIR.glob("*.py") if p.stem != "__init__")


# --------------------------------------------------------------------------
# (a) One ownership method per module (ruling §6a). Generated dynamically
# so each module gets its own independently-reported, independently-green
# test method, named for its step.
# --------------------------------------------------------------------------

def _make_ownership_test(step: int, module_name: str, anchor: str):
    def test(self):
        try:
            mod = _import_cairnlib_module(module_name)
        except ImportError as exc:
            self.fail(f"cairnlib.{module_name} (step {step}) does not exist yet: {exc}")
        self.assertTrue(hasattr(mod, "__all__"), f"cairnlib.{module_name} must define __all__")
        self.assertIn(
            anchor, mod.__all__, f"cairnlib.{module_name}.__all__ must list its anchor {anchor!r}"
        )
        self.assertTrue(hasattr(mod, anchor), f"cairnlib.{module_name} must define {anchor!r}")
        for name in mod.__all__:
            self.assertTrue(
                hasattr(cairn, name),
                f"facade `cairn` is missing {name!r}, owned by cairnlib.{module_name}",
            )
            facade_obj = getattr(cairn, name)
            module_obj = getattr(mod, name)
            self.assertIs(
                facade_obj,
                module_obj,
                f"cairn.{name} is not the same object as cairnlib.{module_name}.{name}",
            )
            if inspect.isfunction(module_obj) or inspect.isclass(module_obj):
                self.assertEqual(
                    module_obj.__module__,
                    f"cairnlib.{module_name}",
                    f"{name} reports __module__={module_obj.__module__!r}, "
                    f"expected cairnlib.{module_name}",
                )

    test.__name__ = f"test_step{step:02d}_{module_name}_owns_its_names"
    test.__doc__ = f"Ruling §2 step {step}: cairnlib.{module_name} (anchor {anchor!r})."
    return test


_ownership_methods = {}
for _step, _module, _anchor in STEPS:
    _t = _make_ownership_test(_step, _module, _anchor)
    _ownership_methods[_t.__name__] = _t

OwnershipTests = type("OwnershipTests", (unittest.TestCase,), _ownership_methods)


# --------------------------------------------------------------------------
# (b) Partition -- no name claimed by two modules' __all__.
# --------------------------------------------------------------------------

class PartitionTests(unittest.TestCase):
    def test_no_name_is_claimed_by_two_modules(self):
        owner_of = {}
        dupes = []
        for module_name in _existing_cairnlib_modules():
            mod = _import_cairnlib_module(module_name)
            for name in getattr(mod, "__all__", ()):
                if name in owner_of and owner_of[name] != module_name:
                    dupes.append((name, owner_of[name], module_name))
                owner_of.setdefault(name, module_name)
        self.assertEqual(dupes, [], f"names claimed by two modules: {dupes}")


# --------------------------------------------------------------------------
# (c) Layering -- every cairnlib-internal import names an earlier step.
# --------------------------------------------------------------------------

class LayeringTests(unittest.TestCase):
    def test_every_cairnlib_import_names_an_earlier_step(self):
        violations = []
        for module_name in _existing_cairnlib_modules():
            step = MODULE_STEP_INDEX.get(module_name)
            if step is None:
                continue  # a module outside this ruling's table is not this check's concern
            path = CAIRNLIB_DIR / f"{module_name}.py"
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if (
                    isinstance(node, ast.ImportFrom)
                    and node.level == 0
                    and node.module
                    and node.module.startswith("cairnlib.")
                ):
                    imported = node.module.split(".", 1)[1]
                    imported_step = MODULE_STEP_INDEX.get(imported)
                    if imported_step is None or imported_step >= step:
                        violations.append(
                            f"{module_name}.py (step {step}) imports cairnlib.{imported} "
                            f"(step {imported_step}) -- not strictly earlier"
                        )
        self.assertEqual(violations, [], "; ".join(violations))


# --------------------------------------------------------------------------
# (d) Facade-only, red until step 21 (ruling §3).
# --------------------------------------------------------------------------

class FacadeOnlyTests(unittest.TestCase):
    def test_cairn_py_is_a_pure_facade(self):
        source_path = helpers.CAIRN_PY
        tree = ast.parse(source_path.read_text(encoding="utf-8"), filename=str(source_path))
        bad_nodes = []
        all_assign = None
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                bad_nodes.append(f"{type(node).__name__}:{node.name}@{node.lineno}")
            elif isinstance(node, ast.Assign):
                targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
                if targets == ["__all__"]:
                    all_assign = node
                else:
                    bad_nodes.append(f"Assign:{','.join(targets) or '?'}@{node.lineno}")
            elif isinstance(node, ast.AnnAssign):
                bad_nodes.append(f"AnnAssign@{node.lineno}")
        self.assertEqual(
            bad_nodes,
            [],
            "cairn.py must be facade-only (docstring / imports / __all__ / __main__ guard "
            f"only); found: {bad_nodes}",
        )
        self.assertIsNotNone(all_assign, "cairn.py must define __all__")

        expected = set()
        for module_name in _existing_cairnlib_modules():
            mod = _import_cairnlib_module(module_name)
            expected.update(getattr(mod, "__all__", ()))
        self.assertEqual(
            set(getattr(cairn, "__all__", [])),
            expected,
            "cairn.__all__ must be exactly the union of every cairnlib module's __all__",
        )


# --------------------------------------------------------------------------
# (e) No unresolved globals -- pyflakes-lite (ruling M13 / §6e). Flat,
# whole-file scoping on purpose: the point is to catch a name that used
# to be reachable in the monolith but was left behind by an extraction,
# not to re-implement real lexical scoping.
# --------------------------------------------------------------------------

_BUILTIN_NAMES = set(dir(_builtins_mod)) | {"__debug__"}
_MODULE_DUNDERS = {
    "__name__", "__file__", "__doc__", "__package__", "__spec__", "__loader__",
    "__builtins__", "__all__", "__annotations__", "__dict__", "__path__",
}


def _bound_names(tree: ast.AST) -> set:
    bound = set()

    class Binder(ast.NodeVisitor):
        def visit_FunctionDef(self, node):
            bound.add(node.name)
            self._bind_args(node.args)
            self.generic_visit(node)

        visit_AsyncFunctionDef = visit_FunctionDef

        def visit_ClassDef(self, node):
            bound.add(node.name)
            self.generic_visit(node)

        def visit_Lambda(self, node):
            self._bind_args(node.args)
            self.generic_visit(node)

        def _bind_args(self, args):
            for a in list(args.posonlyargs) + list(args.args) + list(args.kwonlyargs):
                bound.add(a.arg)
            if args.vararg:
                bound.add(args.vararg.arg)
            if args.kwarg:
                bound.add(args.kwarg.arg)

        def visit_Name(self, node):
            if isinstance(node.ctx, (ast.Store, ast.Del)):
                bound.add(node.id)
            self.generic_visit(node)

        def visit_Import(self, node):
            for alias in node.names:
                bound.add((alias.asname or alias.name).split(".")[0])

        def visit_ImportFrom(self, node):
            for alias in node.names:
                if alias.name != "*":
                    bound.add(alias.asname or alias.name)

        def visit_ExceptHandler(self, node):
            if node.name:
                bound.add(node.name)
            self.generic_visit(node)

        def visit_Global(self, node):
            bound.update(node.names)

        def visit_Nonlocal(self, node):
            bound.update(node.names)

    Binder().visit(tree)
    return bound


def _loaded_names(tree: ast.AST) -> list:
    return [n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)]


class NoUnresolvedGlobalsTests(unittest.TestCase):
    def test_every_name_load_is_bound_somewhere_in_its_module(self):
        violations = {}
        for module_name in _existing_cairnlib_modules():
            path = CAIRNLIB_DIR / f"{module_name}.py"
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            bound = _bound_names(tree) | _BUILTIN_NAMES | _MODULE_DUNDERS
            unresolved = sorted({n for n in _loaded_names(tree) if n not in bound})
            if unresolved:
                violations[module_name] = unresolved
        self.assertEqual(violations, {}, f"unresolved names per module: {violations}")


# --------------------------------------------------------------------------
# (f) Engine dir mode -- ruling §4, step 0. Red until engine_fingerprint /
# engine_is_stale accept a directory instead of only a file.
# --------------------------------------------------------------------------

class EngineDirModeTests(unittest.TestCase):
    def _write_two_file_dir(self, contents=("one\n", "two\n")) -> Path:
        tmp_dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp_dir, ignore_errors=True)
        (tmp_dir / "a.py").write_text(contents[0], encoding="utf-8")
        (tmp_dir / "b.py").write_text(contents[1], encoding="utf-8")
        return tmp_dir

    def test_editing_one_file_makes_a_directory_engine_stale(self):
        engine_dir = self._write_two_file_dir()
        boot = cairn.engine_fingerprint(engine_dir)
        (engine_dir / "a.py").write_text("one, edited\n", encoding="utf-8")
        self.assertTrue(cairn.engine_is_stale(engine_dir, boot))

    def test_touching_mtime_with_identical_bytes_is_not_stale(self):
        engine_dir = self._write_two_file_dir()
        boot = cairn.engine_fingerprint(engine_dir)
        future = time.time() + 5
        os.utime(engine_dir / "a.py", (future, future))
        self.assertFalse(cairn.engine_is_stale(engine_dir, boot))


if __name__ == "__main__":
    unittest.main()
