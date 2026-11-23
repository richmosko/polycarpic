"""POLY-100 T-sauth (R11, S29, S30). The Caddyfile imports the staging basic-auth file as Caddyfile text, so the file must be one exact line, root:10010, 0440, in a root:10010 0750
directory; the command reads a pasted htpasswd line at a hidden prompt only. Written from the ruling (6747ce07); the box-ownership half runs in the provision job."""
import getpass
import os
import random
import re
import stat
import string
import sys
import unittest
from unittest import mock

from base import OPS, REPO, OpsTest, Runner

PATH = "/etc/polycarpic/secrets/caddy/staging_basic_auth"
DIR = "/etc/polycarpic/secrets/caddy"
B64 = "./" + string.ascii_letters + string.digits


def hash53(seed=0):
    r = random.Random(seed)
    return "".join(r.choice(B64) for _ in range(53))  # built at run time: never a literal credential


def good_line(seed=0):
    return "staging:$2y$10$" + hash53(seed)


def stored(seed=0):
    return "staging $2y$10$" + hash53(seed) + "\n"


class StagingAuth(OpsTest):
    def setUp(self):
        super().setUp()
        self.host.mkdir(DIR, 0o750)
        if str(OPS) not in sys.path:
            sys.path.insert(0, str(OPS))
        from lib import sauth
        self.sauth = sauth
        self.owner = lambda fd, path: (os.getuid(), sauth.GID)  # the seam: a unit test cannot own group 10010

    def runner(self):
        r = Runner(None)
        r.on(lambda a: "ps" in a, out="")
        return r

    def put(self, value, **kw):
        kw.setdefault("tty", True)
        return self.host.go("staging-auth", secrets=[value], runner=self.runner(), ctx_extra={"owner_of": self.owner}, **kw)

    def file(self):
        return self.host.p(PATH)

    # ---- the command's input ----
    def test_a_pasted_htpasswd_line_is_written_as_the_one_exact_line_0440_and_never_shown(self):
        v = good_line(1)
        r = self.put(v)
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(self.file().read_text(), stored(1))
        self.assertEqual(stat.S_IMODE(os.stat(str(self.file())).st_mode), 0o440)
        self.assertTrue(any(c[1] == 0 and c[2] == self.sauth.GID for c in r.chowns), r.chowns)
        self.assertRegex(r.out, r"written: %s \(\d+ bytes, 0440 root:10010\)" % re.escape(PATH))
        self.assertNoTrace(hash53(1), r, extra_paths=[self.file()])
        for c in r.runner.calls:
            self.assertNotIn(hash53(1), repr(c))

    def test_every_other_input_is_refused_with_exit_2_nothing_written_and_not_echoed(self):
        bad = {
            "a pasted password": "correct-horse-battery-staple-" + hash53(2)[:8],
            "another cost": "staging:$2y$12$" + hash53(3),
            "another user": "admin:$2y$10$" + hash53(4),
            "an extra line": good_line(5) + "\n" + good_line(6),
            "a trailing newline": good_line(7) + "\n",
            "bcrypt $2a$": "staging:$2a$10$" + hash53(8),
            "a short hash": "staging:$2y$10$" + hash53(9)[:52],
            "a long hash": "staging:$2y$10$" + hash53(10) + "x",
            "a bad character": "staging:$2y$10$" + hash53(11)[:52] + "!",
            "text after": good_line(12) + " respond 200",
            "a directive": 'staging:$2y$10$' + hash53(13)[:40] + '\nrespond "x"',
            "empty": "",
        }
        for label, v in bad.items():
            r = self.put(v)
            self.assertEqual(r.rc, 2, label + ": " + r.err)
            self.assertFalse(self.file().exists(), label)
            if len(v) > 12:
                self.assertNotIn(v, r.out + r.err + r.term.getvalue() + "".join(r.prompts + r.confirms), label)

    def test_no_terminal_and_unhidden_echo_are_refused_exit_2(self):
        r = self.put(good_line(14), tty=False)
        self.assertEqual((r.rc, self.file().exists()), (2, False))

        def echoes():
            import warnings
            warnings.warn("Can not control echo on the terminal.", getpass.GetPassWarning)
            return good_line(15)
        r = self.put(echoes)
        self.assertEqual((r.rc, self.file().exists()), (2, False))
        self.assertNotIn(hash53(15), r.out + r.err)

    def test_replacing_asks_for_yes_and_anything_else_leaves_the_file_unchanged(self):
        self.assertEqual(self.put(good_line(16)).rc, 0)
        for answer in ("no", "", "y", "YES"):
            r = self.put(good_line(17), confirm=answer)
            self.assertNotEqual(r.rc, 0, answer)
            self.assertEqual(self.file().read_text(), stored(16), answer)
        r = self.put(good_line(17), confirm="yes")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(self.file().read_text(), stored(17))

    def test_the_value_is_read_at_the_prompt_only(self):
        # no argument, option, environment variable or pipe carries it
        r = self.host.go("staging-auth", good_line(18), runner=self.runner(), ctx_extra={"owner_of": self.owner})
        self.assertEqual(r.rc, 2)
        self.assertFalse(self.file().exists())

    def test_the_directory_must_be_root_10010_0750_before_anything_is_written(self):
        os.chmod(str(self.host.p(DIR)), 0o770)
        r = self.put(good_line(19))
        self.assertNotEqual(r.rc, 0)
        self.assertFalse(self.file().exists())
        os.chmod(str(self.host.p(DIR)), 0o750)
        r = self.host.go("staging-auth", secrets=[good_line(19)], runner=self.runner(), tty=True, ctx_extra={"owner_of": lambda fd, p: (os.getuid(), 4242)})
        self.assertNotEqual(r.rc, 0, "a directory in another group (the group comes from the owner seam, not from the directory)")
        self.assertFalse(self.file().exists())

    def test_provision_installs_no_apache2_utils(self):
        self.assertNotIn("apache2-utils", (REPO / "infra" / "provision.sh").read_text())


