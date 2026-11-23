"""POLY-100 G5: the box's GitHub token and the signers file (R11; T17, T18, S8, S9). No child process may run in either command."""
import base64
import hashlib
import io
import os
import re
import stat

from base import REPO, OpsTest, ctx_class
from deploy_base import World

TOKEN_PATH = "/etc/polycarpic/secrets/host/github_read_token"
SIGNERS = "/etc/polycarpic/allowed_signers"


class Token(OpsTest):
    def fresh(self):
        return "github_pat_" + os.urandom(41).hex()[:82]  # built at run time

    def put(self, v, **kw):
        return self.host.go("set-secret", "github_read_token", secrets=[v], **kw)

    def test_t18_host_only_is_exactly_two_names_in_both_places(self):
        ctx_class()
        import importlib
        self.assertEqual(importlib.import_module("lib.secrets").HOST_ONLY, {"heartbeat_url": "host", "github_read_token": "host"})
        m = re.search(r'^HOST_ONLY="([^"]*)"', (REPO / "infra" / "provision-check.sh").read_text(), re.M)
        self.assertIsNotNone(m)
        self.assertEqual(sorted(m.group(1).split()), ["github_read_token=host", "heartbeat_url=host"])

    def test_t18_a_classic_token_is_refused_with_exit_2_and_nothing_written(self):
        for bad in ("ghp_" + "a" * 36, "gho_" + "a" * 36, "github_pat_" + "a" * 81, "github_pat_" + "a" * 83, "github_pat_" + "a" * 81 + "-", "x github_pat_" + "a" * 82,
                    "github_pat_" + "a" * 82 + " ", ""):
            r = self.put(bad)
            self.assertEqual(r.rc, 2, repr(bad[:14]))
            self.assertFalse(self.host.p(TOKEN_PATH).exists())
            if bad.strip():
                self.assertNotIn(bad, r.out + r.err + "".join(r.prompts))

    def test_t18_a_fine_grained_token_is_written_0400_root_in_host_and_never_printed(self):
        v = self.fresh()
        r = self.put(v)
        self.assertEqual(r.rc, 0, r.err)
        f = self.host.p(TOKEN_PATH)
        self.assertEqual(f.read_text(), v + "\n")
        self.assertEqual(stat.S_IMODE(os.stat(str(f)).st_mode), 0o400)
        self.assertEqual(stat.S_IMODE(os.stat(str(f.parent)).st_mode), 0o700)
        self.assertTrue(all(c[1] == 0 and c[2] == 0 for c in r.chowns), r.chowns)
        self.assertEqual(r.runner.calls, [])
        self.assertNoTrace(v, r, extra_paths=[f])

    def test_t18_list_secrets_shows_state_and_mode_and_never_the_value(self):
        v = self.fresh()
        self.assertEqual(self.put(v).rc, 0)
        r = self.host.go("list-secrets")
        self.assertEqual(r.rc, 0, r.err)
        self.assertIn("github_read_token", r.out)
        self.assertRegex(r.out, r"(?m)^host\s+github_read_token\s+set\s+0400\s")
        self.assertNotIn(v, r.out + r.err)


class Signers(OpsTest):
    def setUp(self):
        super().setUp()
        self.world = World(self.tmp)
        _, self.k1 = self.world.keygen("s1")
        _, self.k2 = self.world.keygen("s2")

    def install(self, text, confirm=None, **kw):
        return self.host.go("allowed-signers", "install", ctx_extra={"stdin": io.StringIO(text)}, confirm=confirm, **kw)

    def line(self, key, who="rel1"):
        return '%s namespaces="git" %s' % (who, key)

    def fp(self, key):
        blob = base64.b64decode(key.split()[1])
        return "SHA256:" + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("=")

    def test_t17_only_the_plain_form_is_accepted_and_each_other_form_exits_2_writing_nothing(self):
        bad = {
            "cert-authority": 'rel cert-authority namespaces="git" %s' % self.k1,
            "a second namespace": 'rel namespaces="git,file" %s' % self.k1,
            "no namespaces option": "rel %s" % self.k1,
            "valid-before": 'rel valid-before="20300101" namespaces="git" %s' % self.k1,
            "valid-after": 'rel namespaces="git" valid-after="20200101" %s' % self.k1,
            "an ecdsa key": 'rel namespaces="git" ecdsa-sha2-nistp256 %s' % self.k1.split()[1],
            "an rsa key": 'rel namespaces="git" ssh-rsa %s' % self.k1.split()[1],
            "garbage": "not a signers line",
            "no lines": "",
            "only a comment": "# nothing here\n",
        }
        for label, text in bad.items():
            r = self.install(text + "\n", confirm="yes")
            self.assertEqual(r.rc, 2, label + ": " + r.err)
            self.assertFalse(self.host.p(SIGNERS).exists(), label)
            self.assertEqual(r.runner.calls, [], label)
        # one bad line among good ones refuses the whole file
        r = self.install(self.line(self.k1) + "\n" + bad["cert-authority"] + "\n", confirm="yes")
        self.assertEqual(r.rc, 2)
        self.assertFalse(self.host.p(SIGNERS).exists())

    def test_t17_the_plain_form_is_written_root_0644_and_the_fingerprints_are_printed(self):
        text = self.line(self.k1, "a") + "\n" + self.line(self.k2, "b") + "\n"
        r = self.install(text)
        self.assertEqual(r.rc, 0, r.err)
        f = self.host.p(SIGNERS)
        self.assertEqual(f.read_text(), text)
        self.assertEqual(stat.S_IMODE(os.stat(str(f)).st_mode), 0o644)
        self.assertTrue(all(c[1] == 0 and c[2] == 0 for c in r.chowns), r.chowns)
        for k in (self.k1, self.k2):
            self.assertIn(self.fp(k), r.out)
        self.assertEqual(r.runner.calls, [])

    def test_t17_replacing_an_existing_file_asks_for_yes_and_anything_else_changes_nothing(self):
        old = self.line(self.k1) + "\n"
        self.assertEqual(self.install(old).rc, 0)
        new = self.line(self.k2) + "\n"
        for answer in ("no", "", "y", "YES"):
            r = self.install(new, confirm=answer)
            self.assertNotEqual(r.rc, 0, answer)
            self.assertEqual(self.host.p(SIGNERS).read_text(), old, answer)
        r = self.install(new, confirm="yes")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(self.host.p(SIGNERS).read_text(), new)
        self.assertEqual(len(r.confirms), 1)

    def test_t17_comment_lines_are_not_the_plain_form_so_the_whole_file_is_refused(self):
        for text in ("# a note\n" + self.line(self.k1) + "\n", self.line(self.k1) + "\n# trailing\n"):
            r = self.install(text, confirm="yes")
            self.assertEqual(r.rc, 2, text)
            self.assertFalse(self.host.p(SIGNERS).exists())
        self.assertEqual(self.install('rel namespaces="git" cert-authority %s\n' % self.k1, confirm="yes").rc, 2)
