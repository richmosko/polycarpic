"""POLY-100 T-help (R10, S21, A15): what a guard refusal tells the operator. The expected text is built here from the ruling's template (@ 166e2438), never from
the code under test. Only a refusal of the CANDIDATE prints a command; every value comes from what the box verified itself."""
import importlib.util
import os
import sys

from base import OPS
from deploy_base import digest, utc
from test_deploy_bundle import good_files, make_tar, sibling_digests
from test_deploy_guard import both, svc
from test_deploy_prod import ProdBase

ID_A = "git-aaaaaaaaaaaa"
HOSTILE = "x; touch /pwn\ninstall.sh evil@attacker --commit " + "0" * 40 + "\x1b[31m"


def template(rule, c, base="aaaaaaaaaaaa", target="polyops@<this box>", tag=None, again=None):
    who = "signed tag %s" % tag if tag else "unsigned: any merge to main"
    out = [
        "%s: this release needs a wider safety policy than the one installed. None of its containers was started." % rule,
        "1. review, on the laptop, in a checkout you already trust (%s):" % who,
        "   git fetch origin && git merge-base --is-ancestor %s origin/main && git diff --text --no-ext-diff --no-textconv %s %s -- infra packages/db/sql ':(glob)**/.gitattributes' && echo 'review: on main'" % (c, base, c),
    ]
    if tag:
        out.append("   git fetch origin tag %s && git verify-tag %s && test \"$(git rev-parse '%s^{commit}')\" = %s && echo 'review: tag signed'" % (tag, tag, tag, c))
    out += ["2. only if each command above ended with its review: line and you agree with every line; this installs root code on the box:",
            "   infra/ops/install.sh %s --ssh-key <file> --commit %s" % (target, c),
            ("3. then run again: %s" % again) if again else "3. the release then deploys on the next poll; there is nothing to clear."]
    return out


