"""POLY-100 G1: finding the candidate and verifying it (R2, R3 V1-V4; T1-T4). T5 (siblings) waits for the bundle seam (test_deploy_bundle.py)."""
from base import REPO  # noqa: F401
from deploy_base import REGISTRY, SLUG, DeployTest, digest, utc

V1_FLAGS = {"--repo": SLUG, "--signer-workflow": SLUG + "/.github/workflows/build.yml", "--source-ref": "refs/heads/main",
            "--source-digest": None, "--predicate-type": "https://slsa.dev/provenance/v1", "--deny-self-hosted-runners": True}


def flags(argv):
    out, i = {}, 0
    while i < len(argv):
        if argv[i] == "--deny-self-hosted-runners":
            out[argv[i]] = True
            i += 1
        else:
            out[argv[i]] = argv[i + 1]
            i += 2
    return out


def verifies(r):
    return [c for c in r.runner.calls if c["argv"][:3] == ["gh", "attestation", "verify"]]


def first_docker(r, sub):
    for i, c in enumerate(r.runner.calls):
        if c["argv"][0] == "docker" and c["argv"][1] == sub:
            return i
    return None


class Staging(DeployTest):
    def candidate(self, attested_at=None, label=None, head=None):
        w = self.world
        head = head or w.commit_b
        x = digest("x")
        w.image("polycarpic", x, label or head)
        w.attested.add((x, attested_at or head))
        w.staging_run(head, x)
        return x

    def test_t1_v1_argv_is_exactly_the_six_flags_with_c_and_precedes_any_pull(self):
        x = self.candidate()
        r = self.deploy("staging")
        v = verifies(r)
        self.assertEqual(len(v), 1)
        argv = v[0]["argv"]
        self.assertEqual(argv[3], "oci://%s@%s" % (REGISTRY, x))
        want = dict(V1_FLAGS, **{"--source-digest": self.world.commit_b})
        self.assertEqual(flags(argv[4:]), want)
        self.assertEqual(len(argv), 4 + 11)
        pull = first_docker(r, "pull")
        self.assertIsNotNone(pull, "a verified candidate is pulled (V2); got %s" % r.err)
        self.assertLess(r.runner.calls.index(v[0]), pull)
        self.assertEqual([c["argv"][1] for c in r.runner.calls[:r.runner.calls.index(v[0])] if c["argv"][0] == "docker" and "--short" not in c["argv"]], [])  # G10 (f5a62e3c): the pinned Compose version is asked first, before any network call; it is not a pull

    def test_t2_a_label_alone_does_not_bind_the_image(self):
        # labelled with main's head B, but attested only at A: V1's --source-digest B refuses it, the label check would have passed
        x = self.candidate(attested_at=self.world.commit_a)
        r = self.deploy("staging")
        self.assertEqual(r.rc, 1)
        self.assertEqual(r.err.splitlines()[-1], "deploy: refused attestation")
        self.assertEqual(flags(verifies(r)[0]["argv"][4:])["--source-digest"], self.world.commit_b)
        self.assertEqual(self.world.pulled, [])
        self.assertEqual(self.alert_name("staging"), "attestation")

    def test_label_mismatch_is_refused_and_quarantined(self):
        x = self.candidate(label=self.world.commit_a)  # attested at B (V1 passes), the label says A
        r = self.deploy("staging")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused label"))
        self.assertIn(x, self.state("staging", "quarantine"))
        self.assertEqual(self.alert_name("staging"), "label")

    def test_t4_a_rerun_of_an_old_run_is_refused_as_not_newer(self):
        w = self.world
        self.seed("staging", digest("cur2"), "-", w.commit_b)  # staging runs B now
        self.candidate(head=w.commit_a)  # the old run of A is replayed
        r = self.deploy("staging")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused not-newer"))
        self.assertEqual(self.alert_name("staging"), "not-newer")
        self.assertEqual(w.pulled, [])

    def test_t4_a_candidate_not_descending_from_current_is_refused(self):
        w = self.world
        w.git("checkout", "-q", "-b", "side", w.commit_a)
        side = w.commit("side")
        w.git("checkout", "-q", "main")
        self.seed("staging", digest("cur3"), "-", side)
        self.candidate()
        r = self.deploy("staging")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused not-newer"))

    def test_t4_positive_a_descendant_is_not_refused(self):
        self.seed("staging", digest("cur-a"), "-", self.world.commit_a)
        self.candidate()
        r = self.deploy("staging")
        self.assertNotEqual(self.alert_name("staging"), "not-newer", r.err)
        self.assertIsNotNone(first_docker(r, "pull"))

    def test_t4_positive_the_same_commit_with_a_new_digest_is_not_refused(self):
        self.seed("staging", digest("cur-b"), "-", self.world.commit_b)
        self.candidate()
        r = self.deploy("staging")
        self.assertNotEqual(self.alert_name("staging"), "not-newer", r.err)
        self.assertIsNotNone(first_docker(r, "pull"))

    def test_same_digest_as_current_exits_0_touching_nothing(self):
        x = self.candidate()
        self.seed("staging", x, "-", self.world.commit_b)
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual((verifies(r), self.world.docker_log), ([], []))
        self.assertIsNone(self.alert_name("staging"))

    def test_quarantined_digest_exits_0_without_a_new_alert(self):
        x = self.candidate()
        self.host.write("/var/lib/polycarpic/state/deploy/staging/quarantine", "%s %s unhealthy\n" % (x, utc()))
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        self.assertIn("quarantined", self.log_events("staging"))
        self.assertIsNone(self.alert_name("staging"))
        self.assertEqual(self.world.pulled, [])

    def test_a_gh_outage_is_transient_not_quarantined(self):
        self.candidate()
        self.world.gh_down = True
        r = self.deploy("staging")
        self.assertIn("transient", self.log_events("staging"))
        self.assertEqual((self.state("staging", "quarantine") or "").strip(), "")
        self.assertEqual(self.world.pulled, [])


