"""POLY-100 G12 (ruling.md fcca8d3b): `roles-missing` on a fresh Postgres is ASKED of Postgres, never read from an authentication error. Only when the project has no `current`, right after Postgres is healthy and
before any backup or one-off, root asks over the container's local socket (`exec -T postgres psql -U postgres -d postgres`, SQL on stdin): `SELECT count(*) FROM pg_roles WHERE rolname = 'poly_migrator'`.
Exactly `0` -> `roles-missing` (the provision command, exit 4, no quarantine, no one-off started). Exactly `1` -> on. Anything else -> `roles-read` (alert, no quarantine, exit 1). Once the role exists, or with a
`current`, an authentication failure is `plan-error` (alert, no quarantine, exit 1). Written from the ruling, red on the build it was written against."""
from deploy_base import DeployTest
import test_deploy_flow as fl


def last(r):
    return r.err.splitlines()[-1] if r.err.strip() else ""


class Roles(DeployTest):
    new_commit = fl.Flow.new_commit
    staging_candidate = fl.Flow.staging_candidate
    hex_dir = fl.Flow.hex_dir
    first = fl.Flow.first
    ups = fl.Flow.ups
    since = fl.Flow.since
    mark = 0

    def setUp(self):
        super().setUp()
        import shutil
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        self.n = 0

    def runs(self, r):
        return [c for c in r.world.compose_log if c["cmd"] == "run"]

    def test_a_fresh_postgres_with_no_poly_migrator_is_roles_missing_exit_4_with_the_provision_command_and_nothing_started(self):
        x = self.staging_candidate()
        self.world.roles_answer = (0, "0\n", "")
        r = self.deploy("staging", cmd="first-deploy")
        self.assertEqual((r.rc, last(r)), (4, "deploy: refused roles-missing"), r.err)
        self.assertIn("provision --stage database --project staging", r.err)
        self.assertEqual(self.runs(r), [], "no one-off was started")
        self.assertNotIn(x, self.state("staging", "quarantine") or "", "no Q")
        self.assertEqual(len(self.world.role_queries), 1)

    def test_the_question_is_read_only_sql_on_stdin_over_the_local_socket_as_postgres(self):
        self.staging_candidate()
        self.world.roles_answer = (0, "0\n", "")
        self.deploy("staging", cmd="first-deploy")
        argv = self.world.role_queries[0]
        for need in ("exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "postgres"):
            self.assertIn(need, argv)

    def test_exactly_one_goes_on(self):
        self.staging_candidate()
        self.world.roles_answer = (0, "1\n", "")
        r = self.deploy("staging", cmd="first-deploy")
        self.assertEqual(r.rc, 0, r.err)

    def test_anything_else_is_roles_read_with_an_alert_and_no_quarantine(self):
        for label, answer in (("a failed query", (1, "", "psql: error\n")), ("a timeout", "timeout"), ("two", (0, "2\n", "")), ("garbage", (0, "abc\n", "")), ("empty", (0, "", "")),
                              ("0 with a failing exit", (1, "0\n", "")), ("two lines", (0, "1\n1\n", ""))):
            self.setUp()
            x = self.staging_candidate()
            self.world.roles_answer = answer
            r = self.deploy("staging", cmd="first-deploy")
            self.assertEqual((r.rc, last(r)), (1, "deploy: refused roles-read"), "%s: %s" % (label, r.err))
            self.assertEqual(self.alert_name("staging"), "roles-read", label)
            self.assertNotIn(x, self.state("staging", "quarantine") or "", label)
            self.assertEqual(self.runs(r), [], label)

    def test_with_a_current_the_question_is_not_asked(self):
        self.first()
        self.staging_candidate()
        self.world.role_queries.clear()
        self.world.roles_answer = (0, "0\n", "")
        r = self.deploy("staging")
        self.assertEqual(self.world.role_queries, [], "asked with a `current`")
        self.assertEqual(r.rc, 0, r.err)

    def test_a_28p01_from_plan_with_the_role_there_is_plan_error_not_roles_missing_and_no_quarantine(self):
        x = self.staging_candidate()
        self.world.roles_answer = (0, "1\n", "")
        self.world.plan_code, self.world.plan_out = 1, 'error: password authentication failed for user "poly_migrator"\n'
        r = self.deploy("staging", cmd="first-deploy")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused plan-error"), r.err)
        self.assertNotIn(x, self.state("staging", "quarantine") or "", "plan-error bans nothing")

    def test_with_a_current_a_28p01_is_plan_error_and_the_question_is_not_asked(self):
        self.first()
        x = self.staging_candidate()
        self.world.role_queries.clear()
        self.world.plan_code, self.world.plan_out = 1, 'error: password authentication failed for user "poly_migrator"\n'
        r = self.deploy("staging")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused plan-error"), r.err)
        self.assertEqual(self.world.role_queries, [])
        self.assertNotIn(x, self.state("staging", "quarantine") or "")
