"""POLY-100 T-edge, T-take (ruling R9, S22-S25, S28): Caddy comes up alone from a signed `edge-<n>` tag through `edge-deploy <tag>`, before prod exists;
prod takes it over once. Written from the ruling (3c50fb1c, 6747ce07), not from the build."""
import fcntl
import os
import shutil

from deploy_base import DeployTest, digest, utc
from test_deploy_bundle import good_files, images_env_text, make_tar, sibling_digests
from test_deploy_prod import ProdBase

EDGE = "polycarpic-edge"
PRODP = "polycarpic-prod"
LOCK = "/run/polycarpic/deploy.lock"


class EdgeBase(ProdBase):
    def setUp(self):
        super().setUp()
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)

    def edge_release(self, n, commit=None, tag=None, sibs=None, key=None, kind="signed"):
        """A signed `edge-<n>` Release: a new commit (or the given one), an app image with its bundle, siblings, attestations."""
        w = self.world
        tag = tag or "edge-%d" % n
        self.n += 1
        c = commit or w.commit("e%d-%d" % (n, self.n))
        sibs = sibs or sibling_digests(tag + str(self.n))
        self.last_sibs = sibs
        if w.git("tag", "-l", tag):
            w.git("tag", "-d", tag)  # a second release under the same tag name (another digest)
        x = digest("img-%s-%d" % (tag, self.n))
        w.image("polycarpic", x, c, bundle=make_tar(good_files(images_env_text(sibs))))
        w.attested.add((x, c))
        for name, d in sibs.items():
            w.image("polycarpic-" + name, d, c)
            w.attested.add((d, c))
        w.tag(tag, c, kind=kind, key=key or self.good)
        w.releases.insert(0, {"tag_name": tag, "draft": False, "prerelease": False, "body": "digest: " + x, "published_at": utc()})
        return x, c

    def edge(self, tag, **kw):
        return self.deploy(tag, cmd="edge-deploy", **kw)

    def edge_current(self):
        v = self.state("edge", "current")
        return v.split() if v else None

    def ups(self, r, mark):
        return [c for c in r.world.compose_log[mark:] if c["cmd"] == "up"]


