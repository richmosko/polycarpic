"""POLY-97 R8/R9: dns-records.py writes the allowed set (and only that), idempotently, after a typed yes."""
import unittest

from base import ALLOWED, IPV4, IPV6, SECRETS, FakeCF, Net, ToolTest, good_zone, rel

SEC = [SECRETS["cf_token"]]
ADDR = ("--ipv4", IPV4, "--ipv6", IPV6)


class DnsRecords(ToolTest):
    def run_records(self, cf, args=ADDR, answers=None):
        self.cf, self.writes = cf, []

        def spy(method, url, headers, body):
            if method != "GET":
                self.writes.append((method, url, body))
            return cf(method, url, headers, body)

        self.net = Net(**{"api.cloudflare.com": spy})
        return self.tool("dns-records", list(args), self.net, secrets=[SECRETS["cf_token"]], answers=answers)

    def posts(self):
        return [b for m, u, b in self.writes if m == "POST"]

    def key(self, b):
        n = rel(b["name"]) if b["name"].endswith("polycarpic.com") else b["name"]
        if b["type"] == "CAA":  # POSTed as data {flags, tag, value}, never as content (devops/lead change)
            self.assertIn("data", b, "CAA must be posted as data {flags, tag, value}")
            d = b["data"]
            return (n, "CAA", '%d %s "%s"' % (d["flags"], d["tag"], d["value"]), None)
        return (n, b["type"], b["content"].strip(chr(34)) if b["type"] == "TXT" else b["content"], b.get("priority"))

    def test_an_empty_zone_gets_exactly_the_allowed_set_and_the_four_address_records(self):
        rc, out, err = self.run_records(FakeCF())
        self.assertEqual((rc, err), (0, ""), out)
        expected = {(r[0], r[1], r[2], r[3] if len(r) > 3 else None) for r in ALLOWED}
        got = {self.key(b) for b in self.posts()}
        self.assertEqual({g for g in got if g[1] not in ("A", "AAAA")}, expected)
        self.assertEqual({g[:3] for g in got if g[1] in ("A", "AAAA")}, {("app", "A", IPV4), ("app", "AAAA", IPV6), ("staging", "A", IPV4), ("staging", "AAAA", IPV6)})
        self.assertEqual(len(self.writes), 13)

    def test_caa_is_posted_as_data_flags_tag_value_with_no_content_key(self):
        self.run_records(FakeCF())
        caa = [b for b in self.posts() if b["type"] == "CAA"]
        self.assertEqual(len(caa), 3)
        for b in caa:
            self.assertNotIn("content", b)
            self.assertEqual(set(b["data"]), {"flags", "tag", "value"})
            self.assertIs(type(b["data"]["flags"]), int)
            self.assertNotIn('"', b["data"]["value"])
        self.assertEqual({(b["data"]["tag"], b["data"]["value"]) for b in caa}, {("issue", "letsencrypt.org"), ("issue", "sectigo.com"), ("issuewild", ";")})

    def test_a_zone_whose_caa_comes_back_as_data_only_or_content_only_is_complete_and_idempotent(self):
        for mode in ("data", "content", "both"):
            rc, out, _ = self.run_records(good_zone(caa_mode=mode))
            self.assertEqual((rc, self.writes), (0, []), mode)

    def test_accepts_the_exact_ipv6_value_create_sh_prints_and_rejects_the_bare_64_network(self):
        # verdict C2: create.sh prints `IPv6: <prefix>::1 (network <prefix>/64)`; the value to pass is <prefix>::1
        rc, out, err = self.run_records(FakeCF(), args=("--ipv4", IPV4, "--ipv6", "2a01:4f8:c17:abcd::1"))
        self.assertEqual((rc, err), (0, ""), out)
        self.assertEqual({b["content"] for b in self.posts() if b["type"] == "AAAA"}, {"2a01:4f8:c17:abcd::1"})
        rc, out, err = self.run_records(FakeCF(), args=("--ipv4", IPV4, "--ipv6", "2a01:4f8:c17:abcd::/64"))
        self.assertEqual(rc, 2, out + err)
        self.assertEqual(self.writes, [])

    def test_address_records_are_ttl_300_and_no_record_is_proxied(self):
        self.run_records(FakeCF())
        for b in self.posts():
            self.assertFalse(b.get("proxied", False), b)
            if b["type"] in ("A", "AAAA"):
                self.assertEqual(b["ttl"], 300)

    def test_never_writes_a_record_outside_the_allowed_set_even_with_odd_arguments(self):
        for extra in ([], ["--ipv4", "198.51.100.1"], ["--ipv4", IPV4, "--ipv6", IPV6, "--name", "evil", "--type", "A"]):
            self.run_records(FakeCF(), args=extra, answers=None)
            allowed_names = {r[0] for r in ALLOWED} | {"app", "staging"}
            for b in self.posts():
                self.assertIn(self.key(b)[0], allowed_names, b)

    def test_idempotent_a_complete_zone_gets_no_write_and_says_exists(self):
        rc, out, _ = self.run_records(good_zone())
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.writes, [])
        self.assertIn("exists", out.lower())

    def test_a_second_run_over_the_first_runs_result_writes_nothing(self):
        cf = FakeCF()
        self.run_records(cf)
        n = len(cf.records)
        self.run_records(cf)
        self.assertEqual(self.writes, [])
        self.assertEqual(len(cf.records), n)

    def test_without_a_typed_yes_nothing_is_written_and_the_plan_was_listed_first(self):
        rc, out, _ = self.run_records(FakeCF(), answers={"yes": "no"})
        self.assertEqual(self.writes, [])
        for needle in ("v=spf1 -all", "letsencrypt.org", "send.forge.rmta.net", "app"):
            self.assertIn(needle, out)

    def test_never_deletes_or_overwrites_and_a_conflicting_record_is_reported_with_exit_1(self):
        cf = good_zone()
        for r in cf.records:
            if r["type"] == "TXT" and r["name"] == "polycarpic.com":
                r["content"] = '"v=spf1 +all"'
        rc, out, err = self.run_records(cf)
        self.assertEqual(rc, 1, out)
        self.assertEqual([m for m, u, b in self.writes if m in ("DELETE", "PUT", "PATCH")], [])
        self.assertIn("v=spf1 +all", out + err)

    def test_without_addresses_it_writes_no_a_or_aaaa_record(self):
        self.run_records(FakeCF(), args=())
        self.assertEqual([b for b in self.posts() if b["type"] in ("A", "AAAA")], [])

    def test_token_is_read_hidden_once_never_printed_never_written(self):
        rc, out, err = self.run_records(FakeCF())
        self.assertEqual(len(self.gp_prompts), 1)
        self.assertNoSecrets(out + err, SEC)
        self.assertNoSecretsOnDisk(SEC)
        self.assertNotRegex(out + err, r"(?i)bearer |authorization:")

    def test_an_api_error_exits_1_with_the_providers_message(self):
        cf = FakeCF()
        cf.token = "x"
        rc, out, err = self.run_records(cf)
        self.assertEqual(rc, 1)
        self.assertIn("Invalid access token", out + err)
        self.assertNoSecrets(out + err, SEC)


if __name__ == "__main__":
    unittest.main()
