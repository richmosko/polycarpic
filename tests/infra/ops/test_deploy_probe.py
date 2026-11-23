"""POLY-100 T-probe (A13, R7): prod, real-domain mode, not the first deploy: the release must answer 200 through Caddy when it did before.
Seam: ctx.https_status(host, addr, path) -> status int, raising OSError. The fake answers 200 unless the running web image is in world.edge_bad."""
import os
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from base import OPS
from deploy_base import digest
from test_deploy_prod import PROD, ProdBase  # noqa: F401


class Probe(ProdBase):
    def two(self):
        x1, _ = self.first_prod()
        self.world.https_calls.clear()
        x2 = self.release_of("v1.1.0")
        return x1, x2

    def test_the_probe_asks_the_pinned_url_once_as_baseline_then_in_the_health_poll(self):
        x1, x2 = self.two()
        r = self.deploy("prod")
        self.assertEqual(r.rc, 0, r.err)
        self.assertGreaterEqual(len(self.world.https_calls), 2)
        self.assertEqual(set(self.world.https_calls), {("app.example.com", "127.0.0.1", "/api/v1/health")}, "POLY_BIND_ADDR 0.0.0.0 reads as 127.0.0.1")
        self.assertIsNone(self.alert_name("prod"))

    def test_baseline_200_then_502_rolls_back_and_quarantines(self):
        x1, x2 = self.two()
        self.world.edge_bad[x2] = 502
        r = self.deploy("prod")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: rolled-back"), r.err)
        self.assertIn(x2, self.state("prod", "quarantine"))
        self.assertEqual(self.state("prod", "current").split()[0], x1)

    def test_baseline_200_then_a_certificate_failure_rolls_back_and_quarantines(self):
        x1, x2 = self.two()
        self.world.edge_bad[x2] = ssl.SSLCertVerificationError("certificate verify failed")
        r = self.deploy("prod")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: rolled-back"), r.err)
        self.assertIn(x2, self.state("prod", "quarantine"))

    def test_a_failing_baseline_deploys_healthy_logs_and_alerts_edge_probe_baseline_without_quarantine(self):
        x1, x2 = self.two()
        self.world.https_always = OSError("connection refused")
        r = self.deploy("prod")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(self.state("prod", "current").split()[0], x2)
        self.assertIn("edge-probe-baseline", self.log_events("prod"))
        self.assertEqual(self.alert_name("prod"), "edge-probe-baseline")
        self.assertEqual((self.state("prod", "quarantine") or "").strip(), "")

    def test_a_failing_baseline_never_makes_a_good_release_unhealthy_whatever_the_probe_says_later(self):
        x1, x2 = self.two()
        self.world.https_always = 503
        r = self.deploy("prod")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(self.alert_name("prod"), "edge-probe-baseline")

    def test_the_first_deploy_and_staging_are_never_probed(self):
        self.first_prod()
        self.assertEqual(self.world.https_calls, [])
        self.staging_next()
        self.assertEqual(self.deploy("staging", cmd="first-deploy").rc, 0)
        self.staging_next()
        self.assertEqual(self.deploy("staging").rc, 0)
        self.assertEqual(self.world.https_calls, [])

    def test_a_box_not_in_real_domain_mode_is_not_probed(self):
        x1, x2 = self.two()
        self.host.write("/etc/polycarpic/host.env", "PUBLIC_ORIGIN=https://app.example.com\nTLS_MODE=internal\n")
        r = self.deploy("prod")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(self.world.https_calls, [])


class RealHttpsStatus(unittest.TestCase):
    """The real seam against a local self-signed listener: full verification is on (red on a mutant that skips it), and a verifying certificate answers."""

    def setUp(self):
        if not shutil.which("openssl"):
            self.fail("openssl is required for this test")
        self.tmp = Path(tempfile.mkdtemp(prefix="poly100-tls-"))
        self.addCleanup(shutil.rmtree, str(self.tmp), True)
        key, crt = self.tmp / "k.pem", self.tmp / "c.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key), "-out", str(crt), "-days", "2", "-subj", "/CN=app.example.com",
                        "-addext", "subjectAltName=DNS:app.example.com"], check=True, capture_output=True)
        self.key, self.crt = key, crt
        import sys
        if str(OPS) not in sys.path:
            sys.path.insert(0, str(OPS))
        from lib import ctx as ctxmod
        self.ctxmod = ctxmod

    def serve(self):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(str(self.crt), str(self.key))
        srv = socket.socket()
        srv.bind(("127.0.0.1", 0))
        srv.listen(4)
        port = srv.getsockname()[1]

        def loop():
            while True:
                try:
                    c, _ = srv.accept()
                except OSError:
                    return
                try:
                    with ctx.wrap_socket(c, server_side=True) as t:
                        t.recv(1024)
                        t.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                except (OSError, ssl.SSLError):
                    pass
        threading.Thread(target=loop, daemon=True).start()
        self.addCleanup(srv.close)
        real = socket.create_connection
        return port, lambda addr, **kw: real(("127.0.0.1", port), **{k: v for k, v in kw.items()})

    def test_an_untrusted_certificate_raises_and_a_trusted_one_answers_200(self):
        port, redirect = self.serve()
        with mock.patch.object(socket, "create_connection", lambda address, timeout=None, **kw: redirect(address, timeout=timeout)):
            with self.assertRaises(OSError):  # ssl.SSLCertVerificationError is an OSError: nothing trusts the self-signed certificate
                self.ctxmod.Ctx(root="/").https_status("app.example.com", "127.0.0.1", "/api/v1/health")
            with mock.patch.dict(os.environ, {"SSL_CERT_FILE": str(self.crt)}):
                self.assertEqual(self.ctxmod.Ctx(root="/").https_status("app.example.com", "127.0.0.1", "/api/v1/health"), 200)
                with self.assertRaises(OSError):  # a certificate for another name is refused even when trusted
                    self.ctxmod.Ctx(root="/").https_status("other.example.com", "127.0.0.1", "/api/v1/health")


if __name__ == "__main__":
    unittest.main()
