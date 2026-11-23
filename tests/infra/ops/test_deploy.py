"""POLY-100 R13: `polycarpic-ops deploy`. Slice 0 first (ruling R13); the rest follow in groups (test-plan.md)."""
import unittest

from base import ctx_class
from deploy_base import REGISTRY, DeployTest, digest


class Slice0(DeployTest):
    """An image whose attestation fails V1 is refused and never run (R3 V1, S1)."""

    def test_unverified_image_is_refused_and_never_run(self):
        w = self.world
        x = digest("x")
        w.image("polycarpic", x, w.commit_b)  # the registry holds X; no attestation matches it
        w.staging_run(w.commit_b, x)
        r = self.deploy("staging")
        self.assertEqual(r.rc, 1, r.err)
        self.assertEqual(r.err.splitlines()[-1], "deploy: refused attestation")
        # it got as far as V1 for X, with the token in gh's env (so the refusal is the attestation's, not a missing credential)
        verify = [c for c in r.runner.calls if c["argv"][:3] == ["gh", "attestation", "verify"]]
        self.assertEqual(len(verify), 1)
        self.assertIn("oci://%s@%s" % (REGISTRY, x), verify[0]["argv"])
        self.assertEqual(verify[0]["env"].get("GH_TOKEN"), self.token)
        # nothing with X's digest reached docker: no pull, create, run, compose
        self.assertEqual([a for a in self.argv_text(r, "docker") if x in a or x[7:] in a], [])
        self.assertEqual(w.pulled, [])
        # the record
        self.assertEqual(self.alert_name("staging"), "attestation")
        self.assertIn("refused", self.log_events("staging"))
        self.assertIn("refused attestation " + x, self.state("staging", "deploy.log"))
        self.assertEqual((self.state("staging", "quarantine") or "").strip(), "", "V1 is not a Q row (R3)")
        self.assertEqual(self.state("staging", "current").split()[0], self.current_digest)


class CtxSeams(unittest.TestCase):
    """Contract pins: the seams R13 names exist on Ctx (red until the builder adds them)."""

    def test_ctx_has_resolve_and_run_bytes(self):
        names = ctx_class().__init__.__code__.co_varnames
        self.assertIn("resolve", names)
        self.assertIn("run_bytes", names)


if __name__ == "__main__":
    unittest.main()
