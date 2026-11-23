"""POLY-100 F9 (ruling.md @ f6a9af34): `_edge_up(ctx, judged, digest)` takes the `Judged(project, digest, path, sha256)` the guard returned and compares, before any compose call: it is a
`Judged`; its project is `edge`; its digest is the digest being upped; the file's sha256, re-read without following a link, is its `sha256`. A miss: refusal `unjudged`, caddy untouched.
Written from the ruling, red on the build it was written against (`_edge_up(project, ctx, rdir, judged=True)` is a constant)."""
import hashlib
import os
import sys
import tempfile
import unittest

from base import OPS, Runner


def modules():
    if str(OPS) not in sys.path:
        sys.path.insert(0, str(OPS))
    from lib import compose_guard, deployer
    from lib.ctx import Ctx
    return deployer, compose_guard, Ctx


DIG = "sha256:" + "a" * 64
OTHER = "sha256:" + "b" * 64


class Judged(unittest.TestCase):
    def setUp(self):
        self.deployer, self.guard, self.Ctx = modules()
        self.tmp = tempfile.mkdtemp(prefix="poly100-judged-")
        self.addCleanup(__import__("shutil").rmtree, self.tmp, True)
        self.path = os.path.join(self.tmp, "render-aaaaaaaaaaaa.json")
        self.body = b'{"name": "polycarpic-edge", "services": {"caddy": {"image": "x"}}}'
        with open(self.path, "wb") as fh:
            fh.write(self.body)
        self.sha = hashlib.sha256(self.body).hexdigest()
        self.runner = Runner(None)
        self.runner.on(lambda a: True, out="")
        self.ctx = self.Ctx(root=self.tmp, run=self.runner, trusted_uid=os.getuid())

    def J(self, **kw):
        cls = getattr(self.deployer, "Judged", None) or getattr(self.guard, "Judged", None)
        if cls is None:
            self.fail("no Judged type: the guard must return one and nothing else may make one (F9)")
        d = dict(project="edge", digest=DIG, path=self.path, sha256=self.sha)
        d.update(kw)
        return cls(**d)

    def up(self, judged, digest=DIG):
        return self.deployer._edge_up(self.ctx, judged, digest)

    def assertUnjudged(self, judged, digest=DIG, label=""):
        before = len(self.runner.calls)
        with self.assertRaises(self.deployer.Refusal if hasattr(self.deployer, "Refusal") else Exception) as cm:
            self.up(judged, digest)
        self.assertEqual(getattr(cm.exception, "name", None), "unjudged", label)
        self.assertEqual(len(self.runner.calls), before, label + ": caddy untouched, no compose call")

    def test_the_right_judged_render_ups(self):
        self.up(self.J())
        ups = [c["argv"] for c in self.runner.calls if "up" in c["argv"]]
        self.assertEqual(len(ups), 1)
        self.assertIn(self.path, ups[0])

    def test_none_and_true_and_other_values_are_unjudged(self):
        for label, v in (("None", None), ("True", True), ("a path", self.path), ("a dict", {"path": self.path}), ("a tuple", ("edge", DIG, self.path, self.sha))):
            self.assertUnjudged(v, label=label)

    def test_another_projects_judged_is_unjudged(self):
        self.assertUnjudged(self.J(project="prod"), label="prod's own")
        self.assertUnjudged(self.J(project="staging"), label="staging's own")

    def test_another_digests_judged_is_unjudged(self):
        self.assertUnjudged(self.J(digest=OTHER), label="judged for another digest")
        self.assertUnjudged(self.J(), digest=OTHER, label="upping another digest than the judged one")

    def test_a_changed_missing_or_linked_file_is_unjudged(self):
        with open(self.path, "ab") as fh:
            fh.write(b" ")
        self.assertUnjudged(self.J(), label="the file changed after it was judged")
        os.unlink(self.path)
        self.assertUnjudged(self.J(), label="missing")
        other = os.path.join(self.tmp, "other.json")
        with open(other, "wb") as fh:
            fh.write(self.body)
        os.symlink(other, self.path)
        self.assertUnjudged(self.J(), label="a symlink, never followed (the target has the right bytes)")

    def test_a_wrong_hash_is_unjudged(self):
        self.assertUnjudged(self.J(sha256="0" * 64), label="the recorded hash is not the file's")
