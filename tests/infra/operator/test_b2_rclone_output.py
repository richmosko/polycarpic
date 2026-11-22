"""POLY-98 R10, K11, S9: b2-setup.py --probe --show-rclone-output. Redact first, then cut to 4096 bytes, then filter; print only after the temporary key is deleted."""
import io
import unittest

from base import SECRETS, FakeB2, Net, ToolTest, load

TEMP_SECRET = "K004TEMPKEYSECRETxxxxxxxxxxxxxxxxxxx"  # what FakeB2 hands back for the temporary probe key
HEAD = "--- rclone output (temporary key already deleted) ---"
TAIL = "--- end ---"


class Rec(io.StringIO):
    def __init__(self, order):
        super().__init__()
        self.order = order

    def write(self, s):
        self.order.append(("out", s))
        return super().write(s)


class ShowRcloneOutput(ToolTest):
    def drive(self, args, runner):
        mod = load("b2-setup")
        b2 = FakeB2()
        net = Net(**{"backblazeb2.com": b2})
        order, err = [], io.StringIO()
        out = Rec(order)

        def transport(method, url, headers, body):
            order.append(("req", url.rsplit("/", 1)[-1]))
            return net(method, url, headers, body)

        vals = [SECRETS["b2_master_id"], SECRETS["b2_master_key"]]

        def fake_input(prompt=""):
            if "done" in prompt.lower():
                b2.regenerate_master()
                return "done"
            return "yes"

        rc = mod.main(list(args), transport=transport, getpass=lambda p="": vals.pop(0), input=fake_input, stdout=out, stderr=err, runner=runner,
                      env={"HOME": str(self.tmp), "PATH": "/usr/bin"}, home=str(self.tmp))
        self.order, self.b2 = order, b2
        return rc, out.getvalue(), err.getvalue()

    def five(self):
        tmp_id = "0049fixturekey%010d" % 1
        return [tmp_id, TEMP_SECRET, SECRETS["b2_master_id"], SECRETS["b2_master_key"], SECRETS["b2_token"]]

    def test_the_flag_without_probe_is_a_usage_error_exit_2_with_the_message(self):
        rc, out, err = self.drive(["--show-rclone-output"], lambda argv, env=None, stdin=None: (0, ""))
        self.assertEqual((rc, err), (2, "b2-setup.py: --show-rclone-output is only valid with --probe\n"))
        self.assertEqual(self.b2.requests, [])

    def test_probe_without_the_flag_prints_no_block(self):
        rc, out, err = self.drive(["--probe"], lambda argv, env=None, stdin=None: (1, "AccessDenied: some rclone words"))
        self.assertNotIn(HEAD, out)
        self.assertNotIn("some rclone words", out + err)

    def test_the_block_is_printed_after_the_probe_line_and_after_the_key_deletion_returned(self):
        rc, out, err = self.drive(["--probe", "--show-rclone-output"], lambda argv, env=None, stdin=None: (1, "AccessDenied: not authorized to perform s3:PutObject\n"))
        lines = out.splitlines()
        self.assertEqual(rc, 0, out + err)
        probe = [i for i, l in enumerate(lines) if l.startswith("PROBE:")]
        self.assertEqual(len(probe), 1)
        self.assertIn(HEAD, lines)
        self.assertGreater(lines.index(HEAD), probe[0])
        self.assertEqual(lines[lines.index(HEAD) + 1], "AccessDenied: not authorized to perform s3:PutObject")
        self.assertEqual(lines[lines.index(HEAD) + 2], TAIL)
        delete_at = [i for i, (k, v) in enumerate(self.order) if k == "req" and v == "b2_delete_key"][0]
        block_at = [i for i, (k, v) in enumerate(self.order) if k == "out" and HEAD in v][0]
        self.assertGreater(block_at, delete_at, "the block printed before the temporary key's deletion returned")

    def test_all_five_values_are_redacted_everywhere_in_the_block(self):
        vals = self.five()
        noisy = "\n".join("echo %d: %s" % (i, v) for i, v in enumerate(vals)) + "\nAuthorization: " + vals[4] + "\n"
        rc, out, err = self.drive(["--probe", "--show-rclone-output"], lambda argv, env=None, stdin=None: (1, noisy))
        self.assertIn("<redacted>", out)
        self.assertNoSecrets(out + err, vals, "output")
        self.assertEqual(out.count("<redacted>"), 6)

    def test_a_value_straddling_byte_4096_leaves_none_of_its_bytes(self):  # K11: redact, then cut
        text = "A" * (4096 - 10) + TEMP_SECRET + "B" * 200
        rc, out, err = self.drive(["--probe", "--show-rclone-output"], lambda argv, env=None, stdin=None: (1, text))
        self.assertIn(HEAD, out)
        block = out.split(HEAD + "\n", 1)[1].split("\n" + TAIL, 1)[0]
        self.assertLessEqual(len(block.encode()), 4096)
        for frag in (TEMP_SECRET[:6], TEMP_SECRET[-6:], "TEMPKEY"):
            self.assertNotIn(frag, out + err)

    def test_the_block_is_cut_to_4096_bytes(self):
        rc, out, err = self.drive(["--probe", "--show-rclone-output"], lambda argv, env=None, stdin=None: (1, "x" * 10000))
        self.assertIn(HEAD, out)
        block = out.split(HEAD + "\n", 1)[1].split("\n" + TAIL, 1)[0]
        self.assertLessEqual(len(block.encode()), 4096)
        self.assertGreater(len(block), 4000)

    def test_control_characters_from_rclone_never_reach_the_terminal(self):  # K3 filter on the block
        rc, out, err = self.drive(["--probe", "--show-rclone-output"], lambda argv, env=None, stdin=None: (1, "red \x1b[31malert\x1b[0m \x07bell\n"))
        self.assertNotIn("\x1b", out + err)
        self.assertNotIn("\x07", out + err)

    def test_rclones_verbosity_flags_are_never_added(self):
        seen = []

        def runner(argv, env=None, stdin=None):
            seen.append(list(argv))
            return (0, "")

        self.drive(["--probe", "--show-rclone-output"], runner)
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0][:3], ["rclone", "rcat", "--s3-no-head"])
        self.assertFalse([a for a in seen[0] if a in ("-v", "-vv", "--verbose", "--dump", "headers", "-vvv") or a.startswith("--dump")])


if __name__ == "__main__":
    unittest.main()
