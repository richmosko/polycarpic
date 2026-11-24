"""POLY-100 F4 (ruling.md; build review F4): (a) every render runs with no network, as the render user (10020), with an empty HOME and the experimental remote flags off, so a remote `include` cannot be fetched;
(b) what was judged is what starts: the judged plain JSON (`ulimits.core` `{}` written back as 0) is saved root 0600 and rendered once more on stdin, and must equal the judged one; every other
compose call names only that file with -f. Written from the ruling, red on the build it was written against."""
import json
import os
import stat

from deploy_base import DeployTest, digest
from test_deploy_bundle import good_files, make_tar, sibling_digests

PREFIX = ["unshare", "--net", "--", "setpriv", "--reuid", "10020", "--regid", "10020", "--clear-groups", "--no-new-privs", "--", "docker", "compose"]
STATE = "/var/lib/polycarpic/state/deploy"


def last(r):
    return r.err.splitlines()[-1] if r.err.strip() else ""


class Render(DeployTest):
    def candidate(self, files=None):
        w = self.world
        x = digest("x")
        w.image("polycarpic", x, w.commit_b, bundle=make_tar(files or good_files()))
        w.attested.add((x, w.commit_b))
        for n, d in sibling_digests().items():
            w.image("polycarpic-" + n, d, w.commit_b)
            w.attested.add((d, w.commit_b))
        w.staging_run(w.commit_b, x)
        return x

    def saved(self, project="staging"):
        d = self.host.p("%s/%s" % (STATE, project))
        return sorted(n for n in os.listdir(str(d)) if n.startswith("render-") and n.endswith(".json"))

    def saved_of(self, x, project="staging"):
        """The candidate's own saved render (`current`'s is saved too when Postgres has to come up from it: ruling, step 2)."""
        return [n for n in self.saved(project) if n == "render-%s.json" % x.split(":")[1][:12]]

    # ---- (a) no network at render ----
    def test_every_render_is_isolated_unprivileged_with_an_empty_home_and_the_remote_flags_off(self):
        self.candidate()
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        configs = [c for c in r.world.compose_log if c["cmd"] == "config"]
        self.assertTrue(configs)
        self.assertEqual(r.world.config_wrapped, [True] * len(configs), "a render ran outside `unshare --net` / `setpriv`")
        for argv, env in r.world.wrapped_calls:
            self.assertEqual(argv[:len(PREFIX)], PREFIX, argv[:14])
            self.assertEqual(env.get("COMPOSE_EXPERIMENTAL_GIT_REMOTE"), "0")
            self.assertEqual(env.get("COMPOSE_EXPERIMENTAL_OCI_REMOTE"), "0")
            self.assertTrue(env.get("HOME") and env["HOME"] == env.get("XDG_CACHE_HOME"), "HOME and XDG_CACHE_HOME are one empty directory")
            self.assertNotEqual(env["HOME"], "/root")
        self.assertTrue(r.world.wrapped_calls)

    def test_a_remote_include_is_refused_as_guard_render_and_never_fetched(self):
        files = good_files()
        files["infra/compose/staging.yml"] = b"include:\n  - oci://example.invalid/evil:1\n" + files["infra/compose/staging.yml"]
        x = self.candidate(files)
        r = self.deploy("staging")
        self.assertEqual(r.world.network_attempts, 0, "Compose fetched a remote include while rendering")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused guard-render"), r.err)
        self.assertIn(x, self.state("staging", "quarantine"))
        self.assertEqual([c for c in r.world.compose_log if c["cmd"] in ("up", "run")], [])

    # ---- (b) what was judged is what starts ----
    def test_the_judged_render_is_saved_root_0600_with_core_written_back_as_zero(self):
        x = self.candidate()
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        names = self.saved_of(x)
        self.assertEqual(len(names), 1, self.saved())
        self.assertRegex(names[0], r"^render-%s\.json$" % x.split(":")[1][:12])
        p = self.host.p("%s/staging/%s" % (STATE, names[0]))
        self.assertEqual(stat.S_IMODE(os.stat(str(p)).st_mode), 0o600)
        d = json.loads(p.read_text())
        for name, svc in d["services"].items():
            if "ulimits" in svc:
                self.assertEqual(svc["ulimits"].get("core"), 0, "`core: {}` is a zero (JSON drops it): written back as 0 where the policy pins it at zero (%s)" % name)

    def test_a_second_render_that_differs_from_the_judged_one_is_guard_render(self):
        x = self.candidate()
        self.world.rerender_hook = lambda d: d["services"]["web"].update(privileged=True) or d
        r = self.deploy("staging")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused guard-render"), r.err)
        self.assertIn(x, self.state("staging", "quarantine"))
        self.assertEqual([c for c in r.world.compose_log if c["cmd"] in ("up", "run")], [], "nothing starts from a render that was not the judged one")

    def test_the_second_render_reads_the_saved_file_on_stdin(self):
        self.candidate()
        r = self.deploy("staging")
        stdin_renders = [c for c in r.runner.calls if c["argv"] and "config" in c["argv"] and c["stdin"]]
        self.assertTrue(stdin_renders, "no render fed the saved JSON on stdin")
        for c in stdin_renders:
            self.assertIn("-f", c["argv"])
            self.assertEqual(c["argv"][c["argv"].index("-f") + 1], "-")
            self.assertEqual(c["argv"][:len(PREFIX)], PREFIX)

    def test_every_other_compose_call_names_only_the_saved_file_with_f(self):
        x = self.candidate()
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        saved = [str(self.host.p("%s/staging/%s" % (STATE, n))) for n in self.saved_of(x)]
        self.assertEqual(len(saved), 1)
        checked = 0
        for c in r.world.compose_log:
            if c["cmd"] in ("up", "run", "exec", "restart"):
                a = c["argv"]
                fs = [a[i + 1] for i, t in enumerate(a) if t == "-f"]
                every = [str(self.host.p("%s/staging/%s" % (STATE, n))) for n in self.saved()]
                self.assertTrue(len(fs) == 1 and fs[0] in every, "a compose call names a bundle's compose file, not a judged render: %r" % (a,))
                # G11 (ruling 3b62bbe6): the saved file's calls name the render home as project directory and /dev/null as env file: the caller's directory decides nothing
                self.assertEqual(a[a.index("--project-directory") + 1] if "--project-directory" in a else None, str(self.host.p("/var/lib/polycarpic/state/deploy/render-home")), a)
                self.assertEqual([a[i + 1] for i, t in enumerate(a) if t == "--env-file"], ["/dev/null"], a)
                checked += 1
        self.assertGreater(checked, 3)

    def test_no_releases_path_reaches_any_argv_but_as_configs_f_env_file_or_project_directory(self):
        self.candidate()
        r = self.deploy("staging")
        for c in r.runner.calls:
            a = c["argv"]
            for i, tok in enumerate(a):
                if "/releases/" in tok and a[i - 1] if i else False:
                    self.assertTrue("config" in a and a[i - 1] in ("-f", "--env-file", "--project-directory"), "a releases/ path outside config's inputs: %r" % (a,))