class Prod(DeployTest):
    def setUp(self):
        super().setUp()
        w = self.world
        self.good, self.good_pub = w.keygen("good")
        self.bad, self.bad_pub = w.keygen("bad")
        self.signers(self.good_pub)
        self.seed("prod", digest("prod-cur"), "v1.0.0", w.commit_a)

    def refused(self, r, name, quarantined=True):
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused " + name), r.err)
        self.assertEqual(self.alert_name("prod"), name)
        self.nothing_ran(r)
        if quarantined:
            self.assertRegex(self.state("prod", "quarantine"), r"^sha256:[0-9a-f]{64} \S+ %s$" % name)

    def test_t3_a_good_signed_tag_passes_v4_with_the_pinned_git_invocation(self):
        dig = self.release("v1.1.0", self.good)
        r = self.deploy("prod")
        self.assertNotIn(self.alert_name("prod"), ("tag-signature", "tag-commit", "tag-name", "not-newer", "attestation", "label"), r.err)
        vt = [c for c in r.runner.calls if "verify-tag" in c["argv"]]
        self.assertEqual(len(vt), 1)
        a = vt[0]["argv"]
        self.assertIn("gpg.format=ssh", a)
        self.assertIn("gpg.ssh.allowedSignersFile=" + str(self.host.p("/etc/polycarpic/allowed_signers")), a)
        self.assertEqual((vt[0]["env"].get("GIT_CONFIG_GLOBAL"), vt[0]["env"].get("GIT_CONFIG_NOSYSTEM")), ("/dev/null", "1"))
        self.assertEqual(flags(verifies(r)[0]["argv"][4:])["--source-digest"], self.world.commit_b)
        self.assertIn("oci://%s@%s" % (REGISTRY, dig), verifies(r)[0]["argv"])

    def test_t3_a_tag_signed_by_a_key_not_in_allowed_signers(self):
        self.release("v1.1.0", self.bad)
        self.refused(self.deploy("prod"), "tag-signature")

    def test_t3_a_global_git_config_cannot_add_a_signer(self):
        self.release("v1.1.0", self.bad)
        other = self.tmp / "other_signers"
        other.write_text('x namespaces="git" %s\n' % self.bad_pub)
        (self.tmp / ".gitconfig").write_text('[gpg "ssh"]\n\tallowedSignersFile = %s\n[gpg]\n\tformat = ssh\n' % other)
        self.refused(self.deploy("prod"), "tag-signature")

    def test_t3_a_lightweight_tag(self):
        self.release("v1.1.0", None, kind="light")
        self.refused(self.deploy("prod"), "tag-signature")

    def test_t3_a_gpg_signed_tag(self):
        self.release("v1.1.0", None, kind="gpg")
        self.refused(self.deploy("prod"), "tag-signature")

    def test_t3_a_signed_tag_of_a_tree_is_tag_commit(self):
        self.release("v1.1.0", self.good, kind="tree")
        self.refused(self.deploy("prod"), "tag-commit")

    def test_t3_a_signed_tag_on_another_commit_fails_the_attestation_at_that_commit(self):
        # image X built from B and attested at B; the maintainer's tag points at A, so C = A and V1 refuses (pin: test-plan.md 9)
        w = self.world
        dig = self.release("v1.1.0", self.good, commit=w.commit_a)
        w.attested = {(dig, w.commit_b)}
        r = self.deploy("prod")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused attestation"))
        self.assertEqual(self.alert_name("prod"), "attestation")
        self.nothing_ran(r)

    def test_t3_a_correctly_signed_older_tag_object_served_under_a_newer_name(self):
        # the real tag object says v1.1.0; the ref and the Release say v1.99.0 (S2)
        w = self.world
        w.tag("v1.1.0", w.commit_b, key=self.good, ref="v1.99.0")
        dig = digest("img-v1.99.0")
        w.image("polycarpic", dig, w.commit_b)
        w.attested.add((dig, w.commit_b))
        w.releases.insert(0, {"tag_name": "v1.99.0", "draft": False, "prerelease": False, "body": "digest: " + dig, "published_at": utc()})
        self.refused(self.deploy("prod"), "tag-name")

    def test_t4_prod_takes_the_highest_semver_not_the_newest(self):
        w = self.world
        d10 = self.release("v1.10.0", self.good)
        self.release("v1.2.0", self.good)  # published later, lower
        w.releases.insert(0, {"tag_name": "v1.99.0", "draft": True, "prerelease": False, "body": "digest: " + digest("d"), "published_at": utc()})
        w.releases.insert(0, {"tag_name": "v1.98.0", "draft": False, "prerelease": True, "body": "digest: " + digest("p"), "published_at": utc()})
        r = self.deploy("prod")
        self.assertEqual([v["argv"][3] for v in verifies(r)], ["oci://%s@%s" % (REGISTRY, d10)])

    def test_t4_a_release_below_current_is_refused_as_not_newer(self):
        self.seed("prod", digest("prod-cur"), "v1.5.0", self.world.commit_a)
        self.release("v1.2.0", self.good)
        r = self.deploy("prod")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused not-newer"))
        self.assertEqual(self.world.pulled, [])


