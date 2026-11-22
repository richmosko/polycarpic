"""POLY-97 R8: dns-move-to-cloudflare.py as prototyped, with the Porkbun API key read hidden too (laptop-check shares this file's fixtures)."""
import unittest

from base import SECRETS, FakeCF, Net, ToolTest

SEC = [SECRETS["cf_token"], SECRETS["pb_key"], SECRETS["pb_secret"]]
CF_NS = ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"]


class FakePorkbun(object):
    def __init__(self, ns=None):
        self.ns, self.calls = ns or ["curitiba.porkbun.com", "salvador.porkbun.com"], []

    def __call__(self, method, url, headers, body):
        self.calls.append((url, dict(body or {})))
        if body.get("apikey") != SECRETS["pb_key"] or body.get("secretapikey") != SECRETS["pb_secret"]:
            return 200, {"status": "ERROR", "message": "Invalid API key. (fixture)"}
        if "/getNs/" in url:
            return 200, {"status": "SUCCESS", "ns": list(self.ns)}
        if "/updateNs/" in url:
            self.ns = list(body["ns"])
            return 200, {"status": "SUCCESS"}
        return 404, {"status": "ERROR", "message": "FAKE: unrouted"}


class DnsMove(ToolTest):
    def go(self, cf=None, pb=None, answers=None, secrets=None):
        self.cf = cf or FakeCF()
        self.pb = pb or FakePorkbun()
        self.net = Net(**{"api.cloudflare.com": self.cf, "porkbun.com": self.pb})
        return self.tool("dns-move-to-cloudflare", [], self.net, secrets=secrets or [SECRETS["cf_token"], SECRETS["pb_key"], SECRETS["pb_secret"]], answers=answers)

    def test_every_secret_including_the_porkbun_api_key_is_read_hidden_never_through_input(self):
        rc, out, err = self.go()
        self.assertEqual(rc, 0, out + err)
        self.assertEqual(len(self.gp_prompts), 3)
        for p in self.in_prompts:
            self.assertNotRegex(p, r"(?i)api ?key|pk1_|secret")

    def test_deletes_the_leftover_records_then_points_the_name_servers_at_cloudflares_and_reads_back(self):
        cf = FakeCF([{"type": "A", "name": "old", "content": "192.0.2.1"}, {"type": "TXT", "name": "@", "content": '"parked"'}])
        rc, out, _ = self.go(cf=cf)
        self.assertEqual(cf.records, [])
        self.assertEqual(sorted(self.pb.ns), sorted(CF_NS))
        self.assertRegex(out, r"(?i)name servers match")

    def test_nothing_changes_without_a_typed_yes(self):
        cf = FakeCF([{"type": "A", "name": "old", "content": "192.0.2.1"}])
        rc, out, _ = self.go(cf=cf, answers={"yes": "no"})
        self.assertEqual(len(cf.records), 1)
        self.assertEqual(self.pb.ns, ["curitiba.porkbun.com", "salvador.porkbun.com"])
        self.assertFalse([u for u, b in self.pb.calls if "updateNs" in u])

    def test_a_porkbun_refusal_exits_non_zero_with_its_message(self):
        rc, out, err = self.go(secrets=[SECRETS["cf_token"], "pk1_wrong", "sk1_wrong"])
        self.assertNotEqual(rc, 0)
        self.assertIn("Invalid API key", out + err)

    def test_a_token_that_cannot_see_the_zone_stops_with_exit_1(self):
        cf = FakeCF()
        cf.token = "other"
        rc, out, err = self.go(cf=cf)
        self.assertEqual(rc, 1)
        self.assertFalse([u for u, b in self.pb.calls])

    def test_no_secret_is_printed_or_written_and_no_header_is_shown_on_error(self):
        rc, out, err = self.go()
        self.assertNoSecrets(out + err, SEC)
        self.assertNoSecretsOnDisk(SEC)
        cf = FakeCF()
        cf.token = "other"
        rc, out, err = self.go(cf=cf)
        self.assertNoSecrets(out + err, SEC)
        self.assertNotRegex(out + err, r"(?i)bearer |authorization:")


if __name__ == "__main__":
    unittest.main()
