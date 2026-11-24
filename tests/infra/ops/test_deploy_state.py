"""POLY-100 build-review faults F5, F6, F7, F11, F13 (ruling.md, table of F1-F15). Written from the ruling and red on the build it was written against.
F5: only FileNotFoundError is absent. F6: all five fields of a pointer per project. F7: transient is exit 1 with a cause for the two foreground commands. F11: a guard refusal of
`current` is `current-guard-<rule>`, no quarantine for the candidate. F13: /srv/polycarpic must be a mount point (ctx.ismount)."""
import os
import shutil

from deploy_base import DeployTest, digest, utc
from test_deploy_bundle import good_files, make_tar, sibling_digests
from test_deploy_guard import both, svc

SDIR = "/var/lib/polycarpic/state/deploy"


def last(r):
    return r.err.splitlines()[-1] if r.err.strip() else ""
GOOD = "%s - %s %s %s\n"


class Base(DeployTest):
    def candidate(self, hooks=None):
        w = self.world
        x = digest("x")
        w.image("polycarpic", x, w.commit_b, bundle=make_tar(good_files()))
        w.attested.add((x, w.commit_b))
        for n, d in sibling_digests().items():
            w.image("polycarpic-" + n, d, w.commit_b)
            w.attested.add((d, w.commit_b))
        w.staging_run(w.commit_b, x)
        w.render_hooks.update(hooks or {})
        return x

    def put(self, project, name, text):
        self.host.write("%s/%s/%s" % (SDIR, project, name), text)

    def as_directory(self, project, name):
        """An entry that exists but cannot be read as a file: a directory (EISDIR is not FileNotFoundError, and it fails the same for root)."""
        p = self.host.p("%s/%s/%s" % (SDIR, project, name))
        p.parent.mkdir(parents=True, exist_ok=True)
        if p.exists():
            p.unlink()
        p.mkdir()

    def started(self, r):
        return [c for c in r.world.compose_log if c["cmd"] in ("up", "run")]


class F5(Base):
    def test_an_unreadable_current_or_previous_stops_the_run_with_state_and_ups_nothing(self):
        for name in ("current", "previous"):
            self.setUp_again()
            self.candidate()
            self.as_directory("staging", name)
            r = self.deploy("staging")
            self.assertEqual((r.rc, last(r)), (1, "deploy: refused state"), name + ": " + r.err)
            self.assertEqual(self.started(r), [], name)
            self.assertEqual(self.world.pulled, [], name)

    def test_an_unreadable_quarantine_never_lets_a_quarantined_image_up_again_and_is_never_rewritten(self):
        x = self.candidate()
        self.put("staging", "quarantine", "%s %s unhealthy\n" % (x, utc()))
        before = self.state("staging", "quarantine")
        os.chmod(str(self.host.p("%s/staging/quarantine" % SDIR)), 0o000)
        try:
            if os.access(str(self.host.p("%s/staging/quarantine" % SDIR)), os.R_OK):
                self.skipTest("running as root: use the directory form below")
        finally:
            os.chmod(str(self.host.p("%s/staging/quarantine" % SDIR)), 0o644)
        self.as_directory("staging", "quarantine")
        r = self.deploy("staging")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused state"), r.err)
        self.assertEqual(self.started(r), [])
        self.assertEqual(self.world.pulled, [])
        self.assertTrue(self.host.p("%s/staging/quarantine" % SDIR).is_dir(), "the unreadable entry is left as it was, not rewritten")
        self.assertIsNotNone(before)

    def test_a_malformed_quarantine_line_stops_the_run_with_state_and_the_file_is_not_rewritten(self):
        x = self.candidate()
        for bad in ("garbage\n", "%s\n" % x, "%s %s\n" % (x, utc()), "not-a-digest %s unhealthy\n" % utc(), "%s not-a-time unhealthy\n" % x):
            self.put("staging", "quarantine", bad)
            r = self.deploy("staging")
            self.assertEqual((r.rc, last(r)), (1, "deploy: refused state"), repr(bad) + r.err)
            self.assertEqual(self.state("staging", "quarantine"), bad, "never rewritten from a partial read")
            self.assertEqual(self.started(r), [])

    def test_an_unreadable_first_attempt_stops_first_deploy_with_state(self):
        self.setUp_again()
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        self.candidate()
        self.as_directory("staging", "first-attempt")
        r = self.deploy("staging", cmd="first-deploy")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused state"), r.err)
        self.assertEqual(self.started(r), [])

    def setUp_again(self):
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        self.seed("staging", self.current_digest, "-", self.world.commit_a)
        self.world.registry.clear(), self.world.attested.clear(), self.world.runs.clear(), self.world.pulled.clear()


GOOD_AT = "2026-11-22T18:21:00Z"
D = "sha256:" + "a" * 64
C = "b" * 40
T = "0" * 64


