"""Regenerates tests/infra/ops/fixtures/compose/*.json from infra/compose/*.yml with the real `docker compose config` (needs the compose plugin, no daemon).

Sentinel digests stand in for the four images (a.. postgres, b.. tools, c.. caddy, d.. app); the tests substitute the run's own.
config reads env_file paths under /etc/polycarpic, so a temp copy points them at an empty file and the output is rewritten back.
`@@REL@@` stands for the release directory (the project directory is @@REL@@/infra/compose).
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent / "compose"
SENT = {"POSTGRES": "a", "TOOLS": "b", "CADDY": "c", "APP": "d"}
REPOS = {"POSTGRES": "polycarpic-postgres", "TOOLS": "polycarpic-tools", "CADDY": "polycarpic-caddy", "APP": "polycarpic"}


def render(files, project, env_files, raw):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        empty = tmp / "empty.env"
        empty.write_text("")
        rel = tmp / "rel"
        d = rel / "infra" / "compose"
        d.mkdir(parents=True)
        for f in files:
            text = (REPO / "infra" / "compose" / f).read_text()
            for host in ("/etc/polycarpic/host.env", "/etc/polycarpic/staging-host.env"):
                text = text.replace(host, str(empty))
            (d / f).write_text(text)
        img = tmp / "images.env"
        img.write_text("".join("POLY_%s_IMAGE=ghcr.io/richmosko/%s@sha256:%s\n" % (k, REPOS[k], SENT[k] * 64) for k in SENT))
        envs = [img]
        for name, body in env_files:
            (tmp / name).write_text(body)
            envs.append(tmp / name)
        argv = ["docker", "compose", "-p", project, "--project-directory", str(d)]
        for f in files:
            argv += ["-f", str(d / f)]
        for e in envs:
            argv += ["--env-file", str(e)]
        argv += ["config"] + (["--no-interpolate", "--no-normalize"] if raw else []) + ["--format", "json"]
        p = subprocess.run(argv, capture_output=True, text=True)
        if p.returncode:
            sys.exit("compose config failed: " + p.stderr)
        host = "/etc/polycarpic/staging-host.env" if "staging" in project else "/etc/polycarpic/host.env"
        return p.stdout.replace(str(empty), host).replace(str(rel), "@@REL@@")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    edge_env = [("edge.env", "POLY_DOMAIN=example.com\nPOLY_BIND_ADDR=0.0.0.0\nPOLY_STAGING_ALLOW=10.0.0.0/8\nPOLY_TLS=internal\n")]
    sets = {"prod": (["prod.yml"], "polycarpic-prod", []), "staging": (["staging.yml"], "polycarpic-staging", []),
            "prod-edge": (["prod.yml", "edge.yml"], "polycarpic-prod", edge_env), "edge": (["edge.yml"], "polycarpic-edge", edge_env)}
    for name, (files, project, envs) in sets.items():
        for raw in (True, False):
            text = render(files, project, envs, raw)
            json.loads(text)
            (OUT / ("%s.%s.json" % (name, "raw" if raw else "plain"))).write_text(text)
    print("wrote", sorted(p.name for p in OUT.iterdir()))


if __name__ == "__main__":
    main()
