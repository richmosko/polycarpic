"""POLY-100 F4 (ruling.md; build review F4): (a) every render runs with no network, as nobody, with an empty HOME and the experimental remote flags off, so a remote `include` cannot be fetched;
(b) what was judged is what starts: the judged plain JSON (`ulimits.core` `{}` written back as 0) is saved root 0600 and rendered once more on stdin, and must equal the judged one; every other
compose call names only that file with -f. Written from the ruling, red on the build it was written against."""
import json
import os
import stat

from deploy_base import DeployTest, digest
from test_deploy_bundle import good_files, make_tar, sibling_digests

PREFIX = ["unshare", "--net", "--", "setpriv", "--reuid", "65534", "--regid", "65534", "--clear-groups", "--no-new-privs", "--", "docker", "compose"]
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
        names = self.saved()
        self.assertEqual(len(names), 1, names)
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
        self.candidate()
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        saved = [str(self.host.p("%s/staging/%s" % (STATE, n))) for n in self.saved()]
        self.assertEqual(len(saved), 1)
        checked = 0
        for c in r.world.compose_log:
            if c["cmd"] in ("up", "run", "exec", "restart"):
                a = c["argv"]
                fs = [a[i + 1] for i, t in enumerate(a) if t == "-f"]
                self.assertEqual(fs, saved, "a compose call names a bundle's compose file, not the judged render: %r" % (a,))
                self.assertNotIn("--project-directory", a)
                self.assertNotIn("--env-file", a)
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