class RenderFiles(Render):
    """S34/S35 and the fixed point (ruling f08d4948): the saved bytes are what was judged and what starts; owner and mode; no secret value in any saved render, log or alert."""

    test_every_render_is_isolated_unprivileged_with_an_empty_home_and_the_remote_flags_off = None
    test_a_remote_include_is_refused_as_guard_render_and_never_fetched = None
    test_the_judged_render_is_saved_root_0600_with_core_written_back_as_zero = None
    test_a_second_render_that_differs_from_the_judged_one_is_guard_render = None
    test_the_second_render_reads_the_saved_file_on_stdin = None
    test_every_other_compose_call_names_only_the_saved_file_with_f = None
    test_no_releases_path_reaches_any_argv_but_as_configs_f_env_file_or_project_directory = None

    def test_the_fixed_point_the_saved_bytes_render_again_to_themselves(self):
        x = self.candidate()
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        path = self.host.p("%s/staging/%s" % (STATE, self.saved_of(x)[0]))
        saved = path.read_text()
        again = [c for c in r.runner.calls if c["argv"] and "config" in c["argv"] and c["stdin"] and x.split(":")[1] in c["stdin"]]
        self.assertTrue(again, "the second render")
        for c in again:
            self.assertEqual(c["stdin"], saved, "the second render is fed exactly the saved bytes")
        self.assertEqual(json.loads(saved), json.loads(json.dumps(json.loads(saved))))

    def test_the_saved_render_has_the_zero_correction_and_started_containers_come_from_it(self):
        x = self.candidate()
        r = self.deploy("staging")
        d = json.loads(self.host.p("%s/staging/%s" % (STATE, self.saved_of(x)[0])).read_text())
        for name, svc in d["services"].items():
            core = (svc.get("ulimits") or {}).get("core")
            self.assertNotEqual(core, {}, "%s: `core: {}` is written back as 0 before it is judged and saved" % name)
        started = [c for c in r.world.compose_log if c["cmd"] == "up"]
        self.assertTrue(started)

    def test_s35_the_saved_render_is_owned_by_root_and_mode_0600_whatever_the_umask(self):
        x = self.candidate()
        old = os.umask(0o000)
        try:
            r = self.deploy("staging")
        finally:
            os.umask(old)
        p = self.host.p("%s/staging/%s" % (STATE, self.saved_of(x)[0]))
        st = os.stat(str(p))
        self.assertEqual(stat.S_IMODE(st.st_mode), 0o600)
        self.assertEqual(st.st_uid, os.getuid(), "owned by the trusted uid (root on a box)")
        self.assertTrue(all(c[1] == 0 for c in r.chowns if "render" in str(c[0])), r.chowns)

    def test_s35_no_fixture_secret_value_reaches_a_saved_render_a_log_or_an_alert(self):
        values = {}
        for svc, name in (("web", "db_password_app"), ("auth", "auth_secret"), ("worker", "credential_keyring"), ("postgres", "db_superuser_password")):
            v = "fx" + os.urandom(12).hex()
            self.host.secret(svc, name, v + "\n", staging=True)
            values[name] = v
        for refused in (False, True):
            if refused:
                self.world.render_hooks[("staging", None)] = lambda d: d["services"]["web"].update(privileged=True) or d
            self.candidate()
            self.deploy("staging")
        blob = b""
        for base, _, files in os.walk(str(self.host.p(STATE))):
            for f in files:
                blob += open(os.path.join(base, f), "rb").read()
        for name, v in values.items():
            self.assertNotIn(v.encode(), blob, "the value of %s is in a saved render, log or alert" % name)

    def baked(self, refused):
        """The plain render carries env_file values; the saved file (0600) is the only place they may be, on an accepted run and on a refused one."""
        mark = "s35" + os.urandom(12).hex()

        def hook(d):
            d["services"]["web"].setdefault("environment", {})["S35_BAKED"] = mark
            if refused:
                d["services"]["web"]["privileged"] = True
            return d
        self.world.render_hooks[("staging", None)] = hook
        self.candidate()
        r = self.deploy("staging")
        self.assertEqual(r.rc != 0, refused, r.err)
        self.assertNotIn(mark, r.out + r.err, "a baked value was printed")
        in_saved = 0
        for base, _, files in os.walk(str(self.host.p("/"))):
            for f in files:
                try:
                    blob = open(os.path.join(base, f), "rb").read().decode("utf-8", "replace")
                except OSError:
                    continue
                if mark in blob:
                    self.assertRegex(f, r"^render-[0-9a-f]{12}\.json$", "a baked value is in %s" % os.path.join(base, f))
                    in_saved += 1
        return in_saved

    def test_s35_an_accepted_runs_baked_value_is_in_the_saved_file_alone(self):
        self.assertGreaterEqual(self.baked(False), 1, "the control: the saved render has the value")

    def test_s35_a_refused_runs_baked_value_is_in_no_file_log_alert_or_output(self):
        self.assertEqual(self.baked(True), 0, "a refused render is not saved (nor printed, logged or alerted)")