class FileCheck(unittest.TestCase):
    """The reader every deploy path shares (sauth.check): one exact file, exact owner/groups/modes. Bad variants each produce a reason; the good file none."""

    def setUp(self):
        import shutil
        import tempfile
        if str(OPS) not in sys.path:
            sys.path.insert(0, str(OPS))
        from lib import sauth
        from lib.ctx import Ctx
        self.sauth = sauth
        self.tmp = tempfile.mkdtemp(prefix="poly100-sauth-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.d = os.path.join(self.tmp, DIR.lstrip("/"))
        os.makedirs(self.d, mode=0o750)
        os.chmod(self.d, 0o750)
        self.ctx = Ctx(root=self.tmp, trusted_uid=os.getuid())
        p = mock.patch.object(sauth, "GID", os.stat(self.d).st_gid)
        p.start()
        self.addCleanup(p.stop)

    def write(self, data, mode=0o440):
        f = os.path.join(self.d, "staging_basic_auth")
        if os.path.lexists(f):
            os.unlink(f)
        with open(f, "wb") as fh:
            fh.write(data)
        os.chmod(f, mode)

    def test_the_good_file_passes(self):
        self.write(stored(20).encode())
        self.assertIsNone(self.sauth.check(self.ctx))

    def test_each_bad_variant_is_refused(self):
        good = stored(21).encode()
        variants = {
            "a second line": good + b'respond "x"\n',
            "two trailing newlines": good + b"\n",
            "crlf": good[:-1] + b"\r\n",
            "129 bytes": b"staging $2y$10$" + b"a" * 114 + b"\n",
            "no newline": good[:-1],
            "colon form (the htpasswd line itself)": good.replace(b"staging ", b"staging:", 1),
            "another cost": good.replace(b"$10$", b"$12$", 1),
            "non-ascii": good[:-2] + "é".encode() + b"\n",
            "empty": b"",
        }
        for label, data in variants.items():
            self.write(data)
            self.assertIsNotNone(self.sauth.check(self.ctx), label)
        self.write(good, mode=0o460)
        self.assertIsNotNone(self.sauth.check(self.ctx), "group-writable")
        self.write(good, mode=0o444)
        self.assertIsNotNone(self.sauth.check(self.ctx), "world-readable")
        self.write(good, mode=0o640)
        self.assertIsNotNone(self.sauth.check(self.ctx), "0640")

    def test_missing_symlink_and_directory_modes(self):
        self.assertIsNotNone(self.sauth.check(self.ctx), "file missing")
        other = os.path.join(self.tmp, "other")
        with open(other, "wb") as fh:
            fh.write(stored(22).encode())
        os.symlink(other, os.path.join(self.d, "staging_basic_auth"))
        self.assertIsNotNone(self.sauth.check(self.ctx), "a symlink is never followed")
        os.unlink(os.path.join(self.d, "staging_basic_auth"))
        self.write(stored(22).encode())
        os.chmod(self.d, 0o770)
        self.assertIsNotNone(self.sauth.check(self.ctx), "directory group-writable")
        os.chmod(self.d, 0o750)
        self.assertIsNone(self.sauth.check(self.ctx))
        with mock.patch.object(self.sauth, "GID", self.sauth.GID + 1):
            self.assertIsNotNone(self.sauth.check(self.ctx), "the group is compared with 10010 itself, not taken from the directory")

    def test_the_grammar_is_a_full_match_not_a_dollar_anchored_search(self):
        self.write(stored(23).encode() + b"respond 200\n")
        self.assertIsNotNone(self.sauth.check(self.ctx), "a `$` anchor would let a trailing newline or a second line through")
        self.write(b"x\n" + stored(23).encode())
        self.assertIsNotNone(self.sauth.check(self.ctx), "the line is not found by search")


if __name__ == "__main__":
    unittest.main()


class FileGroup(unittest.TestCase):
    """The file's own group is compared, not the directory's: the owner seam answers a different group for the file than for the directory."""

    setUp = FileCheck.setUp
    write = FileCheck.write

    def test_a_file_in_another_group_inside_a_correct_directory_is_refused(self):
        self.write(stored(24).encode())
        g = self.sauth.GID

        def owner(fd, path):
            return (os.getuid(), g if path == DIR else g + 1)
        from lib.ctx import Ctx
        ctx = Ctx(root=self.tmp, trusted_uid=os.getuid(), owner_of=owner)
        self.assertIsNotNone(self.sauth.check(ctx))
        ctx2 = Ctx(root=self.tmp, trusted_uid=os.getuid(), owner_of=lambda fd, path: (os.getuid() + 1, g))
        self.assertIsNotNone(self.sauth.check(ctx2), "another owner")
