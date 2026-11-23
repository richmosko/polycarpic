"""POLY-100 G7 (ruling.md section G, 822a05a9): each health child gets min(30 s, what is left of the window) computed just before it starts; with nothing left the poll ends as "not healthy". Six
children taking 29 s each must not push the rollback past 120 s of fake time. Written from the ruling, red on the build it was written against (it computes the child's budget once per poll)."""
from test_deploy_hang import Hang, last


class Budget(Hang):
    def test_children_of_29_seconds_each_still_start_the_rollback_within_the_window(self):
        x1, x2 = self.bad_second_deploy()  # hang_from: the window opens at the candidate's first `up`
        self.world.hang = {"exec"}
        self.world.child_secs = 29
        r = self.deploy("staging")
        self.assertEqual(last(r), "deploy: rolled-back", r.err)
        marks = self.world.up_marks
        self.assertGreaterEqual(len(marks), 2, "the candidate's up and the rollback's")
        started = marks[-1] - marks[-2]
        self.assertLessEqual(started, 125, "the rollback started %d s of fake time after the candidate's up (window 120 s); marks %r" % (started, marks))

    def test_a_healthy_slow_child_within_the_window_still_passes(self):
        x1, x2 = self.bad_second_deploy()
        self.world.child_secs = 3
        r = self.deploy("staging")
        self.assertEqual(r.rc, 0, r.err)