class RenderUser(Render):
    """A18 (ruling 13e43e26): renders run as `polycarpic-render` (uid and gid 10020, no shell, no other group); a missing or wrong user refuses `render-user` (exit 4)."""

    test_every_render_is_isolated_unprivileged_with_an_empty_home_and_the_remote_flags_off = None
    test_a_remote_include_is_refused_as_guard_render_and_never_fetched = None
    test_the_judged_render_is_saved_root_0600_with_core_written_back_as_zero = None
    test_a_second_render_that_differs_from_the_judged_one_is_guard_render = None
    test_the_second_render_reads_the_saved_file_on_stdin = None
    test_every_other_compose_call_names_only_the_saved_file_with_f = None
    test_no_releases_path_reaches_any_argv_but_as_configs_f_env_file_or_project_directory = None

    def passwd(self, line):
        self.host.write("/etc/passwd", "root:x:0:0:root:/root:/bin/bash\n" + (line + "\n" if line else ""))

    def test_a_missing_render_user_or_one_with_a_shell_or_another_group_refuses_render_user_exit_4(self):
        self.candidate()
        for label, line in (("missing", ""), ("a shell", "polycarpic-render:x:10020:10020::/nonexistent:/bin/bash"), ("another uid", "polycarpic-render:x:10021:10020::/nonexistent:/usr/sbin/nologin"),
                            ("another gid", "polycarpic-render:x:10020:10021::/nonexistent:/usr/sbin/nologin"), ("a home", "polycarpic-render:x:10020:10020::/home/render:/usr/sbin/nologin")):
            self.passwd(line)
            r = self.deploy("staging")
            self.assertEqual((r.rc, last(r)), (4, "deploy: refused render-user"), "%s: %s" % (label, r.err))
            self.assertEqual([c for c in r.world.compose_log if c["cmd"] in ("up", "run")], [], label)
        self.passwd("polycarpic-render:x:10020:10020::/nonexistent:/usr/sbin/nologin")
        r = self.deploy("staging")
        self.assertNotEqual(last(r), "deploy: refused render-user", "the right user passes: " + r.err)


