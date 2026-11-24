"""POLY-100 G4 (ruling.md section G, 822a05a9): a hung one-off is GONE only when `docker inspect` exits non-zero AND its stderr holds `No such object` or `No such container`. Anything else, a timeout
included, is `oneoff-stuck`, and the locks are held while it is re-checked, 5 s apart, for 60 s. Written from the ruling, red on the build it was written against."""
import test_deploy_oneoff as o

last = o.last

NAME = "polycarpic-staging-migrate"


class Gone(o.F15):
    test_every_one_off_run_is_named_and_a_stale_one_is_removed_first = None
    test_the_migrate_client_timeout_is_thirty_minutes_above_the_runners_ten_minute_lock_wait = None
    test_a_hanging_migrate_is_removed_and_shown_gone_before_the_run_ends_and_is_migrate_timeout_with_q = None
    test_a_one_off_that_is_still_there_after_rm_is_oneoff_stuck_alert_q_exit_1_and_blocks_the_next_run = None
    test_the_prod_backup_lock_is_not_released_before_the_one_off_is_gone = None

    def hung_migrate(self, inspect_answer):
        x2 = self.second()
        self.world.run_hang = {("migrate", "")}
        self.world.inspect_fail[NAME] = inspect_answer
        r = self.deploy("staging")
        return x2, r

    def test_a_daemon_that_cannot_be_reached_is_not_gone_it_is_oneoff_stuck(self):
        x2, r = self.hung_migrate((1, "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n"))
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused oneoff-stuck"), r.err)

    def test_an_inspect_that_times_out_is_not_gone_it_is_oneoff_stuck(self):
        x2, r = self.hung_migrate("timeout")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused oneoff-stuck"), r.err)

    def test_an_exit_zero_inspect_is_not_gone(self):
        x2, r = self.hung_migrate((0, ""))
        self.assertEqual(last(r), "deploy: refused oneoff-stuck", r.err)

    def test_each_real_message_form_of_a_missing_container_is_gone_and_the_refusal_is_migrate_timeout(self):
        for msg in ("Error: No such object: polycarpic-staging-migrate\n", "Error response from daemon: No such container: polycarpic-staging-migrate\n", "Error: No such container: polycarpic-staging-migrate\n",
                    "error: no such object: polycarpic-staging-migrate\n"):  # Docker 29.1.3 (measured in a Linux container, T-real): lowercase, and `_remove_oneoff` asks before EVERY run
            self.setUp()
            x2, r = self.hung_migrate((1, msg))
            self.assertEqual((r.rc, last(r)), (1, "deploy: refused migrate-timeout"), msg + r.err)

    def test_an_exit_code_alone_is_not_gone(self):
        x2, r = self.hung_migrate((1, ""))
        self.assertEqual(last(r), "deploy: refused oneoff-stuck", "a non-zero exit with no message is not proof the container is gone: " + r.err)

    def test_a_not_gone_container_is_rechecked_every_five_seconds_for_a_minute_with_the_locks_held(self):
        x2, r = self.hung_migrate((1, "Cannot connect to the Docker daemon\n"))
        calls = [n for n in self.world.inspect_calls if n == NAME]
        self.assertGreaterEqual(len(calls), 12, "re-checked about every 5 s for 60 s")
        self.assertGreaterEqual(self.world.sleeps_total(), 55, "the run waited about a minute before it gave up")
        self.assertLessEqual(self.world.sleeps_total(), 600 + 70, "and no longer than that beyond the run's own waits")

    def test_a_container_that_goes_away_during_the_recheck_is_migrate_timeout(self):
        x2 = self.second()
        self.world.run_hang = {("migrate", "")}
        state = {"n": 0}

        class Answers(dict):
            def __getitem__(self, k):
                state["n"] += 1
                return (1, "Cannot connect to the Docker daemon\n") if state["n"] < 4 else (1, "Error: No such object: %s\n" % NAME)
            def __contains__(self, k):
                return k == NAME
        self.world.inspect_fail = Answers()
        r = self.deploy("staging")
        self.assertEqual((r.rc, last(r)), (1, "deploy: refused migrate-timeout"), r.err)

    def test_a_normal_deploy_is_not_stalled_or_refused_by_dockers_lowercase_message_for_a_name_that_does_not_exist(self):
        """T-real, measured: `_remove_oneoff` asks before EVERY run; Docker 29.1.3 answers `error: no such object: <name>`; a build that reads only `No such object` waits 60 s per run, then is oneoff-stuck."""
        self.world.inspect_missing_msg = "error: no such object: polycarpic-staging-x\n"
        self.second()
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
        self.assertLess(self.world.sleeps_total(), 600, "no 60 s re-check per one-off run")
