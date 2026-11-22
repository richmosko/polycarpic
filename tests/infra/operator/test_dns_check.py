"""POLY-97 R9: dns-check.py against fixtures. Every fault is planted in a fixture zone and the exact FAIL line is asserted."""
import json
import unittest

from base import ALLOWED, DKIM, IPV4, IPV6, SECRETS, FakeCF, FakeDoH, Net, ToolTest, good_zone, OPDIR

ARGS = ["--ipv4", IPV4, "--ipv6", IPV6]
SEC = [SECRETS["cf_token"], SECRETS["b2_token"]]


class DnsCheck(ToolTest):
    def run_check(self, cf, doh=None, args=ARGS):
        doh = doh or FakeDoH()
        self.doh, self.cf, self.net = doh, cf, Net(**{"api.cloudflare.com": cf, "cloudflare-dns.com": doh})
        return self.tool("dns-check", args, self.net, secrets=[SECRETS["cf_token"]])

    def assertFails(self, rc, out, *needles):
        self.assertEqual(rc, 1, out)
        self.assertNotIn("DNS CHECK PASSED", out)
        self.line(out, "FAIL", *needles)

    def test_allowed_file_exists_and_pins_the_three_caa_rows_and_no_ruf(self):
        text = (OPDIR / "dns-allowed.json").read_text()
        json.loads(text)
        for needle in ("letsencrypt.org", "sectigo.com", "issuewild", "send.forge.rmta.net", "rsend-euw1.forge.rmta.net", "p=reject", "sp=reject", "adkim=s", "aspf=r"):
            self.assertIn(needle, text)
        self.assertNotIn("ruf=", text)

    def test_good_zone_passes_exit_0(self):
        rc, out, err = self.run_check(good_zone())
        self.assertEqual((rc, err), (0, ""), out)
        self.assertEqual(self.lines(out)[-1], "DNS CHECK PASSED")
        self.assertNotIn("FAIL", out)

    def test_caa_passes_whether_the_list_reply_carries_content_only_data_only_or_both(self):
        for mode in ("content", "data", "both"):
            rc, out, err = self.run_check(good_zone(caa_mode=mode))
            self.assertEqual(rc, 0, (mode, out))
            self.assertEqual(self.lines(out)[-1], "DNS CHECK PASSED")

    def test_caa_faults_are_caught_in_data_only_mode_too(self):
        cf = good_zone(caa_mode="data")
        cf.records = [r for r in cf.records if not (r["type"] == "CAA" and r["data"]["value"] == "sectigo.com")]
        self.assertFails(*self.run_check(cf), "CAA")
        cf = good_zone(caa_mode="data")
        cf.add("CAA", "@", '0 issue "digicert.com"')
        self.assertFails(*self.run_check(cf), "CAA", "digicert")
        cf = good_zone(caa_mode="data")
        for r in cf.records:
            if r["type"] == "CAA" and r["data"]["tag"] == "issuewild":
                r["data"]["value"] = "letsencrypt.org"
        self.assertFails(*self.run_check(cf), "CAA")

    def test_accepts_the_ipv6_host_address_create_sh_prints(self):
        cf = good_zone()
        for r in cf.records:
            if r["type"] == "AAAA":
                r["content"] = "2a01:4f8:c17:abcd::1"
        rc, out, err = self.run_check(cf, args=["--ipv4", IPV4, "--ipv6", "2a01:4f8:c17:abcd::1"])
        self.assertEqual(rc, 0, out + err)

    def test_absent_app_and_staging_are_allowed_and_reported_as_absent(self):
        cf = FakeCF()
        for r in ALLOWED:
            cf.add(r[1], r[0], '"%s"' % r[2] if r[1] == "TXT" else r[2], priority=(r[3] if len(r) > 3 else None))
        rc, out, _ = self.run_check(cf)
        self.assertEqual(rc, 0, out)
        self.line(out, "app", "absent")
        self.line(out, "staging", "absent")

    def test_names_and_cname_targets_compare_case_insensitively_with_a_trailing_dot(self):
        cf = good_zone()
        for r in cf.records:
            if r["type"] == "CNAME":
                r["content"] = r["content"].upper() + "."
                r["name"] = r["name"].upper()
        rc, out, _ = self.run_check(cf)
        self.assertEqual(rc, 0, out)

    def test_txt_values_compare_exactly_after_joining_255_byte_strings(self):
        cf = good_zone()
        for r in cf.records:
            if r["name"].startswith("resend._domainkey"):
                r["content"] = '"%s" "%s"' % (DKIM[:255], DKIM[255:])
        rc, out, _ = self.run_check(cf)
        self.assertEqual(rc, 0, out)

    def test_spf_in_another_case_fails_because_txt_compares_exactly(self):
        cf = good_zone()
        for r in cf.records:
            if r["type"] == "TXT" and r["name"] == "polycarpic.com":
                r["content"] = '"V=SPF1 -ALL"'
        self.assertFails(*self.run_check(cf), "@", "TXT")

    def test_unknown_name_or_type_fails_naming_it(self):
        cf = good_zone()
        cf.add("TXT", "planted", '"hello"')
        rc, out, _ = self.run_check(cf)
        self.assertFails(rc, out, "planted TXT")
        self.assertTrue(self.line(out, "FAIL", "planted TXT").startswith("FAIL planted TXT"))

    def test_planted_record_on_a_later_page_is_found(self):
        cf = good_zone()
        cf.page_size = 5
        cf.add("TXT", "planted", '"hello"')
        self.assertFails(*self.run_check(cf), "planted TXT")

    def test_wildcard_fails(self):
        cf = good_zone()
        cf.add("A", "*", IPV4)
        self.assertFails(*self.run_check(cf), "*")

    def test_cname_to_anywhere_else_fails_and_so_does_a_third_cname(self):
        cf = good_zone()
        for r in cf.records:
            if r["name"].startswith("send.mail"):
                r["content"] = "evil.example.net"
        self.assertFails(*self.run_check(cf), "send.mail", "CNAME")
        cf = good_zone()
        cf.add("CNAME", "www", "app.polycarpic.com")
        self.assertFails(*self.run_check(cf), "www", "CNAME")

    def test_value_differing_from_its_pin_fails_for_dmarc_dkim_and_mx(self):
        for name, typ, new in (("_dmarc", "TXT", '"v=DMARC1; p=none"'), ("resend._domainkey.mail", "TXT", '"%s"' % (DKIM[:-5] + "XXXXX")), ("polycarpic.com", "MX", "mail.example.net")):
            cf = good_zone()
            for r in cf.records:
                if r["type"] == typ and r["name"].startswith(name.split(".")[0]) and (name != "polycarpic.com" or r["name"] == "polycarpic.com"):
                    r["content"] = new
            rc, out, _ = self.run_check(cf)
            self.assertEqual(rc, 1, name)
            self.line(out, "FAIL", typ)

    def test_a_changed_dkim_names_the_repin_fix(self):
        cf = good_zone()
        for r in cf.records:
            if r["name"].startswith("resend._domainkey"):
                r["content"] = '"%s"' % (DKIM[:-5] + "XXXXX")
        rc, out, _ = self.run_check(cf)
        self.assertIn("confirm a Resend key rotation, then re-pin in dns-allowed.json", self.line(out, "FAIL", "resend._domainkey"))

    def test_ruf_in_dmarc_fails_whatever_the_pin_says(self):
        cf = good_zone()
        for r in cf.records:
            if r["name"].startswith("_dmarc"):
                r["content"] = '"v=DMARC1; p=reject; sp=reject; adkim=s; aspf=r; ruf=mailto:x@example.com"'
        rc, out, _ = self.run_check(cf)
        self.assertFails(rc, out, "_dmarc", "ruf")

    def test_caa_must_be_exactly_the_three_rows(self):
        cf = good_zone()
        cf.records = [r for r in cf.records if not (r["type"] == "CAA" and "sectigo" in r["content"])]
        self.assertFails(*self.run_check(cf), "CAA")
        cf = good_zone()
        cf.add("CAA", "@", '0 issue "digicert.com"')
        self.assertFails(*self.run_check(cf), "CAA", "digicert")

    def test_two_records_for_one_name_and_type_fail(self):
        cf = good_zone()
        cf.add("A", "app", IPV4, ttl=300)
        rc, out, _ = self.run_check(cf)
        self.assertFails(rc, out, "app", "A")
        self.assertRegex(self.line(out, "FAIL", "app", "A"), r"(?i)two|duplicate|more than one")

    def test_proxied_true_fails_on_any_record(self):
        cf = good_zone()
        for r in cf.records:
            if r["name"] == "app.polycarpic.com" and r["type"] == "A":
                r["proxied"] = True
        self.assertFails(*self.run_check(cf), "app", "proxied")

    def test_ns_record_below_the_apex_fails(self):
        cf = good_zone()
        cf.add("NS", "sub", "ns1.example.net")
        self.assertFails(*self.run_check(cf), "sub NS")

    def test_app_address_not_equal_to_the_given_one_fails_naming_both(self):
        cf = good_zone()
        for r in cf.records:
            if r["name"] == "app.polycarpic.com" and r["type"] == "A":
                r["content"] = "198.51.100.9"
        rc, out, _ = self.run_check(cf)
        l = self.line(out, "FAIL", "app", "A")
        self.assertIn("198.51.100.9", l)
        self.assertIn(IPV4, l)
        self.assertEqual(rc, 1)

    def test_aaaa_mismatch_for_staging_fails(self):
        cf = good_zone()
        for r in cf.records:
            if r["name"] == "staging.polycarpic.com" and r["type"] == "AAAA":
                r["content"] = "2001:db8:9::1"
        self.assertFails(*self.run_check(cf), "staging", "AAAA")

    def test_fails_closed_when_result_info_reports_more_than_was_fetched(self):
        cf = good_zone()
        cf.lie_total = len(cf.records) + 40
        rc, out, err = self.run_check(cf)
        self.assertEqual(rc, 1, out)
        self.assertNotIn("DNS CHECK PASSED", out)

    def test_fails_closed_when_the_listing_says_success_false_or_the_token_is_refused(self):
        rc, out, err = self.run_check(FakeCF(fail_list=True))
        self.assertEqual(rc, 1)
        self.assertNotIn("DNS CHECK PASSED", out + err)
        cf = good_zone()
        cf.token = "some-other-token"
        rc, out, err = self.run_check(cf)
        self.assertEqual(rc, 1)
        self.assertNotIn("DNS CHECK PASSED", out + err)

    def test_target_health_resolves_both_targets_for_a_aaaa_and_caa_over_the_injected_transport(self):
        doh = FakeDoH()
        self.run_check(good_zone(), doh)
        for target in ("send.forge.rmta.net", "rsend-euw1.forge.rmta.net"):
            for typ in ("A", "AAAA", "CAA"):
                self.assertIn((target, typ), doh.seen)

    def test_an_a_aaaa_or_caa_answer_at_either_target_fails_with_the_stop_and_ask_fix(self):
        for target in ("send.forge.rmta.net", "rsend-euw1.forge.rmta.net"):
            for typ, code, data in (("A", 1, "192.0.2.10"), ("AAAA", 28, "2001:db8::10"), ("CAA", 257, '0 issue "letsencrypt.org"')):
                doh = FakeDoH({(target, typ): [{"name": target, "type": code, "TTL": 60, "data": data}]})
                rc, out, _ = self.run_check(good_zone(), doh)
                self.assertEqual(rc, 1, (target, typ))
                self.assertNotIn("DNS CHECK PASSED", out)
                l = self.line(out, "FAIL", target, typ)
                self.assertIn("stop and ask seceng; do not re-pin", l)

    def test_uses_a_read_only_transport_only_and_never_prints_the_token_or_headers(self):
        rc, out, err = self.run_check(good_zone())
        self.assertEqual({m for m, _ in self.net.log}, {"GET"})
        self.assertNoSecrets(out + err, SEC)
        self.assertNoSecretsOnDisk(SEC)
        self.assertEqual(len(self.gp_prompts), 1)

    def test_an_http_error_prints_the_provider_message_and_no_headers(self):
        cf = good_zone()
        cf.token = "other"
        rc, out, err = self.run_check(cf)
        self.assertEqual(rc, 1)
        self.assertIn("Invalid access token", out + err)
        self.assertNoSecrets(out + err, SEC)
        self.assertNotRegex(out + err, r"(?i)authorization:|bearer ")


if __name__ == "__main__":
    unittest.main()
