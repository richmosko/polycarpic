"""POLY-100 G3 (ruling.md section G, 822a05a9; seceng's Q4): with a `current`, `_start_postgres` is given `current`'s judged render and no other; the candidate's is passed only by `first-deploy` with
no `current`. ONE `compose ps` decides whether Postgres runs and its answer is carried; a failed or unparsable `ps` stops the run (`ps`: alert, no Q); every other branch on a `ps` carries its answer
too, a failure being the refusing one. Written from the ruling, red on the build it was written against."""
from test_deploy_prod import ProdBase

PROD = "polycarpic-prod"


def last(r):
    return r.err.splitlines()[-1] if r.err.strip() else ""


class PsOnce(ProdBase):
    def deploy_with_ps(self, fail_nth, **kw):
        """A prod upgrade in which the `fail_nth`-th `compose ps` of the prod project (1-based; None: never) fails."""
        x1, _ = self.first_prod()
        x2 = self.release_of("v1.1.0")
        orig = self.world._compose
        seen = {"n": 0}

        def wrapped(argv, stdin=None):
            if "ps" in argv and "-p" in argv and argv[argv.index("-p") + 1] == PROD:
                seen["n"] += 1
                if seen["n"] == fail_nth:
                    return 1, "", "ps failed"
            return orig(argv, stdin)
        self.world._compose = wrapped
        mark = len(self.world.compose_log)
        r = self.deploy("prod")
        return x1, x2, r, mark

    def candidate_postgres_ups(self, r, mark, x2):
        tag = "render-%s.json" % x2.split(":")[1][:12]
        out = []
        for c in r.world.compose_log[mark:]:
            if c["cmd"] == "run":
                break  # step 5: the first one-off run
            if c["cmd"] == "up" and "postgres" in c["argv"] and tag in " ".join(c["argv"]):
                out.append(c["argv"])
        return out

    def test_a_second_ps_that_fails_never_starts_the_candidates_postgres_before_step_5(self):
        x1, x2, r, mark = self.deploy_with_ps(2)
        self.assertEqual(self.candidate_postgres_ups(r, mark, x2), [], "Postgres started from the candidate's render on live data before the backup (S12)")

    def test_a_first_ps_that_fails_stops_the_run_as_ps_with_an_alert_and_no_quarantine(self):
        x1, x2, r, mark = self.deploy_with_ps(1)
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused ps"), r.err)
        self.assertEqual(self.alert_name("prod"), "ps")
        self.assertNotIn(x2, self.state("prod", "quarantine") or "", "a failed ps is a box fault: no Q")
        self.assertEqual([c for c in r.world.compose_log[mark:] if c["cmd"] in ("up", "run")], [], "nothing started")

    def test_postgres_down_starts_from_currents_render_and_never_the_candidates(self):
        x1, _ = self.first_prod()
        x2 = self.release_of("v1.1.0")
        del self.world.containers[PROD]["postgres"]
        mark = len(self.world.compose_log)
        r = self.deploy("prod")
        ups = [c for c in r.world.compose_log[mark:] if c["cmd"] == "up" and "postgres" in c["argv"]]
        self.assertTrue(ups)
        self.assertIn("render-%s.json" % x1.split(":")[1][:12], " ".join(ups[0]["argv"]), "current's render")
        self.assertEqual(self.candidate_postgres_ups(r, mark, x2), [])

    def test_the_answer_of_the_one_ps_is_carried_not_asked_again_before_step_5(self):
        x1, x2, r, mark = self.deploy_with_ps(None)
        n = 0
        for c in r.world.compose_log[mark:]:
            if c["cmd"] == "run":
                break
            if c["cmd"] == "ps" and c["project"] == PROD:
                n += 1
        self.assertEqual(n, 1, "one `compose ps` of the project before step 5")