class Edge(EdgeBase):
    # ---- step 1: the two tag grammars never cross (S22) ----
    def test_a_prod_tag_offered_to_edge_deploy_is_refused_before_any_network_call(self):
        self.release_of("v1.0.0")
        for bad in ("v1.0.0", "edge-01", "edge-", "edge-1x", "Edge-1", "edge-1 ", "v1.1.0", "edge--1", "../edge-1"):
            r = self.edge(bad)
            self.assertEqual(r.rc, 2, bad)
            self.assertEqual(r.runner.calls, [], bad)

    def test_an_edge_tag_offered_to_prod_is_never_a_prod_candidate(self):
        x1, _ = self.first_prod()
        x, _ = self.edge_release(9)
        before = len(self.world.pulled)
        r = self.deploy("prod")
        self.assertNotIn(x, " ".join(" ".join(c["argv"]) for c in r.runner.calls), "an edge-9 Release is not a prod candidate")
        self.assertEqual(len(self.world.pulled), before)

    # ---- tag checks (V4 for edge) ----
    def test_a_signed_edge_1_object_served_as_ref_edge_2_is_refused_tag_name(self):
        w = self.world
        w.tag("edge-1", w.commit_b, key=self.good, ref="edge-2")
        x = digest("img-e2")
        w.image("polycarpic", x, w.commit_b, bundle=make_tar(good_files()))
        w.attested.add((x, w.commit_b))
        w.releases.insert(0, {"tag_name": "edge-2", "draft": False, "prerelease": False, "body": "digest: " + x, "published_at": utc()})
        r = self.edge("edge-2")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused tag-name"), r.err)

    def test_an_unlisted_signer_is_refused_tag_signature(self):
        bad, _ = self.world.keygen("evil")
        self.edge_release(1, key=bad)
        r = self.edge("edge-1")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused tag-signature"), r.err)
        self.assertIsNone(self.edge_current())

    def test_a_release_whose_tag_name_differs_or_is_a_draft_or_has_two_digest_lines_is_malformed(self):
        x, c = self.edge_release(1)
        self.world.releases[0]["draft"] = True
        self.assertEqual(self.edge("edge-1").err.splitlines()[-1], "deploy: refused malformed")
        self.world.releases[0].update(draft=False, body="digest: %s\nextra" % x)
        self.assertEqual(self.edge("edge-1").err.splitlines()[-1], "deploy: refused malformed")

    # ---- step 3: rising n ----
    def test_a_lower_or_equal_n_with_another_digest_is_not_newer_and_the_same_digest_exits_0(self):
        x2, _ = self.edge_release(2)
        self.assertEqual(self.edge("edge-2").rc, 0)
        self.assertEqual(self.edge_current()[0], x2)
        self.edge_release(1)
        r = self.edge("edge-1")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused not-newer"))
        x2b, _ = self.edge_release(2, tag="edge-2")  # the same tag name, another digest
        r = self.edge("edge-2")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused not-newer"))
        self.world.releases[:] = [x for x in self.world.releases if x["body"] != "digest: " + x2b]
        r = self.edge("edge-2")  # the same tag, the digest `current` already runs
        self.assertEqual(r.rc, 0, r.err)

    def test_n_is_compared_as_a_number_not_a_string(self):
        self.edge_release(9)
        self.assertEqual(self.edge("edge-9").rc, 0)
        x10, _ = self.edge_release(10)
        r = self.edge("edge-10")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(self.edge_current()[0], x10)

    # ---- step 2 (S23, S28): edge only before prod exists, read after the lock ----
    def test_edge_deploy_with_a_prod_current_is_refused_and_nothing_is_upped(self):
        self.first_prod()
        self.edge_release(1)
        mark = len(self.world.compose_log)
        r = self.edge("edge-1")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (4, "deploy: refused edge-owned-by-prod"))
        self.assertEqual(self.ups(r, mark), [])

    def test_a_damaged_prod_current_counts_as_present(self):
        self.host.write("/var/lib/polycarpic/state/deploy/prod/current", "garbage\n")
        self.edge_release(1)
        mark = len(self.world.compose_log)
        r = self.edge("edge-1")
        self.assertNotEqual(r.rc, 0)
        self.assertIn(r.err.splitlines()[-1], ("deploy: refused edge-owned-by-prod", "deploy: refused state"))
        self.assertEqual(self.ups(r, mark), [])

    def test_no_current_but_a_prod_container_listed_is_refused_including_a_stopped_one(self):
        self.edge_release(1)
        self.world.set_container(PRODP, "web", "ghcr.io/richmosko/polycarpic@" + digest("lost"))
        mark = len(self.world.compose_log)
        r = self.edge("edge-1")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (4, "deploy: refused edge-owned-by-prod"))
        self.assertEqual(self.ups(r, mark), [])

    def test_a_failing_ps_reads_as_a_container_present(self):
        self.edge_release(1)
        self.world.ps_fails.add(PRODP)
        mark = len(self.world.compose_log)
        r = self.edge("edge-1")
        self.assertNotEqual(r.rc, 0)
        self.assertIsNone(self.edge_current())
        self.assertEqual(self.ups(r, mark), [])

    def test_prod_gaining_a_current_while_the_command_waits_for_the_lock_is_refused(self):
        self.edge_release(1)
        path = str(self.host.p(LOCK))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX)

        def prod_appears():
            self.host.write("/var/lib/polycarpic/state/deploy/prod/current", "sha256:%s v1.0.0 %s %s %s\n" % ("a" * 64, "b" * 40, "0" * 64, utc()))
            fcntl.flock(fd, fcntl.LOCK_UN)
        mark = len(self.world.compose_log)
        r = self.edge("edge-1", sleeps_hook=prod_appears)
        os.close(fd)
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (4, "deploy: refused edge-owned-by-prod"), r.err)
        self.assertEqual(self.ups(r, mark), [])

    def test_a_damaged_edge_current_is_refused_state(self):
        self.edge_release(1)
        self.host.write("/var/lib/polycarpic/state/deploy/edge/current", "not a pointer\n")
        r = self.edge("edge-1")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused state"))

    # ---- success: caddy alone ----
    def test_success_ups_only_caddy_in_polycarpic_edge_and_names_no_other_service(self):
        x, c = self.edge_release(1)
        mark = len(self.world.compose_log)
        r = self.edge("edge-1")
        self.assertEqual(r.rc, 0, r.err)
        ups = self.ups(r, mark)
        self.assertEqual(len(ups), 1)
        self.assertEqual((ups[0]["project"], ups[0]["rest"][-1]), (EDGE, "caddy"))
        for call in r.world.compose_log[mark:]:
            if call["cmd"] in ("up", "run", "exec", "restart", "start", "create"):
                toks = " ".join(call["argv"])
                for other in ("web", "auth", "worker", "migrate", "operator", "postgres", "backup", "uploader"):
                    self.assertNotRegex(toks, r"\s%s(\s|$)" % other, call["argv"])
        self.assertEqual(self.edge_current()[:3][0], x)
        self.assertEqual(self.edge_current()[2], c)
        self.assertEqual([k for k in self.world.containers if k != EDGE], [], "no other project's container was started")

    def test_an_unhealthy_caddy_is_quarantined_and_edge_previous_comes_back_after_its_guard(self):
        x1, _ = self.edge_release(1)
        self.assertEqual(self.edge("edge-1").rc, 0)
        x2, _ = self.edge_release(2)
        self.world.bad_caddy.add(self.last_sibs["caddy"])
        mark = len(self.world.compose_log)
        r = self.edge("edge-2")
        self.assertEqual(r.rc, 1, r.err)
        self.assertIn(x2, self.state("edge", "quarantine"))
        self.assertEqual(self.edge_current()[0], x1)
        ups = self.ups(r, mark)
        self.assertEqual(len(ups), 2)
        self.assertRegex(" ".join(ups[1]["argv"]), r"/state/deploy/edge/render-%s\.json" % x1.split(":")[1][:12], "edge's previous release is upped from its own saved render (F4)")
        cfg = [i for i, c in enumerate(r.world.compose_log[mark:]) if c["cmd"] == "config" and self.hex_dir(x1) in " ".join(c["argv"])]
        self.assertTrue(cfg, "the previous release's render is judged before its up")

    def test_rollback_edge_restores_the_previous_release_guarded(self):
        x1, _ = self.edge_release(1)
        self.assertEqual(self.edge("edge-1").rc, 0)
        x2, _ = self.edge_release(2)
        self.assertEqual(self.edge("edge-2").rc, 0)
        mark = len(self.world.compose_log)
        r = self.deploy("edge", cmd="rollback")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(self.edge_current()[0], x1)
        self.assertIn(x2, self.state("edge", "quarantine"))
        self.assertEqual(len(self.ups(r, mark)), 1)

    def test_rollback_edge_refuses_on_step_2s_conditions(self):
        x1, _ = self.edge_release(1)
        self.assertEqual(self.edge("edge-1").rc, 0)
        x2, _ = self.edge_release(2)
        self.assertEqual(self.edge("edge-2").rc, 0)
        self.world.ps_fails.add(PRODP)
        mark = len(self.world.compose_log)
        r = self.deploy("edge", cmd="rollback")
        self.assertNotEqual(r.rc, 0)
        self.assertEqual(self.edge_current()[0], x2)
        self.assertEqual(self.ups(r, mark), [])
        self.world.ps_fails.clear()
        self.host.write("/var/lib/polycarpic/state/deploy/prod/current", "garbage\n")
        r = self.deploy("edge", cmd="rollback")
        self.assertNotEqual(r.rc, 0)
        self.assertEqual(self.edge_current()[0], x2)

    def test_a_guard_refusal_prints_the_help_with_the_edge_tag(self):
        self.edge_release(1)
        self.world.render_hooks[("edge", None)] = lambda d: d["services"]["caddy"].update(privileged=True) or d
        r = self.edge("edge-1")
        self.assertEqual((r.rc, r.err.splitlines()[-1].startswith("deploy: refused guard-")), (1, True), r.err)
        blob = r.err + (self.state("edge", "alert") or "") + (self.state("edge", "deploy.log") or "")
        self.assertIn("edge-deploy edge-1", blob)
        self.assertIsNone(self.edge_current())


