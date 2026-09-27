"""POLY-58 verdict: apply each §8 mutation to a fresh copy of scripts/cairn, run the named
test(s), and report red/green. Usage: python3 mutate.py <src scripts/cairn> <workdir>"""
import shutil, subprocess, sys, re
from pathlib import Path

SRC = Path(sys.argv[1]); WORK = Path(sys.argv[2])

def sub(path, old, new, count=1):
    s = path.read_text()
    assert old in s, (path, old)
    path.write_text(s.replace(old, new, count))

def append(path, text):
    path.write_text(path.read_text() + text)

M = [
 ("6a owner", "test_cairnlib_layout.py", lambda d: append(d/"cairn.py", "\ndef load_config(*a, **k):\n    return None\n"), "OwnershipTests"),
 ("6b partition", "test_cairnlib_layout.py", lambda d: append(d/"cairnlib/lint.py", "\n__all__ = __all__ + ['_dir_glob']\n"), "PartitionTests"),
 ("6c layering", "test_cairnlib_layout.py", lambda d: append(d/"cairnlib/constants.py", "\nif False:\n    from cairnlib.cli import main\n"), "LayeringTests"),
 ("6d facade", "test_cairnlib_layout.py", lambda d: append(d/"cairn.py", "\ndef _x():\n    pass\n"), "FacadeOnlyTests"),
 ("6e unresolved", "test_cairnlib_layout.py", lambda d: sub(d/"cairnlib/lint.py", "    _dir_glob,\n    _id_sort_key,\n", "    _id_sort_key,\n"), "NoUnresolvedGlobalsTests"),
 ("6f dirmode", "test_cairnlib_layout.py", lambda d: sub(d/"cairnlib/watch.py", "    if is_dir:\n        try:\n            current", "    if False:\n        try:\n            current"), "EngineDirModeTests"),
 ("5 dashboard spy", "test_dashboard.py", lambda d: (sub(d/"tests/test_dashboard.py", "patch.object(cairnlib.payloads, \"read_git_tags\", spy)", "patch.object(cairn, \"read_git_tags\", spy)"), sub(d/"tests/test_dashboard.py", "patch.object(cairnlib.attribution, \"read_git_tags\", spy)", "patch.object(cairn, \"read_git_tags\", spy)")), None),
 ("5 server alloc", "test_server.py", lambda d: sub(d/"tests/test_server.py", "        cairnlib.server.allocate_and_create_issue = _always_exhausted", "        cairn.allocate_and_create_issue = _always_exhausted"), None),
 ("5 tokens spy", "test_tokens_endpoint.py", lambda d: sub(d/"tests/test_tokens_endpoint.py", "mock.patch(\"cairnlib.flow._compute_flow_payload\"", "mock.patch(\"cairn._compute_flow_payload\""), None),
 ("5 copy_engine", "test_otel_receiver_hardening.py", lambda d: sub(d/"tests/helpers.py", "    if cairnlib_src.is_dir():", "    if False:"), None),
 ("5 src lint.py", "test_archived_milestone_paths.py", lambda d: sub(d/"tests/test_archived_milestone_paths.py", "LINT_PY = helpers.CAIRN_DIR / \"cairnlib\" / \"lint.py\"", "LINT_PY = helpers.CAIRN_DIR / \"cairn.py\""), None),
 ("5 src store", "test_id_allocation.py", lambda d: sub(d/"tests/test_id_allocation.py", "source = inspect.getsource(cairnlib.store)", "source = inspect.getsource(cairn)"), None),
]

def fresh():
    d = WORK / "scripts" / "cairn"
    if WORK.exists(): shutil.rmtree(WORK)
    shutil.copytree(SRC, d, ignore=shutil.ignore_patterns("__pycache__", "node_modules"))
    return d

def run(d, test, cls):
    target = test[:-3] + (("." + cls) if cls else "")
    r = subprocess.run([sys.executable, "-m", "unittest", target], cwd=d/"tests", capture_output=True, text=True)
    tail = [l for l in r.stderr.splitlines() if l.startswith(("OK", "FAILED", "Ran "))]
    return r.returncode, " ".join(tail)

only = sys.argv[3:]  # optional names
for name, test, mut, cls in M:
    if only and name not in only: continue
    d = fresh()
    base_rc, base = run(d, test, cls)
    mut(d)
    rc, out = run(d, test, cls)
    verdict = "KILLED" if (base_rc == 0 and rc != 0) else "SURVIVED/BAD-BASE"
    print(f"{name:18s} {test}{'.'+cls if cls else ''}: base rc={base_rc} [{base}] -> mutated rc={rc} [{out}] => {verdict}", flush=True)
