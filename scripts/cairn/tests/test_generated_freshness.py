"""POLY-102 gate 2: generated-output freshness through the generic core of check_dist_freshness.py.

Contract pinned here is process/cairn/reviews/POLY-102/ruling.md R2 (registry `infra/ci/generated.json`, modes
`regenerate` and `ancestry`, CLI `[--pair NAME]... [--ci] [--all] [repo_root]`, one line per pair
`<name>: <reason>: <message>`, exit 0 fresh / 1 stale / 2 could not run, 2 outranks 1) and the V1-V4 rows of R7.
The existing PT-58 contract (no flag = dashboard only) stays in test_dist_freshness.py, unchanged.

Every test names the mutation that turns it red in its docstring ("red if:"). Fixtures are tiny fake generators
(python), never the real drizzle-kit; the real-generator cases live in tests/ci/generated-freshness.test.ts.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

import helpers  # noqa: F401
from test_dist_freshness import _commit, _run_git, make_dashboard_repo

SCRIPT = helpers.CAIRN_DIR / "check_dist_freshness.py"
PY = sys.executable

_GEN = """\
import os, shutil
shutil.rmtree('out', ignore_errors=True)  # this generator owns out/; an add-only one (drizzle-kit) cannot expose a committed stray
src = open('src.txt').read().strip()
dep = open('node_modules/dep.txt').read().strip()
os.makedirs('out', exist_ok=True)
leak = '|skip-leaked' if os.path.exists('.skipme') and not os.environ.get('POLY_QA_FIXTURE') else ''
leak += '|env-leaked' if 'POLY_QA_SECRET' in os.environ else ''
open('out/result.txt', 'w').write(f'built:{src}:{dep}{leak}\\n')
"""
_BUILD = """\
import os
src = open('src.txt').read().strip()
os.makedirs('dist', exist_ok=True)
open('dist/out.txt', 'w').write(f'built:{src}\\n')
"""


def regen_pair(**kw):
    p = {"name": "gen", "mode": "regenerate", "root": "pkg", "output": "out", "link": ["node_modules"],
         "skip": [".skipme"], "command": [PY, "gen.py"], "timeout": 60, "ci": True}
    p.update(kw)
    return p


def anc_pair(**kw):
    p = {"name": "anc", "mode": "ancestry", "root": "apkg", "output": "dist", "exclude": ["README.md"],
         "link": [], "skip": [], "command": [PY, "build.py"], "timeout": 60, "ci": False}
    p.update(kw)
    return p


def write_registry(repo: Path, pairs) -> None:
    f = repo / "infra" / "ci" / "generated.json"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps({"pairs": pairs}, indent=2) + "\n", encoding="utf-8")


def regen(repo: Path) -> None:
    """Run the fixture generators the way a developer would, so the committed output is real."""
    env = dict(os.environ, POLY_QA_FIXTURE="1")
    subprocess.run([PY, "gen.py"], cwd=str(repo / "pkg"), env=env, check=True)
    subprocess.run([PY, "build.py"], cwd=str(repo / "apkg"), env=env, check=True)


def make_repo(tc, pairs=None) -> Path:
    repo = helpers.make_empty_tmp_dir(tc)
    _run_git(repo, "init", "-q")
    _run_git(repo, "config", "user.email", "test@example.com")
    _run_git(repo, "config", "user.name", "Test")
    pkg, apkg = repo / "pkg", repo / "apkg"
    (pkg / "node_modules").mkdir(parents=True)
    apkg.mkdir()
    (pkg / ".gitignore").write_text("node_modules/\n", encoding="utf-8")
    (pkg / "node_modules" / "dep.txt").write_text("dep1\n", encoding="utf-8")
    for d, files in ((pkg, {"gen.py": _GEN, "src.txt": "v1\n"}), (apkg, {"build.py": _BUILD, "src.txt": "v1\n", "README.md": "r1\n"})):
        for n, c in files.items():
            (d / n).write_text(c, encoding="utf-8")
    regen(repo)
    (pkg / ".skipme").write_text("must not be copied\n", encoding="utf-8")
    (repo / "docs").mkdir()
    (repo / "docs" / "notes.md").write_text("n1\n", encoding="utf-8")
    write_registry(repo, pairs if pairs is not None else [regen_pair(), anc_pair()])
    _commit(repo, "initial: sources + matching outputs + registry", when="2026-08-20T10:00:00")
    return repo


def status(repo: Path) -> str:
    return _run_git(repo, "status", "--porcelain=v1", "--untracked-files=all", "--ignored")


class _Base(unittest.TestCase):
    def run_check(self, repo: Path, *flags: str, env=None, python=PY):
        tmpdir = Path(tempfile.mkdtemp(prefix="qa-tmpdir-"))
        self.addCleanup(shutil.rmtree, tmpdir, True)
        e = dict(os.environ, TMPDIR=str(tmpdir))
        e.update(env or {})
        before = status(repo) if (repo / ".git").exists() else None
        t0 = time.time()
        r, w = os.pipe()  # an open, silent stdin: a child that inherits it and reads would hang until its timeout
        try:
            p = subprocess.run([python, str(SCRIPT), *flags, str(repo)], capture_output=True, text=True, env=e, stdin=r)
        finally:
            os.close(r)
            os.close(w)
        self.elapsed = time.time() - t0
        if before is not None and (repo / ".git").exists() and shutil.which("git"):
            self.assertEqual(status(repo), before, "the check must never write to the tree (V4)")
        self.assertEqual(os.listdir(tmpdir), [], "the check must remove its tmp copy on every path")
        if p.returncode in (0, 1):  # a verdict names every selected pair, so an exit 0 cannot be vacuous
            for i, f in enumerate(flags):
                if f == "--pair":
                    self.assertRegex(p.stdout + p.stderr, rf"(?m)^{flags[i + 1]}: [a-z-]+: ", "one line per selected pair")
        return p.returncode, p.stdout + p.stderr

    def line(self, out: str, name: str, reason: str):
        self.assertRegex(out, rf"(?m)^{name}: {reason}: ", out)


class RegenerateModeTests(_Base):
    def test_fresh_exits_0_with_one_line_for_the_pair(self):
        """red if: fresh exits non-zero, or the line is not `<name>: <reason>: <message>`."""
        repo = make_repo(self)
        code, out = self.run_check(repo, "--pair", "gen")
        self.assertEqual(code, 0, out)
        self.line(out, "gen", "fresh")

    def test_touching_a_source_without_regenerating_fails(self):
        """red if: the regenerate comparison is skipped, or a committed source change with an unchanged output reads fresh."""
        repo = make_repo(self)
        (repo / "pkg" / "src.txt").write_text("v2\n", encoding="utf-8")
        _commit(repo, "src only", when="2026-08-21T10:00:00")
        code, out = self.run_check(repo, "--pair", "gen")
        self.assertEqual(code, 1, out)
        self.line(out, "gen", "stale")

    def test_regenerating_passes(self):
        """red if: a regenerated, committed output still reads stale (comparison against the wrong tree)."""
        repo = make_repo(self)
        (repo / "pkg" / "src.txt").write_text("v2\n", encoding="utf-8")
        regen(repo)
        _commit(repo, "src + regenerated output", when="2026-08-21T10:00:00")
        code, out = self.run_check(repo, "--pair", "gen")
        self.assertEqual(code, 0, out)

    def test_a_hand_edited_output_is_stale(self):
        """red if: the check trusts that the output's last commit is newer than the source's (history instead of content)."""
        repo = make_repo(self)
        (repo / "pkg" / "out" / "result.txt").write_text("built:hand-edited\n", encoding="utf-8")
        _commit(repo, "edit the generated file by hand", when="2026-08-21T10:00:00")
        code, out = self.run_check(repo, "--pair", "gen")
        self.assertEqual(code, 1, out)

    def test_an_extra_file_on_either_side_is_stale(self):
        """red if: the tree compare ignores files present on only one side."""
        repo = make_repo(self)
        (repo / "pkg" / "out" / "stray.txt").write_text("committed but never generated\n", encoding="utf-8")
        _commit(repo, "stray committed output file", when="2026-08-21T10:00:00")
        code, out = self.run_check(repo, "--pair", "gen")
        self.assertEqual(code, 1, "committed-only file: " + out)
        repo2 = make_repo(self)
        (repo2 / "pkg" / "gen.py").write_text(_GEN + "open('out/extra.txt', 'w').write('x')\n", encoding="utf-8")
        _commit(repo2, "generator now emits a file that was not committed", when="2026-08-21T10:00:00")
        code, out = self.run_check(repo2, "--pair", "gen")
        self.assertEqual(code, 1, "generated-only file: " + out)

    def test_addendum_1_add_only_generator_does_not_see_a_committed_only_stray(self):
        """POLY-102 ruling Addendum 1 pins an accepted limit: the copy starts from the committed output, so for a
        generator that only adds files (drizzle-kit never deletes) a committed-only stray is in both trees and the pair
        reads fresh. red if: the comparator starts flagging it (then the addendum and ARCH 8 need re-ruling) or the pair
        fails to run."""
        add_only = "import os; os.makedirs('out', exist_ok=True); open('out/result.txt', 'w').write('built:v1:dep1\\n')"
        repo = make_repo(self, [regen_pair(name="addonly", command=[PY, "-c", add_only])])
        (repo / "pkg" / "out" / "stray.txt").write_text("committed, never generated\n", encoding="utf-8")
        _commit(repo, "stray committed output file", when="2026-08-21T10:00:00")
        code, out = self.run_check(repo, "--pair", "addonly")
        self.assertEqual(code, 0, out)
        self.line(out, "addonly", "fresh")

    def test_a_doc_only_commit_never_flips_fresh_to_stale(self):
        """red if: any commit after the output's makes a regenerate pair stale."""
        repo = make_repo(self)
        (repo / "docs" / "notes.md").write_text("n2\n", encoding="utf-8")
        _commit(repo, "docs only", when="2026-08-21T10:00:00")
        code, out = self.run_check(repo, "--pair", "gen")
        self.assertEqual(code, 0, out)

    def test_history_is_not_read_same_second_and_cross_timezone(self):
        """red if: regenerate mode consults timestamps or ancestry. Same-second source+output commits and a
        late-looking -0700 stamp on the source commit must give the content answer in both directions."""
        repo = make_repo(self)
        same = "2026-08-21T09:00:00+0000"
        (repo / "pkg" / "src.txt").write_text("v2\n", encoding="utf-8")
        _commit(repo, "src, same second as the next commit", when=same)
        (repo / "docs" / "notes.md").write_text("n2\n", encoding="utf-8")
        _commit(repo, "unrelated, same second", when=same)
        code, out = self.run_check(repo, "--pair", "gen")
        self.assertEqual(code, 1, "stale must stay stale with identical timestamps: " + out)
        regen(repo)
        _commit(repo, "regenerate, earlier-looking stamp", when="2026-08-21T00:30:00+0000")
        (repo / "pkg" / "src.txt").write_text("v2\n", encoding="utf-8")  # unchanged content
        code, out = self.run_check(repo, "--pair", "gen")
        self.assertEqual(code, 0, "fresh must stay fresh whatever the stamps say: " + out)

    def test_uncommitted_edit_under_root_is_stale(self):
        """red if: working-tree changes under `root` are ignored (regenerate would compare a tree git does not hold)."""
        repo = make_repo(self)
        (repo / "pkg" / "src.txt").write_text("v2 uncommitted\n", encoding="utf-8")
        code, out = self.run_check(repo, "--pair", "gen")
        self.assertEqual(code, 1, out)
        self.line(out, "gen", "uncommitted-src-changes")

    def test_untracked_file_under_root_is_stale(self):
        """red if: only modified tracked files count as uncommitted."""
        repo = make_repo(self)
        (repo / "pkg" / "new_source.txt").write_text("brand new\n", encoding="utf-8")
        code, out = self.run_check(repo, "--pair", "gen")
        self.assertEqual(code, 1, out)
        self.line(out, "gen", "uncommitted-src-changes")

    def test_skip_entries_are_not_copied(self):
        """red if: `skip` is ignored. The generator leaks `.skipme` into its output when it can see it; the committed
        output was made without it, so a copy that includes it reads stale."""
        repo = make_repo(self)
        code, out = self.run_check(repo, "--pair", "gen")
        self.assertEqual(code, 0, out)

    def test_link_entries_are_symlinked_to_their_real_path(self):
        """red if: `link` entries are copied or not provided. The generator reads node_modules/dep.txt, which is
        gitignored and exists only in the working tree; a missing link makes the generator fail (exit 2)."""
        repo = make_repo(self)
        (repo / "pkg" / "node_modules" / "dep.txt").write_text("dep2\n", encoding="utf-8")  # ignored: tree stays clean
        code, out = self.run_check(repo, "--pair", "gen")
        self.assertEqual(code, 1, "the generator must see the live dep (committed output says dep1): " + out)
        self.line(out, "gen", "stale")

    def test_the_generator_runs_with_a_minimal_environment(self):
        """red if: the parent environment is passed through. The generator marks its output when POLY_QA_SECRET
        (standing for a token or DATABASE_*) is visible; only PATH, HOME, LANG, TMPDIR may reach it."""
        repo = make_repo(self)
        code, out = self.run_check(repo, "--pair", "gen", env={"POLY_QA_SECRET": "s3cret", "DATABASE_PASSWORD": "x"})
        self.assertEqual(code, 0, out)

    def test_the_committed_output_is_never_written(self):
        """red if: the generator runs in the repo instead of a copy. run_check asserts `git status --ignored` is
        identical before and after, and the output bytes here."""
        repo = make_repo(self)
        (repo / "pkg" / "src.txt").write_text("v2\n", encoding="utf-8")
        _commit(repo, "src only", when="2026-08-21T10:00:00")
        before = (repo / "pkg" / "out" / "result.txt").read_bytes()
        self.run_check(repo, "--pair", "gen")
        self.assertEqual((repo / "pkg" / "out" / "result.txt").read_bytes(), before)