class F6(Base):
    """Each field of a pointer is validated per project; a miss is `state`, for every command that reads it."""

    def pointer(self, project, tag=None, tree=T, at=GOOD_AT, digest_=D, commit=C):
        tag = tag if tag is not None else {"prod": "v1.5.0", "edge": "edge-3", "staging": "-"}[project]
        return "%s %s %s %s %s\n" % (digest_, tag, commit, tree, at)

    def run_for(self, project):
        if project == "edge":
            return self.deploy("edge-9", cmd="edge-deploy")
        return self.deploy(project)

    def test_a_good_pointer_is_not_a_state_error(self):
        for project in ("prod", "staging", "edge"):
            self.put(project, "current", self.pointer(project)) if self.host.mkdir("%s/%s" % (SDIR, project)) else None
            r = self.run_for(project)
            self.assertNotIn("refused state", r.err, project)

    def test_each_bad_field_is_state_for_each_project(self):
        bad = {
            "prod": [("tag -", dict(tag="-")), ("tag not v1.*", dict(tag="v2.0.0")), ("tag vX", dict(tag="vX")), ("an edge tag", dict(tag="edge-1")), ("tag with a space-free junk", dict(tag="v1.0")),
                     ("tree -", dict(tree="-")), ("tree 63 hex", dict(tree="0" * 63)), ("tree upper case", dict(tree="A" * 64)), ("time date only", dict(at="2026-11-22")), ("time junk", dict(at="x")),
                     ("digest short", dict(digest_="sha256:abc")), ("commit short", dict(commit="abc"))],
            "staging": [("tag not -", dict(tag="v1.0.0")), ("tag an edge tag", dict(tag="edge-1")), ("tree -", dict(tree="-")), ("tree 65 hex", dict(tree="0" * 65)), ("time junk", dict(at="yesterday"))],
            "edge": [("tag -", dict(tag="-")), ("tag a prod tag", dict(tag="v1.0.0")), ("tag edge-x", dict(tag="edge-x")), ("tag with a leading zero", dict(tag="edge-01")),
                     ("tree -", dict(tree="-")), ("time junk", dict(at="x"))],
        }
        for project, cases in bad.items():
            for label, kw in cases:
                shutil.rmtree(str(self.sdir(project)), ignore_errors=True)
                self.host.mkdir("%s/%s" % (SDIR, project))
                self.put(project, "current", self.pointer(project, **kw))
                r = self.run_for(project)
                self.assertEqual((r.rc, last(r)), (1, "deploy: refused state"), "%s %s: %s" % (project, label, r.err))

    def test_a_damaged_tag_never_switches_the_downgrade_check_off(self):
        # seceng's probe: prod `current` whose tag field is `-` let v1.0.0 replace v1.5.0
        self.put("prod", "current", self.pointer("prod", tag="-")) if self.host.mkdir("%s/prod" % SDIR) else None
        self.world.releases.insert(0, {"tag_name": "v1.0.0", "draft": False, "prerelease": False, "body": "digest: " + digest("old"), "published_at": utc()})
        r = self.deploy("prod")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused state"), r.err)
        self.assertEqual(self.world.pulled, [])

    def test_an_unhashable_tree_is_release_tree_never_a_pass(self):
        # `tree()` never returns `-`: a release directory holding a link or an odd file is `release-tree`, so `-` can never equal `-`
        x = self.candidate()
        d = self.host.p("/opt/polycarpic/releases/sha256-" + self.current_digest.split(":")[1])
        os.symlink("/etc/passwd", str(d / "infra" / "link"))
        self.put("staging", "current", self.pointer("staging", digest_=self.current_digest, tree="-", commit=self.world.commit_a))
        r = self.deploy("staging")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused state"), r.err)


class F7(Base):
    def test_edge_deploy_and_first_deploy_on_a_transient_exit_1_with_the_cause_and_no_alert(self):
        self.world.gh_down = True
        self.host.mkdir("%s/staging" % SDIR)
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        self.candidate()
        r = self.deploy("staging", cmd="first-deploy")
        self.assertEqual(r.rc, 1, r.err)
        self.assertTrue(r.err.strip(), "the cause is on stderr")
        self.assertIsNone(self.state("staging", "alert"))
        r = self.deploy("edge-1", cmd="edge-deploy")
        self.assertEqual(r.rc, 1, r.err)
        self.assertTrue(r.err.strip())
        self.assertIsNone(self.state("edge", "alert"))

    def test_the_timer_keeps_exit_0_on_a_transient(self):
        self.world.gh_down = True
        self.candidate()
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        self.assertIn("transient", self.log_events("staging"))


class F11(Base):
    def test_a_guard_refusal_of_current_is_current_guard_rule_no_quarantine_and_is_retried(self):
        x = self.candidate()
        cur = "sha256-" + self.current_digest.split(":")[1]
        self.world.dir_hooks[cur] = lambda d: d["services"]["web"].update(privileged=True) or d
        r = self.deploy("staging")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused current-guard-key"), r.err)
        self.assertEqual((self.state("staging", "quarantine") or "").strip(), "", "the candidate is not quarantined for current's fault")
        self.assertEqual(self.alert_name("staging"), "current-guard-key")
        self.assertNotIn("install.sh", r.err, "name only: installing the candidate is not the fix")
        r2 = self.deploy("staging")
        self.assertEqual(last(r2), "deploy: refused current-guard-key", "retried on the next poll, not skipped")


class F13(Base):
    def test_an_unmounted_data_volume_refuses_every_command_with_data_mount_exit_4_and_touches_nothing(self):
        self.world.unmounted.add("/srv/polycarpic")
        self.candidate()
        before = self.host.tree()
        for label, args, kw in (("deploy", ("staging",), {}), ("first-deploy", ("staging",), dict(cmd="first-deploy")), ("edge-deploy", ("edge-1",), dict(cmd="edge-deploy")),
                                ("rollback", ("staging",), dict(cmd="rollback"))):
            if label == "first-deploy":
                shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
            r = self.deploy(*args, **kw)
            self.assertEqual(r.rc, 4, "%s: %s" % (label, r.err))
            self.assertIn("data-mount", r.err, label)
            self.assertEqual(self.started(r), [], label)
            self.assertIsNone(self.state("staging", "first-attempt"), label)

    def test_a_mounted_volume_passes(self):
        self.candidate()
        r = self.deploy("staging")
        self.assertNotIn("data-mount", r.err)
