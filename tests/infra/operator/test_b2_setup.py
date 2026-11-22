"""POLY-97 R8 (b2-setup.py), R6's box-key constant, R10: bucket read-back, the two API-made keys, the old-master 401, --probe."""
import json
import unittest

from base import BUCKET, BUCKET_ID, NEW_KEY_SECRET, OPDIR, SECRETS, FakeB2, Net, ToolTest

READ_SET = {"listBuckets", "listFiles", "readFiles", "readBucketRetentions", "readFileRetentions", "readFileLegalHolds", "readBucketEncryption"}
FORBIDDEN = {"deleteFiles", "bypassGovernance", "shareFiles", "listKeys", "writeKeys", "deleteKeys", "writeBucketRetentions", "writeFileRetentions", "writeFileLegalHolds", "writeBucketEncryption", "writeBuckets", "deleteBuckets", "writeFiles"}
MASTER = [SECRETS["b2_master_id"], SECRETS["b2_master_key"]]
SEC = list(SECRETS.values())
PUT = "polycarpic-put-only"
READ = "polycarpic-read"


def box_caps():
    return set(json.loads((OPDIR / "b2-capabilities.json").read_text())["capabilities"])


class B2Setup(ToolTest):
    def go(self, b2, args=(), answers=None, regenerate=True, runner=None):
        self.b2 = b2
        ans = dict(answers or {})
        if regenerate and "done" not in ans:
            ans["done"] = lambda p: (b2.regenerate_master(), "done")[1]
        self.net = Net(**{"backblazeb2.com": b2})
        return self.tool("b2-setup", list(args), self.net, secrets=list(MASTER), answers=ans, runner=runner)

    def test_the_box_key_constant_is_one_of_the_two_allowed_sets_and_never_widens(self):
        data = json.loads((OPDIR / "b2-capabilities.json").read_text())
        caps = set(data["capabilities"])
        self.assertIn(caps, ({"writeFiles"}, {"listBuckets", "writeFiles"}))
        self.assertEqual(data["bucketName"], BUCKET)
        self.assertFalse(caps & {"listFiles", "readFiles", "deleteFiles", "bypassGovernance", "writeBucketRetentions", "writeKeys", "deleteKeys", "listKeys"})

    def test_happy_path_prints_the_master_key_instruction_passes_the_bucket_checks_and_ends_exit_0(self):
        rc, out, err = self.go(FakeB2())
        self.assertEqual((rc, err), (0, ""), out)
        self.assertIn("Generate New Master Application Key", out)
        self.line(out, "PASS", "allPrivate")
        self.line(out, "PASS", "compliance")
        self.line(out, "PASS", "35")
        self.line(out, "PASS", "36")
        self.assertNotIn("FAIL", out)

    def test_creates_exactly_two_keys_with_exact_capability_sets_both_restricted_to_the_bucket(self):
        self.go(FakeB2())
        by = {c["keyName"]: c for c in self.b2.created}
        self.assertEqual(set(by), {PUT, READ})
        self.assertEqual(set(by[PUT]["capabilities"]), box_caps())
        self.assertEqual(len(by[PUT]["capabilities"]), len(set(by[PUT]["capabilities"])))
        extra = set(by[READ]["capabilities"]) - READ_SET
        self.assertTrue(all("lifecycle" in c.lower() for c in extra) and len(extra) <= 1, extra)
        self.assertTrue(READ_SET <= set(by[READ]["capabilities"]))
        self.assertFalse(set(by[READ]["capabilities"]) & FORBIDDEN)
        for c in by.values():
            self.assertEqual(c["bucketId"], BUCKET_ID)

    def test_each_new_keys_secret_is_printed_exactly_once_and_nothing_else_secret_is(self):
        rc, out, err = self.go(FakeB2())
        for secret in NEW_KEY_SECRET.values():
            self.assertEqual((out + err).count(secret), 1)
        self.assertNoSecrets(out + err, [SECRETS["b2_master_id"], SECRETS["b2_master_key"], SECRETS["b2_token"]])
        self.assertNotRegex(out + err, r"(?i)basic [a-z0-9+/=]{16,}|authorizationToken|authorization:")

    def test_no_secret_reaches_disk_and_credentials_come_from_getpass_only(self):
        self.go(FakeB2())
        self.assertNoSecretsOnDisk([SECRETS["b2_master_id"], SECRETS["b2_master_key"], SECRETS["b2_token"]] + list(NEW_KEY_SECRET.values()))
        self.assertEqual(len(self.gp_prompts), 2)  # the key id and the key, both hidden
        for p in self.in_prompts:
            self.assertNotRegex(p, r"(?i)key ?id|application ?key")

    def test_a_bucket_that_is_not_private_fails_with_exit_1(self):
        rc, out, _ = self.go(FakeB2(bucket={"bucketType": "allPublic"}))
        self.assertEqual(rc, 1)
        self.line(out, "FAIL", "allPrivate")

    def test_governance_mode_a_shorter_period_and_a_wrong_lifecycle_each_fail(self):
        cases = [
            ({"fileLockConfiguration": {"isClientAuthorizedToRead": True, "value": {"isFileLockEnabled": True, "defaultRetention": {"mode": "governance", "period": {"duration": 35, "unit": "days"}}}}}, "compliance"),
            ({"fileLockConfiguration": {"isClientAuthorizedToRead": True, "value": {"isFileLockEnabled": True, "defaultRetention": {"mode": "compliance", "period": {"duration": 30, "unit": "days"}}}}}, "35"),
            ({"fileLockConfiguration": {"isClientAuthorizedToRead": True, "value": {"isFileLockEnabled": False, "defaultRetention": {"mode": None, "period": None}}}}, "lock"),
            ({"lifecycleRules": [{"daysFromHidingToDeleting": 1, "daysFromUploadingToHiding": 40, "fileNamePrefix": ""}]}, "36"),
            ({"lifecycleRules": [{"daysFromHidingToDeleting": 7, "daysFromUploadingToHiding": 36, "fileNamePrefix": ""}]}, "1"),
        ]
        for bucket, needle in cases:
            rc, out, _ = self.go(FakeB2(bucket=bucket))
            self.assertEqual(rc, 1, bucket)
            self.line(out, "FAIL", needle)

    def test_encryption_is_reported_not_asserted(self):
        rc, out, _ = self.go(FakeB2(bucket={"defaultServerSideEncryption": {"isClientAuthorizedToRead": True, "value": {"mode": None}}}))
        self.assertEqual(rc, 0, out)
        self.assertRegex(out, r"(?i)encryption")
        self.assertNotRegex(out, r"(?i)FAIL[^\n]*encrypt")

    def test_an_existing_key_of_the_same_name_shows_its_capabilities_and_is_replaced_never_duplicated(self):
        b2 = FakeB2()
        old = b2.add_key(PUT, ["listBuckets", "writeFiles", "deleteFiles"])
        rc, out, _ = self.go(b2)
        self.assertEqual(rc, 0, out)
        self.assertIn("deleteFiles", out)  # its capabilities were shown
        self.assertIn(old["applicationKeyId"], b2.deleted)
        names = [k["keyName"] for k in b2.keys]
        self.assertEqual(sorted(names), sorted([PUT, READ]))

    def test_declining_the_delete_never_makes_a_second_key_with_one_name(self):
        b2 = FakeB2()
        b2.add_key(PUT, ["listBuckets", "writeFiles", "deleteFiles"])
        self.go(b2, answers={"delete": "no"}, regenerate=True)
        names = [k["keyName"] for k in b2.keys]
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(b2.deleted, [])

    def test_a_web_form_read_only_key_that_differs_from_the_read_set_is_replaced(self):
        b2 = FakeB2()
        old = b2.add_key(READ, ["listAllBucketNames", "listBuckets", "listFiles", "readFiles", "shareFiles"])
        rc, out, _ = self.go(b2)
        self.assertIn(old["applicationKeyId"], b2.deleted)
        new = [k for k in b2.keys if k["keyName"] == READ]
        self.assertEqual(len(new), 1)
        self.assertFalse(set(new[0]["capabilities"]) & FORBIDDEN)

    def test_the_read_back_lists_every_key_and_fails_one_outside_the_two_names_that_holds_the_bucket(self):
        b2 = FakeB2()
        b2.add_key("polycarpic-put", ["listBuckets", "writeFiles", "deleteFiles"])
        rc, out, _ = self.go(b2, answers={"delete": "no"})
        self.assertEqual(rc, 1)
        l = self.line(out, "FAIL", "polycarpic-put")
        self.assertIn("delete it", l)

    def test_a_key_for_another_bucket_is_not_a_failure(self):
        b2 = FakeB2()
        b2.add_key("other-project-key", ["listBuckets", "writeFiles"], bucket=False)
        rc, out, _ = self.go(b2)
        self.assertEqual(rc, 0, out)

    def test_the_read_back_fails_a_key_whose_capabilities_drifted_from_its_pin(self):
        b2 = FakeB2()
        orig = b2.__call__

        def drift(method, url, headers, body):
            status, data = orig(method, url, headers, body)
            if url.endswith("b2_list_keys"):
                for k in data["keys"]:
                    if k["keyName"] == PUT:
                        k["capabilities"] = sorted(set(k["capabilities"]) | {"deleteFiles"})
            return status, data

        self.b2 = b2
        net = Net(**{"backblazeb2.com": drift})
        ans = {"done": lambda p: (b2.regenerate_master(), "done")[1]}
        rc, out, err = self.tool("b2-setup", [], net, secrets=list(MASTER), answers=ans)
        self.assertEqual(rc, 1)
        self.line(out, "FAIL", PUT, "deleteFiles")

    def test_old_master_key_getting_401_after_regeneration_is_a_pass(self):
        rc, out, _ = self.go(FakeB2())
        self.line(out, "PASS", "master")
        self.assertRegex(out, r"(?i)never.*(store|saved)")  # the master key is never to be stored

    def test_old_master_key_still_valid_after_done_is_a_fail_with_exit_1(self):
        rc, out, _ = self.go(FakeB2(), regenerate=False)
        self.assertEqual(rc, 1)
        self.line(out, "FAIL", "master")

    def test_without_a_typed_yes_nothing_is_created_or_deleted_and_the_plan_names_both_keys(self):
        b2 = FakeB2()
        b2.add_key(PUT, ["writeFiles", "deleteFiles"])
        rc, out, _ = self.go(b2, answers={"yes": "no", "delete": "no"})
        self.assertEqual((b2.created, b2.deleted), ([], []))
        self.assertIn(PUT, out)
        self.assertIn(READ, out)

    def test_a_provider_error_exits_1_with_its_message_and_no_headers_or_tokens(self):
        b2 = FakeB2()
        b2.fail_create = "key limit reached (fixture)"
        rc, out, err = self.go(b2)
        self.assertEqual(rc, 1)
        self.assertIn("key limit reached (fixture)", out + err)
        self.assertNoSecrets(out + err, [SECRETS["b2_master_key"], SECRETS["b2_token"]])
        self.assertNotRegex(out + err, r"(?i)authorization:|basic [a-z0-9+/=]{16,}")

    def test_a_wrong_master_key_exits_1_with_backblazes_message(self):
        b2 = FakeB2()
        b2.master = ("other", "other")
        rc, out, err = self.go(b2)
        self.assertEqual(rc, 1)
        self.assertIn("Invalid credentials", out + err)

    def test_probe_creates_a_temporary_writefiles_only_key_uploads_one_probe_object_and_deletes_the_key(self):
        calls = []

        def runner(argv, env=None, stdin=None):
            calls.append((list(argv), dict(env or {})))
            return 0

        b2 = FakeB2()
        rc, out, err = self.go(b2, args=["--probe"], runner=runner, regenerate=False)
        self.assertEqual(rc, 0, out + err)
        probe_keys = [c for c in b2.created if set(c["capabilities"]) == {"writeFiles"}]
        self.assertEqual(len(probe_keys), 1)
        self.assertEqual(len(b2.created), 1)  # the probe makes no permanent key
        self.assertEqual(len(calls), 1)
        argv, env = calls[0]
        self.assertEqual(argv[0], "rclone")
        self.assertRegex(" ".join(argv), r"probe/\d{8}T?\d{6}|probe/\d{4}-\d{2}-\d{2}")
        self.assertTrue(b2.deleted, "the temporary key was deleted")
        joined = " ".join(argv)
        for s in list(NEW_KEY_SECRET.values()) + ["K004TEMPKEYSECRETxxxxxxxxxxxxxxxxxxx"]:
            self.assertNotIn(s, joined)  # the key reaches rclone through the child's environment, never argv
        self.assertRegex(out, r"(?i)success|accepted|uploaded")

    def test_probe_reports_a_refusal_and_still_deletes_the_temporary_key(self):
        b2 = FakeB2()
        rc, out, err = self.go(b2, args=["--probe"], runner=lambda argv, env=None, stdin=None: 1, regenerate=False)
        self.assertRegex(out + err, r"(?i)refus|fail|denied")
        self.assertTrue(b2.deleted)

    def test_probe_never_leaks_the_temporary_key(self):
        rc, out, err = self.go(FakeB2(), args=["--probe"], runner=lambda argv, env=None, stdin=None: 0, regenerate=False)
        self.assertNoSecrets(out + err, ["K004TEMPKEYSECRETxxxxxxxxxxxxxxxxxxx", SECRETS["b2_master_key"], SECRETS["b2_token"]])


if __name__ == "__main__":
    unittest.main()