class Take(EdgeBase):
    """S23: prod takes edge over once; its commit must equal or descend from edge's."""

    def take(self, commit):
        x_edge, c_edge = self.edge_release(1)
        self.assertEqual(self.edge("edge-1").rc, 0)
        self.edge_commit, self.edge_x = c_edge, x_edge
        self.world.releases[:] = [r for r in self.world.releases]
        self.n += 1
        c = commit(c_edge)
        sibs = sibling_digests("v1.0.0")
        x = digest("prod-v1.0.0")
        w = self.world
        w.image("polycarpic", x, c, bundle=make_tar(good_files(images_env_text(sibs))))
        w.attested.add((x, c))
        for name, d in sibs.items():
            w.image("polycarpic-" + name, d, c)
            w.attested.add((d, c))
        w.tag("v1.0.0", c, key=self.good)
        w.releases.insert(0, {"tag_name": "v1.0.0", "draft": False, "prerelease": False, "body": "digest: " + x, "published_at": utc()})
        return x

    def _prunes(self, f):
        x = self.take(f)
        r = self.deploy("prod", cmd="first-deploy")
        self.assertEqual(r.rc, 0, r.err)
        self.assertEqual(self.state("prod", "current").split()[0], x)
        self.assertFalse(os.path.exists(self.hex_dir(self.edge_x)), "edge's release is pruned after prod is healthy")

    def test_from_edges_commit_prod_takes_over_and_prunes_edges_releases(self):
        self._prunes(lambda c: c)

    def test_from_a_descendant_prod_takes_over_and_prunes_edges_releases(self):
        self._prunes(lambda c: self.world.commit("child"))

    def test_from_a_commit_that_does_not_descend_from_edges_is_edge_older_and_nothing_is_upped(self):
        def side(c):
            w = self.world
            w.git("checkout", "-q", "-b", "side", w.commit_a)
            s = w.commit("side")
            w.git("checkout", "-q", "main")
            return s
        self.take(side)
        mark = len(self.world.compose_log)
        r = self.deploy("prod", cmd="first-deploy")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: refused edge-older"), r.err)
        self.assertEqual([c for c in r.world.compose_log[mark:] if c["cmd"] in ("up", "run")], [])
        self.assertNotIn(self.state("prod", "quarantine") or "", ("x",))
        self.assertEqual((self.state("prod", "quarantine") or "").strip(), "", "edge-older is not a Q row")

    def test_edges_release_is_not_pruned_before_prod_is_healthy_and_caddy_goes_back_when_prod_fails(self):
        x = self.take(lambda c: c)
        self.world.bad_apps.add(x)
        mark = len(self.world.compose_log)
        r = self.deploy("prod", cmd="first-deploy")
        self.assertEqual((r.rc, r.err.splitlines()[-1]), (1, "deploy: rollback-unhealthy"), r.err)
        self.assertTrue(os.path.isdir(self.hex_dir(self.edge_x)), "edge's release survives a failed take-over")
        self.assertEqual(self.edge_current()[0], self.edge_x)
        edge_ups = [c for c in r.world.compose_log[mark:] if c["cmd"] == "up" and c["project"] == EDGE]
        self.assertTrue(edge_ups)
        self.assertRegex(" ".join(edge_ups[-1]["argv"]), r"/state/deploy/edge/render-%s\.json" % self.edge_x.split(":")[1][:12], "caddy is put back on edge's current, from its saved render (F4)")