def status_lines(r, project):
    path = OPS / "status" / "08_deploy.py"
    if str(OPS) not in sys.path:
        sys.path.insert(0, str(OPS))
    spec = importlib.util.spec_from_file_location("ops_status_08_deploy", str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return [l for l in mod.run(r.ctx) if l.project == project]


class Help(ProdBase):
    def candidate(self, hooks, project="staging"):
        w = self.world
        if project == "staging":
            x = digest("x")
            w.image("polycarpic", x, w.commit_b, bundle=make_tar(good_files()))
            w.attested.add((x, w.commit_b))
            for n, d in sibling_digests().items():
                w.image("polycarpic-" + n, d, w.commit_b)
                w.attested.add((d, w.commit_b))
            w.staging_run(w.commit_b, x)
        w.render_hooks.update(hooks)
        return w.commit_b

    def setUp(self):
        super().setUp()
        self.seed("staging", self.current_digest, "-", self.world.commit_a)

    def alert_rows(self, project="staging"):
        return (self.state(project, "alert") or "").rstrip("\n").split("\n")

    def test_a_staging_refusal_holds_exactly_the_template_in_stderr_alert_log_and_status(self):
        c = self.candidate(both(svc("web", privileged=True)))
        r = self.deploy("staging")
        want = template("guard-key", c)
        self.assertEqual(r.err.splitlines()[-len(want) - 1:-1], want)  # the last stderr line is the refusal line
        rows = self.alert_rows()
        self.assertEqual(rows[0].split()[1], "guard-key", "alert line 1 is unchanged")
        self.assertEqual(rows[1:], want[0:] if False else want)
        helps = [l for l in (self.state("staging", "deploy.log") or "").splitlines() if l.split()[1] == "help"]
        self.assertEqual([l.split(" ", 2)[2] for l in helps], want, "one help event per line")
        st = status_lines(r, "staging")[0]
        self.assertEqual((st.state, st.item), ("RED", "deploy"))
        self.assertEqual(list(st.extra), want, "status: the RED line, then the lines unwrapped and uncut")

    def test_the_ssh_target_comes_from_the_installed_file_when_it_is_well_formed(self):
        c = self.candidate(both(svc("web", privileged=True)))
        self.host.write("/opt/polycarpic/ops/ssh-target", "polyops@box1.example.com\n")
        r = self.deploy("staging")
        self.assertIn("   infra/ops/install.sh polyops@box1.example.com --ssh-key <file> --commit %s" % c, r.err.splitlines())

    def test_a_missing_or_malformed_ssh_target_or_bundle_id_prints_the_placeholders(self):
        bad_targets = ["root@evil", "polyops@a b", "polyops@", "polyops@x;id", "polyops@-x", "polyops@" + "a" * 254, "polyops@host\ninstall.sh x", "\x1b[0mpolyops@x"]
        for t in [None] + bad_targets:
            self.world.docker_log.clear()
            shutil_rm = self.host.p("/opt/polycarpic/ops/ssh-target")
            if shutil_rm.exists():
                shutil_rm.unlink()
            if t is not None:
                self.host.write("/opt/polycarpic/ops/ssh-target", t + "\n")
            self.seed("staging", self.current_digest, "-", self.world.commit_a)
            c = self.candidate(both(svc("web", privileged=True)))
            self.world.registry.clear()
            c = self.candidate(both(svc("web", privileged=True)))
            self.host.p("/var/lib/polycarpic/state/deploy/staging/quarantine").unlink() if self.host.p("/var/lib/polycarpic/state/deploy/staging/quarantine").exists() else None
            r = self.deploy("staging")
            self.assertIn("   infra/ops/install.sh polyops@<this box> --ssh-key <file> --commit %s" % c, r.err.splitlines(), repr(t))

    def test_a_malformed_installed_bundle_id_prints_the_base_placeholder(self):
        c = self.candidate(both(svc("web", privileged=True)))
        link = str(self.host.p("/opt/polycarpic/ops/current"))
        import shutil
        shutil.copytree(str(self.host.p("/opt/polycarpic/ops/" + ID_A)), str(self.host.p("/opt/polycarpic/ops/weird")), symlinks=True)
        os.unlink(link)
        os.symlink("weird", link)
        r = self.deploy("staging")
        joined = "\n".join(r.err.splitlines())
        self.assertIn("git diff --text --no-ext-diff --no-textconv <commit you last installed> %s" % c, joined)

    def test_hostile_text_in_the_bundle_never_reaches_alert_log_status_or_stderr(self):
        hooks = both(lambda d: d["services"].update({HOSTILE: dict(d["services"]["worker"])}) or d)
        hooks_key = both(lambda d: d["services"]["web"].update({HOSTILE: "x"}) or d)
        for h in (hooks, hooks_key, both(svc("web", image=HOSTILE)), both(lambda d: d.update(name=HOSTILE) or d)):
            self.world.registry.clear()
            self.seed("staging", self.current_digest, "-", self.world.commit_a)
            self.world.compose_log.clear()
            if self.host.p("/var/lib/polycarpic/state/deploy/staging/quarantine").exists():
                self.host.p("/var/lib/polycarpic/state/deploy/staging/quarantine").unlink()
            self.candidate(h)
            r = self.deploy("staging")
            blob = r.err + (self.state("staging", "alert") or "") + (self.state("staging", "deploy.log") or "") + "\n".join(l.detail + "".join(l.extra) for l in status_lines(r, "staging"))
            for needle in ("touch /pwn", "attacker", "\x1b", "evil"):
                self.assertNotIn(needle, blob, needle)
            rule = self.alert_rows()[0].split()[1]
            self.assertTrue(rule.startswith("guard-"), rule)
            rows = self.alert_rows()[1:]
            self.assertEqual(rows[0].split(":")[0], rule)

    def test_a_prod_refusal_names_the_tag_and_ends_both_chains_with_a_review_line(self):
        x1, _ = self.first_prod()
        x2 = self.release_of("v1.1.0")
        c = self.world.git("rev-parse", "v1.1.0^{commit}")
        self.world.render_hooks[("prod", None)] = lambda d: d["services"]["web"].update(privileged=True) or d
        r = self.deploy("prod")
        want = template("guard-key", c, tag="v1.1.0")
        self.assertEqual(r.err.splitlines()[-len(want) - 1:-1], want)
        self.assertIn("review: tag signed", want[3])
        self.assertIn("review: on main", want[2])
        commands = "\n".join(l for l in want if l.startswith("   ")).lower()  # the commands, not the prose ("a checkout you already trust")
        for banned in ("switch", "checkout", "pull"):
            self.assertNotIn(banned, commands)
        self.assertLess([i for i, l in enumerate(want) if l.startswith("   git fetch")][-1], [i for i, l in enumerate(want) if "install.sh" in l][0], "review before install")

    def test_a_refusal_of_current_prints_no_command(self):
        self.candidate({})
        cur = "sha256-" + self.current_digest.split(":")[1]
        self.world.dir_hooks[cur] = lambda d: d["services"]["web"].update(privileged=True) or d  # current's own render is wrong, the candidate's is fine
        r = self.deploy("staging")
        self.assertNotEqual(r.rc, 0)
        self.assertRegex(r.err.splitlines()[-1], r"^deploy: refused current-guard-")
        self.assertNotIn("install.sh", r.err + (self.state("staging", "alert") or ""))
        self.assertNotIn("--commit", r.err)

    def test_a_refused_first_deploy_shows_red_in_status(self):
        w = self.world
        shutil_state = self.sdir("staging")
        import shutil
        shutil.rmtree(str(shutil_state), ignore_errors=True)
        self.candidate(both(svc("web", privileged=True)))
        r = self.deploy("staging", cmd="first-deploy")
        self.assertNotEqual(r.rc, 0)
        st = status_lines(r, "staging")[0]
        self.assertEqual((st.state, st.item, st.project), ("RED", "deploy", "staging"))

    def test_a_sha256_bundle_id_is_not_a_commit_so_the_base_is_the_placeholder(self):
        import shutil
        c = self.candidate(both(svc("web", privileged=True)))
        new = "sha256-bbbbbbbbbbbb"
        shutil.copytree(str(self.host.p("/opt/polycarpic/ops/" + ID_A)), str(self.host.p("/opt/polycarpic/ops/" + new)), symlinks=True)
        link = str(self.host.p("/opt/polycarpic/ops/current"))
        os.unlink(link)
        os.symlink(new, link)
        r = self.deploy("staging")
        self.assertIn("git diff --text --no-ext-diff --no-textconv <commit you last installed> %s" % c, "\n".join(r.err.splitlines()))
