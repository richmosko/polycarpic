"""POLY-98 R7, R7a, K8, K9, K10: status. Every item has its OK, RED and WAIT case with the exact line (or the exact prefix plus the named facts).

Fixtures: the fake runner answers docker compose ps/inspect/logs and psql; ctx.statvfs, ctx.tls_probe and the state files are planted.
Pinned protocols (test-plan.md): psql prints `open:plpgsql`, `open:<sig>`, `missing:<sig>` lines for revokes, one slot name per line for slots.
"""
import datetime as dt
import os
import re
import time
import unittest
from types import SimpleNamespace

from base import APP_REF, BUNDLE, NOW, OpsTest, PG_REF, Runner, stack

H = dt.timedelta


def ts(delta, frac=".123456789Z"):
    return (NOW + delta).strftime("%Y-%m-%dT%H:%M:%S") + frac


def hhmm(t):
    return t.strftime("%H:%MZ")


def line(state, item, project, detail):
    return "%-4s %-9s %-8s %s" % (state, item, project, detail)


DISK_OK = line("OK", "disk", "host", "/ 23%, /srv/polycarpic 4%")
APP_OK = line("OK", "app", "prod", "sha256:1a2b3c4d5e6f, deployed 2026-11-22 18:21Z (19 m)")
CERT_OK = line("OK", "cert", "prod", "app.example.com, 84 days left")
BACKUP_OK = line("OK", "backup", "prod", "last upload 2026-11-22 02:31Z (16 h)")
BDB_OK = line("OK", "backupdb", "prod", "0 poly_backup connections in 24 h, all accounted")
SLOTS_OK = line("OK", "slots", "prod", "no non-temporary replication slot")
REVOKES_OK = line("OK", "revokes", "prod", "plpgsql and 17 built-ins closed to PUBLIC")
GREEN_PROD = [APP_OK, CERT_OK, BACKUP_OK, BDB_OK, SLOTS_OK, REVOKES_OK]
GREEN_STAGING = [line("OK", "app", "staging", "sha256:1a2b3c4d5e6f, deployed 2026-11-22 18:21Z (19 m)"), line("OK", "cert", "staging", "staging.example.com, 84 days left"),
                 line("OK", "slots", "staging", "no non-temporary replication slot"), line("OK", "revokes", "staging", "plpgsql and 17 built-ins closed to PUBLIC")]
FIX = lambda p: "run: sudo polycarpic-ops provision --stage database --project " + p


def vfs(used_pct):
    return SimpleNamespace(f_blocks=100, f_bfree=100 - used_pct, f_bavail=100 - used_pct, f_frsize=4096)