class AncestryModeTests(_Base):
    """The PT-58 fixtures, re-run through the generic core for an `ancestry` pair (V3)."""

    def setUp(self):
        self.repo = make_repo(self, [anc_pair(ci=True)])
        self.apkg = self.repo / "apkg"

    def test_fresh(self):
        """red if: the ancestry pair reports stale on a consistent tree."""
        code, out = self.run_check(self.repo, "--pair", "anc")
        self.assertEqual(code, 0, out)
        self.line(out, "anc", "fresh")

    def test_source_after_output_is_stale_and_rebuild_commit_is_fresh(self):
        """red if: the pair never reaches `stale`, or a rebuilt output after the source stays stale."""
        (self.apkg / "src.txt").write_text("v2\n", encoding="utf-8")
        _commit(self.repo, "src only", when="2026-08-21T10:00:00")
        code, out = self.run_check(self.repo, "--pair", "anc")
        self.assertEqual(code, 1, out)
        self.line(out, "anc", "stale")
        (self.apkg / "dist" / "out.txt").write_text("built:v2\n", encoding="utf-8")
        _commit(self.repo, "rebuild", when="2026-08-21T11:00:00")
        code, out = self.run_check(self.repo, "--pair", "anc")
        self.assertEqual(code, 0, out)

    def test_same_second_commits_resolve_toward_stale(self):
        """red if: a timestamp comparison replaces ancestry (a tie resolves to fresh)."""
        same = "2026-08-21T09:00:00+0000"
        (self.apkg / "dist" / "out.txt").write_text("rebuilt, same second as the src change below\n", encoding="utf-8")
        _commit(self.repo, "dist", when=same)
        (self.apkg / "src.txt").write_text("v2\n", encoding="utf-8")
        _commit(self.repo, "src, same instant", when=same)
        code, out = self.run_check(self.repo, "--pair", "anc")
        self.assertEqual(code, 1, out)

    def test_cross_timezone_stamps_do_not_invert_the_order(self):
        """red if: ISO-8601 offsets are compared lexically. The rebuild is the next commit but looks earlier."""
        (self.apkg / "src.txt").write_text("v2\n", encoding="utf-8")
        _commit(self.repo, "src, late-looking -0700", when="2026-08-20T23:00:00-0700")
        (self.apkg / "dist" / "out.txt").write_text("built:v2\n", encoding="utf-8")
        _commit(self.repo, "dist, earlier-looking +0000, next commit", when="2026-08-21T00:30:00+0000")
        code, out = self.run_check(self.repo, "--pair", "anc")
        self.assertEqual(code, 0, out)

    def test_a_doc_only_commit_never_flips_fresh_to_stale(self):
        """red if: a commit touching neither source nor output makes the pair stale."""
        (self.repo / "docs" / "notes.md").write_text("n2\n", encoding="utf-8")
        _commit(self.repo, "docs only", when="2026-08-21T10:00:00")
        code, out = self.run_check(self.repo, "--pair", "anc")
        self.assertEqual(code, 0, out)

    def test_excluded_noise_does_not_demand_a_rebuild(self):
        """red if: the pair's `exclude` list is ignored."""
        (self.apkg / "README.md").write_text("r2\n", encoding="utf-8")
        _commit(self.repo, "readme", when="2026-08-21T10:00:00")
        code, out = self.run_check(self.repo, "--pair", "anc")
        self.assertEqual(code, 0, out)

    def test_uncommitted_source_is_stale(self):
        """red if: working-tree edits under an ancestry pair's root are ignored."""
        (self.apkg / "src.txt").write_text("v2 uncommitted\n", encoding="utf-8")
        code, out = self.run_check(self.repo, "--pair", "anc")
        self.assertEqual(code, 1, out)
        self.line(out, "anc", "uncommitted-src-changes")

    def test_dist_never_committed_is_its_own_reason(self):
        """red if: a pair whose output has no commit history is lumped into `stale` or `fresh`."""
        _run_git(self.repo, "rm", "-rq", "apkg/dist")
        _commit(self.repo, "remove output", when="2026-08-21T10:00:00")
        code, out = self.run_check(self.repo, "--pair", "anc")
        self.assertEqual(code, 1, out)
        self.line(out, "anc", "dist-never-built")


