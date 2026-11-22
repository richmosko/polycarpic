"""POLY-99 R5/R6 fixtures for the root job runner (infra/ops/commands/backup.py and upload.py). Pins 15-24: process/cairn/reviews/POLY-99/test-plan.md.

The runner is driven in-process through the POLY-98 harness (base.py). The container run is a fake `docker compose ... run` that makes the files
the real container would publish and prints its stdout; the fake is NOT the unit under test (the runner is), as R12 T15 says.
"""
import hashlib
import json
import os
import re
import shutil
import tempfile
from pathlib import Path

from base import BUNDLE, FIXED_ENV, NOW, OPS, PG_REF, REPO, OpsTest, Runner, load_dispatcher, stack

TS = "20261122T021500Z"
SYS = "7711142272324444185"
M = "17"
TOOLS_REF = "ghcr.io/richmosko/polycarpic-tools@sha256:" + "cd" * 32
HB = "https://hc-ping.example/ping/0000aaaa-0000-0000-0000-000000000000"
SPOOL = "/srv/polycarpic/spool"
STATE = "/var/lib/polycarpic/state"
IMAGES_ENV = "/opt/polycarpic/images.env"
INSTANCE = "poly-test"
COMPOSE = BUNDLE + "/infra/compose/prod.yml"


def nm(kind, ts=TS, sys=SYS):
    return "%s-%s-%s-%s.age" % (kind, M, sys, ts)


def wal(seg):
    return "wal-%s-%s-%s.age" % (M, SYS, seg)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


class BackupBase(OpsTest):
    def setUp(self):
        super().setUp()
        h = self.host
        h.write("/etc/polycarpic/host.env", "PUBLIC_ORIGIN=https://app.example.com\nPOLY_INSTANCE=%s\n" % INSTANCE)
        h.mkdir("/etc/polycarpic/secrets/host", 0o700)  # H-1: heartbeat_url is host-only, root:root 0400 under secrets/host/
        h.write("/etc/polycarpic/secrets/host/heartbeat_url", HB + "\n", 0o400)
        h.write(IMAGES_ENV, "POLY_TOOLS_IMAGE=%s\nPOLY_POSTGRES_IMAGE=%s\n" % (TOOLS_REF, PG_REF))
        for d in ("/run/polycarpic", "/srv", "/srv/polycarpic", SPOOL, SPOOL + "/wal", SPOOL + "/dump", SPOOL + "/premigration"):
            h.mkdir(d)
        self.data = {}

    # --- spool helpers (the root's view: the tree under the fake root) ---
    def spool(self, d, name, data=None):
        data = data if data is not None else ("age-encryption.org/v1\n" + name).encode()
        self.data[(d, name)] = data
        return self.host.write("%s/%s/%s" % (SPOOL, d, name), data, 0o644)

    def spool_path(self, d, name):
        return self.host.p("%s/%s/%s" % (SPOOL, d, name))

    def listing(self, d):
        return sorted(os.listdir(str(self.host.p("%s/%s" % (SPOOL, d)))))

    def state(self, name):
        p = self.host.p("%s/%s" % (STATE, name))
        return p.read_text() if p.exists() else None

    def record_lines(self):
        t = self.state("spool.sha256")
        return [l for l in (t or "").split("\n") if l]

    def write_record(self, entries):
        """entries: [(sha256, 'dir/name')]; a root-owned (the harness's trusted uid) 0644 file, as the runner writes it."""
        self.host.write("%s/spool.sha256" % STATE, "".join("%s %s\n" % e for e in entries), 0o644)

    def jobs(self):
        return [l for l in (self.state("jobs.log") or "").split("\n") if l]

    # --- the fake docker ---
    def runner(self, on_run=None, project_running=True, run_code=0, run_out="", on_rm=None, curl_code=0, extra=None):
        """A Runner with a running prod postgres, `docker rm -f`, the compose run (on_run(argv) makes files; returns (code, out, err)), curl and systemctl."""
        r = Runner(None)
        if project_running:
            stack(r, "prod", refs={"postgres": PG_REF})
        else:
            stack(r, "prod", services={"web": ("running", "healthy")})
        r.on(("rm", "-f"), fn=lambda argv, stdin: (on_rm(argv) if on_rm else None) or (0, "", ""))
        r.on(("compose", "-p", "polycarpic-prod", "-f", COMPOSE), fn=lambda argv, stdin: on_run(argv) if on_run else (run_code, run_out, ""))
        r.on(("curl",), fn=lambda argv, stdin: (curl_code, "", ""))
        r.on(("systemctl",), code=0)
        for tokens, kw in (extra or []):
            r.on(tokens, **kw)
        return r

    def pings(self, r):
        """[(argv, stdin)] of every curl call"""
        return [(c["argv"], c["stdin"]) for c in r.runner.calls if c["argv"][0] == "curl"]

    def ping_urls(self, r):
        out = []
        for argv, stdin in self.pings(r):
            m = re.search(r'"(https://[^"]+)"', stdin or "")
            out.append(m.group(1) if m else None)
        return out

    def assert_ping_hygiene(self, r):
        for argv, stdin in self.pings(r):
            self.assertIn("--config", argv)
            self.assertEqual(argv[argv.index("--config") + 1], "-")
            self.assertTrue(all(HB not in a for a in argv), "the heartbeat URL is in a curl argv")
        for c in r.runner.calls:
            self.assertTrue(HB not in json.dumps(c["env"] or {}), "the heartbeat URL is in a child environment")
        self.assertNotIn(HB, r.out + r.err + r.term.getvalue())

    def mutant_dispatcher(self, rel, old, new):
        """A mutant COPY of infra/ops with one textual change in `rel` (never a fake of the module under test)."""
        tmp = Path(tempfile.mkdtemp(prefix="poly99-mutant-"))
        self.addCleanup(shutil.rmtree, str(tmp), True)
        dst = tmp / "ops"
        shutil.copytree(str(OPS), str(dst), ignore=shutil.ignore_patterns("__pycache__"))
        f = dst / rel
        if not f.exists():
            raise AssertionError("%s does not exist (POLY-99d builds it)" % rel)
        text = f.read_text()
        if hasattr(old, "subn"):
            out, n = old.subn(new, text)
            if not n:
                raise AssertionError("mutant did not change %s: %s" % (rel, old.pattern))
        else:
            if old not in text:
                raise AssertionError("mutant did not change %s: %r" % (rel, old))
            out = text.replace(old, new, 1)
        f.write_text(out)
        return load_dispatcher(dst / "polycarpic-ops")
