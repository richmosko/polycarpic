"""POLY-98 R5: list-secrets prints a table from stat only and never opens a secret file."""
import builtins
import io
import os
import unittest
from unittest import mock

from base import OpsTest, mounts


def row(svc, name, state="", mode="", owner="", size=""):
    line = "%-9s %-25s %-8s %-4s %-13s %5s" % (svc, name, state, mode, owner, size)
    return line.rstrip()


class ListSecrets(OpsTest):
    def expected(self, project="prod", wrong=None):
        staging = project == "staging"
        lines = [row("SERVICE", "NAME", "STATE", "MODE", "OWNER", "BYTES")]
        counts = dict(set=0, missing=0, wrong=0)
        rows = list(mounts(project))
        if project == "prod":
            rows = sorted(rows + [("host", "heartbeat_url", "")])  # POLY-99 H-1: host-only, root:root 0400, no service mounts it
        for svc, name, _ in rows:
            f = self.host.secret_path(svc, name, staging)
            if not f.exists() and not f.is_symlink():
                lines.append(row(svc, name, "missing"))
                counts["missing"] += 1
                continue
            st = os.lstat(str(f))
            owner = "root:%d" % st.st_gid
            if wrong and (svc, name) in wrong:
                lines.append(row(svc, name, "WRONG", "%04o" % (st.st_mode & 0o7777), owner, st.st_size))
                counts["wrong"] += 1
            else:
                lines.append(row(svc, name, "set", "0400" if svc == "host" else "0440", owner, st.st_size))
                counts["set"] += 1
        tail = "%d files: %d set, %d missing" % (len(rows), counts["set"], counts["missing"])
        if counts["wrong"]:
            tail += "; %d wrong: run provision-check" % counts["wrong"]
        return lines + [tail]

    def plant_some(self, staging=False):
        self.host.secret("auth", "auth_secret", "x" * 44 + "\n", staging)
        self.host.secret("auth", "db_password_auth", "y" * 44 + "\n", staging)
        self.host.secret("worker", "resend_api_key", "fxvalue\n", staging)
        self.host.secret("web", "db_password_app", "z" * 44 + "\n", staging)

    def test_the_exact_table_on_a_fixture_tree_exit_0_missing_files_do_not_fail(self):
        self.plant_some()
        r = self.host.go("list-secrets")
        self.assertEqual((r.rc, r.err), (0, ""))
        self.assertEqual(r.out.splitlines(), self.expected())
        self.assertTrue(all(len(l) <= 80 for l in r.out.splitlines()))

    def test_the_host_only_heartbeat_url_is_listed_0400_set_and_0440_is_wrong(self):
        self.host.secret("host", "heartbeat_url", "https://hc-ping.example/u\n", mode=0o400)
        r = self.host.go("list-secrets")
        self.assertIn("set      0400", [l for l in r.out.splitlines() if l.startswith("host ")][0])
        os.unlink(str(self.host.secret_path("host", "heartbeat_url")))
        self.host.secret("host", "heartbeat_url", "https://hc-ping.example/u\n", mode=0o440)
        r = self.host.go("list-secrets")
        self.assertEqual(r.rc, 1)
        self.assertIn("WRONG    0440", [l for l in r.out.splitlines() if l.startswith("host ")][0])

    def test_staging_reads_the_staging_tree_and_compose_file(self):
        self.plant_some(staging=True)
        r = self.host.go("list-secrets", "--staging")
        self.assertEqual(r.out.splitlines(), self.expected("staging"))
        self.assertNotIn("heartbeat_url", r.out)

    def test_a_0644_file_is_wrong_exit_1_and_the_last_line_says_run_provision_check(self):
        self.plant_some()
        self.host.secret("web", "plaid_secret", "p\n", mode=0o644)
        r = self.host.go("list-secrets")
        self.assertEqual(r.rc, 1)
        self.assertEqual(r.out.splitlines(), self.expected(wrong={("web", "plaid_secret")}))
        self.assertIn("WRONG    0644", r.out)

    def test_a_symlink_is_wrong_not_followed(self):
        target = self.tmp / "elsewhere"
        target.write_text("v\n")
        os.symlink(str(target), str(self.host.secret_path("web", "plaid_secret")))
        r = self.host.go("list-secrets")
        self.assertEqual(r.rc, 1)
        line = [l for l in r.out.splitlines() if l.startswith("web") and "plaid_secret" in l][0]
        self.assertIn("WRONG", line)

    def test_no_secret_file_is_ever_opened(self):
        self.plant_some()
        root = str(self.host.p("/etc/polycarpic"))
        real_open, real_os_open = builtins.open, os.open

        def guard(path):
            p = str(path)
            if p.startswith(root) and ("/secrets/" in p or "/staging-secrets/" in p) and os.path.isfile(p):
                raise AssertionError("list-secrets opened a secret file: %s" % p)

        def fake_open(file, *a, **k):
            if not isinstance(file, int):
                guard(file)
            return real_open(file, *a, **k)

        def fake_os_open(path, *a, **k):
            guard(path)
            return real_os_open(path, *a, **k)

        with mock.patch.object(builtins, "open", fake_open), mock.patch.object(io, "open", fake_open), mock.patch.object(os, "open", fake_os_open):
            r = self.host.go("list-secrets")
        self.assertEqual(r.rc, 0, r.err)

    def test_no_child_process_is_run(self):
        self.assertEqual(self.host.go("list-secrets").runner.calls, [])


if __name__ == "__main__":
    unittest.main()