class FailClosedTests(_Base):
    """One test per exit-2 row of R2. Exit 2 means the check could not run; it is never a pass."""

    def two(self, code, out, why):
        self.assertEqual(code, 2, f"{why}: {out}")

    def test_registry_missing_with_ci(self):
        """red if: a missing registry under --ci reads as 'no pairs, fresh'."""
        repo = make_repo(self)
        _run_git(repo, "rm", "-q", "infra/ci/generated.json")
        _commit(repo, "drop registry", when="2026-08-21T10:00:00")
        self.two(*self.run_check(repo, "--ci"), "registry missing")

    def test_registry_invalid_json(self):
        """red if: a parse error is swallowed."""
        repo = make_repo(self)
        (repo / "infra" / "ci" / "generated.json").write_text("{not json", encoding="utf-8")
        _commit(repo, "garble", when="2026-08-21T10:00:00")
        self.two(*self.run_check(repo, "--ci"), "invalid json")

    def test_registry_errors_extra_missing_bad_type_bad_mode_builtin_name(self):
        """red if: any registry validation rule is missing: an unknown key, a missing key, a wrong type, an unknown
        mode, or a name equal to the built-in `dashboard-dist`."""
        bad = {
            "extra key": regen_pair(bogus=1),
            "missing key": {k: v for k, v in regen_pair().items() if k != "timeout"},
            "bad type": regen_pair(timeout="soon"),
            "bad mode": regen_pair(mode="mtime"),
            "built-in name": regen_pair(name="dashboard-dist"),
        }
        for why, pair in bad.items():
            repo = make_repo(self, [pair])
            self.two(*self.run_check(repo, "--ci"), why)

    def test_unknown_pair_name(self):
        """red if: an unknown --pair is ignored or selects nothing."""
        self.two(*self.run_check(make_repo(self), "--pair", "no-such-pair"), "unknown pair")

    def test_registered_root_missing(self):
        """red if: a missing root counts as 'nothing to check, fresh'."""
        repo = make_repo(self, [regen_pair(root="no-such-dir")])
        self.two(*self.run_check(repo, "--ci"), "root missing")

    def test_git_unavailable(self):
        """red if: the check falls back to a pass without git. PATH holds no git; the generator is an absolute path."""
        repo = make_repo(self)
        empty = Path(tempfile.mkdtemp(prefix="qa-nopath-"))
        self.addCleanup(shutil.rmtree, empty, True)
        self.two(*self.run_check(repo, "--pair", "gen", env={"PATH": str(empty)}), "git unavailable")

    def test_ancestry_pair_on_a_shallow_clone(self):
        """red if: an ancestry pair is evaluated on truncated history (a false fresh)."""
        repo = make_repo(self, [anc_pair(ci=True)])
        (repo / "apkg" / "src.txt").write_text("v2\n", encoding="utf-8")
        _commit(repo, "src", when="2026-08-21T10:00:00")
        clone = Path(tempfile.mkdtemp(prefix="qa-shallow-"))
        self.addCleanup(shutil.rmtree, clone, True)
        shutil.rmtree(clone)
        _run_git(repo.parent, "clone", "-q", "--depth", "1", f"file://{repo}", str(clone))
        self.assertEqual(_run_git(clone, "rev-parse", "--is-shallow-repository"), "true")
        self.two(*self.run_check(clone, "--pair", "anc"), "shallow")

    def test_regenerate_pair_on_a_shallow_clone_still_works(self):
        """red if: the shallow refusal is applied to regenerate pairs, which read no history."""
        repo = make_repo(self)
        clone = Path(tempfile.mkdtemp(prefix="qa-shallow-"))
        self.addCleanup(shutil.rmtree, clone, True)
        shutil.rmtree(clone)
        _run_git(repo.parent, "clone", "-q", "--depth", "1", f"file://{repo}", str(clone))
        (clone / "pkg" / "node_modules").mkdir()
        (clone / "pkg" / "node_modules" / "dep.txt").write_text("dep1\n", encoding="utf-8")
        code, out = self.run_check(clone, "--pair", "gen")
        self.assertEqual(code, 0, out)

    def test_generator_absent_nonzero_or_timed_out(self):
        """red if: a generator that cannot run, fails, or exceeds `timeout` is read as fresh or stale."""
        cases = {
            "absent": regen_pair(command=["./no-such-generator"]),
            "non-zero": regen_pair(command=[PY, "-c", "import sys; sys.exit(3)"]),
            "timeout": regen_pair(command=[PY, "-c", "import time; time.sleep(30)"], timeout=1),
        }
        for why, pair in cases.items():
            repo = make_repo(self, [pair])
            self.two(*self.run_check(repo, "--pair", "gen"), why)
            if why == "timeout":
                self.assertLess(self.elapsed, 20, "the timeout must actually kill the generator")

    def test_a_prompting_generator_exits_2_at_once_not_at_the_timeout(self):
        """red if: the generator inherits a terminal or a pipe on stdin (a drizzle-kit rename prompt would hang to
        `timeout`). stdin must be /dev/null; the generator reads one line, gets EOF and fails."""
        repo = make_repo(self, [regen_pair(command=[PY, "-c", "import sys; sys.exit(0 if sys.stdin.readline() else 4)"], timeout=60)])
        code, out = self.run_check(repo, "--pair", "gen")
        self.two(code, out, "prompting generator")
        self.assertLess(self.elapsed, 15, "must exit well inside the 60 s timeout")

    def test_tmp_copy_failure(self):
        """red if: an unreadable file under root is skipped silently. (Skipped as root: chmod does not bind.)"""
        if os.geteuid() == 0:
            self.skipTest("running as root: file modes do not bind")
        repo = make_repo(self)
        locked = repo / "pkg" / "locked.txt"
        locked.write_text("x\n", encoding="utf-8")
        _commit(repo, "add file", when="2026-08-21T10:00:00")
        locked.chmod(0)
        self.addCleanup(locked.chmod, 0o644)
        self.two(*self.run_check(repo, "--pair", "gen"), "copy failure")

    def test_ci_selecting_zero_pairs(self):
        """red if: `--ci` with no ci:true pair exits 0."""
        repo = make_repo(self, [regen_pair(ci=False)])
        self.two(*self.run_check(repo, "--ci"), "zero pairs")

    def test_exit_2_outranks_exit_1(self):
        """red if: a stale pair masks a pair that could not run."""
        repo = make_repo(self, [regen_pair(), regen_pair(name="broken", command=["./no-such-generator"])])
        (repo / "pkg" / "src.txt").write_text("v2\n", encoding="utf-8")
        _commit(repo, "src", when="2026-08-21T10:00:00")
        code, out = self.run_check(repo, "--pair", "gen", "--pair", "broken")
        self.two(code, out, "stale + could-not-run")
        self.line(out, "gen", "stale")

    def test_flag_mode_never_maps_no_dashboard_to_fresh(self):
        """red if: `--pair dashboard-dist` on a repo with no dashboard exits 0 (no flag mode keeps 0: PT-58)."""
        repo = make_repo(self)
        self.two(*self.run_check(repo, "--pair", "dashboard-dist"), "no-dashboard")


