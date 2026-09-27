"""POLY-60 ruling R2: `cairnlib/enginesrc.py`, the new leaf module (no
`cairnlib` imports of its own) that folds `multiroot.compute_multi_etag`'s
inlined `*.py` dir-stat loop and `watch.engine_fingerprint`'s dir branch
into one shared helper, so the ~10-line `sorted(glob("*.py"))` -> max
mtime, sum size loop stops existing twice (POLY-58 verdict, 222f15a).

Nothing under test exists yet: `cairnlib.enginesrc` is not a module.
Every test below is expected to fail (ImportError/ModuleNotFoundError)
until implementation-lead's POLY-60 slice lands.
"""
from __future__ import annotations

import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path

import helpers  # noqa: F401


def _import_enginesrc():
    import cairnlib.enginesrc as enginesrc
    return enginesrc


class EngineSourceFilesTests(unittest.TestCase):
    def _tmp_dir(self) -> Path:
        tmp_dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp_dir, ignore_errors=True)
        return tmp_dir

    def test_a_single_file_returns_just_that_file(self):
        enginesrc = _import_enginesrc()
        tmp_dir = self._tmp_dir()
        f = tmp_dir / "solo.py"
        f.write_text("x\n", encoding="utf-8")
        self.assertEqual(enginesrc.engine_source_files(f), [f])

    def test_a_directory_returns_every_py_file_sorted(self):
        enginesrc = _import_enginesrc()
        tmp_dir = self._tmp_dir()
        (tmp_dir / "b.py").write_text("b\n", encoding="utf-8")
        (tmp_dir / "a.py").write_text("a\n", encoding="utf-8")
        (tmp_dir / "not_python.txt").write_text("nope\n", encoding="utf-8")
        self.assertEqual(
            enginesrc.engine_source_files(tmp_dir),
            [tmp_dir / "a.py", tmp_dir / "b.py"],
        )

    def test_an_empty_directory_returns_an_empty_list(self):
        enginesrc = _import_enginesrc()
        tmp_dir = self._tmp_dir()
        self.assertEqual(enginesrc.engine_source_files(tmp_dir), [])


class EngineSourceStatTests(unittest.TestCase):
    def _tmp_dir(self) -> Path:
        tmp_dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp_dir, ignore_errors=True)
        return tmp_dir

    def test_single_file_returns_its_own_mtime_and_size(self):
        enginesrc = _import_enginesrc()
        tmp_dir = self._tmp_dir()
        f = tmp_dir / "solo.py"
        f.write_text("hello\n", encoding="utf-8")
        mtime_ns, size = enginesrc.engine_source_stat(f)
        st = f.stat()
        self.assertEqual(mtime_ns, st.st_mtime_ns)
        self.assertEqual(size, len(b"hello\n"))

    def test_directory_mtime_is_the_max_not_the_sum(self):
        # Mutation this pins directly: summing mtimes instead of taking the
        # max -- st_mtime_ns values are large epoch-nanosecond integers, so
        # a sum is trivially and grossly larger than the max, never equal
        # to it by coincidence.
        enginesrc = _import_enginesrc()
        tmp_dir = self._tmp_dir()
        old = tmp_dir / "old.py"
        new = tmp_dir / "new.py"
        old.write_text("old\n", encoding="utf-8")
        time.sleep(0.01)
        new.write_text("new\n", encoding="utf-8")
        mtime_ns, _size = enginesrc.engine_source_stat(tmp_dir)
        self.assertEqual(mtime_ns, max(old.stat().st_mtime_ns, new.stat().st_mtime_ns))

    def test_directory_size_is_the_sum(self):
        enginesrc = _import_enginesrc()
        tmp_dir = self._tmp_dir()
        (tmp_dir / "a.py").write_text("aaaa\n", encoding="utf-8")
        (tmp_dir / "b.py").write_text("bb\n", encoding="utf-8")
        _mtime_ns, size = enginesrc.engine_source_stat(tmp_dir)
        self.assertEqual(size, len(b"aaaa\n") + len(b"bb\n"))

    def test_empty_directory_returns_zero_zero(self):
        enginesrc = _import_enginesrc()
        tmp_dir = self._tmp_dir()
        self.assertEqual(enginesrc.engine_source_stat(tmp_dir), (0, 0))

    def test_touching_one_file_in_a_directory_changes_the_stat(self):
        enginesrc = _import_enginesrc()
        tmp_dir = self._tmp_dir()
        (tmp_dir / "a.py").write_text("a\n", encoding="utf-8")
        (tmp_dir / "b.py").write_text("b\n", encoding="utf-8")
        before_mtime_ns, before_size = enginesrc.engine_source_stat(tmp_dir)
        time.sleep(0.01)
        (tmp_dir / "a.py").write_text("a, edited, longer\n", encoding="utf-8")
        after_mtime_ns, after_size = enginesrc.engine_source_stat(tmp_dir)
        self.assertGreater(after_mtime_ns, before_mtime_ns)
        self.assertGreater(after_size, before_size)

    def test_missing_path_raises_oserror(self):
        enginesrc = _import_enginesrc()
        tmp_dir = self._tmp_dir()
        missing = tmp_dir / "does_not_exist.py"
        with self.assertRaises(OSError):
            enginesrc.engine_source_stat(missing)


if __name__ == "__main__":
    unittest.main()
