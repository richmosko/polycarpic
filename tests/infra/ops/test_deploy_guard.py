"""POLY-100 G3: the compose guard (R5; T8, S3, S10, S14). The renders are the committed fixtures (fixtures/gen_compose.py); a case edits them."""
import copy

from deploy_base import DeployTest, digest
from test_deploy_bundle import good_files, make_tar, sibling_digests

EDGE = "polycarpic-prod-edge"


def both(fn):
    return {("staging", None): fn}


def raw_only(fn):
    return {("staging", True): fn}


def plain_only(fn):
    return {("staging", False): fn}


def svc(name, **kv):
    def f(d):
        d["services"][name].update(copy.deepcopy(kv))
        return d
    return f


def chain(*fns):
    def f(d):
        for fn in fns:
            d = fn(d) or d
        return d
    return f


def net(key, entry, join=True):
    def f(d):
        d.setdefault("networks", {})[key] = entry
        if join:
            d["services"]["web"].setdefault("networks", {})[key] = {}
        return d
    return f


def add_vol(name, v):
    def f(d):
        d["services"][name].setdefault("volumes", []).append(copy.deepcopy(v))
        return d
    return f


def delkey(name, key):
    def f(d):
        d["services"][name].pop(key, None)
        return d
    return f


def add_service(name):
    def f(d):
        d["services"][name] = copy.deepcopy(d["services"]["worker"])
        return d
    return f


# (label, hooks, rule)
CASES = [
    ("privileged: true", both(svc("web", privileged=True)), "key"),
    ("a bind of /", both(add_vol("postgres", {"type": "bind", "source": "/", "target": "/host"})), "mount"),
    ("the Docker socket", both(add_vol("postgres", {"type": "bind", "source": "/var/run/docker.sock", "target": "/var/run/docker.sock"})), "mount"),
    ("an image outside the verified set", plain_only(svc("web", image="ghcr.io/anyone/x@sha256:" + "9" * 64)), "image"),
    ("top-level name polycarpic-prod in a staging bundle", both(lambda d: d.update(name="polycarpic-prod") or d), "name"),
    ("a staging service on polycarpic-prod-edge", both(net("edge-prod", {"name": EDGE, "external": True})), "network"),
    ("container_name", both(svc("web", container_name="polycarpic-prod-web-1")), "name"),
    ("a quoted-key include adding a service (raw and plain renders)", both(add_service("x")), "service"),
    ("a service not allowlisted for the project", both(add_service("sidecar")), "service"),
    ("build:", both(svc("web", build={"context": "."})), "service"),
    ('network_mode: "container:polycarpic-prod-web-1"', both(svc("web", network_mode="container:polycarpic-prod-web-1")), "key"),
    ("network_mode: host", both(svc("web", network_mode="host")), "key"),
    ("pid: host", both(svc("web", pid="host")), "key"),
    ("volumes_from", both(svc("web", volumes_from=["postgres"])), "key"),
    ("cap_add", both(svc("web", cap_add=["SYS_ADMIN"])), "key"),
    ("devices", both(svc("web", devices=["/dev/sda:/dev/sda"])), "key"),
    ("a named volume with driver_opts bind /", both(lambda d: d.update(volumes={"v": {"driver": "local", "driver_opts": {"type": "none", "o": "bind", "device": "/"}}}) or
                                                    d["services"]["web"].update(volumes=[{"type": "volume", "source": "v", "target": "/v"}]) or d), ("mount", "key")),
    ("a configs file /etc/shadow", both(lambda d: d.update(configs={"c": {"file": "/etc/shadow"}}) or d["services"]["web"].update(configs=[{"source": "c", "target": "/c"}]) or d), ("file", "key")),
    ("a staging env_file of /etc/polycarpic/host.env", raw_only(svc("web", env_file=[{"path": "/etc/polycarpic/host.env", "required": True}])), "env"),
    ('user: "0"', both(svc("web", user="0")), "pinned"),
    ("a service without cap_drop: [ALL]", both(delkey("web", "cap_drop")), "pinned"),
    ("security_opt widened", both(svc("web", security_opt=["seccomp=unconfined"])), "pinned"),
    ("read_only false", both(svc("web", read_only=False)), "pinned"),
    ("external name polycarpic-prod_default behind key default (S14)", both(lambda d: d["networks"].update(default={"name": "polycarpic-prod_default", "external": True}) or d), "network"),
    ("an edge alias naming polycarpic-prod-edge behind the staging edge key (S14)", both(lambda d: d["networks"].update({"edge-staging": {"name": EDGE, "external": True}}) or d), "network"),
    ("a published port on a non-caddy service", both(svc("web", ports=[{"mode": "ingress", "target": 3000, "published": "3000", "protocol": "tcp"}])), ("ports", "key")),
]


class Guard(DeployTest):
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

    def started(self, r):
        return [c for c in r.world.compose_log if c["cmd"] in ("up", "run")]

    def test_t8_each_unsafe_render_is_refused_before_any_candidate_container(self):
        for label, hooks, rule in CASES:
            with self.subTest(label):
                self.setUp_again()
                x = self.candidate(hooks)
                r = self.deploy("staging")
                rules = rule if isinstance(rule, tuple) else (rule,)
                self.assertEqual(r.rc, 1, label + "\n" + r.err)
                self.assertIn(r.err.splitlines()[-1], ["deploy: refused guard-" + x for x in rules], label)
                self.assertIn(self.alert_name("staging"), ["guard-" + x for x in rules])
                self.assertIn(x, self.state("staging", "quarantine"))
                self.assertEqual(self.started(r), [], label)
                self.assertEqual([a for a in r.world.docker_log if a[1] == "start"], [])

    def setUp_again(self):
        import shutil
        shutil.rmtree(str(self.sdir("staging")), ignore_errors=True)
        shutil.rmtree(str(self.host.p("/opt/polycarpic/releases")), ignore_errors=True)
        self.seed("staging", self.current_digest, "-", self.world.commit_a)
        w = self.world
        w.registry.clear(), w.attested.clear(), w.runs.clear(), w.artifacts.clear(), w.render_hooks.clear(), w.docker_log.clear(), w.compose_log.clear()

    def test_t8_positive_the_real_bundle_passes_the_guard(self):
        self.candidate()
        r = self.deploy("staging")
        self.assertFalse((self.alert_name("staging") or "").startswith("guard-"), r.err)
        self.assertEqual(self.alert_name("staging"), None, r.err)
        self.assertEqual(r.rc, 0, r.err)

    def test_t8_a_permissive_policy_inside_the_bundle_is_ignored(self):
        # the policy is the installed one: a release that ships its own compose-allow.json cannot widen it (mutant: policy read from the release)
        f = good_files()
        f["infra/deploy/compose-allow.json"] = b"{}"
        self.candidate(both(svc("web", privileged=True)))
        self.world.registry[[k for k in self.world.registry if k.endswith("polycarpic@" + digest("x"))][0]]["bundle"] = make_tar(f)
        r = self.deploy("staging")
        self.assertEqual(r.err.splitlines()[-1], "deploy: refused bundle")  # off-manifest, refused before the guard even reads it