class FixtureSanity(DeployTest):
    """The signed-tag fixtures are what the T3 cases claim they are (checked with real git, not the tool)."""

    def verify(self, tag, pub):
        w = self.world
        f = self.tmp / "sanity_signers"
        f.write_text('p namespaces="git" %s\n' % pub)
        from deploy_base import REAL_RUN
        r = REAL_RUN(["git", "-c", "gpg.format=ssh", "-c", "gpg.ssh.allowedSignersFile=" + str(f), "verify-tag", tag], cwd=str(w.origin), env=w._genv())
        return r.returncode

    def test_good_verifies_bad_and_unsigned_do_not(self):
        w = self.world
        good, gpub = w.keygen("g")
        bad, bpub = w.keygen("b")
        w.tag("v1.1.0", w.commit_b, key=good)
        w.tag("v1.2.0", w.commit_b, key=bad)
        w.tag("v1.3.0", w.commit_b, kind="light")
        w.tag("v1.4.0", w.commit_b, kind="gpg")
        w.tag("v1.5.0", w.commit_b, kind="tree", key=good)
        self.assertEqual([self.verify(t, gpub) for t in ("v1.1.0", "v1.2.0", "v1.3.0", "v1.4.0")], [0, 1, 1, 1])
        self.assertEqual(w.git("cat-file", "-t", "v1.5.0"), "tag")
        self.assertEqual(w.git("cat-file", "-t", "v1.5.0^{}"), "tree")
