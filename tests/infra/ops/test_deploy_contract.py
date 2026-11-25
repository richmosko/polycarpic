"""POLY-160c contract pins (ruling.md section S, R1.2, R2): the names and shapes the builders and the tests share. Red until the build lands.
Behaviour is in test_deploy_recover.py, test_deploy_commit.py, test_deploy_retry.py. Mutant: any name or signature below renamed."""
import inspect

import sys

from base import OPS, OpsTest

sys.path.insert(0, str(OPS))
from lib import deployer, edge, release as rel  # noqa: E402


def params(fn):
    return list(inspect.signature(fn).parameters)


class Contract(OpsTest):
    def test_deployer_seams(self):
        self.assertEqual(params(deployer.recover), ["project", "ctx", "cur", "run"])
        self.assertEqual(params(deployer.stand_down), ["project", "ctx", "keep_ref"])
        self.assertIsNone(inspect.signature(deployer.stand_down).parameters["keep_ref"].default)
        self.assertEqual(params(deployer.commit), ["project", "ctx", "cur", "new", "run"])
        self.assertEqual(params(deployer.settle), ["project", "ctx", "rdir", "digest"])

    def test_old_handler_gone(self):
        self.assertFalse(hasattr(deployer, "_handle_interrupted"))

    def test_edge_entry_points_stay(self):
        self.assertTrue(callable(edge.deploy) and callable(edge.rollback))

    def test_state_file_shape_unchanged(self):
        self.assertTrue(rel.DIGEST.fullmatch("sha256:" + "a" * 64))
        self.assertFalse(rel.DIGEST.fullmatch("sha256:" + "a" * 63))
