"""POLY-98 R6: gate-check wraps infra/postgres/gate-check.sh and passes its output and exit code through."""
import unittest

from base import BUNDLE, OpsTest, Runner, stack


class GateCheck(OpsTest):
    def argv(self, project):
        return ["/bin/sh", str(self.host.p(BUNDLE + "/infra/postgres/gate-check.sh")), "docker", "compose", "-p", "polycarpic-" + project, "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "polycarpic"]

    def go(self, project="prod", term="gate: pass\n", code=0, services=None):
        runner = Runner(None)
        stack(runner, project, services)
        runner.on(("gate-check.sh",), code=code, term=term)
        return self.host.go(*(["gate-check"] + (["--staging"] if project == "staging" else [])), runner=runner)

    def test_exact_argv_pass_is_exit_0(self):
        r = self.go()
        inherited = [c["argv"] for c in r.runner.calls if c["kind"] == "inherit"]
        self.assertEqual(inherited, [self.argv("prod")])
        self.assertEqual((r.rc, r.term.getvalue()), (0, "gate: pass\n"))

    def test_staging_uses_the_staging_project(self):
        r = self.go("staging")
        self.assertEqual([c["argv"] for c in r.runner.calls if c["kind"] == "inherit"], [self.argv("staging")])

    def test_a_fail_line_is_exit_1_and_its_text_is_passed_through(self):
        r = self.go(term="FAIL plpgsql open\n", code=1)
        self.assertEqual((r.rc, r.term.getvalue()), (1, "FAIL plpgsql open\n"))

    def test_postgres_down_prints_the_error_line_exits_1_and_runs_no_psql(self):
        r = self.go(services={"web": ("running", "healthy")})
        self.assertEqual((r.rc, r.out), (1, "gate: error (polycarpic-prod postgres is not running)\n"))
        self.assertEqual([c for c in r.runner.calls if c["kind"] == "inherit"], [])
        r = self.go(services={"postgres": ("exited", ""), "web": ("running", "healthy")})
        self.assertEqual((r.rc, r.out), (1, "gate: error (polycarpic-prod postgres is not running)\n"))

    def test_extra_arguments_are_refused(self):
        r = self.host.go("gate-check", "--evil")
        self.assertEqual((r.rc, r.runner.calls), (2, []))


if __name__ == "__main__":
    unittest.main()