class SelectionTests(_Base):
    def test_ci_selects_only_ci_pairs_and_all_selects_every_pair_and_the_builtin(self):
        """red if: --ci also selects ci:false pairs or the built-in; --all drops the registry's ci:false pairs or the
        built-in (a repo with no dashboard then exits 0 instead of 2)."""
        repo = make_repo(self, [regen_pair(), anc_pair(ci=False)])
        (repo / "apkg" / "src.txt").write_text("v2\n", encoding="utf-8")
        _commit(repo, "make anc stale", when="2026-08-21T10:00:00")
        code, out = self.run_check(repo, "--ci")
        self.assertEqual(code, 0, out)
        self.assertNotIn("anc", out)
        self.assertNotIn("dashboard-dist", out)
        code, out = self.run_check(repo, "--all")
        self.assertEqual(code, 2, "--all includes dashboard-dist, absent here: " + out)
        self.line(out, "anc", "stale")

    def test_builtin_pair_by_name_needs_no_registry_and_keeps_its_reasons(self):
        """red if: --pair dashboard-dist requires the registry, or the dashboard pair reports differently from PT-58."""
        repo = make_dashboard_repo(self)
        code, out = self.run_check(repo, "--pair", "dashboard-dist")
        self.assertEqual(code, 0, out)
        self.line(out, "dashboard-dist", "fresh")
        dash = repo / "scripts" / "cairn" / "dashboard"
        (dash / "src" / "App.svelte").write_text("<div>v2</div>\n", encoding="utf-8")
        _commit(repo, "src only", when="2026-08-21T10:00:00")
        code, out = self.run_check(repo, "--pair", "dashboard-dist")
        self.assertEqual(code, 1, out)
        self.line(out, "dashboard-dist", "stale")


if __name__ == "__main__":
    unittest.main()
