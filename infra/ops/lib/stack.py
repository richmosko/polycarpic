"""Running a release (POLY-100 R4, R6-R8): compose argv built from a release directory, health (R7), and the pointers a healthy run writes.

Every compose argv fixes the project, the file and the env files itself; a release directory appears only as the value of
`-f`, `--env-file` or `--project-directory` (S7). The host executes nothing from a release.
"""
import os
import re

from lib import compose, release as rel
from lib.release import Refusal

HEALTH_WAIT = 120
POLL = 5
FETCH = "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))"
PREMIGRATION = re.compile(r"premigration-set [0-9]{8}T[0-9]{6}Z dump-[^ =]+\.age=[0-9a-f]{64} globals-[^ =]+\.age=[0-9a-f]{64}")
APP_SERVICES = ("migrate", "web", "auth", "worker")


def base(rdir, project, edge_env="/etc/polycarpic/edge.env"):
    """The fixed head of every compose call for a release directory. The shared edge project also reads /etc/polycarpic/edge.env."""
    cdir = "%s/infra/compose" % rdir
    argv = ["docker", "compose", "-p", "polycarpic-" + project, "--project-directory", cdir, "-f", "%s/%s.yml" % (cdir, project),
            "--env-file", "%s/images.env" % rdir]
    if project == "edge":
        argv += ["--env-file", edge_env]
    return argv


def refs(rdir):
    """The four image references of a release, from its images.env."""
    out = {}
    for line in (open(os.path.join(rdir, "images.env"), encoding="utf-8").read().splitlines()):
        k, _, v = line.partition("=")
        out[k] = v
    return out


def kinds(images_env):
    return {"app": images_env["POLY_APP_IMAGE"], "postgres": images_env["POLY_POSTGRES_IMAGE"], "tools": images_env["POLY_TOOLS_IMAGE"],
            "caddy": images_env["POLY_CADDY_IMAGE"]}


def run_argv(rdir, project, svc, command):
    return base(rdir, project) + ["--profile", "*", "run", "--rm", "--no-deps", "-T"] + ["--pull", "never", "--no-build"] + [svc] + command


def up_argv(rdir, project, services=(), extra=(), edge_env="/etc/polycarpic/edge.env"):
    return base(rdir, project, edge_env) + ["up", "-d", "--pull", "never", "--no-build"] + list(extra) + list(services)


def healthy_once(ctx, project, want_refs, services):
    rows = compose.ps(ctx, "polycarpic-" + project)
    if rows is None:
        return False
    for svc in services:
        row = compose.running(rows, svc)
        if not row or row.get("Health") != "healthy":
            return False
        if svc in want_refs and compose.image_ref(compose.inspect(ctx, row.get("Name", ""))) != want_refs[svc]:
            return False
    return True


def wait_healthy(ctx, project, rdir, services, wait=HEALTH_WAIT, check_http=True):
    """R7: every long-running service running, healthy and on this release's image; then web answers 200 on its health route."""
    env = refs(rdir)
    want = {"postgres": env["POLY_POSTGRES_IMAGE"], "web": env["POLY_APP_IMAGE"], "auth": env["POLY_APP_IMAGE"], "worker": env["POLY_APP_IMAGE"],
            "caddy": env["POLY_CADDY_IMAGE"]}
    start = ctx.epoch()
    while True:
        if healthy_once(ctx, project, want, services):
            if not check_http:
                return True
            code, out, _ = ctx.run(base(rdir, project) + ["exec", "-T", "web", "node", "-e", FETCH], timeout=30)
            if code == 0 and out.strip() == "200":
                return True
        if ctx.epoch() - start >= wait:
            return False
        ctx.sleep(POLL)


def services_for(project, edge=False):
    svcs = ["postgres", "web", "auth", "worker"]
    return svcs + ["caddy"] if edge else svcs


def tree(rdir):
    return rel.tree_hash(rdir) or "-"
