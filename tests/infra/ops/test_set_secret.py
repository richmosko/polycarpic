"""POLY-98 R4, K3-K5: set-secret. Real files under a temp root; root ownership is the test uid (ctx.trusted_uid), the chown call is recorded."""
import getpass
import os
import re
import stat
import unittest
from unittest import mock

from base import OpsTest, REFUSED_PROVISION, Runner, mounts

OWNER = {"db_superuser_password": "provision", "auth_secret": "provision", "credential_keyring": "init-keyring", "staging_basic_auth": "staging-auth"}


def settable(project="prod"):
    refused = REFUSED_PROVISION | {"credential_keyring", "staging_basic_auth"}
    names = set(n for _, n, _ in mounts(project) if n not in refused)
    if project == "prod":
        names |= {"heartbeat_url"}  # POLY-99 H-1: host-only, written by set-secret under secrets/host/, mounted by no service
    return sorted(names)


class SetSecret(OpsTest):
    def put(self, name, *vals, staging=False, **kw):
        argv = ["set-secret"] + (["--staging"] if staging else []) + [name]
        return self.host.go(*argv, secrets=list(vals), **kw)

    def targets(self, name, staging=False):
        return [(s, p) for s, n, p in mounts("staging" if staging else "prod") if n == name]

    def on_disk(self, svc, name, staging=False):
        return self.host.secret_path(svc, name, staging)

    # ---- refusals
    def test_every_refused_name_exits_2_naming_who_writes_it_and_asks_for_nothing(self):
        for name, who in sorted(OWNER.items()) + [("db_password_%s" % s, "provision") for s in ("app", "auth", "worker", "migrator", "operator", "backup")]:
            r = self.put(name)
            self.assertEqual((r.rc, r.err, r.prompts), (2, "set-secret: %s is written by %s, not set-secret\n" % (name, who), []), name)

    def test_the_provision_refused_set_equals_the_set_provision_sh_generates(self):
        from base import REPO, need, ctx_class
        ctx_class()  # puts infra/ops on sys.path
        need(REPO / "infra" / "ops" / "lib" / "secrets.py")
        import importlib
        refused_by = importlib.import_module("lib.secrets").refused_by
        text = (REPO / "infra" / "provision.sh").read_text()
        generated = set()
        for var in ("PROD_GENERATED", "STAGING_GENERATED"):
            generated |= set(p.split("/")[1] for p in re.search(r'^%s="([^"]+)"' % var, text, re.M).group(1).split())
        every = set(n for p in ("prod", "staging") for _, n, _ in mounts(p)) | generated
        self.assertEqual(set(n for n in every if refused_by(n) == "provision"), generated)
        self.assertEqual(generated, REFUSED_PROVISION)
        self.assertEqual((refused_by("credential_keyring"), refused_by("staging_basic_auth"), refused_by("resend_api_key")), ("init-keyring", "staging-auth", None))

    def test_a_name_no_service_mounts_exits_2_with_the_list(self):
        r = self.put("oauth_google_secret")
        m = re.match(r"^set-secret: no service in (\S+) mounts oauth_google_secret; names you can set: (.+)\n$", r.err)
        self.assertTrue(m, r.err)
        self.assertEqual((r.rc, m.group(2).split(", ")), (2, settable()))
        self.assertEqual(r.prompts, [])

    def test_staging_has_no_uploader_so_its_two_names_are_unmounted_there(self):
        for name in ("heartbeat_url", "backup_store_credential"):
            r = self.put(name, staging=True)
            self.assertEqual(r.rc, 2, name)
            self.assertNotIn("heartbeat_url", r.err.split("names you can set:")[1])

    def test_bad_name_patterns_exit_2(self):
        for name in ("Resend", "-resend_api_key", "resend-api-key", "../x", "", "a" * 65, "resend api"):
            r = self.put(name)
            self.assertEqual(r.rc, 2, repr(name))
            self.assertEqual(r.prompts, [])

    # ---- reading
    def test_non_tty_exits_2_and_never_prompts(self):
        r = self.put("resend_api_key", tty=False)
        self.assertEqual((r.rc, r.err, r.prompts), (2, "set-secret reads from a terminal only\n", []))

    def test_values_that_break_the_rules_exit_2_and_write_nothing(self):
        for bad in ("", "has space", "tab\there", "new\nline", "esc\x1b[0m", "nul\x00x", "x" * 4097):
            r = self.put("resend_api_key", bad)
            self.assertEqual(r.rc, 2, repr(bad[:20]))
            self.assertFalse(self.on_disk("auth", "resend_api_key").exists())
        self.assertEqual(self.put("resend_api_key", "x" * 4096).rc, 0)  # K5 positive twin: 4096 bytes is accepted

    def test_heartbeat_url_must_start_https(self):
        for bad in ("http://hc-ping.example/u", "ftp://x", "hc-ping.example"):
            self.assertEqual(self.put("heartbeat_url", bad).rc, 2, bad)
        r = self.put("heartbeat_url", "https://hc-ping.example/00000000-0000-0000-0000-000000000000")
        self.assertEqual(r.rc, 0, r.err)

    def test_a_getpass_that_cannot_turn_echo_off_is_an_error_and_nothing_is_written(self):  # K5
        def warns():
            import warnings
            warnings.warn("Can not control echo on the terminal.", getpass.GetPassWarning)
            return "fxvalue"
        r = self.put("resend_api_key", warns)
        self.assertEqual(r.rc, 2)
        self.assertFalse(self.on_disk("auth", "resend_api_key").exists())
        self.assertFalse(self.on_disk("worker", "resend_api_key").exists())

    def test_prompt_text_is_exact(self):
        r = self.put("resend_api_key", "fxvalue")
        self.assertEqual(r.prompts, ["resend_api_key (input hidden): "])

    # ---- writing
    def test_resend_api_key_lands_in_auth_and_worker_0440_with_the_exact_output(self):
        v = self.fix()
        r = self.put("resend_api_key", v)
        self.assertEqual(r.rc, 0, r.err)
        lines = []
        for svc in ("auth", "worker"):
            f = self.on_disk(svc, "resend_api_key")
            self.assertEqual(f.read_text(), v + "\n")
            self.assertEqual(stat.S_IMODE(os.stat(str(f)).st_mode), 0o440)
            lines.append("written: %s (%d bytes, 0440 root:%d)" % (f, len(v) + 1, self.host.gid(svc)))
        lines.append("set-secret: resend_api_key written for auth, worker; run: sudo polycarpic-ops restart auth worker")
        self.assertEqual(r.out.splitlines(), lines)
        self.assertEqual(sorted((c[1], c[2]) for c in r.chowns), sorted([(0, self.host.gid("auth")), (0, self.host.gid("worker"))]))

    def test_the_recorded_chown_owner_is_root_whatever_the_trusted_uid(self):  # K12(c)
        r = self.put("resend_api_key", "fxvalue", trusted=os.getuid())
        self.assertEqual(r.rc, 0, r.err)
        self.assertTrue(r.chowns)
        self.assertTrue(all(c[1] == 0 for c in r.chowns), r.chowns)

    def test_under_umask_077_the_target_is_still_0440(self):  # K4
        os.umask(0o077)
        self.put("resend_api_key", "fxvalue")
        self.assertEqual(stat.S_IMODE(os.stat(str(self.on_disk("auth", "resend_api_key"))).st_mode), 0o440)

    def test_a_single_service_name_writes_one_file_and_names_the_restart(self):
        r = self.put("plaid_secret", "fxvalue")
        self.assertEqual(r.rc, 0)
        self.assertEqual(r.out.splitlines()[-1], "set-secret: plaid_secret written for web; run: sudo polycarpic-ops restart web")

    def test_heartbeat_url_is_host_only_written_under_secrets_host_root_root_0400_and_says_who_reads_it(self):
        """POLY-99 H-1 (ruling R10 correction): no service mounts it; root reads it."""
        r = self.put("heartbeat_url", "https://hc-ping.example/u")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(r.out.splitlines()[-1], "set-secret: heartbeat_url written; root reads it on the next backup or upload run")
        p = self.on_disk("host", "heartbeat_url")
        self.assertEqual(p.read_text(), "https://hc-ping.example/u\n")
        self.assertEqual(stat.S_IMODE(os.stat(str(p)).st_mode), 0o400)
        self.assertTrue(r.chowns and all(c[1:] == (0, 0) for c in r.chowns), r.chowns)  # root:root, not root:10005
        self.assertFalse(self.on_disk("uploader", "heartbeat_url").exists())

    def test_HOST_ONLY_is_pinned_exactly_and_no_host_only_name_is_compose_mounted(self):
        """Any addition to HOST_ONLY comes to seceng (ruling H-1)."""
        from base import ctx_class
        ctx_class()
        import importlib
        rules = importlib.import_module("lib.secrets")
        self.assertEqual(rules.HOST_ONLY, {"heartbeat_url": "host"})
        mounted = set(n for p in ("prod", "staging") for _, n, _ in mounts(p))
        self.assertEqual(mounted & set(rules.HOST_ONLY), set())

    def test_a_host_only_name_outside_HOST_ONLY_is_refused_exit_2(self):
        r = self.put("not_a_secret_anyone_reads", "x")
        self.assertEqual(r.rc, 2)
        self.assertFalse(self.host.p("/etc/polycarpic/secrets/host/not_a_secret_anyone_reads").exists())

    def test_backup_store_credential_takes_two_prompts_and_is_two_lines(self):
        kid, key = "0049" + self.fix(), "K004" + self.fix()
        r = self.put("backup_store_credential", kid, key)
        self.assertEqual((r.rc, r.prompts), (0, ["key id (input hidden): ", "application key (input hidden): "]))
        self.assertEqual(self.on_disk("uploader", "backup_store_credential").read_text(), kid + "\n" + key + "\n")
        self.assertNoTrace(kid, r, [self.on_disk("uploader", "backup_store_credential")])
        self.assertNoTrace(key, r, [self.on_disk("uploader", "backup_store_credential")])

    def test_staging_writes_only_the_staging_tree_from_staging_yml(self):
        r = self.put("resend_api_key", "fxvalue", staging=True)
        self.assertEqual(r.rc, 0, r.err)
        self.assertTrue(self.on_disk("auth", "resend_api_key", staging=True).exists())
        self.assertFalse(self.on_disk("auth", "resend_api_key").exists())

    def test_nothing_runs_as_a_child_process(self):
        r = self.put("resend_api_key", "fxvalue")
        self.assertEqual(r.runner.calls, [])

    # ---- replacing
    def test_replacing_asks_with_the_exact_prompt_and_anything_but_yes_leaves_the_old_file(self):
        self.host.secret("auth", "resend_api_key", "old\n")
        for answer in ("no", "y", "YES", "", "yes "):
            r = self.put("resend_api_key", "fxnewvalue", confirm=answer)
            self.assertEqual((r.rc, r.err), (1, "not replaced\n"), answer)
            self.assertEqual(r.confirms, ["resend_api_key exists for: auth; type yes to replace:"])
            self.assertEqual(r.prompts, [], "a refused replace shows no value prompt at all")
            self.assertEqual(self.on_disk("auth", "resend_api_key").read_text(), "old\n")
            self.assertFalse(self.on_disk("worker", "resend_api_key").exists(), "nothing written for the other service either")

    def test_b4_a_secret_pasted_at_the_replace_question_is_refused_and_appears_nowhere(self):
        pasted = self.fix()
        self.host.secret("auth", "resend_api_key", "old\n")
        r = self.put("resend_api_key", "fxnewvalue", confirm=pasted)
        self.assertEqual((r.rc, r.err), (1, "not replaced\n"))
        self.assertNoTrace(pasted, r)
        self.assertEqual(self.on_disk("auth", "resend_api_key").read_text(), "old\n")

    def test_yes_replaces_every_target(self):
        self.host.secret("auth", "resend_api_key", "old\n")
        self.host.secret("worker", "resend_api_key", "old\n")
        r = self.put("resend_api_key", "fxnewvalue", confirm="yes")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(r.confirms, ["resend_api_key exists for: auth, worker; type yes to replace:"])
        self.assertEqual(r.events, ["confirm", "getpass"], "R4 order: the yes question first, then the hidden value prompt")
        for svc in ("auth", "worker"):
            self.assertEqual(self.on_disk(svc, "resend_api_key").read_text(), "fxnewvalue\n")

    # ---- directory and symlink safety
    def test_a_bad_directory_is_refused_before_any_question_or_prompt(self):
        os.chmod(str(self.host.p("/etc/polycarpic/secrets/auth")), 0o755)
        self.host.secret("worker", "resend_api_key", "old\n")
        r = self.put("resend_api_key", "fxvalue", confirm="yes")
        self.assertEqual((r.rc, r.events), (4, []))

    def test_a_symlinked_service_directory_exits_4_with_nothing_written_anywhere(self):
        d = self.host.p("/etc/polycarpic/secrets/worker")
        other = self.tmp / "elsewhere"
        d.rename(other)
        os.symlink(str(other), str(d))
        r = self.put("resend_api_key", "fxvalue")
        self.assertEqual(r.rc, 4)
        self.assertTrue(r.err.startswith("%s is not root:" % d), r.err)
        self.assertFalse(self.on_disk("auth", "resend_api_key").exists())
        self.assertEqual(os.listdir(str(other)), [])

    def test_a_symlinked_target_file_exits_4_with_nothing_written(self):
        victim = self.tmp / "victim"
        victim.write_text("untouched\n")
        os.symlink(str(victim), str(self.on_disk("worker", "resend_api_key")))
        r = self.put("resend_api_key", "fxvalue", confirm="yes")
        self.assertEqual(r.rc, 4)
        self.assertEqual(victim.read_text(), "untouched\n")
        self.assertFalse(self.on_disk("auth", "resend_api_key").exists())

    def test_a_directory_that_is_not_0750_exits_4_with_the_run_provision_message(self):
        d = self.host.p("/etc/polycarpic/secrets/auth")
        os.chmod(str(d), 0o755)
        r = self.put("resend_api_key", "fxvalue")
        self.assertEqual((r.rc, r.err), (4, "%s is not root:%d 0750: run provision\n" % (d, os.stat(str(d)).st_gid)))
        self.assertFalse(self.on_disk("worker", "resend_api_key").exists())

    def test_a_missing_directory_exits_4(self):
        os.rmdir(str(self.host.p("/etc/polycarpic/secrets/worker")))
        r = self.put("resend_api_key", "fxvalue")
        self.assertEqual(r.rc, 4)

    # ---- failure and leaks
    def test_a_fault_between_write_and_rename_leaves_no_temporary_file(self):  # K4
        seen = {}
        real = os.rename

        def boom(src, dst, *a, **k):
            d = k.get("src_dir_fd")
            seen["mode"] = stat.S_IMODE(os.stat(src, dir_fd=d).st_mode) if d is not None else stat.S_IMODE(os.stat(src).st_mode)
            raise OSError(5, "injected")

        with mock.patch("os.rename", boom), mock.patch("os.replace", boom):
            r = self.put("resend_api_key", "fxvalue")
        self.assertEqual(r.rc, 1)
        self.assertEqual(seen.get("mode"), 0o440, "the temporary file is 0440 before the rename")
        for svc in ("auth", "worker"):
            self.assertEqual(os.listdir(str(self.host.p("/etc/polycarpic/secrets/" + svc))), [])

    def test_the_value_appears_in_no_output_argv_env_prompt_or_file_but_its_targets(self):
        v = self.fix()
        r = self.put("resend_api_key", v)
        self.assertNoTrace(v, r, [self.on_disk("auth", "resend_api_key"), self.on_disk("worker", "resend_api_key")])

    def test_no_fingerprint_only_a_byte_count_is_printed(self):
        v = self.fix()
        r = self.put("resend_api_key", v)
        for frag in (v[:6], v[-6:]):
            self.assertNotIn(frag, r.out + r.err)


if __name__ == "__main__":
    unittest.main()