class SidecarTamper(Render):
    test_every_render_is_isolated_unprivileged_with_an_empty_home_and_the_remote_flags_off = None
    test_a_remote_include_is_refused_as_guard_render_and_never_fetched = None
    test_the_judged_render_is_saved_root_0600_with_core_written_back_as_zero = None
    test_a_second_render_that_differs_from_the_judged_one_is_guard_render = None
    test_the_second_render_reads_the_saved_file_on_stdin = None
    test_every_other_compose_call_names_only_the_saved_file_with_f = None
    test_no_releases_path_reaches_any_argv_but_as_configs_f_env_file_or_project_directory = None

    def test_a_changed_sidecar_alone_does_not_stop_up_it_starts_the_judged_bytes(self):
        """seceng-100 on G5: `up` and `run` check the .json against the Judged record; the sidecar is what the READERS (backup, upload, cli) and a restore compare."""
        x = self.candidate()
        done = {}

        def tamper(cmd, argv):
            if cmd == "up" and not done:
                done["x"] = 1
                with open(str(self.host.p("%s/staging/render-%s.sha256" % (STATE, x.split(":")[1][:12]))), "a") as fh:
                    fh.write("0")
        self.world.on_compose = tamper
        r = self.deploy("staging")
        self.assertTrue(done, "the sidecar was reached")
        self.assertEqual(r.rc, 0, r.err)


class Tamper(Render):
    test_every_render_is_isolated_unprivileged_with_an_empty_home_and_the_remote_flags_off = None
    test_a_remote_include_is_refused_as_guard_render_and_never_fetched = None
    test_the_judged_render_is_saved_root_0600_with_core_written_back_as_zero = None
    test_a_second_render_that_differs_from_the_judged_one_is_guard_render = None
    test_the_second_render_reads_the_saved_file_on_stdin = None
    test_every_other_compose_call_names_only_the_saved_file_with_f = None
    test_no_releases_path_reaches_any_argv_but_as_configs_f_env_file_or_project_directory = None

    def test_the_saved_file_changed_between_the_judging_and_the_up_is_refused(self):
        x = self.candidate()
        seen = {"config": 0}

        def tamper(cmd, argv):
            if cmd == "config":
                seen["config"] += 1
                return
            if cmd in ("run", "up") and not seen.get("done"):
                names = [n for n in os.listdir(str(self.host.p("%s/staging" % STATE))) if n == "render-%s.json" % x.split(":")[1][:12]] if os.path.isdir(str(self.host.p("%s/staging" % STATE))) else []  # the candidate's own .json (not a sidecar, not current's), whatever order listdir gives
                if names:
                    seen["done"] = True
                    with open(str(self.host.p("%s/staging/%s" % (STATE, names[0]))), "ab") as fh:
                        fh.write(b" ")
        self.world.on_compose = tamper
        r = self.deploy("staging")
        self.assertTrue(seen.get("done"), "a render was saved before the first run/up")
        self.assertNotEqual(r.rc, 0, r.err)
        self.assertEqual([c for c in r.world.compose_log if c["cmd"] == "up" and "caddy" not in c["argv"] and "postgres" not in c["argv"]], [], "nothing starts from a file that is not what was judged")