class Status(OpsTest):
    def setUp(self):
        super().setUp()
        self.disk = {"/": 23, "/srv/polycarpic": 4}
        self.tls = {"app.example.com": {"ok": True, "not_after": NOW + H(days=84, hours=3)}, "staging.example.com": {"ok": True, "not_after": NOW + H(days=84, hours=3)}}
        self.prod = None
        self.staging = None
        self.edge = {"caddy": ("running", "healthy")}
        self.refs = {}
        self.started = {}
        self.created = {}
        self.logs = None  # list of docker log lines; None = a healthy 24 h log with no poly_backup connection
        self.slots = {"prod": "", "staging": ""}
        self.revokes = {"prod": "", "staging": ""}
        self.host.write("/var/lib/polycarpic/state/last-upload", "2026-11-22T02:31:00Z\nobject-one\n")
        self.host.write("/var/lib/polycarpic/state/jobs.log", "")
        self.timeouts = set()
        self.psql_calls = []

    def go(self, **_):
        r = Runner(None)
        stack(r, "prod", self.prod, self.refs, created=self.created, started=self.started)
        stack(r, "staging", self.staging if self.staging is not None else self.prod, self.refs)
        stack(r, "edge", self.edge)
        logs = self.logs if self.logs is not None else ["%s 2026-11-21 19:00:00.000 UTC [1] LOG:  database system is ready to accept connections" % ts(-H(hours=23, minutes=50))]
        r.on(("logs", "--timestamps", "--since", "24h", "polycarpic-prod-postgres-1"), out="\n".join(logs) + "\n")

        def psql(argv, stdin):
            project = "prod" if "polycarpic-prod" in argv else "staging"
            self.psql_calls.append((project, argv, stdin))
            if "pg_replication_slots" in stdin:
                return (0, self.slots[project], "")
            return (0, self.revokes[project], "")

        r.on(lambda a: "psql" in a, fn=psql)
        for tokens in self.timeouts:
            r.on(tokens, raises=TimeoutError("timed out"))
        return self.host.go("status", runner=r, tls=lambda host, port: self._tls(host, port), statvfs=lambda p: self._vfs(p))

    def _tls(self, host, port):
        assert port == 443
        v = self.tls[host]
        if isinstance(v, Exception):
            raise v
        return v

    def _vfs(self, path):
        key = "/srv/polycarpic" if path.rstrip("/").endswith("srv/polycarpic") else "/"
        v = self.disk[key]
        if v is None:
            raise FileNotFoundError(path)
        return vfs(v)

    def find(self, r, item, project):
        hits = [l for l in r.out.splitlines() if re.match(r"^(OK|RED|WAIT) +%s +%s " % (item, project), l) or re.match(r"^(OK|RED|WAIT) +%s +%s$" % (item, project), l)]
        self.assertEqual(len(hits), 1, "want one %s %s line in:\n%s" % (item, project, r.out))
        return hits[0]

    # ---- whole-screen shape, summary, exit
    def test_all_green_exact_screen_summary_and_exit_0(self):
        r = self.go()
        self.assertEqual(r.rc, 0, r.out + r.err)
        lines = r.out.splitlines()
        self.assertRegex(lines[0], r"^polycarpic-ops status  box1  2026-11-22 18:40Z  ops git-aaaaaaaaaaaa$")
        self.assertEqual(lines[1:-1], [DISK_OK] + GREEN_PROD + GREEN_STAGING)
        self.assertEqual(lines[-1], "STATUS GREEN")

    def test_waiting_items_make_a_green_with_waiting_summary_and_exit_3(self):
        self.staging = {}
        r = self.go()
        self.assertEqual(r.rc, 3, r.out)
        self.assertEqual(self.find(r, "app", "staging"), "WAIT app      staging  not deployed")
        self.assertEqual(r.out.splitlines()[-1], "STATUS GREEN; 3 WAITING: app staging, slots staging, revokes staging")

    def test_a_red_item_makes_the_summary_red_exit_1_and_the_count_and_names_exact(self):
        self.slots["prod"] = "leftover"
        r = self.go()
        self.assertEqual((r.rc, r.out.splitlines()[-1]), (1, "STATUS RED: 1: slots prod"))
        self.slots["staging"] = "other_slot"
        r = self.go()
        self.assertEqual(r.out.splitlines()[-1], "STATUS RED: 2: slots prod, slots staging")

    def test_red_beats_waiting_in_the_summary(self):
        self.staging = {}
        self.disk["/"] = 90
        r = self.go()
        self.assertEqual((r.rc, r.out.splitlines()[-1]), (1, "STATUS RED: 1: disk host"))

    def test_prod_lines_come_before_staging_lines_disk_first_backup_items_prod_only(self):
        r = self.go()
        items = [(l.split()[1], l.split()[2]) for l in r.out.splitlines()[1:-1]]
        self.assertEqual(items[0], ("disk", "host"))
        self.assertNotIn(("backup", "staging"), items)
        self.assertNotIn(("backupdb", "staging"), items)
        first_staging = min(i for i, x in enumerate(items) if x[1] == "staging")
        self.assertTrue(all(x[1] == "prod" for x in items[1:first_staging]))

    def test_at_most_24_lines_of_at_most_80_characters_even_with_hostile_long_details(self):
        self.slots["prod"] = "\n".join("slot_%02d_" % i + "x" * 40 for i in range(30))
        self.revokes["prod"] = "\n".join("open:fn%02d(%s)" % (i, "text," * 10) for i in range(30))
        self.tls["app.example.com"] = {"ok": False, "reason": "certificate verify failed: " + "very long reason " * 20}
        self.host.write("/var/lib/polycarpic/state/last-upload", "x" * 500 + "\n")
        r = self.go()
        lines = r.out.splitlines()
        self.assertLessEqual(len(lines), 24)
        self.assertTrue(all(len(l) <= 80 for l in lines), [l for l in lines if len(l) > 80])
        self.assertTrue(any(l.endswith("\u2026") for l in lines), "a cut detail ends with an ellipsis")

    def test_read_only_every_call_is_a_bounded_docker_read_and_no_file_changes(self):
        before = self.host.tree()
        r = self.go()
        self.assertEqual(self.host.tree(), before)
        for c in r.runner.calls:
            self.assertEqual(c["argv"][0], "docker", c["argv"])
            self.assertIsNotNone(c["timeout"], c["argv"])
            self.assertLessEqual(c["timeout"], 10, c["argv"])
            self.assertFalse(set(c["argv"]) & {"restart", "up", "down", "rm", "kill", "stop", "start", "run", "pull"}, c["argv"])

    def test_completes_within_15_seconds_against_the_fakes(self):
        t = time.time()
        self.go()
        self.assertLess(time.time() - t, 15)

    # ---- disk
    def test_disk_ok_exact_and_79_is_ok_80_is_red(self):
        self.assertEqual(self.find(self.go(), "disk", "host"), DISK_OK)
        self.disk["/"] = 79
        self.assertTrue(self.find(self.go(), "disk", "host").startswith("OK   disk      host     / 79%"))
        self.disk["/"] = 80
        l = self.find(self.go(), "disk", "host")
        self.assertEqual(l, line("RED", "disk", "host", "/ 80%, /srv/polycarpic 4%"))

    def test_disk_srv_over_80_or_not_mounted_is_red(self):
        self.disk["/srv/polycarpic"] = 85
        self.assertEqual(self.find(self.go(), "disk", "host"), line("RED", "disk", "host", "/ 23%, /srv/polycarpic 85%"))
        self.disk["/srv/polycarpic"] = None
        l = self.find(self.go(), "disk", "host")
        self.assertTrue(l.startswith("RED  disk      host     "), l)
        self.assertIn("/srv/polycarpic not mounted", l)

    # ---- app
    def test_app_ok_exact_with_digest_deployed_time_and_age(self):
        self.assertEqual(self.find(self.go(), "app", "prod"), APP_OK)

    def test_app_age_is_in_minutes_below_an_hour_hours_below_48_h_days_after(self):
        for delta, shown in ((H(hours=5), "13:40Z (5 h)"), (H(days=3), "2026-11-19 18:40Z (3 d)")):
            self.created = {"web": ts(-delta, "Z")[:19] + "Z"}
            l = self.find(self.go(), "app", "prod")
            self.assertTrue(l.endswith(shown), l)

    def test_app_digest_falls_back_to_the_image_id_when_the_reference_has_no_digest(self):
        self.refs = {"web": "ghcr.io/x/y:v1", "auth": "ghcr.io/x/y:v1", "worker": "ghcr.io/x/y:v1"}
        self.assertEqual(self.find(self.go(), "app", "prod"), line("OK", "app", "prod", "sha256:cdcdcdcdcdcd, deployed 2026-11-22 18:21Z (19 m)"))

    def test_app_red_for_each_unhealthy_stopped_or_missing_service(self):
        ok = {"postgres": ("running", "healthy"), "web": ("running", "healthy"), "auth": ("running", "healthy"), "worker": ("running", "healthy")}
        for svc, bad in (("web", ("running", "unhealthy")), ("postgres", ("running", "starting")), ("worker", ("exited", "")), ("auth", None)):
            self.prod = dict(ok)
            if bad is None:
                del self.prod[svc]
            else:
                self.prod[svc] = bad
            l = self.find(self.go(), "app", "prod")
            self.assertTrue(l.startswith("RED  app       prod     "), l)
            self.assertIn(svc, l)

    def test_app_no_health_check_running_is_ok_and_differing_images_are_red(self):
        self.prod = {"postgres": ("running", "healthy"), "web": ("running", ""), "auth": ("running", "healthy"), "worker": ("running", "healthy")}
        self.assertTrue(self.find(self.go(), "app", "prod").startswith("OK   app       prod     "))
        self.prod = None
        self.refs = {"auth": "ghcr.io/richmosko/polycarpic@sha256:" + "ee" * 32}
        l = self.find(self.go(), "app", "prod")
        self.assertTrue(l.startswith("RED  app       prod     "), l)
        self.assertIn("image", l)

    def test_app_wait_when_the_project_has_no_containers(self):
        self.prod = {}
        self.staging = {}
        r = self.go()
        self.assertEqual(self.find(r, "app", "prod"), "WAIT app      prod     not deployed")

    # ---- cert
    def test_cert_ok_exact_red_under_14_days_and_13_days_is_red(self):
        self.assertEqual(self.find(self.go(), "cert", "prod"), CERT_OK)
        self.tls["app.example.com"] = {"ok": True, "not_after": NOW + H(days=14, hours=1)}
        self.assertEqual(self.find(self.go(), "cert", "prod"), line("OK", "cert", "prod", "app.example.com, 14 days left"))
        self.tls["app.example.com"] = {"ok": True, "not_after": NOW + H(days=13, hours=23)}
        self.assertEqual(self.find(self.go(), "cert", "prod"), line("RED", "cert", "prod", "app.example.com, 13 days left"))

    def test_cert_fails_to_verify_is_red_with_the_reason(self):
        self.tls["app.example.com"] = {"ok": False, "reason": "certificate verify failed: hostname mismatch"}
        l = self.find(self.go(), "cert", "prod")
        self.assertTrue(l.startswith("RED  cert      prod     "), l)
        self.assertIn("hostname mismatch", l)

    def test_cert_nothing_answers_is_wait_when_edge_has_no_containers_and_red_when_it_has(self):
        self.tls["app.example.com"] = ConnectionRefusedError("refused")
        self.edge = {}
        l = self.find(self.go(), "cert", "prod")
        self.assertTrue(l.startswith("WAIT cert      prod     "), l)
        self.edge = {"caddy": ("running", "healthy")}
        l = self.find(self.go(), "cert", "prod")
        self.assertTrue(l.startswith("RED  cert      prod     "), l)

    # ---- backup
    def test_backup_ok_exact_red_at_26_h_or_over_and_27_h_is_red(self):
        self.assertEqual(self.find(self.go(), "backup", "prod"), BACKUP_OK)
        self.host.write("/var/lib/polycarpic/state/last-upload", "2026-11-21T16:40:00Z\n")
        self.assertEqual(self.find(self.go(), "backup", "prod"), line("RED", "backup", "prod", "last upload 2026-11-21 16:40Z (26 h)"))
        self.host.write("/var/lib/polycarpic/state/last-upload", "2026-11-21T15:40:00Z\n")
        self.assertEqual(self.find(self.go(), "backup", "prod"), line("RED", "backup", "prod", "last upload 2026-11-21 15:40Z (27 h)"))
        self.host.write("/var/lib/polycarpic/state/last-upload", "2026-11-21T16:41:00Z\n")  # 25 h 59 m: still inside INFRA 6.5's window
        self.assertTrue(self.find(self.go(), "backup", "prod").startswith("OK   backup"))

    def test_backup_empty_or_absent_is_wait_and_an_unparseable_first_line_is_red(self):
        self.host.write("/var/lib/polycarpic/state/last-upload", "")
        self.assertTrue(self.find(self.go(), "backup", "prod").startswith("WAIT backup    prod     "))
        os.unlink(str(self.host.p("/var/lib/polycarpic/state/last-upload")))
        self.assertTrue(self.find(self.go(), "backup", "prod").startswith("WAIT backup    prod     "))
        self.host.write("/var/lib/polycarpic/state/last-upload", "yesterday-ish\n")
        self.assertTrue(self.find(self.go(), "backup", "prod").startswith("RED  backup    prod     "))

    def test_backup_hostile_file_content_is_never_printed(self):  # K8
        self.host.write("/var/lib/polycarpic/state/last-upload", "\x1b[31m2026-11-22T02:31:00Z\x1b]0;pwned\x07\nobject\x1b[0m\n")
        r = self.go()
        self.assertNotIn("\x1b", r.out + r.err)
        self.assertTrue(self.find(r, "backup", "prod").startswith("RED  backup    prod     "))

    def test_backup_timestamp_more_than_5_minutes_in_the_future_is_red_4_minutes_is_not(self):  # K8
        self.host.write("/var/lib/polycarpic/state/last-upload", ts(H(minutes=10), "Z")[:19] + "Z\n")
        l = self.find(self.go(), "backup", "prod")
        self.assertTrue(l.startswith("RED  backup    prod     "), l)
        self.assertIn("timestamp in the future", l)
        self.host.write("/var/lib/polycarpic/state/last-upload", ts(H(minutes=4), "Z")[:19] + "Z\n")
        self.assertTrue(self.find(self.go(), "backup", "prod").startswith("OK   backup"))

    # ---- backupdb
    def conn(self, delta):
        return "%s %s [9] LOG:  replication connection authorized: user=poly_backup application_name=pg_basebackup" % (ts(delta), (NOW + delta).strftime("%Y-%m-%d %H:%M:%S.000 UTC"))

    def at(self, hh, mm, ss=0):
        t = NOW.replace(hour=hh, minute=mm, second=ss)
        return t - NOW

    def window(self, a, b, job="provision-check-d3", result="ok"):
        f = "%Y-%m-%dT%H:%M:%SZ"
        return "%s %s %s %s\n" % ((NOW + a).strftime(f), (NOW + b).strftime(f), job, result)

    def logs_with(self, *conns):
        return ["%s 2026-11-21 19:00:00.000 UTC [1] LOG:  database system is ready" % ts(-H(hours=23, minutes=50))] + [self.conn(c) for c in conns]

    def test_backupdb_counts_connections_inside_a_widened_window_boundaries_included(self):
        self.host.write("/var/lib/polycarpic/state/jobs.log", self.window(self.at(11, 59), self.at(12, 0, 30)))
        self.logs = self.logs_with(self.at(12, 0), self.at(12, 1, 20))
        self.assertEqual(self.find(self.go(), "backupdb", "prod"), line("OK", "backupdb", "prod", "2 poly_backup connections in 24 h, all accounted"))

    def test_backupdb_a_connection_outside_every_window_is_red_with_its_time(self):
        self.host.write("/var/lib/polycarpic/state/jobs.log", self.window(self.at(11, 59), self.at(12, 0, 30)))
        self.logs = self.logs_with(self.at(12, 1, 40))
        l = self.find(self.go(), "backupdb", "prod")
        self.assertTrue(l.startswith("RED  backupdb  prod     "), l)
        self.assertIn("12:01Z", l)
        self.logs = self.logs_with(self.at(12, 0))  # the same connection inside the D3 window is accounted
        self.assertTrue(self.find(self.go(), "backupdb", "prod").startswith("OK   backupdb  prod     1 poly_backup connections"))

    def test_backupdb_names_at_most_three_times(self):
        self.logs = self.logs_with(*[self.at(h, 5) for h in (1, 2, 3, 4, 5)])
        l = self.find(self.go(), "backupdb", "prod")
        self.assertEqual(len(re.findall(r"\d\d:\d\dZ", l)), 3, l)

    def test_backupdb_unparseable_or_inconsistent_jobs_log_lines_are_red_with_the_line_number(self):  # K8
        good = self.window(self.at(1, 0), self.at(1, 5), "backup")
        for bad in ("garbage\n", "2026-11-22T01:00:00Z 2026-11-22T01:05:00Z Bad_Job ok\n", "2026-11-22T01:05:00Z 2026-11-22T01:00:00Z backup ok\n",
                    "2026-11-22T10:00:00Z 2026-11-22T23:00:00Z backup ok\n", "2026-11-22T01:00:00Z 2026-11-22T01:05:00Z backup maybe\n"):
            self.host.write("/var/lib/polycarpic/state/jobs.log", good + bad)
            l = self.find(self.go(), "backupdb", "prod")
            self.assertTrue(l.startswith("RED  backupdb  prod     "), (bad, l))
            self.assertIn("jobs.log line 2", l, bad)

    def test_backupdb_window_caps_d3_ten_minutes_other_jobs_six_hours(self):  # K9
        self.host.write("/var/lib/polycarpic/state/jobs.log", self.window(-H(hours=24), -H(minutes=1)))
        self.assertIn("jobs.log line 1", self.find(self.go(), "backupdb", "prod"))
        self.host.write("/var/lib/polycarpic/state/jobs.log", self.window(-H(hours=7), -H(minutes=1), "backup"))
        self.assertIn("jobs.log line 1", self.find(self.go(), "backupdb", "prod"))
        self.host.write("/var/lib/polycarpic/state/jobs.log", self.window(-H(hours=5, minutes=59), -H(minutes=1), "backup") + self.window(-H(minutes=19), -H(minutes=10)))
        self.assertTrue(self.find(self.go(), "backupdb", "prod").startswith("OK   backupdb"))

    def test_backupdb_a_log_that_covers_under_23_hours_is_red_unless_the_container_is_young(self):  # K9
        self.logs = ["%s 2026-11-22 16:30:00.000 UTC [1] LOG:  checkpoint complete" % ts(-H(hours=2, minutes=5))]
        self.assertEqual(self.find(self.go(), "backupdb", "prod"), line("RED", "backupdb", "prod", "postgres log covers only 2 h"))
        self.started = {"postgres": ts(-H(hours=3), "Z")}
        self.assertTrue(self.find(self.go(), "backupdb", "prod").startswith("OK   backupdb"))

    def test_backupdb_a_future_jobs_log_end_is_red(self):  # K8
        self.host.write("/var/lib/polycarpic/state/jobs.log", self.window(-H(minutes=1), H(minutes=30), "backup"))
        self.assertIn("jobs.log line 1", self.find(self.go(), "backupdb", "prod"))

    def test_backupdb_wait_when_postgres_is_not_running_and_red_on_timeout(self):
        self.prod = {"web": ("running", "healthy")}
        self.staging = {}
        l = self.find(self.go(), "backupdb", "prod")
        self.assertTrue(l.startswith("WAIT backupdb  prod     "), l)
        self.assertIn("not running", l)
        self.prod = None
        self.staging = None
        self.timeouts = {("logs", "--timestamps")}
        l = self.find(self.go(), "backupdb", "prod")
        self.assertTrue(l.startswith("RED  backupdb  prod     "), l)
        self.assertIn("timed out", l)

    # ---- slots
    def test_slots_ok_exact_red_names_the_slot_wait_when_postgres_is_down(self):
        self.assertEqual(self.find(self.go(), "slots", "prod"), SLOTS_OK)
        self.slots["prod"] = "leftover\nother\n"
        l = self.find(self.go(), "slots", "prod")
        self.assertTrue(l.startswith("RED  slots     prod     "), l)
        self.assertIn("leftover", l)
        self.assertIn("other", l)
        self.slots["prod"] = ""
        self.prod = {}
        self.staging = {}
        self.assertTrue(self.find(self.go(), "slots", "prod").startswith("WAIT slots     prod     "))

    def test_slots_names_are_pattern_checked_before_printing(self):  # K8
        self.slots["prod"] = "bad\x1b[31mname\n"
        r = self.go()
        self.assertNotIn("\x1b", r.out)
        self.assertIn("?", self.find(r, "slots", "prod"))

    # ---- revokes
    def test_revokes_ok_exact_and_the_status_session_is_read_only_with_literal_signatures(self):  # K10
        r = self.go()
        self.assertEqual(self.find(r, "revokes", "prod"), REVOKES_OK)
        roles = self.host.p(BUNDLE + "/packages/db/sql/roles.sql").read_text()
        sigs = re.findall(r"^REVOKE EXECUTE ON FUNCTION pg_catalog\.(\S+) FROM PUBLIC;$", roles, re.M)
        self.assertEqual(len(sigs), 17)
        calls = [c for c in r.runner.calls if "psql" in c["argv"]]
        self.assertTrue(calls)
        for c in calls:
            self.assertEqual(c["argv"][:13], ["docker", "compose", "-p", "polycarpic-" + ("prod" if "polycarpic-prod" in c["argv"] else "staging"), "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "polycarpic", "-XAtq", "-v"])
            self.assertEqual(c["argv"][13:], ["ON_ERROR_STOP=1"])
            self.assertTrue(c["stdin"].lstrip().startswith("SET default_transaction_read_only = on"), c["stdin"][:80])
        rev = [c["stdin"] for c in calls if "pg_replication_slots" not in c["stdin"]][0]
        for s in sigs:
            self.assertTrue(("'" + s + "'") in rev or ("'pg_catalog." + s + "'") in rev, "signature not passed as a quoted literal: " + s)

    def test_revokes_plpgsql_open_is_red_naming_it_and_the_fix_line_appears_once_before_the_summary(self):
        self.revokes["prod"] = "open:plpgsql\n"
        r = self.go()
        l = self.find(r, "revokes", "prod")
        self.assertTrue(l.startswith("RED  revokes   prod     "), l)
        self.assertIn("plpgsql", l)
        lines = r.out.splitlines()
        self.assertEqual(lines.count(FIX("prod")), 1)
        self.assertLess(lines.index(FIX("prod")), len(lines) - 1)
        self.assertTrue(lines[-1].startswith("STATUS RED"))

    def test_revokes_one_builtin_executable_by_public_is_red_naming_it(self):
        self.revokes["prod"] = "open:query_to_xml(text,boolean,boolean,text)\n"
        l = self.find(self.go(), "revokes", "prod")
        self.assertTrue(l.startswith("RED  revokes   prod     "), l)
        self.assertIn("query_to_xml", l)

    def test_revokes_a_signature_that_does_not_resolve_is_red_not_found(self):
        self.revokes["prod"] = "missing:query_to_xml(text,boolean,boolean,text)\n"
        l = self.find(self.go(), "revokes", "prod")
        self.assertTrue(l.startswith("RED  revokes   prod     "), l)
        self.assertIn("query_to_xml(text,boolean,boolean,text) not found", l)

    def test_revokes_roles_sql_with_16_revokes_is_red_exact(self):
        f = self.host.p(BUNDLE + "/packages/db/sql/roles.sql")
        text = f.read_text()
        i = text.index("REVOKE EXECUTE ON FUNCTION pg_catalog.")
        j = text.index("\n", i)
        f.write_text(text[:i] + text[j + 1:])
        self.assertEqual(self.find(self.go(), "revokes", "prod"), line("RED", "revokes", "prod", "roles.sql lists 16 built-ins, want 17"))

    def test_revokes_a_signature_with_a_quote_is_red_and_no_psql_runs_for_it(self):  # K10
        f = self.host.p(BUNDLE + "/packages/db/sql/roles.sql")
        f.write_text(f.read_text().replace("pg_catalog.query_to_xml(text,boolean,boolean,text)", "pg_catalog.query_to_xml(text,boolean,boolean,text'); DROP TABLE x; --", 1))
        r = self.go()
        self.assertTrue(self.find(r, "revokes", "prod").startswith("RED  revokes   prod     "))
        self.assertFalse([c for c in r.runner.calls if "psql" in c["argv"] and "DROP TABLE" in (c["stdin"] or "")])
        for c in r.runner.calls:
            if "psql" in c["argv"]:
                self.assertIn("pg_replication_slots", c["stdin"], "only the slots query may run when roles.sql is unusable")

    def test_revokes_wait_when_postgres_is_not_running(self):
        self.prod = {}
        self.staging = {}
        self.assertTrue(self.find(self.go(), "revokes", "prod").startswith("WAIT revokes   prod     "))


if __name__ == "__main__":
    unittest.main()
